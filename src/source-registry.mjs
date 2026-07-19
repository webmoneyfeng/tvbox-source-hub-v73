export const SOURCE_REGISTRY_SCHEMA_VERSION = 'v7.3-source-registry-2';
export const SOURCE_REGISTRY_SCOPE = 'validated-physical-source-registry';

export const SOURCE_STATUS_VALUES = Object.freeze([
  'ACTIVE',
  'WATCH',
  'REJECTED',
  'BLOCKED',
]);

export const SOURCE_TIER_VALUES = Object.freeze(['main', 'aux']);

export const DEFAULT_HEALTH_WINDOW = deepFreeze({
  windowDays: 7,
  probeIntervalMinutes: 5,
  minimumSamples: 24,
  activeSuccessRateMin: 0.8,
  watchSuccessRateMin: 0.6,
  maxConsecutiveFailures: 3,
  staleAfterMinutes: 15,
});

const STATUS_PRIORITY = Object.freeze({
  ACTIVE: 4,
  WATCH: 3,
  BLOCKED: 2,
  REJECTED: 1,
});

const TIER_PRIORITY = Object.freeze({
  main: 2,
  aux: 1,
});

const RAW_SOURCE_REGISTRY = [
  { slug: 'sony', key: 'cms_sony', short: '\u7d22\u5c3c', name: '\u7d22\u5c3c\u8d44\u6e90', api: 'https://suoniapi.com/api.php/provide/vod/', tier: 'main', status: 'BLOCKED', origin: 'current', participatesInHotRefresh: false, participatesInFullSnapshot: false },
  { slug: 'lzi', key: 'cms_lzi', short: '\u91cf\u5b50', name: '\u91cf\u5b50\u8d44\u6e90', api: 'https://lzizy1.com/api.php/provide/vod/', tier: 'main', status: 'BLOCKED', origin: 'current', participatesInHotRefresh: false, participatesInFullSnapshot: false },
  { slug: 'baidu', key: 'cms_baidu', short: '\u767e\u5ea6', name: '\u767e\u5ea6\u8d44\u6e90', api: 'https://api.apibdzy.com/api.php/provide/vod/', tier: 'main', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'sdzy', key: 'cms_sdzy', short: '\u95ea\u7535', name: '\u95ea\u7535\u8d44\u6e90', api: 'http://sdzyapi.com/api.php/provide/vod/', tier: 'main', status: 'WATCH', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'bfzy', key: 'cms_bfzy', short: '\u66b4\u98ce', name: '\u66b4\u98ce\u8d44\u6e90', api: 'https://bfzyapi.com/api.php/provide/vod/', tier: 'main', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'taopian', key: 'cms_taopian', short: '\u6dd8\u7247', name: '\u6dd8\u7247\u8d44\u6e90', api: 'https://taopianapi.com/cjapi/mc/vod/json.html', tier: 'aux', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'huya', key: 'cms_huya', short: '\u864e\u7259', name: '\u864e\u7259\u8d44\u6e90', api: 'https://www.huyaapi.com/api.php/provide/vod/from/hym3u8/', tier: 'aux', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'hhzy', key: 'cms_hhzy', short: '\u706b\u72d0', name: '\u706b\u72d0\u8d44\u6e90', api: 'https://hhzyapi.com/api.php/provide/vod/', tier: 'aux', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'hongniu', key: 'cms_hongniu', short: '\u7ea2\u725b', name: '\u7ea2\u725b\u8d44\u6e90', api: 'https://www.hongniuzy2.com/api.php/provide/vod/', tier: 'aux', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'guangsu', key: 'cms_guangsu', short: '\u5149\u901f', name: '\u5149\u901f\u8d44\u6e90', api: 'https://api.guangsuapi.com/api.php/provide/vod/', tier: 'aux', status: 'ACTIVE', origin: 'current', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'ffzy', key: 'cms_ffzy', short: '\u975e\u51e1', name: '\u975e\u51e1\u8d44\u6e90', api: 'https://api.ffzyapi.com/api.php/provide/vod/', tier: 'main', status: 'WATCH', origin: 'discovered', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'wujin', key: 'cms_wujin', short: '\u65e0\u5c3d', name: '\u65e0\u5c3d\u8d44\u6e90', api: 'https://api.wujinapi.me/api.php/provide/vod/', tier: 'main', status: 'WATCH', origin: 'discovered', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'modu', key: 'cms_modu', short: '\u9b54\u90fd', name: '\u9b54\u90fd\u8d44\u6e90', api: 'https://caiji.moduapi.cc/api.php/provide/vod/', tier: 'aux', status: 'ACTIVE', origin: 'discovered', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'yhzy', key: 'cms_yhzy', short: '\u6a31\u82b1', name: '\u6a31\u82b1\u8d44\u6e90', api: 'https://m3u8.apiyhzy.com/api.php/provide/vod/', tier: 'aux', status: 'BLOCKED', origin: 'discovered', participatesInHotRefresh: false, participatesInFullSnapshot: false },
  { slug: 'xinlang', key: 'cms_xinlang', short: '\u65b0\u6d6a', name: '\u65b0\u6d6a\u8d44\u6e90', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/', tier: 'aux', status: 'ACTIVE', origin: 'discovered', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'lzi_direct', key: 'cms_lzi_direct', short: '\u91cf\u5b50\u76f4\u8fde', name: '\u91cf\u5b50\u76f4\u8fde\u8d44\u6e90', api: 'https://cj.lziapi.com/api.php/provide/vod/', tier: 'main', status: 'ACTIVE', origin: 'discovered', participatesInHotRefresh: true, participatesInFullSnapshot: true },
  { slug: 'ffzy_direct', key: 'cms_ffzy_direct', short: '\u975e\u51e1\u76f4\u8fde', name: '\u975e\u51e1\u76f4\u8fde\u8d44\u6e90', api: 'http://ffzy.tv/api.php/provide/vod/', tier: 'main', status: 'ACTIVE', origin: 'discovered', participatesInHotRefresh: true, participatesInFullSnapshot: true },
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeIdentifier(value, field) {
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!text) throw new TypeError('source.' + field + ' is required');
  return text;
}

function normalizeBoolean(value, field) {
  if (typeof value !== 'boolean') throw new TypeError('source.' + field + ' must be boolean');
  return value;
}

function normalizeHealthNumber(value, field, { min = 0, max = Number.POSITIVE_INFINITY, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new TypeError('healthWindow.' + field + ' is invalid');
  }
  return number;
}

function normalizeHealthWindow(value = DEFAULT_HEALTH_WINDOW) {
  if (!isRecord(value)) throw new TypeError('source.healthWindow must be an object');
  const merged = { ...DEFAULT_HEALTH_WINDOW, ...value };
  const normalized = {
    windowDays: normalizeHealthNumber(merged.windowDays, 'windowDays', { min: 1, integer: true }),
    probeIntervalMinutes: normalizeHealthNumber(merged.probeIntervalMinutes, 'probeIntervalMinutes', { min: 1, integer: true }),
    minimumSamples: normalizeHealthNumber(merged.minimumSamples, 'minimumSamples', { min: 1, integer: true }),
    activeSuccessRateMin: normalizeHealthNumber(merged.activeSuccessRateMin, 'activeSuccessRateMin', { min: 0, max: 1 }),
    watchSuccessRateMin: normalizeHealthNumber(merged.watchSuccessRateMin, 'watchSuccessRateMin', { min: 0, max: 1 }),
    maxConsecutiveFailures: normalizeHealthNumber(merged.maxConsecutiveFailures, 'maxConsecutiveFailures', { min: 1, integer: true }),
    staleAfterMinutes: normalizeHealthNumber(merged.staleAfterMinutes, 'staleAfterMinutes', { min: 1, integer: true }),
  };
  if (normalized.watchSuccessRateMin > normalized.activeSuccessRateMin) {
    throw new TypeError('healthWindow.watchSuccessRateMin must not exceed activeSuccessRateMin');
  }
  return normalized;
}

export function normalizeCmsApiUrl(value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!text) throw new TypeError('CMS API URL is required');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError('CMS API URL is invalid: ' + text);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('CMS API URL must use http or https');
  }
  if (url.username || url.password) throw new TypeError('CMS API URL must not contain credentials');

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  url.pathname = url.pathname.replace(/\/{2,}/gu, '/');
  url.searchParams.sort();
  return url.toString();
}

export function physicalSourceKey(value) {
  const url = new URL(normalizeCmsApiUrl(value));
  const hostname = url.hostname.replace(/^www\./u, '');
  return hostname + (url.port ? ':' + url.port : '');
}

function normalizePhysicalSourceKey(value, canonicalApiUrl) {
  const derived = physicalSourceKey(canonicalApiUrl);
  if (value === null || value === undefined || String(value).trim() === '') return derived;
  const normalized = String(value).normalize('NFKC').trim().toLowerCase().replace(/^www\./u, '');
  if (normalized !== derived) {
    throw new TypeError('source.physicalSourceKey does not match canonical API host for ' + canonicalApiUrl);
  }
  return normalized;
}

function normalizeSource(source) {
  if (!isRecord(source)) throw new TypeError('source registry entry must be an object');

  const status = normalizeIdentifier(source.status, 'status').toUpperCase();
  if (!SOURCE_STATUS_VALUES.includes(status)) throw new TypeError('unsupported source.status: ' + status);

  const tier = normalizeIdentifier(source.tier, 'tier').toLowerCase();
  if (!SOURCE_TIER_VALUES.includes(tier)) throw new TypeError('unsupported source.tier: ' + tier);

  const canonicalApiUrl = normalizeCmsApiUrl(source.canonicalApiUrl ?? source.api);
  if (source.api !== undefined && normalizeCmsApiUrl(source.api) !== canonicalApiUrl) {
    throw new TypeError('source.api and source.canonicalApiUrl disagree');
  }

  const participatesInHotRefresh = normalizeBoolean(source.participatesInHotRefresh, 'participatesInHotRefresh');
  const participatesInFullSnapshot = normalizeBoolean(source.participatesInFullSnapshot, 'participatesInFullSnapshot');
  if ((status === 'REJECTED' || status === 'BLOCKED') && (participatesInHotRefresh || participatesInFullSnapshot)) {
    throw new TypeError(status + ' source must not participate in production data paths');
  }

  return {
    slug: normalizeIdentifier(source.slug, 'slug').toLowerCase(),
    key: normalizeIdentifier(source.key, 'key'),
    short: normalizeIdentifier(source.short, 'short'),
    name: normalizeIdentifier(source.name, 'name'),
    tier,
    status,
    origin: normalizeIdentifier(source.origin, 'origin'),
    api: canonicalApiUrl,
    canonicalApiUrl,
    physicalSourceKey: normalizePhysicalSourceKey(source.physicalSourceKey, canonicalApiUrl),
    healthWindow: normalizeHealthWindow(source.healthWindow),
    participatesInHotRefresh,
    participatesInFullSnapshot,
  };
}

function sourceRank(source) {
  return (STATUS_PRIORITY[source.status] * 10) + TIER_PRIORITY[source.tier];
}

export function dedupePhysicalSources(sources = []) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  const selected = new Map();

  for (const rawSource of sources) {
    const source = normalizeSource(rawSource);
    const existing = selected.get(source.physicalSourceKey);
    if (!existing || sourceRank(source) > sourceRank(existing)) selected.set(source.physicalSourceKey, source);
  }

  return deepFreeze([...selected.values()]);
}

function assertUnique(registry, field) {
  const seen = new Set();
  for (const source of registry) {
    const value = source[field];
    if (seen.has(value)) throw new TypeError('duplicate source.' + field + ': ' + value);
    seen.add(value);
  }
}

export function loadSourceRegistry(sources = RAW_SOURCE_REGISTRY) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  const normalized = sources.map((source) => normalizeSource(source));
  assertUnique(normalized, 'slug');
  assertUnique(normalized, 'key');
  assertUnique(normalized, 'canonicalApiUrl');
  assertUnique(normalized, 'physicalSourceKey');
  return deepFreeze(normalized);
}

function toSet(value, normalize) {
  if (value === undefined || value === null) return null;
  const values = Array.isArray(value) ? value : [value];
  return new Set(values.map((entry) => normalize(String(entry))));
}

export function filterSourceRegistry(sources = SOURCE_REGISTRY, criteria = {}) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  if (!isRecord(criteria)) throw new TypeError('criteria must be an object');

  const statuses = toSet(criteria.statuses ?? criteria.status, (value) => value.trim().toUpperCase());
  const tiers = toSet(criteria.tiers ?? criteria.tier, (value) => value.trim().toLowerCase());
  const hotRefresh = criteria.participatesInHotRefresh ?? criteria.hotRefresh;
  const fullSnapshot = criteria.participatesInFullSnapshot ?? criteria.fullSnapshot;

  if (hotRefresh !== undefined && typeof hotRefresh !== 'boolean') throw new TypeError('hot refresh filter must be boolean');
  if (fullSnapshot !== undefined && typeof fullSnapshot !== 'boolean') throw new TypeError('full snapshot filter must be boolean');

  return deepFreeze(sources.filter((source) => {
    if (statuses && !statuses.has(source.status)) return false;
    if (tiers && !tiers.has(source.tier)) return false;
    if (hotRefresh !== undefined && source.participatesInHotRefresh !== hotRefresh) return false;
    if (fullSnapshot !== undefined && source.participatesInFullSnapshot !== fullSnapshot) return false;
    return true;
  }));
}

export const SOURCE_REGISTRY = loadSourceRegistry();
export const ACTIVE_SOURCE_REGISTRY = filterSourceRegistry(SOURCE_REGISTRY, { status: 'ACTIVE' });
export const HOT_REFRESH_SOURCES = filterSourceRegistry(ACTIVE_SOURCE_REGISTRY, { hotRefresh: true });
export const FULL_SNAPSHOT_SOURCES = filterSourceRegistry(ACTIVE_SOURCE_REGISTRY, { fullSnapshot: true });

export default deepFreeze({
  schemaVersion: SOURCE_REGISTRY_SCHEMA_VERSION,
  scope: SOURCE_REGISTRY_SCOPE,
  healthWindowPolicy: DEFAULT_HEALTH_WINDOW,
  sources: SOURCE_REGISTRY,
  activeSources: ACTIVE_SOURCE_REGISTRY,
  hotRefreshSources: HOT_REFRESH_SOURCES,
  fullSnapshotSources: FULL_SNAPSHOT_SOURCES,
});
