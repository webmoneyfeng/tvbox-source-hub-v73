import { normalizeContentItem } from './content-model.mjs';

const CACHE_SCHEMA_VERSION = 1;
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const ELIGIBLE_CATEGORIES = new Set(['other_movie', 'tv_series']);
const NETWORK_RELEASE_RE = /(网络|线上|上线|online|streaming|web)/iu;
const THEATRICAL_RELEASE_RE = /(院线|影院|公映|theatrical|cinema)/iu;
const FESTIVAL_ONLY_RE = /(电影节|影展|festival|首映礼)/iu;
const DATE_RE = /(?:19|20)\d{2}(?:[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)?/u;

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value === null || value === undefined || value === '') return [];
  return [text(value)].filter(Boolean);
}

function doubanId(row) {
  const raw = text(row?.douban_id || row?.vod_douban_id);
  return /^\d+$/u.test(raw) && raw !== '0' ? raw : '';
}

function compactMetadata(metadata, fallbackId = '') {
  const id = text(metadata?.id || fallbackId);
  return {
    id,
    title: text(metadata?.title),
    original_title: text(metadata?.original_title),
    subtype: text(metadata?.subtype).toLowerCase(),
    is_tv: metadata?.is_tv === true,
    pubdate: values(metadata?.pubdate),
    release_date: values(metadata?.release_date),
    pre_release_desc: text(metadata?.pre_release_desc),
    year: text(metadata?.year),
  };
}

export function classifyDoubanReleaseMetadata(metadata = {}) {
  const compact = compactMetadata(metadata);
  const releaseEntries = [...compact.pubdate, ...compact.release_date, compact.pre_release_desc].filter(Boolean);
  const releaseText = releaseEntries.join(' | ');
  if (!releaseText) return null;
  const subtype = compact.subtype;
  const isTv = compact.is_tv || subtype === 'tv' || subtype === 'series';
  const isMovie = !isTv && (subtype === 'movie' || subtype === 'film' || metadata?.is_tv === false);
  const network = NETWORK_RELEASE_RE.test(releaseText);
  const theatricalSignal = THEATRICAL_RELEASE_RE.test(releaseText);
  const regularDatedRelease = releaseEntries.some((entry) => DATE_RE.test(entry)
    && !NETWORK_RELEASE_RE.test(entry)
    && !FESTIVAL_ONLY_RE.test(entry));

  if (isTv && network) {
    return { primary_category: 'web_series', release_channel: 'web', confidence: 0.96, value: releaseText };
  }
  if (!isMovie) return null;
  if (network) {
    return { primary_category: 'web_movie', release_channel: 'web', confidence: 0.96, value: releaseText };
  }
  if (theatricalSignal || regularDatedRelease) {
    return { primary_category: 'theatrical_movie', release_channel: 'theatrical', confidence: theatricalSignal ? 0.96 : 0.9, value: releaseText };
  }
  return null;
}

export function applyDoubanReleaseMetadata(row = {}, metadata = {}) {
  const current = text(row?.primary_category);
  if (!ELIGIBLE_CATEGORIES.has(current)) return row;
  const id = doubanId(row) || text(metadata?.id);
  if (!id) return row;
  const compact = compactMetadata(metadata, id);
  const release = classifyDoubanReleaseMetadata(compact);
  if (!release) return { ...row, douban_id: id, external_release_metadata: compact };
  if (current === 'other_movie' && !['theatrical_movie', 'web_movie'].includes(release.primary_category)) return row;
  if (current === 'tv_series' && release.primary_category !== 'web_series') return row;

  const label = release.primary_category === 'web_series'
    ? '网络剧'
    : release.primary_category === 'web_movie' ? '网络电影' : '院线电影';
  const explicitTags = [...new Set([...values(row.explicit_tags), label])];
  const normalized = normalizeContentItem({
    ...row,
    douban_id: id,
    explicit_tags: explicitTags,
    release_channel: release.release_channel,
    external_release_metadata: compact,
  });
  const evidence = {
    source: 'douban_release_metadata',
    priority: 3,
    category: release.primary_category,
    field: 'douban.pubdate',
    value: release.value,
    signal: release.release_channel,
    provider: 'douban',
    external_id: id,
  };
  return {
    ...normalized,
    primary_category: release.primary_category,
    movie_release_channel: release.primary_category === 'web_series' ? 'unknown' : release.release_channel,
    release_channel: release.release_channel,
    classification_evidence: [evidence, ...(normalized.classification_evidence || []).filter((entry) => entry?.source !== 'douban_release_metadata')],
    classification_confidence: release.confidence,
    classification_confidence_level: 'high',
    classification_confidence_score: release.confidence,
  };
}

function freshCacheEntry(entry, nowMs) {
  const fetchedAt = Date.parse(entry?.fetchedAt || '');
  if (!Number.isFinite(fetchedAt)) return false;
  return nowMs - fetchedAt <= (entry?.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
}

async function mapLimit(items, limit, worker) {
  const input = [...items];
  const output = new Array(input.length);
  let next = 0;
  async function run() {
    while (next < input.length) {
      const index = next;
      next += 1;
      output[index] = await worker(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, input.length || 1)) }, run));
  return output;
}

export async function enrichRowsWithDoubanMetadata(rows = [], options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const maxFetch = Math.max(0, Math.trunc(Number(options.maxFetch ?? 500)));
  const concurrency = Math.max(1, Math.trunc(Number(options.concurrency ?? 6)));
  const fetchMetadata = options.fetchMetadata;
  const existingEntries = options.cache?.entries && typeof options.cache.entries === 'object'
    ? options.cache.entries
    : {};
  const entries = { ...existingEntries };
  const eligibleIds = [...new Set(rows
    .filter((row) => ELIGIBLE_CATEGORIES.has(text(row?.primary_category)))
    .map(doubanId)
    .filter(Boolean))];
  const cacheHits = eligibleIds.filter((id) => freshCacheEntry(entries[id], nowMs));
  const missing = eligibleIds.filter((id) => !freshCacheEntry(entries[id], nowMs));
  const selected = missing.slice(0, maxFetch);
  let failed = 0;

  if (selected.length && typeof fetchMetadata === 'function') {
    await mapLimit(selected, concurrency, async (id) => {
      try {
        const metadata = compactMetadata(await fetchMetadata(id), id);
        if (!metadata.id || (!metadata.subtype && metadata.is_tv !== true && !metadata.pubdate.length)) throw new Error('release metadata is incomplete');
        entries[id] = { ok: true, fetchedAt: new Date(nowMs).toISOString(), metadata };
      } catch (error) {
        failed += 1;
        entries[id] = { ok: false, fetchedAt: new Date(nowMs).toISOString(), error: text(error?.message || error) };
      }
    });
  }

  const enrichedRows = rows.map((row) => {
    const id = doubanId(row);
    const entry = id ? entries[id] : null;
    return entry?.ok && entry.metadata ? applyDoubanReleaseMetadata(row, entry.metadata) : row;
  });
  return {
    rows: enrichedRows,
    cache: { schemaVersion: CACHE_SCHEMA_VERSION, generatedAt: new Date(nowMs).toISOString(), entries },
    stats: {
      eligibleIds: eligibleIds.length,
      cacheHits: cacheHits.length,
      fetched: selected.length - failed,
      failed,
      deferred: Math.max(0, missing.length - selected.length),
      classified: enrichedRows.filter((row, index) => row.primary_category !== rows[index]?.primary_category).length,
    },
  };
}

export function tagReleaseBackfillRow(row = {}, targetCategory = '') {
  const title = text(row?.vod_name || row?.name || row?.title);
  let matches = false;
  let label = '';
  if (targetCategory === 'web_series') {
    matches = /(网络剧|网剧(?:版)?)/u.test(title);
    label = '网络剧';
  } else if (targetCategory === 'web_movie') {
    matches = /(网络(?:大)?电影|VIP\s*网大|^网大(?:\s|[：:·-]|$)|网大(?:电影|影片))/iu.test(title);
    label = '网络电影';
  }
  if (!matches) return null;
  return {
    ...row,
    explicit_tags: [...new Set([...values(row.explicit_tags), label])],
    release_channel: 'web',
    release_metadata_evidence: `source-search-title:${title}`,
  };
}

export default Object.freeze({
  applyDoubanReleaseMetadata,
  classifyDoubanReleaseMetadata,
  enrichRowsWithDoubanMetadata,
  tagReleaseBackfillRow,
});
