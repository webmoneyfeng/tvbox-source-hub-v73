import { createHash } from 'node:crypto';

import { isAdultPolicyContent, normalizeContentItem } from './content-model.mjs';
import { inspectSourceTimestamp, latestPlausibleSourceTimestamp } from './source-time.mjs';

export const SNAPSHOT_CATEGORIES = Object.freeze([
  Object.freeze({ id: '0', key: 'recommend', name: '推荐' }),
  Object.freeze({ id: '10', key: 'theatrical_movie', name: '院线电影' }),
  Object.freeze({ id: '11', key: 'web_movie', name: '网络电影' }),
  Object.freeze({ id: '12', key: 'other_movie', name: '其他电影' }),
  Object.freeze({ id: '20', key: 'tv_series', name: '电视剧' }),
  Object.freeze({ id: '21', key: 'web_series', name: '网络剧' }),
  Object.freeze({ id: '6', key: 'web_short', name: '网络短剧' }),
  Object.freeze({ id: '3', key: 'variety', name: '综艺' }),
  Object.freeze({ id: '4', key: 'anime', name: '动漫' }),
  Object.freeze({ id: '5', key: 'documentary', name: '纪录片' }),
  Object.freeze({ id: '7', key: 'explainer', name: '解说' }),
  Object.freeze({ id: '8', key: 'knowledge', name: '文娱知识' }),
  Object.freeze({ id: '9', key: 'adult', name: '成人伦理' }),
]);

export const SNAPSHOT_PRIMARY_CATEGORIES = Object.freeze(
  SNAPSHOT_CATEGORIES.filter((category) => category.key !== 'recommend'),
);

export const LEGACY_CATEGORY_PACKS = Object.freeze({
  1: Object.freeze(['theatrical_movie', 'web_movie', 'other_movie']),
  2: Object.freeze(['tv_series', 'web_series']),
  6: Object.freeze(['web_short']),
});

const CATEGORY_BY_ID = new Map(SNAPSHOT_CATEGORIES.map((category) => [category.id, category]));
const CATEGORY_BY_KEY = new Map(SNAPSHOT_CATEGORIES.map((category) => [category.key, category]));
const CATEGORY_BY_NAME = new Map(SNAPSHOT_CATEGORIES.map((category) => [category.name, category]));
const CATEGORY_ORDER = new Map(SNAPSHOT_CATEGORIES.map((category, index) => [category.key, index]));
const SOURCE_CATEGORY_MAP = Object.freeze(Object.fromEntries(SNAPSHOT_CATEGORIES.flatMap((category) => [
  [category.id, category.key],
  [category.key, category.key],
  [category.name, category.key],
])));
const UPDATED_AT_FIELDS = [
  'source_updated_at',
  'content_changed_at',
  'vod_time',
  'vod_time_add',
  'vod_pubdate',
];

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function categoryFor(value) {
  const normalized = text(value);
  return CATEGORY_BY_ID.get(normalized)
    || CATEGORY_BY_KEY.get(normalized.toLowerCase())
    || CATEGORY_BY_NAME.get(normalized)
    || null;
}

function sourceCategoryForRow(row) {
  return categoryFor(row?.primary_category)
    || categoryFor(row?.source_category_id)
    || categoryFor(row?.type_id)
    || categoryFor(row?.type_name);
}

function uniqueObjects(values, keyFn) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object') continue;
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function inferredSourceCandidate(row) {
  const id = text(row?.source_id || row?.vod_id || row?.id);
  if (!id || id.startsWith('agg_')) return null;
  return {
    source: text(row?._sourceSlug || row?.source_slug || row?.source || row?._sourceShort || 'aggregate'),
    id,
    url: text(row?.source_url || row?.api || ''),
  };
}

function sourceCandidates(row) {
  const explicit = Array.isArray(row?.source_candidates) ? row.source_candidates : [];
  const inferred = explicit.length ? null : inferredSourceCandidate(row);
  const merged = new Map();
  for (const candidate of [...explicit, ...(inferred ? [inferred] : [])]) {
    const source = text(candidate?.source);
    const id = text(candidate?.id);
    if (!source || !id) continue;
    const key = `${source}|${id}`;
    const previous = merged.get(key) || {};
    merged.set(key, {
      ...previous,
      ...candidate,
      source,
      id,
      url: text(candidate?.url || previous.url),
      updated_at: text(candidate?.updated_at || previous.updated_at),
    });
  }
  return [...merged.values()];
}

function aggregateVodId(candidates, fallback = '') {
  const payload = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ s: text(candidate?.source), id: text(candidate?.id) }))
    .filter((candidate) => candidate.s && candidate.id)
    .sort((left, right) => left.s.localeCompare(right.s) || left.id.localeCompare(right.id));
  if (!payload.length) return text(fallback);
  return `agg_${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function playLines(row) {
  const explicit = Array.isArray(row?.play_lines) ? row.play_lines : [];
  const from = text(row?.vod_play_from).split('$$$').map(text).filter(Boolean);
  const urls = text(row?.vod_play_url).split('$$$').map(text).filter(Boolean);
  const inferred = from.map((name, index) => ({
    source: text(row?._sourceSlug || row?.source_slug || row?.source || 'aggregate'),
    name,
    url: urls[index] || '',
  })).filter((line) => line.url);
  return uniqueObjects([...explicit, ...inferred], (line) => [line.source, line.name, line.url].map(text).join('|'));
}

function evidenceKey(evidence) {
  if (!evidence || typeof evidence !== 'object') return text(evidence);
  return JSON.stringify({
    source: evidence.source,
    priority: evidence.priority,
    category: evidence.category,
    field: evidence.field,
    value: evidence.value,
    signal: evidence.signal,
  });
}

function normalizedRow(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const category = sourceCategoryForRow(input);
  const prepared = category
    ? { ...input, source_category_id: category.id }
    : { ...input };
  const normalized = normalizeContentItem(prepared, { sourceCategoryMap: SOURCE_CATEGORY_MAP });
  const candidates = sourceCandidates(normalized);
  return {
    ...normalized,
    vod_id: aggregateVodId(candidates, normalized.vod_id),
    source_category_id: category?.id || text(normalized.source_category_id),
    source_candidates: candidates,
    play_lines: playLines(normalized),
  };
}

export function normalizeSnapshotRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object' && (row.vod_id || row.vod_name || row.name || row.title))
    .map(normalizedRow);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rowScore(row) {
  const confidence = numeric(row?.classification_confidence);
  const evidence = Array.isArray(row?.classification_evidence) ? row.classification_evidence.length : 0;
  const sources = Array.isArray(row?.source_candidates) ? row.source_candidates.length : 0;
  const lines = Array.isArray(row?.play_lines) ? row.play_lines.length : 0;
  const categoryPriority = SNAPSHOT_CATEGORIES.length - (CATEGORY_ORDER.get(row?.primary_category) ?? SNAPSHOT_CATEGORIES.length);
  return confidence * 100_000 + evidence * 1_000 + sources * 100 + lines * 10 + categoryPriority;
}

function betterRow(left, right) {
  const leftScore = rowScore(left);
  const rightScore = rowScore(right);
  if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
  return text(left?.vod_name || left?.name).length <= text(right?.vod_name || right?.name).length ? left : right;
}

function maxNumeric(...values) {
  const result = Math.max(...values.map(numeric));
  return result > 0 ? result : '';
}

function preferredCanonicalId(left, right, best) {
  const ids = [left?.canonical_id, right?.canonical_id].map(text).filter(Boolean);
  const external = ids.find((id) => id.startsWith('ext:'));
  return external || text(best?.canonical_id || ids[0]);
}

function mergeTwoRows(left, right) {
  const best = betterRow(left, right);
  const candidates = sourceCandidates({ source_candidates: [
    ...sourceCandidates(left),
    ...sourceCandidates(right),
  ] });
  return {
    ...best,
    canonical_id: preferredCanonicalId(left, right, best),
    vod_id: aggregateVodId(candidates, best.vod_id || left.vod_id || right.vod_id),
    episode_count: maxNumeric(left.episode_count, right.episode_count, left.vod_total, right.vod_total)
      || best.episode_count || best.vod_total || '',
    latest_episode: maxNumeric(left.latest_episode, right.latest_episode, left.vod_serial, right.vod_serial)
      || best.latest_episode || best.vod_serial || '',
    source_candidates: candidates,
    play_lines: uniqueObjects([
      ...playLines(left),
      ...playLines(right),
    ], (line) => [line.source, line.name, line.url].map(text).join('|')),
    classification_evidence: uniqueObjects([
      ...(Array.isArray(left.classification_evidence) ? left.classification_evidence : []),
      ...(Array.isArray(right.classification_evidence) ? right.classification_evidence : []),
    ], evidenceKey),
  };
}

function normalizeSemanticToken(value) {
  return text(value).toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function semanticSeason(row) {
  const explicit = text(row?.season || row?.vod_season || row?.season_number);
  if (/^\d{1,3}$/u.test(explicit)) return String(Number(explicit));
  const title = text(row?.vod_name || row?.name || row?.title);
  const match = title.match(/(?:第\s*)?(\d{1,3})\s*季|\bS(\d{1,3})\b/iu);
  return match ? String(Number(match[1] ?? match[2])) : '0';
}

function semanticIdentityKey(row) {
  const title = normalizeSemanticToken(row?.vod_name || row?.name || row?.title);
  const year = text(row?.vod_year || row?.year).match(/(?:19|20)\d{2}/u)?.[0] || '';
  if (!title || !year) return '';
  return `${title}|${year}|${semanticSeason(row)}`;
}

function creatorTokens(row) {
  const raw = [row?.vod_actor, row?.actors, row?.vod_director, row?.directors]
    .flatMap((value) => String(value || '').split(/[,，、/|;；]+/u));
  return new Set(raw.map(normalizeSemanticToken).filter(Boolean));
}

function externalCanonicalId(row) {
  const id = text(row?.canonical_id);
  return id.startsWith('ext:') ? id : '';
}

function semanticMergeCompatible(left, right) {
  const key = semanticIdentityKey(left);
  if (!key || key !== semanticIdentityKey(right)) return false;
  const leftExternal = externalCanonicalId(left);
  const rightExternal = externalCanonicalId(right);
  if (leftExternal && rightExternal && leftExternal !== rightExternal) return false;
  const leftCreators = creatorTokens(left);
  const rightCreators = creatorTokens(right);
  if (!leftCreators.size || !rightCreators.size) return false;
  for (const creator of leftCreators) if (rightCreators.has(creator)) return true;
  return false;
}

function compareRows(left, right) {
  return (CATEGORY_ORDER.get(left?.primary_category) ?? 999) - (CATEGORY_ORDER.get(right?.primary_category) ?? 999)
    || numeric(right?.vod_year) - numeric(left?.vod_year)
    || text(left?.vod_name || left?.name).localeCompare(text(right?.vod_name || right?.name), 'zh-CN')
    || text(left?.canonical_id).localeCompare(text(right?.canonical_id));
}

function recommendationTimestamp(row) {
  for (const field of UPDATED_AT_FIELDS) {
    const value = text(row?.[field]);
    if (!value) continue;
    if (/^\d{10,13}$/u.test(value)) {
      const numericValue = Number(value);
      const milliseconds = value.length === 10 ? numericValue * 1000 : numericValue;
      if (Number.isFinite(milliseconds)) return milliseconds;
    }
    const withZone = value.includes('T') ? value : value.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/u.test(value) ? '' : '+08:00');
    const parsed = Date.parse(withZone);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function compareRecommendationRows(left, right) {
  return recommendationTimestamp(right) - recommendationTimestamp(left)
    || numeric(right?.vod_year) - numeric(left?.vod_year)
    || (right?.source_candidates?.length || 0) - (left?.source_candidates?.length || 0)
    || (right?.play_lines?.length || 0) - (left?.play_lines?.length || 0)
    || numeric(right?.classification_confidence) - numeric(left?.classification_confidence)
    || text(left?.vod_name || left?.name).localeCompare(text(right?.vod_name || right?.name), 'zh-CN')
    || text(left?.canonical_id).localeCompare(text(right?.canonical_id));
}

export function mergeSnapshotRows(input) {
  const rows = normalizeSnapshotRows(input);
  const grouped = new Map();
  for (const row of rows) {
    const key = text(row.canonical_id);
    if (!key) continue;
    const previous = grouped.get(key);
    grouped.set(key, previous ? mergeTwoRows(previous, row) : row);
  }
  const semanticGroups = new Map();
  const merged = [];
  for (const row of grouped.values()) {
    const semanticKey = semanticIdentityKey(row);
    const candidates = semanticKey ? (semanticGroups.get(semanticKey) || []) : [];
    const index = candidates.find((candidateIndex) => semanticMergeCompatible(merged[candidateIndex], row));
    if (index !== undefined) {
      merged[index] = mergeTwoRows(merged[index], row);
      continue;
    }
    const nextIndex = merged.length;
    merged.push(row);
    if (semanticKey) semanticGroups.set(semanticKey, [...candidates, nextIndex]);
  }
  merged.sort(compareRows);
  return {
    rows: merged,
    duplicate_count: Math.max(0, rows.length - merged.length),
  };
}

export function snapshotRetentionGate(input = {}) {
  const previousCount = Math.max(0, Math.trunc(Number(input.previousCount) || 0));
  const nextCount = Math.max(0, Math.trunc(Number(input.nextCount) || 0));
  const minimumBaseline = Math.max(1, Math.trunc(Number(input.minimumBaseline) || 100));
  const minimumRatio = Math.min(1, Math.max(0, Number(input.minimumRatio) || 0.6));
  const ratio = previousCount > 0 ? nextCount / previousCount : 1;
  const ok = previousCount < minimumBaseline || ratio >= minimumRatio;
  return {
    ok,
    previousCount,
    nextCount,
    ratio: Number(ratio.toFixed(4)),
    minimumRatio,
    sourceQuorumRatio: Number(input.sourceQuorumRatio || 0),
    root_cause: ok ? 'OK' : 'CATALOG_RETENTION_REGRESSION',
  };
}

export function buildCatalogViews(input) {
  const rows = mergeSnapshotRows(input).rows;
  const canonical = Object.fromEntries(SNAPSHOT_CATEGORIES.map((category) => [category.key, []]));
  for (const row of rows) {
    const category = CATEGORY_BY_KEY.get(text(row.primary_category));
    if (category && category.key !== 'recommend') canonical[category.key].push(row);
  }
  canonical.recommend = [...rows].sort(compareRecommendationRows);
  const legacy = {};
  for (const [legacyId, categoryKeys] of Object.entries(LEGACY_CATEGORY_PACKS)) {
    legacy[legacyId] = mergeSnapshotRows(categoryKeys.flatMap((key) => canonical[key] || [])).rows;
  }
  const primary = Object.fromEntries(
    SNAPSHOT_PRIMARY_CATEGORIES.map((category) => [category.key, canonical[category.key]]),
  );
  return { rows, canonical, primary, legacy };
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function revisionProjection(row) {
  return {
    canonical_id: row.canonical_id,
    primary_category: row.primary_category,
    vod_name: row.vod_name || row.name || row.title || '',
    vod_year: row.vod_year || row.year || '',
    vod_serial: row.vod_serial || '',
    vod_total: row.vod_total || '',
    vod_duration: row.vod_duration || '',
    episode_count: row.episode_count || '',
    latest_episode: row.latest_episode || '',
    source_candidates: row.source_candidates || [],
    play_lines: row.play_lines || [],
  };
}

export function buildSnapshotRevision(input) {
  const rows = mergeSnapshotRows(input).rows
    .map(revisionProjection)
    .sort((left, right) => text(left.canonical_id).localeCompare(text(right.canonical_id)));
  const digest = createHash('sha256').update(stableValue(rows)).digest('hex').slice(0, 20);
  return `snapshot-${digest}`;
}

function chunk(values, shardSize) {
  const out = [];
  for (let index = 0; index < values.length; index += shardSize) out.push(values.slice(index, index + shardSize));
  return out;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');
}

function byteBoundedShards(values, { maxRows, maxBytes, makeShard }) {
  if (!Number.isFinite(maxBytes)) {
    return chunk(values, maxRows).map((items, index) => makeShard(items, index, index * maxRows));
  }
  const shards = [];
  let start = 0;
  while (start < values.length) {
    const maximumCount = Math.min(maxRows, values.length - start);
    const maximumShard = makeShard(values.slice(start, start + maximumCount), shards.length, start);
    if (serializedBytes(maximumShard) <= maxBytes) {
      shards.push(maximumShard);
      start += maximumCount;
      continue;
    }

    let low = 1;
    let high = maximumCount - 1;
    let acceptedCount = 0;
    let acceptedShard = null;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = makeShard(values.slice(start, start + count), shards.length, start);
      if (serializedBytes(candidate) <= maxBytes) {
        acceptedCount = count;
        acceptedShard = candidate;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (!acceptedShard) {
      const single = makeShard([values[start]], shards.length, start);
      throw new RangeError(`single snapshot shard item exceeds ${maxBytes} byte limit at offset ${start} (${serializedBytes(single)} bytes)`);
    }
    shards.push(acceptedShard);
    start += acceptedCount;
  }
  return shards;
}

function splitTerms(value) {
  if (Array.isArray(value)) return value.flatMap(splitTerms);
  return text(value).split(/[,，、/|;；]+/u).map(text).filter(Boolean);
}

function searchDocument(row) {
  const aliases = [...new Set([
    ...splitTerms(row.aliases),
    ...splitTerms(row.vod_sub),
    ...splitTerms(row.original_title),
  ])];
  const actors = [...new Set(splitTerms(row.vod_actor || row.actors))];
  const directors = [...new Set(splitTerms(row.vod_director || row.directors))];
  const fields = [
    row.vod_name,
    ...aliases,
    ...actors,
    ...directors,
    row.vod_year,
    row.vod_area,
    row.vod_class,
    row.type_name,
    row.primary_category,
    row.content_form,
    row.semantic_tags,
  ].map(text).filter(Boolean);
  return {
    canonical_id: row.canonical_id,
    title: text(row.vod_name || row.name || row.title),
    aliases,
    actors,
    directors,
    year: text(row.vod_year || row.year),
    area: text(row.vod_area || row.area),
    category: text(row.primary_category),
    type: text(row.vod_class || row.type_name),
    content_form: text(row.content_form),
    search_text: fields.join(' '),
  };
}

function policyIndex(rows, policy, revision, shardSize, maxShardBytes) {
  const catalogShards = byteBoundedShards(rows, {
    maxRows: shardSize,
    maxBytes: maxShardBytes,
    makeShard: (shardRows, index, start) => ({
      id: `catalog-${String(index + 1).padStart(5, '0')}`,
      revision,
      policy,
      start,
      count: shardRows.length,
      rows: shardRows,
    }),
  });
  const documents = rows.map(searchDocument);
  const searchShards = byteBoundedShards(documents, {
    maxRows: shardSize,
    maxBytes: maxShardBytes,
    makeShard: (shardDocuments, index, start) => ({
      id: `search-${String(index + 1).padStart(5, '0')}`,
      revision,
      policy,
      start,
      count: shardDocuments.length,
      documents: shardDocuments,
    }),
  });
  return { revision, policy, total: rows.length, catalogShards, searchShards };
}

export function buildSnapshotIndexes(input, options = {}) {
  const shardSize = Number(options.shardSize ?? 750);
  if (!Number.isInteger(shardSize) || shardSize < 500 || shardSize > 1000) {
    throw new RangeError('snapshot shardSize must be between 500 and 1000 rows');
  }
  const maxShardBytes = options.maxShardBytes === undefined ? Number.POSITIVE_INFINITY : Number(options.maxShardBytes);
  if (maxShardBytes !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxShardBytes) || maxShardBytes < 1024)) {
    throw new RangeError('snapshot maxShardBytes must be at least 1024 bytes');
  }
  const rows = mergeSnapshotRows(input).rows;
  const revision = text(options.revision) || buildSnapshotRevision(rows);
  const cleanRows = rows.filter((row) => !isAdultPolicyContent(row));
  return {
    revision,
    shardSize,
    maxShardBytes: Number.isFinite(maxShardBytes) ? maxShardBytes : null,
    full: policyIndex(rows, 'full', revision, shardSize, maxShardBytes),
    clean: policyIndex(cleanRows, 'clean-no-adult', revision, shardSize, maxShardBytes),
  };
}

function rowUpdatedAtMs(row, options = {}) {
  return latestPlausibleSourceTimestamp(row, { ...options, fields: UPDATED_AT_FIELDS }).ms;
}

export function extractUpdatedAt(input, options = {}) {
  return latestPlausibleSourceTimestamp(input, { ...options, fields: UPDATED_AT_FIELDS }).iso;
}

function fingerprint(row) {
  return stableValue(revisionProjection(row));
}

export async function crawlIncrementalCatalog(options = {}) {
  if (typeof options.fetchPage !== 'function') throw new TypeError('crawlIncrementalCatalog requires fetchPage(page)');
  const maxPages = Math.max(1, Number(options.maxPages || 500));
  const previousRows = mergeSnapshotRows(options.previousRows || []).rows;
  const collectedRows = mergeSnapshotRows(options.collectedRows || []).rows;
  const baseline = new Map(previousRows.map((row) => [row.canonical_id, fingerprint(row)]));
  const accumulated = [...previousRows, ...collectedRows];
  const timeOptions = { nowMs: options.nowMs, maxFutureSkewMs: options.maxFutureSkewMs };
  const watermarkMs = inspectSourceTimestamp(options.watermark, timeOptions).effectiveMs;
  let page = Math.max(1, Number(options.resume?.nextPage || 1));
  let consecutiveStalePages = Math.max(0, Number(options.resume?.consecutiveStalePages || 0));
  let fetchedPages = 0;
  let stopReason = 'max-pages';

  while (fetchedPages < maxPages) {
    const data = await options.fetchPage(page);
    const rawRows = Array.isArray(data?.list) ? data.list : [];
    const pageRows = normalizeSnapshotRows(rawRows);
    fetchedPages += 1;

    if (!pageRows.length) {
      stopReason = 'empty-page';
      if (typeof options.onCheckpoint === 'function') {
        await options.onCheckpoint({ page, nextPage: page + 1, consecutiveStalePages, stopReason, pageData: data, pageRows });
      }
      break;
    }

    const pageChanged = pageRows.some((row) => baseline.get(row.canonical_id) !== fingerprint(row));
    const timestamps = pageRows.map((row) => rowUpdatedAtMs(row, timeOptions)).filter(Boolean);
    const pageOlderThanWatermark = watermarkMs > 0
      && timestamps.length === pageRows.length
      && Math.max(...timestamps) <= watermarkMs;
    consecutiveStalePages = pageOlderThanWatermark && !pageChanged ? consecutiveStalePages + 1 : 0;
    accumulated.push(...pageRows);

    const nextPage = page + 1;
    const pageCount = Math.max(0, Number(data?.pagecount || data?.page_count || 0));
    if (consecutiveStalePages >= 2) stopReason = 'two-stale-pages';
    else if (pageCount > 0 && page >= pageCount) stopReason = 'pagecount';
    else stopReason = '';

    if (typeof options.onCheckpoint === 'function') {
      await options.onCheckpoint({
        page,
        nextPage,
        consecutiveStalePages,
        stopReason,
        pageData: data,
        pageRows,
      });
    }
    page = nextPage;
    if (stopReason) break;
  }

  const merged = mergeSnapshotRows(accumulated);
  return {
    ...merged,
    nextPage: page,
    consecutiveStalePages,
    fetchedPages,
    stopReason: stopReason || 'max-pages',
    watermark: extractUpdatedAt(merged.rows, timeOptions),
  };
}

export default Object.freeze({
  SNAPSHOT_CATEGORIES,
  LEGACY_CATEGORY_PACKS,
  normalizeSnapshotRows,
  mergeSnapshotRows,
  buildCatalogViews,
  buildSnapshotRevision,
  buildSnapshotIndexes,
  extractUpdatedAt,
  crawlIncrementalCatalog,
});
