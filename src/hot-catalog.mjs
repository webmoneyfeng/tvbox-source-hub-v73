const PUNCTUATION_RE = /[\s\u3000\u00b7\u30fb,.;:!?\-_/\\|\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u2014()[\]{}<>"'`]+/g;

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(PUNCTUATION_RE, '').toLowerCase();
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function latestIso(...values) {
  let best = '';
  let bestTime = 0;
  for (const value of values) {
    const text = String(value || '').trim();
    const time = Date.parse(text);
    if (Number.isFinite(time) && time >= bestTime) {
      best = new Date(time).toISOString();
      bestTime = time;
    }
  }
  return best;
}

function canonicalKey(row) {
  const canonical = String(row?.canonical_id || '').trim();
  if (canonical.startsWith('ext:')) return canonical;
  const title = normalize(row?.vod_name || row?.name);
  const year = String(row?.vod_year || row?.year || '').match(/(?:19|20)\d{2}/)?.[0] || '';
  const season = String(row?.season || row?.vod_season || row?.season_number || row?.vod_name || '').match(/(?:\u7b2c\s*)?(\d{1,3})\s*\u5b63|\bs(\d{1,3})\b/i);
  const seasonNumber = season ? String(Number(season[1] ?? season[2])) : '0';
  if (!title) return canonical;
  return `meta-base:${title}|${year || 'unknown'}|${seasonNumber}`;
}

function creatorTokens(row) {
  const values = [
    row?.vod_actor,
    row?.actor,
    row?.actors,
    row?.vod_director,
    row?.director,
    row?.directors,
  ];
  const out = new Set();
  for (const value of values) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      for (const token of String(entry || '').split(/[,\u3001/|;\s]+/u)) {
        const normalized = normalize(token);
        if (normalized) out.add(normalized);
      }
    }
  }
  return out;
}

function externalCanonicalId(row) {
  const value = String(row?.canonical_id || '').trim();
  return value.startsWith('ext:') ? value : '';
}

function yearForIdentity(row) {
  return String(row?.vod_year || row?.year || '').match(/(?:19|20)\d{2}/)?.[0] || '';
}

export function rowsIdentityCompatible(left, right) {
  const leftExternal = externalCanonicalId(left);
  const rightExternal = externalCanonicalId(right);
  if (leftExternal && rightExternal) return leftExternal === rightExternal;
  if (normalize(left?.vod_name || left?.name) !== normalize(right?.vod_name || right?.name)) return false;
  const leftYear = yearForIdentity(left);
  const rightYear = yearForIdentity(right);
  if (leftYear && rightYear && leftYear !== rightYear) return false;
  const leftCreators = creatorTokens(left);
  const rightCreators = creatorTokens(right);
  if (leftCreators.size && rightCreators.size && ![...leftCreators].some((value) => rightCreators.has(value))) return false;
  return true;
}

function uniqueObjects(values, keyFn) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function rowScore(row) {
  const confidence = numeric(row?.classification_confidence);
  const evidence = Array.isArray(row?.classification_evidence) ? row.classification_evidence.length : 0;
  const lines = Array.isArray(row?.play_lines) ? row.play_lines.length : 0;
  const sources = Array.isArray(row?.source_candidates) ? row.source_candidates.length : 0;
  return confidence * 1000 + evidence * 50 + lines * 5 + sources;
}

function betterRow(left, right) {
  const leftScore = rowScore(left);
  const rightScore = rowScore(right);
  if (leftScore !== rightScore) return leftScore >= rightScore ? left : right;
  return String(left?.vod_name || '').length <= String(right?.vod_name || '').length ? left : right;
}

function sortRows(left, right) {
  return String(left?.primary_category || '').localeCompare(String(right?.primary_category || ''))
    || numeric(right?.vod_year) - numeric(left?.vod_year)
    || String(left?.vod_name || '').localeCompare(String(right?.vod_name || ''))
    || String(left?.canonical_id || '').localeCompare(String(right?.canonical_id || ''));
}

export function mergeHotRows(input) {
  const rows = Array.isArray(input) ? input.filter((row) => row && (row.vod_id || row.vod_name || row.name)) : [];
  const grouped = new Map();
  for (const raw of rows) {
    const key = canonicalKey(raw);
    if (!key) continue;
    const bucket = grouped.get(key) || [];
    const index = bucket.findIndex((current) => rowsIdentityCompatible(current, raw));
    const current = index >= 0 ? bucket[index] : null;
    if (!current) {
      bucket.push({ ...raw, canonical_id: String(raw.canonical_id || key) });
      grouped.set(key, bucket);
      continue;
    }
    const best = betterRow(current, raw);
    const merged = {
      ...best,
      canonical_id: String(best.canonical_id || key),
      hot_seen_at: latestIso(current.hot_seen_at, raw.hot_seen_at) || best.hot_seen_at || '',
      episode_count: Math.max(numeric(current.episode_count), numeric(raw.episode_count)) || best.episode_count || current.episode_count || 0,
      latest_episode: Math.max(numeric(current.latest_episode), numeric(raw.latest_episode)) || best.latest_episode || current.latest_episode || 0,
      source_candidates: uniqueObjects([
        ...(current.source_candidates || []),
        ...(raw.source_candidates || []),
      ], (value) => `${value?.source || ''}|${value?.id || ''}|${value?.url || ''}`),
      play_lines: uniqueObjects([
        ...(current.play_lines || []),
        ...(raw.play_lines || []),
      ], (value) => `${value?.source || ''}|${value?.name || ''}|${value?.url || ''}`),
      classification_evidence: [...new Set([
        ...(current.classification_evidence || []),
        ...(raw.classification_evidence || []),
      ])],
    };
    bucket[index] = merged;
    grouped.set(key, bucket);
  }
  const mergedRows = [...grouped.values()].flat().sort(sortRows);
  return { rows: mergedRows, duplicate_count: Math.max(0, rows.length - mergedRows.length) };
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

function hashText(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function contentProjection(row) {
  return {
    canonical_id: row.canonical_id,
    vod_name: row.vod_name,
    vod_year: row.vod_year,
    primary_category: row.primary_category,
    episode_count: numeric(row.episode_count),
    latest_episode: numeric(row.latest_episode),
    episode_duration: row.episode_duration || '',
    source_candidates: row.source_candidates || [],
    play_lines: row.play_lines || [],
  };
}

export function buildHotPackage(input, options = {}) {
  const merged = mergeHotRows(input).rows;
  const contentHash = hashText(stableValue(merged.map(contentProjection)));
  const categories = {};
  for (const row of merged) {
    const category = String(row.primary_category || 'other').trim() || 'other';
    if (!categories[category]) categories[category] = [];
    categories[category].push(row);
  }
  return {
    schema_version: 1,
    revision: String(options.revision || `hot-${contentHash}`),
    checked_at: String(options.checkedAt || ''),
    content_changed_at: String(options.contentChangedAt || options.checkedAt || ''),
    content_hash: contentHash,
    total: merged.length,
    rows: merged,
    categories,
  };
}

export function shouldPublishHotPackage(previous, next) {
  return !previous || String(previous.content_hash || '') !== String(next?.content_hash || '');
}

export function filterHotRows(input, options = {}) {
  const rows = mergeHotRows(input).rows;
  const category = String(options.category || '').trim();
  const query = normalize(options.query);
  const year = String(options.year || '').trim();
  return rows.filter((row) => {
    if (category && category !== 'recommend' && String(row.primary_category || '') !== category) return false;
    if (year && !String(row.vod_year || '').includes(year)) return false;
    if (!query) return true;
    const haystack = normalize([
      row.vod_name,
      row.aliases,
      row.vod_actor,
      row.vod_director,
      row.vod_year,
      row.primary_category,
      row.content_form,
      row.semantic_tags,
    ].join(' '));
    return haystack.includes(query);
  });
}

export { canonicalKey, normalize, stableValue };
