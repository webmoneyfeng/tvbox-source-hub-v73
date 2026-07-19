import { buildHotPackage, filterHotRows, mergeHotRows, rowsIdentityCompatible, canonicalKey as hotCanonicalKey, shouldPublishHotPackage } from './hot-catalog.mjs';
import { isAdultPolicyContent, normalizeContentItem } from './content-model.mjs';
import { HOT_REFRESH_SOURCES } from './source-registry.mjs';
import { latestPlausibleSourceTimestamp } from './source-time.mjs';

const VERSION = '2026-07-18-commercial-zero-bill';
const LIVE_GROUP_ORDER = ['电影频道', '经典电影', '纪录片', '动画少儿', '家庭频道', '喜剧频道', '英文影视', '美国频道', '其他频道'];
const VOD_CATEGORIES = [
  { id: '1', key: 'classic', name: '经典电影', aliases: ['classic', '经典电影'] },
  { id: '2', key: 'scifi', name: '科幻惊悚', aliases: ['scifi', 'science', 'sci-fi', '科幻惊悚', '科幻', '惊悚'] },
  { id: '3', key: 'animation', name: '动画少儿', aliases: ['animation', 'cartoon', '动画少儿', '动画', '少儿'] },
  { id: '4', key: 'documentary', name: '纪录片', aliases: ['documentary', 'doc', '纪录片', '纪录'] },
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 TVBoxSourceHub/5.0';
const V73_PRIMARY_HOST = 'tv.webhome.eu.org';
const V73_SECONDARY_HOST = 'tv.webclound.eu.org';
const V73_PRIMARY_ORIGIN = 'https://' + V73_PRIMARY_HOST;
const V73_SECONDARY_ORIGIN = 'https://' + V73_SECONDARY_HOST;
const V73_PROJECT = 'tvbox-source-hub-v73';
const DEFAULT_SNAPSHOT_BASES = [
  'https://tvbox-source-hub-v73.pages.dev/snapshot/latest',
  'https://raw.githubusercontent.com/webmoneyfeng/tvbox-source-hub-v73/snapshot/dist/snapshot/latest',
];
const SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_FETCH_TIMEOUT_MS = 6000;
const SNAPSHOT_VISIBLE_FRESH_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_LAST_GOOD_KV_KEY = 'snapshot:last-good-manifest';
const HOT_UPDATE_KV_KEY = 'hot:last-success';
const HOT_UPDATE_TARGET_MINUTES = 5;
const HOT_UPDATE_FRESH_GUARD_MINUTES = 10;
const HOT_HEALTH_HEARTBEAT_MINUTES = 30;
const HOT_HEALTH_HEARTBEAT_MS = HOT_HEALTH_HEARTBEAT_MINUTES * 60 * 1000;
const HOT_PROBE_STATE_MAX_AGE_MS = (HOT_HEALTH_HEARTBEAT_MINUTES + HOT_UPDATE_TARGET_MINUTES) * 60 * 1000;
const HOT_UPDATE_MEMORY_TTL_MS = 15 * 1000;
const HOT_INTERACTION_PROBE_MIN_INTERVAL_MS = 5 * 60 * 1000;
const HOT_INTERACTION_PROBE_MAX_DAILY_WRITES = Math.ceil(24 * 60 * 60 * 1000 / HOT_INTERACTION_PROBE_MIN_INTERVAL_MS);
const HOT_SNAPSHOT_FRESH_MS = 18 * 60 * 60 * 1000;
const HOT_OVERLAY_CATEGORY_KEYS = new Set([
  'recommend',
  'theatrical_movie',
  'web_movie',
  'other_movie',
  'tv_series',
  'web_series',
  'web_short',
  'variety',
  'anime',
  'documentary',
  'explainer',
  'knowledge',
  'adult',
  'movie',
  'tv',
  'short',
]);
const HOT_ACTIVE_KV_KEY = 'catalog:active';
const HOT_PACKAGE_PREFIX = 'catalog:hot:';
const HOT_PACKAGE_TTL_SECONDS = 24 * 60 * 60;
const HOT_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;
const HOT_LAST_SUCCESS_TTL_SECONDS = 2 * 60 * 60;
const HOT_PUBLISH_SLOT_MS = HOT_UPDATE_TARGET_MINUTES * 60 * 1000;
const SNAPSHOT_PACK_LIMIT = 24;
const snapshotMemoryCache = new Map();
const hotUpdateMemoryCache = { t: 0, v: null, owner: null };
const hotInteractionProbeMemory = { t: 0, p: null };
const hotProbeRuntime = { promise: null };
const LIMIT_DEFAULT = 24;
const LIMIT_MAX = 48;
const CMS_TIMEOUT_MS = 9000;
const CMS_SOURCES = HOT_REFRESH_SOURCES;

const TAG_RULES = [
  ['科幻', /science\s*fiction|sci[-\s]?fi|last man|space|rocket|科幻/i],
  ['恐怖', /horror|zombie|vampire|phantom|nosferatu|caligari|souls|voodoo|恐怖/i],
  ['惊悚', /thriller|suspense|惊悚/i],
  ['悬疑', /mystery|noir|detective|悬疑/i],
  ['喜剧', /comedy|comic|chaplin|laurel|hardy|stooges|funny|humor|喜剧/i],
  ['剧情', /drama|biography|romance|剧情|传记/i],
  ['冒险', /adventure|tarzan|lost world|action|fantasy|冒险/i],
  ['犯罪', /crime|murder|criminal|police|犯罪/i],
  ['音乐', /music|musical|音乐|歌舞/i],
  ['西部', /western|cowboy|西部/i],
  ['动画', /animation|cartoon|popeye|betty|bugs|daffy|superman|woody|fleischer|merrie|动画/i],
  ['Popeye', /popeye/i],
  ['Betty Boop', /betty\s*boop|betty_boop/i],
  ['Superman', /superman/i],
  ['童话', /fairy|bo peep|boy blue|dragon|童话/i],
  ['历史', /history|archives|lincoln|historical|历史/i],
  ['战争', /war|ww2|army|navy|defense|dod|military|战争/i],
  ['人物', /biography|people|person|人物|传记/i],
  ['社会', /society|social|doj|public|社会/i],
  ['科技', /science|technology|ntis|fedflix|科技/i],
  ['安全教育', /safety|fire|usfa|fda|public_safety|安全/i],
];
const TAG_ORDER = TAG_RULES.map(([tag]) => tag);

function text(data, type = 'text/plain; charset=utf-8', maxAge = 300, status = 200, extraHeaders = {}) {
  const noStore = Number(maxAge) <= 0;
  const headers = {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'range,content-type,user-agent,accept',
    'cache-control': noStore ? 'no-store, no-cache, must-revalidate, max-age=0' : 'public, max-age=' + maxAge,
  };
  if (noStore) {
    headers.pragma = 'no-cache';
    headers.expires = '0';
  }
  for (const [key, value] of Object.entries(extraHeaders || {})) {
    if (value !== undefined && value !== null && value !== '') headers[String(key).toLowerCase()] = String(value);
  }
  return new Response(data, {
    status,
    headers,
  });
}
function json(data, maxAge = 300, status = 200, extraHeaders = {}) {
  return text(JSON.stringify(data, null, 2), 'application/json; charset=utf-8', maxAge, status, extraHeaders);
}
function weakEtag(value) {
  const normalized = String(value || '').replace(/[^a-z0-9._:-]+/gi, '-');
  return `W/"${normalized || 'empty'}"`;
}
function revalidatedEdgeHeaders(seconds) {
  const ttl = Math.max(0, Number(seconds) || 0);
  return { 'cache-control': `public, max-age=0, s-maxage=${ttl}, must-revalidate, stale-while-revalidate=${Math.min(ttl, 30)}` };
}
function cleanLineName(s) {
  return String(s || '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'Channel';
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(token) {
  let s = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function tryDecodeURIComponent(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function normalizeText(value) {
  return String(value || '').trim();
}
async function getJsonArray(env, key) {
  if (!env || !env.TVBOX_KV || typeof env.TVBOX_KV.get !== 'function') return [];
  const raw = await env.TVBOX_KV.get(key);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;
  return [];
}
async function getChannels(env) {
  return getJsonArray(env, 'channels');
}
async function getVodItems(env) {
  return getJsonArray(env, 'vod_catalog');
}
function countBy(arr, field) {
  const out = {};
  for (const x of arr) out[x[field] || '未分组'] = (out[x[field] || '未分组'] || 0) + 1;
  return out;
}
function categoryByAny(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return VOD_CATEGORIES.find((c) => c.id === raw || c.key === lower || c.name === raw || c.aliases.some((a) => String(a).toLowerCase() === lower)) || null;
}
function getCategoryParam(params) {
  const keys = ['t', 'tid', 'type', 'type_id', 'cid', 'category'];
  for (const k of keys) {
    const found = categoryByAny(params.get(k));
    if (found) return found;
  }
  const classValue = params.get('class');
  const classCategory = categoryByAny(classValue);
  return classCategory || null;
}
function categoryForItem(item) {
  return VOD_CATEGORIES.find((c) => c.key === item.category || c.name === item.type_name) || null;
}
function categoryIdForItem(item) {
  return (categoryForItem(item) || {}).id || item.category || '';
}
function vodListItem(item) {
  const category = categoryForItem(item);
  return {
    vod_id: item.id,
    vod_name: item.name,
    vod_pic: item.pic || '',
    type_id: category ? category.id : item.category || '',
    type_name: item.type_name || (category ? category.name : ''),
    vod_year: item.year || '',
    vod_remarks: item.remarks || '公开',
  };
}
function vodDetailItem(item, origin) {
  const play = origin + '/p/' + b64urlEncode(item.media);
  return {
    ...vodListItem(item),
    vod_area: item.area || '公开影库',
    vod_actor: '',
    vod_director: item.director || '',
    vod_content: item.content || '公开免费点播视频，已验证媒体首包可读取。',
    vod_play_from: '公开点播',
    vod_play_url: '高清$' + play,
  };
}
function pageList(items, page, limit) {
  const total = items.length;
  const pagecount = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pagecount);
  const start = (safePage - 1) * limit;
  return { total, pagecount, page: safePage, list: items.slice(start, start + limit) };
}
function itemSearchText(item) {
  return [item.name, item.year, item.type_name, item.category, item.content, item.director, item.file, ...(item.subject || [])].join(' ');
}
function tagsForItem(item) {
  const text = itemSearchText(item);
  const tags = [];
  for (const [tag, re] of TAG_RULES) if (re.test(text)) tags.push(tag);
  if (!tags.length && item.type_name) tags.push(item.type_name);
  return [...new Set(tags)];
}
function sizeBucket(item) {
  const bytes = Number(item.bytes || 0);
  if (!bytes) return '';
  if (bytes < 150 * 1024 * 1024) return 'small';
  if (bytes <= 500 * 1024 * 1024) return 'medium';
  return 'large';
}
function decadeValue(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) return 'unknown';
  return Math.floor(y / 10) * 10 + 's';
}
function decadeLabel(value) {
  if (value === 'unknown') return '未标年份';
  return value.replace('s', '年代');
}
function filterValue(v) {
  if (Array.isArray(v)) return normalizeText(v[0] || '');
  return normalizeText(v);
}
function tryParseJsonObject(raw) {
  if (!raw) return {};
  const variants = [String(raw), tryDecodeURIComponent(String(raw))];
  for (const v of variants) {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {}
  }
  try {
    const decoded = b64urlDecode(raw);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {}
  return {};
}
function parseFilters(params) {
  const out = {};
  for (const carrier of ['f', 'extend', 'ext']) Object.assign(out, tryParseJsonObject(params.get(carrier)));
  const direct = ['year', 'yr', 'tag', 'genre', 'subject', 'size', 'sort', 'class'];
  for (const key of direct) {
    const value = params.get(key);
    if (value !== null && value !== undefined && value !== '') {
      if (key === 'class' && categoryByAny(value)) continue;
      out[key] = value;
    }
  }
  return out;
}
function yearMatches(item, value) {
  const v = filterValue(value);
  if (!v || v === '全部') return true;
  const year = normalizeText(item.year);
  if (v === 'unknown' || v === '未标年份') return !year;
  if (/^\d{4}$/.test(v)) return year === v;
  const normalized = v.replace('年代', 's');
  if (/^\d{4}s$/.test(normalized)) return decadeValue(year) === normalized;
  if (/^\d{4}\+$/.test(v)) return parseInt(year || '0', 10) >= parseInt(v, 10);
  return true;
}
function itemMatchesFilters(item, filters) {
  const year = filterValue(filters.year);
  const yr = filterValue(filters.yr);
  if (year && !yearMatches(item, year)) return false;
  if (yr && !yearMatches(item, yr)) return false;

  const tag = filterValue(filters.tag || filters.genre || filters.subject || filters.class);
  if (tag && tag !== '全部' && !tagsForItem(item).includes(tag)) return false;

  const size = filterValue(filters.size);
  if (size && size !== '全部' && sizeBucket(item) !== size) return false;
  return true;
}
function sortItems(items, filters) {
  const sort = filterValue(filters.sort);
  const out = [...items];
  if (sort === 'year_desc') return out.sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || String(a.name).localeCompare(String(b.name)));
  if (sort === 'year_asc') return out.sort((a, b) => Number(a.year || 0) - Number(b.year || 0) || String(a.name).localeCompare(String(b.name)));
  if (sort === 'name_asc') return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (sort === 'size_desc') return out.sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0));
  if (sort === 'size_asc') return out.sort((a, b) => Number(a.bytes || 0) - Number(b.bytes || 0));
  return out;
}
function filterOption(n, v) {
  return { n, v };
}
function buildYearFilter(items) {
  const decades = [...new Set(items.map((x) => decadeValue(x.year)))].filter(Boolean);
  decades.sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return parseInt(b, 10) - parseInt(a, 10);
  });
  return {
    key: 'year',
    name: '年代',
    init: '',
    value: [filterOption('全部', ''), ...decades.map((d) => filterOption(decadeLabel(d), d))],
  };
}
function buildExactYearFilter(items) {
  const years = [...new Set(items.map((x) => normalizeText(x.year)).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  return {
    key: 'yr',
    name: '年份',
    init: '',
    value: [filterOption('全部', ''), ...years.map((y) => filterOption(y, y))],
  };
}
function buildTagFilter(items) {
  const set = new Set();
  for (const item of items) for (const tag of tagsForItem(item)) set.add(tag);
  const tags = [...set].sort((a, b) => {
    const ia = TAG_ORDER.indexOf(a), ib = TAG_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });
  return {
    key: 'tag',
    name: '题材',
    init: '',
    value: [filterOption('全部', ''), ...tags.map((t) => filterOption(t, t))],
  };
}
function buildSizeFilter(items) {
  const buckets = new Set(items.map(sizeBucket).filter(Boolean));
  const opts = [
    ['small', '小体积 <150MB'],
    ['medium', '中等 150-500MB'],
    ['large', '大体积 >500MB'],
  ].filter(([v]) => buckets.has(v)).map(([v, n]) => filterOption(n, v));
  return { key: 'size', name: '大小', init: '', value: [filterOption('全部', ''), ...opts] };
}
function buildSortFilter() {
  return {
    key: 'sort',
    name: '排序',
    init: '',
    value: [
      filterOption('默认', ''),
      filterOption('年代新到旧', 'year_desc'),
      filterOption('年代旧到新', 'year_asc'),
      filterOption('片名 A-Z', 'name_asc'),
      filterOption('体积大到小', 'size_desc'),
      filterOption('体积小到大', 'size_asc'),
    ],
  };
}
function buildFiltersForItems(items) {
  return [buildYearFilter(items), buildExactYearFilter(items), buildTagFilter(items), buildSizeFilter(items), buildSortFilter()]
    .filter((f) => f.value.length > 1 || f.key === 'sort');
}
function buildFilterMap(items) {
  const map = {};
  for (const c of VOD_CATEGORIES) {
    const subset = items.filter((x) => x.category === c.key || x.type_name === c.name);
    map[c.id] = buildFiltersForItems(subset);
    map[c.key] = map[c.id];
  }
  return map;
}
function vodClasses(items) {
  const filterMap = buildFilterMap(items);
  return VOD_CATEGORIES.map((c) => ({
    type_id: c.id,
    type_name: c.name,
    filters: filterMap[c.id] || [],
  }));
}
function cmsSourceBySlug(slug) {
  return CMS_SOURCES.find((s) => s.slug === slug || s.key === slug) || null;
}
function cmsSite(origin, source) {
  return {
    key: source.key,
    name: source.short,
    type: 1,
    api: origin + '/cms/' + source.slug,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    changeable: 1,
    hide: 1,
  };
}

function decodeBasicHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;|&#x22;/gi, '\"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}
function cleanCmsText(value, max = 80) {
  return decodeBasicHtml(value).replace(/[\u2503\uff5c|]+/g, ' ').replace(/\?{2,}/g, '').replace(/VIP/gi, '').replace(/\u89e3\u6790/g, '').replace(/\u91c7\u96c6/g, '\u8d44\u6e90').replace(/\u8d44\u6e90\u8d44\u6e90/g, '\u8d44\u6e90').replace(/\s+/g, ' ').trim().slice(0, max);
}
const CMS_PROMO_TERMS = ['\u516c\u4f17\u53f7', '\u5fae\u4fe1', 'vx', 'qq\u7fa4', '\u52a0\u7fa4', '\u5546\u52a1', '\u5ba2\u670d', '\u8d5e\u52a9', '\u63a8\u5e7f', '\u5e7f\u544a\u4f4d', 'app\u4e0b\u8f7d', '\u8f6f\u4ef6\u4e0b\u8f7d', '\u9632\u8d70\u4e22', '\u6c38\u4e45\u5730\u5740', '\u53d1\u5e03\u9875', '\u63a5\u53e3\u514d\u8d39', '\u4e25\u7981\u8d29\u5356', '\u8dd1\u9a6c\u706f', '\u516c\u544a', '\u8bf7\u52ff\u8d29\u5356', '\u540e\u53f0\u53d1\u9001', '\u83b7\u53d6\u6700\u65b0', '\\u8bbe\\u7f6etoken'];
function includesAnyText(value, terms) {
  const t = String(value || '').replace(/\s+/g, '').toLowerCase();
  return terms.some((term) => t.includes(String(term).toLowerCase()));
}
function isPromoText(value) { return includesAnyText(value, CMS_PROMO_TERMS); }
function isInvalidCmsClass(item) {
  const id = String(item?.type_id ?? item?.id ?? '').trim();
  const name = String(item?.type_name ?? item?.name ?? '').trim();
  return !id || !name || isPromoText(name);
}
function isInvalidCmsVod(item) {
  const id = String(item?.vod_id ?? item?.id ?? '').trim();
  const name = String(item?.vod_name ?? item?.name ?? '').trim();
  if (!id || !name) return true;
  if (/^(\u5e7f\u544a|\u63a8\u5e7f|\u516c\u4f17\u53f7|\u53d1\u5e03\u9875|\u63a5\u53e3)$/i.test(name.trim())) return true;
  return isPromoText(name) && !includesAnyText(name, ['\u5267', '\u7247', '\u5b63', '\u96c6']);
}
function isPlayableCmsUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  const lower = raw.toLowerCase();
  if (/(player\.html|\/player\b|iframe|\/jx\b|jx\.|jiexi|parse|\u89e3\u6790|advert|\u5e7f\u544a\u4f4d)/i.test(lower)) return false;
  return /\.(m3u8|mp4|flv|mkv|mov|ts)(?:$|[?#])/i.test(lower) || /m3u8/i.test(lower);
}
function cleanCmsClass(item) { return { ...item, type_id: String(item.type_id ?? item.id ?? '').trim(), type_name: cleanCmsText(item.type_name ?? item.name ?? '', 40) }; }
function splitCmsEpisodes(group) { return String(group || '').split('#').map((raw) => { const idx = raw.indexOf('$'); return idx === -1 ? { name: '', url: raw.trim() } : { name: raw.slice(0, idx).trim(), url: raw.slice(idx + 1).trim() }; }).filter((x) => x.url); }
function cleanCmsPlay(vod) {
  const fromGroups = String(vod.vod_play_from || '').split('$$$');
  const urlGroups = String(vod.vod_play_url || '').split('$$$');
  const keptFrom = [], keptUrl = [];
  for (let i = 0; i < urlGroups.length; i++) {
    const flag = cleanCmsText(fromGroups[i] || '\u76f4\u8fde', 30) || '\u76f4\u8fde';
    if (isPromoText(flag)) continue;
    const cleaned = [];
    for (const ep of splitCmsEpisodes(urlGroups[i])) {
      if (!isPlayableCmsUrl(ep.url)) continue;
      cleaned.push((cleanCmsText(ep.name || '\u64ad\u653e', 80) || '\u64ad\u653e') + '$' + ep.url);
    }
    if (cleaned.length) { keptFrom.push(flag); keptUrl.push(cleaned.join('#')); }
  }
  return { from: keptFrom.join('$$$'), url: keptUrl.join('$$$') };
}
function cleanCmsVodItem(item, detail = false) {
  if (isInvalidCmsVod(item)) return null;
  const out = {
    vod_id: String(item.vod_id ?? item.id ?? '').trim(),
    type_id: String(item.type_id ?? item.type ?? '').trim(),
    type_name: cleanCmsText(item.type_name ?? '', 40),
    vod_name: cleanCmsText(item.vod_name ?? item.name ?? '', 120),
    vod_sub: cleanCmsText(item.vod_sub ?? '', 120),
    vod_pic: String(item.vod_pic || item.pic || '').trim(),
    vod_remarks: cleanCmsText(item.vod_remarks ?? '', 80),
    vod_year: cleanCmsText(item.vod_year ?? '', 12),
    vod_area: cleanCmsText(item.vod_area ?? '', 60),
    vod_lang: cleanCmsText(item.vod_lang ?? '', 40),
    vod_class: cleanCmsText(item.vod_class ?? '', 80),
    vod_state: cleanCmsText(item.vod_state ?? '', 40),
    vod_actor: cleanCmsText(item.vod_actor ?? '', 120),
    vod_director: cleanCmsText(item.vod_director ?? '', 80),
    vod_play_from: cleanCmsText(item.vod_play_from ?? '', 80),
    vod_time: cleanCmsText(item.vod_time ?? '', 40),
    vod_time_add: cleanCmsText(item.vod_time_add ?? '', 40),
    vod_pubdate: cleanCmsText(item.vod_pubdate ?? '', 40),
    vod_total: cleanCmsText(item.vod_total ?? '', 20),
    vod_serial: cleanCmsText(item.vod_serial ?? '', 40),
    vod_duration: cleanCmsText(item.vod_duration ?? '', 40),
  };
  if (detail) {
    out.vod_content = cleanCmsText(item.vod_content ?? item.vod_blurb ?? '', 800);
    const play = cleanCmsPlay(item);
    if (!play.url) return null;
    out.vod_play_from = play.from;
    out.vod_play_url = play.url;
  }
  return out;
}
function cleanCmsResult(data, forceDetail = false) {
  const out = { ...(data && typeof data === 'object' ? data : {}) };
  out.code = out.code ?? 1;
  out.msg = out.msg || 'ok';
  if (Array.isArray(out.class)) out.class = out.class.filter((x) => !isInvalidCmsClass(x)).map(cleanCmsClass);
  if (Array.isArray(out.list)) {
    const detail = Boolean(forceDetail);
    out.list = out.list.map((x) => cleanCmsVodItem(x, detail)).filter(Boolean);
    if (detail && out.list.length === 0) out.msg = 'no valid direct play url';
  } else out.list = [];
  delete out.ads; delete out.parses; delete out.parse;
  return out;
}
function paramsObject(params) {
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}
function buildCmsUrl(source, requestUrl) { const upstream = new URL(source.api); for (const [k, v] of requestUrl.searchParams) upstream.searchParams.append(k, v); return upstream.href; }
async function fetchCmsJson(source, requestUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), CMS_TIMEOUT_MS);
  try {
    const res = await fetch(buildCmsUrl(source, requestUrl), { headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*' }, redirect: 'follow', signal: controller.signal });
    const body = await res.text();
    let data = null;
    try { data = JSON.parse(body.replace(/^\uFEFF/, '').trim()); } catch {}
    return { res, data };
  } finally { clearTimeout(timer); }
}
function mergeCmsCleanResults(base, additions) {
  const out = { ...(base || {}), list: [...((base && base.list) || [])] };
  const seen = new Set(out.list.map((x) => String(x.vod_id || x.id || '')));
  for (const data of additions || []) {
    const cleaned = cleanCmsResult(data, false);
    for (const item of cleaned.list || []) {
      const id = String(item.vod_id || item.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.list.push(item);
    }
  }
  out.total = out.list.length;
  return out;
}
function cmsLeafClassIdsForRequest(sourceInfo, rawTypeId, max = AGG_CLASS_LIMIT) {
  const id = String(rawTypeId || '').trim();
  if (!id || !sourceInfo || !sourceInfo.classes || !sourceInfo.classes.length) return [];
  const byParent = new Map();
  for (const c of sourceInfo.classes) {
    const pid = String(c.type_pid || c.type_pid_1 || c.parent_id || c.pid || '').trim();
    if (!pid) continue;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(c);
  }
  const leaves = [];
  const seen = new Set([id]);
  const stack = [...(byParent.get(id) || [])];
  while (stack.length && leaves.length < max) {
    const c = stack.shift();
    const cid = String(c.type_id || '').trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    const kids = byParent.get(cid) || [];
    if (kids.length) stack.push(...kids);
    else leaves.push(cid);
  }
  if (leaves.length) return leaves.slice(0, max);
  const name = sourceInfo.byId && sourceInfo.byId[id] || '';
  const macro = macroForTypeName(name);
  if (!macro || !isBroadParentClass(name)) return [];
  return sourceClassIdsFor(sourceInfo, macro, {}).filter((x) => x !== id).slice(0, max);
}
async function cms(request, env, slug) {
  const source = cmsSourceBySlug(slug);
  if (!source) return json({ code: 1, msg: 'source not found', class: [], list: [] }, 60, 404);
  const requestUrl = new URL(request.url);
  const originalParams = requestUrl.searchParams;
  const hasIds = Boolean((originalParams.get('ids') || originalParams.get('id') || '').trim());
  const ac = (originalParams.get('ac') || '').toLowerCase();
  const upstreamParams = paramsObject(originalParams);
  if (!hasIds && ac.includes('detail')) upstreamParams.ac = 'videolist';
  try {
    const got = await fetchCmsJsonByParams(source, upstreamParams, CMS_TIMEOUT_MS);
    if (!got.ok) return json({ code: 1, msg: 'source unavailable', class: [], list: [] }, 30);
    const detail = hasIds;
    let cleaned = cleanCmsResult(got.data, detail);
    const typeId = String(originalParams.get('t') || originalParams.get('tid') || originalParams.get('type_id') || '').trim();
    const wd = (originalParams.get('wd') || originalParams.get('search') || originalParams.get('q') || '').trim();
    if (!detail && !wd && typeId && cleaned.list.length === 0) {
      const sourceInfo = await getSourceClassInfo(source);
      const leafIds = cmsLeafClassIdsForRequest(sourceInfo, typeId, AGG_CLASS_LIMIT);
      if (leafIds.length) {
        const additions = [];
        const jobs = leafIds.map((t) => fetchCmsJsonByParams(source, { ...upstreamParams, ac: 'videolist', t }, 7500));
        const settled = await Promise.allSettled(jobs);
        for (const r of settled) if (r.status === 'fulfilled' && r.value.ok) additions.push(r.value.data);
        cleaned = mergeCmsCleanResults(cleaned, additions);
      }
    }
    return json(cleaned, 120);
  } catch (err) { return json({ code: 1, msg: 'source timeout', class: [], list: [], error: String(err && err.message || err) }, 30); }
}


const AGG_CATEGORIES = [
  { id: '0', key: 'recommend', name: '\u63a8\u8350' },
  { id: '10', key: 'theatrical_movie', name: '\u9662\u7ebf\u7535\u5f71' },
  { id: '11', key: 'web_movie', name: '\u7f51\u7edc\u7535\u5f71' },
  { id: '12', key: 'other_movie', name: '\u5176\u4ed6\u7535\u5f71' },
  { id: '20', key: 'tv_series', name: '\u7535\u89c6\u5267' },
  { id: '21', key: 'web_series', name: '\u7f51\u7edc\u5267' },
  { id: '6', key: 'web_short', name: '\u7f51\u7edc\u77ed\u5267' },
  { id: '3', key: 'variety', name: '\u7efc\u827a' },
  { id: '4', key: 'anime', name: '\u52a8\u6f2b' },
  { id: '5', key: 'documentary', name: '\u7eaa\u5f55\u7247' },
  { id: '7', key: 'explainer', name: '\u89e3\u8bf4' },
  { id: '8', key: 'knowledge', name: '\u6587\u5a31\u77e5\u8bc6' },
  { id: '9', key: 'adult', name: '\u6210\u4eba\u4f26\u7406' },
];
const LEGACY_AGG_CATEGORIES = [
  { id: '1', key: 'movie', name: '\u7535\u5f71', canonicalKeys: ['theatrical_movie', 'web_movie', 'other_movie'] },
  { id: '2', key: 'tv', name: '\u5267\u96c6', canonicalKeys: ['tv_series', 'web_series'] },
  { id: '6', key: 'short', name: '\u77ed\u5267', canonicalKeys: ['web_short'] },
];
const ADULT_CATEGORY_ID = '9';
const ADULT_CATEGORY_KEY = 'adult';
const ADULT_TEXT_RE = /(\u4f26\u7406|\u4f26\u7406\u7247|\u7406\u8bba|\u798f\u5229|\u6210\u4eba|\u60c5\u8272|\u5348\u591c|\u5199\u771f|\u4e09\u7ea7|\u91cc\u756a|\u756a\u53f7|AV)/i;
const AGG_CLASS_LIMIT = 6;
const AGG_DETAIL_LIMIT = 8;
const CLASS_CACHE_TTL_MS = 30 * 60 * 1000;
const SOURCE_RANK = Object.fromEntries(CMS_SOURCES.map((s, i) => [s.slug, CMS_SOURCES.length - i]));
const classCache = new Map();
const STRONG_KNOWLEDGE_RE = /(\u6f14\u5531\u4f1a|\u97f3\u4e50\u4f1a|\u97f3\u4e50\u8282|\u5de1\u6f14|\bLIVE\b|\u73b0\u573a\u7248|\u97f3\u4e50\u73b0\u573a|\bMV\b|\u6b4c\u4f1a|\u665a\u4f1a|\u516c\u5f00\u8bfe|\u8bfe\u7a0b|\u6559\u7a0b|\u6559\u5b66|\u8bb2\u5ea7|\u8bfe\u5802|\u57f9\u8bad|\u79d1\u666e|\u79d1\u6280|\u767e\u79d1|\u5b9e\u9a8c|\u63a2\u7d22|\u5b87\u5b99|\u81ea\u7136|vlog|VLOG|\u65c5\u884c|\u7f8e\u98df|\u5065\u8eab|\u6d4b\u8bc4|\u8bbf\u8c08|\u8d5b\u4e8b|\u6bd4\u8d5b|\u96c6\u9526|\u56de\u653e|\u7bee\u7403|\u8db3\u7403|\u683c\u6597|\u513f\u6b4c|\u65e9\u6559|\u4eb2\u5b50|\u5c11\u513f|\u513f\u7ae5|\u542f\u8499|\u620f\u66f2|\u76f8\u58f0|\u5c0f\u54c1|\u66f2\u827a|\u8bdd\u5267|\u6b4c\u5267|\u821e\u53f0\u5267|\u8d22\u7ecf|\u5546\u4e1a|\u6295\u8d44|\u521b\u4e1a)/i;
const EXPLAINER_RE = /(\u89e3\u8bf4|\u8bb2\u89e3|\u5f71\u8bc4|\u76d8\u70b9|\u5267\u60c5\u89e3\u8bf4|\u7535\u5f71\u89e3\u8bf4|\u5f71\u89c6\u89e3\u8bf4|\u8bf4\u7535\u5f71|\u770b\u7535\u5f71|\u6848\u4ef6\u89e3\u8bf4|\u5386\u53f2\u89e3\u8bf4|\u6e38\u620f\u89e3\u8bf4|\u79d1\u6280\u79d1\u666e|\u3010\u5f71\u89c6\u89e3\u8bf4\u3011|\[\u7535\u5f71\u89e3\u8bf4\])/i;
const SNIPPET_RE = /(\u9884\u544a|\u82b1\u7d6e|\u7247\u82b1|\u7247\u6bb5|\u7cbe\u5f69\u7247\u6bb5|\u5148\u5bfc)/;
const COURSE_RE = /(\u516c\u5f00\u8bfe|\u8bfe\u7a0b|\u6559\u7a0b|\u6559\u5b66|\u8bb2\u5ea7|\u8bfe\u5802|\u57f9\u8bad)/;
const LIVE_FORM_RE = /(\u6f14\u5531\u4f1a|\u97f3\u4e50\u4f1a|\u5de1\u6f14|\bLIVE\b|\u73b0\u573a|\u821e\u53f0|\u97f3\u4e50\u8282|\u665a\u4f1a)/i;
const COLLECTION_RE = /(\u5408\u96c6|\u5927\u5168|\u5168\u96c6|\u7cfb\u5217|\u4e13\u9898|\u76d8\u70b9|\u96c6\u9526)/;

function aggCategoryByAny(value) {
  const raw = normalizeText(value).replace(/\s*\d{12}\s*$/, '');
  if (!raw) return AGG_CATEGORIES[0];
  const lower = raw.toLowerCase();
  const canonical = AGG_CATEGORIES.find((c) => c.id === raw || c.key === lower || c.name === raw);
  if (canonical) return canonical;
  return LEGACY_AGG_CATEGORIES.find((c) => c.id === raw || c.key === lower || c.name === raw) || AGG_CATEGORIES[0];
}
function aggCategoryByKey(key) {
  const lower = String(key || '').trim().toLowerCase();
  return AGG_CATEGORIES.find((c) => c.key === lower)
    || LEGACY_AGG_CATEGORIES.find((c) => c.key === lower)
    || AGG_CATEGORIES[0];
}
function canonicalKeysForCategory(categoryOrKey) {
  const category = typeof categoryOrKey === 'string' ? aggCategoryByKey(categoryOrKey) : (categoryOrKey || AGG_CATEGORIES[0]);
  return Array.isArray(category.canonicalKeys) && category.canonicalKeys.length ? [...category.canonicalKeys] : [category.key];
}
function categoryMatchesPrimary(categoryOrKey, primaryCategory) {
  const primary = String(primaryCategory || '').trim();
  return Boolean(primary && canonicalKeysForCategory(categoryOrKey).includes(primary));
}
function filterSchemaCategoryKey(categoryKey) {
  const key = String(categoryKey || '').trim();
  if (['theatrical_movie', 'web_movie', 'other_movie'].includes(key)) return 'movie';
  if (['tv_series', 'web_series'].includes(key)) return 'tv';
  if (key === 'web_short') return 'short';
  return key;
}
function fallbackPrimaryForCategory(categoryOrKey) {
  const category = typeof categoryOrKey === 'string' ? aggCategoryByKey(categoryOrKey) : (categoryOrKey || AGG_CATEGORIES[0]);
  if (category.key === 'movie') return 'other_movie';
  if (category.key === 'tv') return 'tv_series';
  if (category.key === 'short') return 'web_short';
  return category.key;
}
function cleanAggName(value, max = 80) {
  return cleanCmsText(value, max).replace(/^(\u66f4\u65b0\u81f3|\u66f4\u65b0|\u9ad8\u6e05|\u6b63\u7247|\u5b8c\u7ed3)\s*/g, '').trim() || cleanCmsText(value, max);
}
function aggText(item, className = '') {
  return [className, item?.type_name, item?.vod_name, item?.vod_sub, item?.vod_remarks, item?.vod_class, item?.vod_state, item?.vod_area, item?.vod_lang, item?.vod_actor, item?.vod_director, item?.vod_content, item?.vod_play_from, item?.semantic_tags, item?.snapshot_filter_evidence].join(' ');
}
function macroForTypeName(value) {
  const n = String(value || '').replace(/\s+/g, '');
  if (!n) return '';
  if (/(\u4f26\u7406|\u4f26\u7406\u7247|\u7406\u8bba|\u798f\u5229|\u6210\u4eba|\u60c5\u8272|\u5348\u591c|\u5199\u771f|\u4e09\u7ea7|\u91cc\u756a|\u756a\u53f7|AV)/i.test(n)) return 'adult';
  if (EXPLAINER_RE.test(n)) return 'explainer';
  if (/(\u77ed\u5267|\u5fae\u77ed\u5267|\u7f51\u7edc\u77ed\u5267|\u723d\u6587|\u7ad6\u5c4f)/.test(n)) return 'web_short';
  if (/(\u7eaa\u5f55|\u8bb0\u5f55|\u7eaa\u5b9e)/.test(n)) return 'documentary';
  if (/(\u52a8\u6f2b|\u52a8\u753b|\u5361\u901a|\u756a\u5267|\u4e2d\u56fd\u52a8\u6f2b|\u56fd\u4ea7\u52a8\u6f2b|\u65e5\u672c\u52a8\u6f2b|\u65e5\u97e9\u52a8\u6f2b|\u6b27\u7f8e\u52a8\u6f2b|\u6d77\u5916\u52a8\u6f2b|\u6e2f\u53f0\u52a8\u6f2b|\u52a8\u6f2b\u7535\u5f71|\u5c11\u513f\u52a8\u753b)/.test(n)) return 'anime';
  if (/(\u7efc\u827a|\u771f\u4eba\u79c0|\u8131\u53e3\u79c0|\u5927\u9646\u7efc\u827a|\u65e5\u97e9\u7efc\u827a|\u6e2f\u53f0\u7efc\u827a|\u6b27\u7f8e\u7efc\u827a|\u6d77\u5916\u7efc\u827a)/.test(n)) return 'variety';
  if (/(\u6f14\u5531\u4f1a|\u97f3\u4e50\u4f1a|\u97f3\u4e50\u8282|\u5de1\u6f14|LIVE|MV|\u516c\u5f00\u8bfe|\u8bfe\u7a0b|\u6559\u7a0b|\u8bb2\u5ea7|\u79d1\u666e|\u77e5\u8bc6)/i.test(n)) return 'knowledge';
  if (/(\u7f51\u7edc\u5267|\u7f51\u5267|\u7f51\u7edc\u7535\u89c6\u5267|\u5e73\u53f0\u72ec\u64ad)/.test(n)) return 'web_series';
  if (/(\u7535\u89c6\u5267|\u8fde\u7eed\u5267|\u56fd\u4ea7\u5267|\u5927\u9646\u5267|\u5185\u5730\u5267|\u6b27\u7f8e\u5267|\u7f8e\u5267|\u82f1\u5267|\u6e2f\u5267|\u6e2f\u6fb3\u5267|\u9999\u6e2f\u5267|\u53f0\u5267|\u53f0\u6e7e\u5267|\u97e9\u5267|\u97e9\u56fd\u5267|\u65e5\u5267|\u65e5\u672c\u5267|\u6cf0\u5267|\u9a6c\u6cf0\u5267|\u6d77\u5916\u5267|\u5176\u4ed6\u5267|\u5267\u96c6)/.test(n)) return 'tv_series';
  if (/(\u9662\u7ebf\u7535\u5f71|\u9662\u7ebf\u7247|\u5f71\u9662\u4e0a\u6620|\u9662\u7ebf\u4e0a\u6620)/.test(n)) return 'theatrical_movie';
  if (/(\u7f51\u7edc\u7535\u5f71|\u7f51\u5927|\u7f51\u7edc\u9996\u53d1)/.test(n)) return 'web_movie';
  if (/(\u7535\u5f71|\u52a8\u4f5c|\u559c\u5267|\u7231\u60c5|\u79d1\u5e7b|\u6050\u6016|\u60ca\u609a|\u60ac\u7591|\u5267\u60c5|\u6218\u4e89|\u72af\u7f6a|\u5192\u9669|\u5947\u5e7b|\u707e\u96be|\u52a8\u753b\u7247|\u9662\u7ebf)/.test(n)) return 'other_movie';
  return '';
}
function sourceCategoryMapFromClasses(classes = []) {
  const map = {};
  for (const record of classes) {
    const id = String(record?.type_id ?? record?.id ?? '').trim();
    const name = cleanCmsText(record?.type_name ?? record?.name ?? '', 40);
    const category = macroForTypeName(name);
    if (id && category) map[id] = category;
  }
  return map;
}
function normalizeAggContentItem(item, className = '', sourceCategoryMap = {}) {
  const resolvedClassName = cleanCmsText(className || item?.type_name || item?.source_category_name || '', 40);
  const prepared = {
    ...(item || {}),
    type_name: resolvedClassName || item?.type_name || '',
    source_category_id: String(item?.source_category_id || item?.type_id || '').trim(),
    source_category_name: resolvedClassName,
  };
  const modeled = normalizeContentItem(prepared, { sourceCategoryMap });
  let primary = String(modeled.primary_category || '').trim();
  if (!primary || primary === 'recommend') {
    const text = aggText(prepared, resolvedClassName);
    primary = macroForTypeName(resolvedClassName)
      || (EXPLAINER_RE.test(text) ? 'explainer' : '')
      || (STRONG_KNOWLEDGE_RE.test(text) ? 'knowledge' : '')
      || 'other_movie';
  }
  return { ...modeled, primary_category: primary, _macro: primary, _className: resolvedClassName };
}
function macroForItem(item, className = '', sourceCategoryMap = {}) {
  return normalizeAggContentItem(item, className, sourceCategoryMap).primary_category;
}
function classWantedForMacro(typeName, macroKey) {
  if (!macroKey || macroKey === 'recommend') return true;
  return categoryMatchesPrimary(macroKey, macroForTypeName(typeName));
}
function isBroadParentClass(name) {
  const n = String(name || '').replace(/\s+/g, '');
  return /^(\u7535\u5f71|\u7535\u5f71\u7247|\u7535\u89c6\u5267|\u8fde\u7eed\u5267|\u7efc\u827a|\u7efc\u827a\u7247|\u52a8\u6f2b|\u52a8\u6f2b\u7247|\u7eaa\u5f55\u7247|\u8bb0\u5f55\u7247)$/.test(n);
}
function getAggCategoryParam(params) {
  for (const k of ['t', 'tid', 'type', 'type_id', 'cid', 'category']) {
    const v = params.get(k);
    if (v !== null && v !== '') return aggCategoryByAny(v);
  }
  return AGG_CATEGORIES[0];
}
function hasAggCategoryParam(params) {
  return ['t', 'tid', 'type', 'type_id', 'cid', 'category'].some((k) => {
    const v = params.get(k);
    return v !== null && v !== '';
  });
}
function visibleAggCategoriesForPolicy(policy = {}) {
  return policy.includeAdult === false ? AGG_CATEGORIES.filter((c) => c.key !== ADULT_CATEGORY_KEY) : AGG_CATEGORIES;
}
function isAdultClassRecord(record) {
  const id = String(record?.type_id ?? record?.id ?? '').trim();
  const key = String(record?.key ?? record?.category ?? '').trim().toLowerCase();
  const name = String(record?.type_name ?? record?.name ?? '').trim();
  return id === ADULT_CATEGORY_ID || key === ADULT_CATEGORY_KEY || ADULT_TEXT_RE.test(name);
}
function isAdultFilterKey(key) {
  const raw = String(key ?? '').trim().toLowerCase();
  return raw === ADULT_CATEGORY_ID || raw === ADULT_CATEGORY_KEY || ADULT_TEXT_RE.test(String(key ?? ''));
}
function isAdultFilterOption(value) {
  return ADULT_TEXT_RE.test([value?.n, value?.v, value?.name, value?.value].join(' '));
}
function sanitizeFilterGroupsForPolicy(groups, policy = {}) {
  if (policy.includeAdult !== false) return groups || [];
  return (groups || []).map((group) => {
    const values = (group.value || []).filter((opt) => {
      const v = String(opt?.v ?? '').trim();
      if (!v) return true;
      return !isAdultFilterOption(opt);
    });
    return { ...group, value: values };
  }).filter((group) => group.key === 'sort' || (group.value || []).some((opt) => String(opt?.v ?? '').trim()));
}
function isAdultAggRecord(item) {
  return isAdultPolicyContent(item);
}
export function sanitizeAggResponseForPolicy(payload, policy = {}) {
  const includeAdult = policy.includeAdult !== false;
  if (includeAdult) return { ...payload, content_policy: 'full' };
  const inputList = Array.isArray(payload?.list) ? payload.list : [];
  const list = inputList.filter((item) => !isAdultAggRecord(item));
  const classes = (Array.isArray(payload?.class) ? payload.class : [])
    .filter((c) => !isAdultClassRecord(c))
    .map((c) => ({ ...c, filters: sanitizeFilterGroupsForPolicy(c.filters || [], policy) }));
  const filters = {};
  for (const [key, groups] of Object.entries(payload?.filters || {})) {
    if (isAdultFilterKey(key)) continue;
    filters[key] = sanitizeFilterGroupsForPolicy(groups, policy);
  }
  const limit = Number(payload?.limit || list.length || LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const removedCount = inputList.length - list.length;
  const payloadTotal = Number(payload?.total);
  const cleanTotal = Number(policy?.cleanTotal);
  const total = Number.isFinite(cleanTotal) && cleanTotal >= list.length
    ? cleanTotal
    : Number.isFinite(payloadTotal) && payloadTotal >= inputList.length
      ? Math.max(list.length, payloadTotal - removedCount)
      : list.length;
  return {
    ...payload,
    class: classes,
    filters,
    list,
    total,
    pagecount: Math.max(1, Math.ceil(total / Math.max(1, limit))),
    content_policy: 'clean-no-adult',
  };
}
function inferAggCategoryFromFilters(filters) {
  const cls = filterValue(filters.class || filters.topic || '');
  if (!cls) return null;
  if (/^(\u7535\u5f71|\u52a8\u4f5c|\u559c\u5267|\u7231\u60c5|\u60ac\u7591\u72af\u7f6a|\u79d1\u5e7b\u5947\u5e7b|\u6050\u6016\u60ca\u609a|\u5267\u60c5|\u6218\u4e89\u5386\u53f2)$/.test(cls)) return aggCategoryByKey('movie');
  if (/^(\u5267\u96c6|\u56fd\u4ea7|\u6e2f\u53f0|\u65e5\u97e9|\u6b27\u7f8e|\u6cf0\u56fd|\u6d77\u5916)$/.test(cls)) return aggCategoryByKey('tv');
  if (/^(\u5927\u9646\u7efc\u827a|\u65e5\u97e9\u7efc\u827a|\u6e2f\u53f0\u7efc\u827a|\u6b27\u7f8e\u7efc\u827a|\u771f\u4eba\u79c0|\u8131\u53e3\u79c0)$/.test(cls)) return aggCategoryByKey('variety');
  if (/^(\u52a8\u6f2b|\u56fd\u6f2b|\u65e5\u6f2b|\u6b27\u7f8e\u52a8\u6f2b|\u52a8\u753b\u7535\u5f71|\u5c11\u513f)$/.test(cls)) return aggCategoryByKey('anime');
  if (/^(\u7eaa\u5f55\u7247|\u81ea\u7136|\u5386\u53f2|\u4eba\u6587|\u793e\u4f1a|\u4eba\u7269)$/.test(cls)) return aggCategoryByKey('documentary');
  if (/^(\u77ed\u5267|\u90fd\u5e02|\u53e4\u88c5|\u9006\u88ad|\u751c\u5ba0|\u6218\u795e|\u8c6a\u95e8|\u840c\u5b9d)$/.test(cls)) return aggCategoryByKey('short');
  if (/\u89e3\u8bf4|\u5f71\u8bc4|\u79d1\u6280\u79d1\u666e/.test(cls)) return aggCategoryByKey('explainer');
  if (/\u6587\u5a31\u77e5\u8bc6|\u6f14\u5531\u4f1a|\u97f3\u4e50|MV|\u516c\u5f00\u8bfe|\u6559\u7a0b|\u8bb2\u5ea7|\u79d1\u666e|\u751f\u6d3b|\u7f8e\u98df|\u5065\u8eab|\u6e38\u620f|\u4f53\u80b2|\u5c11\u513f\u4eb2\u5b50/i.test(cls)) return aggCategoryByKey('knowledge');
  if (/\u4f26\u7406|\u7406\u8bba|\u6210\u4eba/.test(cls)) return aggCategoryByKey('adult');
  return null;
}
function parseAggFilters(params) {
  const out = parseFilters(params);
  for (const key of ['area', 'lang', 'quality', 'source', 'form', 'state', 'episodes', 'duration', 'topic', 'line']) {
    const value = params.get(key);
    if (value !== null && value !== undefined && value !== '') out[key] = value;
  }
  return out;
}
function aggFilterOption(n, v) { return { n, v }; }
function valueOptions(items) { return items.map(([n, v]) => aggFilterOption(n, v)); }
function aggClassOptions(categoryKey) {
  const schemaKey = filterSchemaCategoryKey(categoryKey);
  const byCat = {
    recommend: [['\u7cbe\u9009', ''], ['\u7535\u5f71', '\u7535\u5f71'], ['\u5267\u96c6', '\u5267\u96c6'], ['\u89e3\u8bf4', '\u89e3\u8bf4'], ['\u6587\u5a31\u77e5\u8bc6', '\u6587\u5a31\u77e5\u8bc6']],
    movie: [['\u52a8\u4f5c', '\u52a8\u4f5c'], ['\u559c\u5267', '\u559c\u5267'], ['\u7231\u60c5', '\u7231\u60c5'], ['\u60ac\u7591\u72af\u7f6a', '\u60ac\u7591\u72af\u7f6a'], ['\u79d1\u5e7b\u5947\u5e7b', '\u79d1\u5e7b\u5947\u5e7b'], ['\u6050\u6016\u60ca\u609a', '\u6050\u6016\u60ca\u609a'], ['\u5267\u60c5', '\u5267\u60c5'], ['\u6218\u4e89\u5386\u53f2', '\u6218\u4e89\u5386\u53f2']],
    tv: [['\u56fd\u4ea7', '\u56fd\u4ea7'], ['\u6e2f\u53f0', '\u6e2f\u53f0'], ['\u65e5\u97e9', '\u65e5\u97e9'], ['\u6b27\u7f8e', '\u6b27\u7f8e'], ['\u6cf0\u56fd', '\u6cf0\u56fd'], ['\u6d77\u5916', '\u6d77\u5916']],
    variety: [['\u5927\u9646\u7efc\u827a', '\u5927\u9646\u7efc\u827a'], ['\u65e5\u97e9\u7efc\u827a', '\u65e5\u97e9\u7efc\u827a'], ['\u6e2f\u53f0\u7efc\u827a', '\u6e2f\u53f0\u7efc\u827a'], ['\u6b27\u7f8e\u7efc\u827a', '\u6b27\u7f8e\u7efc\u827a'], ['\u771f\u4eba\u79c0', '\u771f\u4eba\u79c0'], ['\u8131\u53e3\u79c0', '\u8131\u53e3\u79c0']],
    anime: [['\u56fd\u6f2b', '\u56fd\u6f2b'], ['\u65e5\u6f2b', '\u65e5\u6f2b'], ['\u6b27\u7f8e\u52a8\u6f2b', '\u6b27\u7f8e\u52a8\u6f2b'], ['\u52a8\u753b\u7535\u5f71', '\u52a8\u753b\u7535\u5f71'], ['\u5c11\u513f', '\u5c11\u513f']],
    documentary: [['\u81ea\u7136', '\u81ea\u7136'], ['\u5386\u53f2', '\u5386\u53f2'], ['\u4eba\u6587', '\u4eba\u6587'], ['\u79d1\u6280', '\u79d1\u6280'], ['\u793e\u4f1a', '\u793e\u4f1a'], ['\u4eba\u7269', '\u4eba\u7269']],
    short: [['\u90fd\u5e02', '\u90fd\u5e02'], ['\u53e4\u88c5', '\u53e4\u88c5'], ['\u9006\u88ad', '\u9006\u88ad'], ['\u751c\u5ba0', '\u751c\u5ba0'], ['\u6218\u795e', '\u6218\u795e'], ['\u8c6a\u95e8', '\u8c6a\u95e8'], ['\u840c\u5b9d', '\u840c\u5b9d']],
    explainer: [['\u7535\u5f71\u89e3\u8bf4', '\u7535\u5f71\u89e3\u8bf4'], ['\u5267\u96c6\u89e3\u8bf4', '\u5267\u96c6\u89e3\u8bf4'], ['\u52a8\u6f2b\u89e3\u8bf4', '\u52a8\u6f2b\u89e3\u8bf4'], ['\u7eaa\u5f55\u89e3\u8bf4', '\u7eaa\u5f55\u89e3\u8bf4'], ['\u6848\u4ef6\u89e3\u8bf4', '\u6848\u4ef6\u89e3\u8bf4'], ['\u6e38\u620f\u89e3\u8bf4', '\u6e38\u620f\u89e3\u8bf4'], ['\u5386\u53f2\u89e3\u8bf4', '\u5386\u53f2\u89e3\u8bf4'], ['\u79d1\u6280\u79d1\u666e', '\u79d1\u6280\u79d1\u666e']],
    knowledge: [['\u6f14\u5531\u4f1a', '\u6f14\u5531\u4f1a'], ['\u97f3\u4e50\u73b0\u573a', '\u97f3\u4e50\u73b0\u573a'], ['MV', 'MV'], ['\u665a\u4f1a', '\u665a\u4f1a'], ['\u516c\u5f00\u8bfe', '\u516c\u5f00\u8bfe'], ['\u6559\u7a0b', '\u6559\u7a0b'], ['\u8bb2\u5ea7', '\u8bb2\u5ea7'], ['\u79d1\u666e', '\u79d1\u666e'], ['\u751f\u6d3b\u65c5\u884c', '\u751f\u6d3b\u65c5\u884c'], ['\u7f8e\u98df\u5065\u8eab', '\u7f8e\u98df\u5065\u8eab'], ['\u6e38\u620f\u79d1\u6280', '\u6e38\u620f\u79d1\u6280'], ['\u4f53\u80b2\u8d5b\u4e8b', '\u4f53\u80b2\u8d5b\u4e8b'], ['\u5c11\u513f\u4eb2\u5b50', '\u5c11\u513f\u4eb2\u5b50']],
    adult: [['\u4f26\u7406', '\u4f26\u7406'], ['\u7406\u8bba', '\u7406\u8bba'], ['\u6210\u4eba', '\u6210\u4eba'], ['\u5267\u60c5', '\u5267\u60c5']],
  };
  return (byCat[schemaKey] || byCat.movie).filter((x) => x[1] !== '').map(([n, v]) => aggFilterOption(n, v));
}
function buildAggFilters() {
  const years = ['2026', '2025', '2024', '2023', '2020-2022', '2010s', 'older'];
  const yearNames = { '2020-2022': '2020-2022', '2010s': '\u0032\u0030\u0031\u0030\u5e74\u4ee3', older: '\u66f4\u65e9' };
  const sortValues = valueOptions([['\u6700\u65b0', 'latest'], ['\u9ad8\u6e05\u4f18\u5148', 'quality'], ['\u591a\u7ebf\u8def\u4f18\u5148', 'lines'], ['\u7247\u540d\u6392\u5e8f', 'name']]);
  const areaValues = valueOptions([['\u5168\u90e8', ''], ['\u5927\u9646', '\u5927\u9646'], ['\u6e2f\u53f0', '\u6e2f\u53f0'], ['\u65e5\u97e9', '\u65e5\u97e9'], ['\u6b27\u7f8e', '\u6b27\u7f8e'], ['\u6cf0\u56fd', '\u6cf0\u56fd'], ['\u5176\u4ed6', '\u5176\u4ed6']]);
  const qualityValues = valueOptions([['\u5168\u90e8', ''], ['\u9ad8\u6e05', 'hd'], ['4K', '4k'], ['1080P', '1080'], ['\u6b63\u7247', '\u6b63\u7247'], ['\u62a2\u5148', 'TC']]);
  const formValues = valueOptions([['\u5168\u90e8', ''], ['\u6b63\u7247', '\u6b63\u7247'], ['\u89e3\u8bf4', '\u89e3\u8bf4'], ['\u5408\u96c6', '\u5408\u96c6'], ['\u73b0\u573a', '\u73b0\u573a'], ['\u8bfe\u7a0b', '\u8bfe\u7a0b'], ['\u77ed\u89c6\u9891', '\u77ed\u89c6\u9891'], ['\u7247\u6bb5', '\u7247\u6bb5']]);
  const stateValues = valueOptions([['\u5168\u90e8', ''], ['\u5df2\u5b8c\u7ed3', '\u5df2\u5b8c\u7ed3'], ['\u66f4\u65b0\u4e2d', '\u66f4\u65b0\u4e2d'], ['\u5408\u96c6', '\u5408\u96c6']]);
  const episodeValues = valueOptions([['\u5168\u90e8', ''], ['30\u96c6\u5185', '0-30'], ['31-80\u96c6', '31-80'], ['80\u96c6\u4ee5\u4e0a', '80+']]);
  const durationValues = valueOptions([['\u5168\u90e8', ''], ['\u77ed\u89c6\u9891', '\u77ed\u89c6\u9891'], ['\u957f\u89c6\u9891', '\u957f\u89c6\u9891'], ['\u5408\u96c6', '\u5408\u96c6']]);
  const topicValues = valueOptions([['\u5168\u90e8', ''], ['\u60ac\u7591', '\u60ac\u7591'], ['\u6050\u6016', '\u6050\u6016'], ['\u79d1\u5e7b', '\u79d1\u5e7b'], ['\u6218\u4e89', '\u6218\u4e89'], ['\u72af\u7f6a', '\u72af\u7f6a'], ['\u5386\u53f2', '\u5386\u53f2'], ['\u4eba\u7269', '\u4eba\u7269'], ['\u5947\u95fb', '\u5947\u95fb']]);
  const knowledgeTopicValues = valueOptions([['\u5168\u90e8', ''], ['\u97f3\u4e50', '\u97f3\u4e50'], ['\u6559\u80b2', '\u6559\u80b2'], ['\u79d1\u6280', '\u79d1\u6280'], ['\u751f\u6d3b', '\u751f\u6d3b'], ['\u8fd0\u52a8', '\u8fd0\u52a8'], ['\u6e38\u620f', '\u6e38\u620f'], ['\u4eb2\u5b50', '\u4eb2\u5b50']]);
  const base = (c) => [
    { key: 'sort', name: '\u6392\u5e8f', init: 'latest', value: sortValues },
    { key: 'year', name: '\u5e74\u4efd', init: '', value: [aggFilterOption('\u5168\u90e8', ''), ...years.map((y) => aggFilterOption(yearNames[y] || y, y))] },
    { key: 'area', name: '\u5730\u533a', init: '', value: areaValues },
    { key: 'class', name: c.key === 'documentary' ? '\u4e3b\u9898' : '\u7c7b\u578b', init: '', value: [aggFilterOption('\u5168\u90e8', ''), ...aggClassOptions(c.key)] },
    { key: 'form', name: '\u5185\u5bb9\u5f62\u6001', init: '', value: formValues },
    { key: 'quality', name: '\u6e05\u6670\u5ea6', init: '', value: qualityValues },
  ];
  const map = {};
  for (const c of AGG_CATEGORIES) {
    const schemaKey = filterSchemaCategoryKey(c.key);
    let filters = base(c);
    if (schemaKey === 'tv' || c.key === 'anime' || c.key === 'variety') filters = [filters[0], filters[1], filters[2], filters[3], { key: 'state', name: '\u72b6\u6001', init: '', value: stateValues }, filters[5]];
    if (schemaKey === 'short') filters = [filters[0], filters[1], filters[3], { key: 'episodes', name: '\u96c6\u6570', init: '', value: episodeValues }, { key: 'state', name: '\u72b6\u6001', init: '', value: stateValues }, filters[5]];
    if (c.key === 'explainer') filters = [filters[0], filters[1], filters[3], { key: 'duration', name: '\u65f6\u957f', init: '', value: durationValues }, { key: 'topic', name: '\u9898\u6750', init: '', value: topicValues }, filters[5]];
    if (c.key === 'knowledge') filters = [filters[0], filters[1], filters[3], filters[4], { key: 'topic', name: '\u4e3b\u9898', init: '', value: knowledgeTopicValues }, filters[5]];
    if (c.key === 'adult') filters = [filters[0], filters[1], filters[2], filters[3], filters[5]];
    map[c.id] = filters;
    map[c.key] = filters;
  }
  for (const legacy of LEGACY_AGG_CATEGORIES) {
    const exemplar = AGG_CATEGORIES.find((c) => filterSchemaCategoryKey(c.key) === legacy.key);
    const filters = exemplar ? map[exemplar.id] : [];
    map[legacy.id] = filters;
    map[legacy.key] = filters;
  }
  return map;
}
const AGG_FILTER_MAP = buildAggFilters();
function aggFilterOptionMatches(item, categoryKey, key, value) {
  const v = filterValue(value);
  if (!v) return true;
  if (key === 'sort') return true;
  if (key === 'year') {
    const y = extractYearFromVod(item);
    if (!y) return false;
    return aggYearMatches(item, v);
  }
  if (key === 'area') return areaMatches(item, v);
  if (key === 'class') return classGroupMatchesText(v, aggText(item, item._className));
  if (key === 'topic') return classGroupMatchesText(v, aggText(item, item._className));
  if (key === 'form') return formMatches(item, v);
  if (key === 'state') return stateMatches(item, v);
  if (key === 'episodes') return episodeMatches(item, v);
  if (key === 'duration') return durationMatches(item, v);
  if (key === 'quality') {
    const text = [item.vod_remarks, item.vod_name, item.vod_play_from].join(' ').toUpperCase();
    if (v === 'hd') return qualityRankText(text) >= 50;
    if (v === '\u6b63\u7247') return contentFormForItem(item) === '\u6b63\u7247';
    return text.includes(v.toUpperCase());
  }
  return true;
}
function dynamicAggFiltersFor(categoryKey, mergedRows) {
  const cat = aggCategoryByKey(categoryKey);
  const base = AGG_FILTER_MAP[cat.id] || AGG_FILTER_MAP[filterSchemaCategoryKey(cat.key)] || [];
  const items = (mergedRows || []).map((x) => x && (x.best || x)).filter(Boolean);
  if (!items.length) return base;
  const out = [];
  for (const f of base) {
    if (f.key === 'sort') { out.push(f); continue; }
    const empty = (f.value || []).find((o) => !filterValue(o.v));
    const kept = [];
    for (const opt of (f.value || [])) {
      const v = filterValue(opt.v);
      if (!v) continue;
      const hits = items.reduce((sum, item) => sum + (aggFilterOptionMatches(item, cat.key, f.key, v) ? 1 : 0), 0);
      if (hits > 0) kept.push({ ...opt, _hits: hits });
    }
    kept.sort((a, b) => (b._hits || 0) - (a._hits || 0));
    const maxOptions = f.key === 'class' || f.key === 'topic' ? 8 : 6;
    const value = [empty || aggFilterOption('\u5168\u90e8', ''), ...kept.slice(0, maxOptions).map(({ _hits, ...opt }) => opt)];
    if (value.length > 1) out.push({ ...f, value });
  }
  return out.slice(0, 6);
}
function aggFiltersForResponse(activeCategoryKey = '', mergedRows = []) {
  const map = { ...AGG_FILTER_MAP };
  if (activeCategoryKey) {
    const cat = aggCategoryByKey(activeCategoryKey);
    if (cat) {
      const filters = dynamicAggFiltersFor(cat.key, mergedRows);
      map[cat.id] = filters;
      map[cat.key] = filters;
      for (const canonicalKey of canonicalKeysForCategory(cat)) {
        const canonical = AGG_CATEGORIES.find((c) => c.key === canonicalKey);
        if (!canonical) continue;
        map[canonical.id] = filters;
        map[canonical.key] = filters;
      }
    }
  }
  return map;
}
function aggClasses(activeCategoryKey = '', mergedRows = [], policy = {}) {
  const responseFilters = aggFiltersForResponse(activeCategoryKey, mergedRows);
  return visibleAggCategoriesForPolicy(policy).map((c) => ({ type_id: c.id, type_name: c.name, filters: sanitizeFilterGroupsForPolicy(responseFilters[c.id] || [], policy) }));
}
function fetchParamsForSource(source, params) {
  const upstream = new URL(source.api);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && String(v) !== '') upstream.searchParams.set(k, String(v));
  return upstream.href;
}
async function fetchCmsJsonByParams(source, params, timeoutMs = CMS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(fetchParamsForSource(source, params), { headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*' }, redirect: 'follow', signal: controller.signal });
    const body = await res.text();
    let data = null;
    try { data = JSON.parse(body.replace(/^\uFEFF/, '').trim()); } catch {}
    return { ok: res.ok && data && typeof data === 'object', status: res.status, data };
  } finally { clearTimeout(timer); }
}
async function getSourceClassInfo(source) {
  const now = Date.now();
  const cached = classCache.get(source.slug);
  if (cached && now - cached.ts < CLASS_CACHE_TTL_MS) return cached.data;
  try {
    const got = await fetchCmsJsonByParams(source, {}, 6500);
    const classes = Array.isArray(got.data?.class) ? got.data.class.filter((x) => !isInvalidCmsClass(x)).map(cleanCmsClass) : [];
    const byId = Object.fromEntries(classes.map((c) => [String(c.type_id), c.type_name]));
    const categoryMap = sourceCategoryMapFromClasses(classes);
    const data = { classes, byId, categoryMap };
    classCache.set(source.slug, { ts: now, data });
    return data;
  } catch {
    const data = { classes: [], byId: {}, categoryMap: {} };
    classCache.set(source.slug, { ts: now, data });
    return data;
  }
}
function selectedSources(filters) {
  const only = filterValue(filters.source);
  if (only) return CMS_SOURCES.filter((s) => s.slug === only || s.key === only || s.short === only || s.name === only);
  return CMS_SOURCES;
}
function classGroupMatchesText(value, text) {
  const v = filterValue(value);
  if (!v) return true;
  const hay = String(text || '');
  const rules = [
    ['\u60ac\u7591\u72af\u7f6a', /(\u60ac\u7591|\u72af\u7f6a|\u63a8\u7406|\u5211\u4fa6|\u8b66\u532a|\u6848\u4ef6)/],
    ['\u79d1\u5e7b\u5947\u5e7b', /(\u79d1\u5e7b|\u5947\u5e7b|\u9b54\u5e7b|\u707e\u96be|\u5192\u9669)/],
    ['\u6050\u6016\u60ca\u609a', /(\u6050\u6016|\u60ca\u609a|\u60ca\u609a|\u7075\u5f02)/],
    ['\u6218\u4e89\u5386\u53f2', /(\u6218\u4e89|\u5386\u53f2|\u53e4\u88c5|\u4f20\u8bb0)/],
    ['\u6e2f\u53f0', /(\u6e2f\u53f0|\u9999\u6e2f|\u6e2f\u5267|\u6e2f\u6fb3|\u53f0\u6e7e|\u53f0\u5267)/],
    ['\u65e5\u97e9', /(\u65e5\u97e9|\u65e5\u672c|\u65e5\u5267|\u65e5\u6f2b|\u97e9\u56fd|\u97e9\u5267|\u97e9\u6f2b)/],
    ['\u6b27\u7f8e', /(\u6b27\u7f8e|\u7f8e\u56fd|\u82f1\u56fd|\u6cd5\u56fd|\u5fb7\u56fd|\u7f8e\u5267|\u82f1\u5267)/],
    ['\u56fd\u6f2b', /(\u56fd\u6f2b|\u56fd\u4ea7\u52a8\u6f2b|\u4e2d\u56fd\u52a8\u6f2b)/],
    ['\u65e5\u6f2b', /(\u65e5\u6f2b|\u65e5\u672c\u52a8\u6f2b|\u65e5\u97e9\u52a8\u6f2b|\u756a\u5267)/],
    ['\u97f3\u4e50\u73b0\u573a', /(\u97f3\u4e50\u73b0\u573a|\u97f3\u4e50\u4f1a|\u6f14\u5531\u4f1a|LIVE|\u73b0\u573a|\u97f3\u4e50\u8282)/i],
    ['\u751f\u6d3b\u65c5\u884c', /(\u751f\u6d3b|\u65c5\u884c|vlog|VLOG|\u65c5\u6e38|\u63a2\u5e97)/],
    ['\u7f8e\u98df\u5065\u8eab', /(\u7f8e\u98df|\u70f9\u996a|\u5065\u8eab|\u8fd0\u52a8|\u745c\u4f3d)/],
    ['\u6e38\u620f\u79d1\u6280', /(\u6e38\u620f|\u79d1\u6280|\u6d4b\u8bc4|\u6570\u7801|\u7535\u7ade)/],
    ['\u4f53\u80b2\u8d5b\u4e8b', /(\u4f53\u80b2|\u8d5b\u4e8b|\u6bd4\u8d5b|\u96c6\u9526|\u56de\u653e|\u7bee\u7403|\u8db3\u7403|\u683c\u6597)/],
    ['\u5c11\u513f\u4eb2\u5b50', /(\u5c11\u513f|\u513f\u7ae5|\u4eb2\u5b50|\u513f\u6b4c|\u65e9\u6559|\u542f\u8499)/],
    ['\u7535\u5f71', /(\u7535\u5f71|\u52a8\u4f5c|\u559c\u5267|\u7231\u60c5|\u79d1\u5e7b|\u6050\u6016|\u60ca\u609a|\u60ac\u7591|\u5267\u60c5|\u6218\u4e89|\u72af\u7f6a|\u5f71\u7247|\u9662\u7ebf)/],
    ['\u5267\u96c6', /(\u5267\u96c6|\u7535\u89c6\u5267|\u8fde\u7eed\u5267|\u56fd\u4ea7\u5267|\u7f8e\u5267|\u82f1\u5267|\u6e2f\u5267|\u53f0\u5267|\u97e9\u5267|\u65e5\u5267|\u6cf0\u5267)/],
    ['\u6587\u5a31\u77e5\u8bc6', /(\u6587\u5a31|\u77e5\u8bc6|\u6f14\u5531\u4f1a|\u97f3\u4e50|MV|LIVE|\u516c\u5f00\u8bfe|\u6559\u7a0b|\u8bb2\u5ea7|\u79d1\u666e|\u7f8e\u98df|\u65c5\u884c|\u6e38\u620f|\u4f53\u80b2|\u5c11\u513f)/i],
  ];
  const found = rules.find(([name]) => name === v);
  return found ? found[1].test(hay) : hay.includes(v);
}
function sourceClassIdsFor(sourceInfo, categoryKey, filters) {
  const cls = filterValue(filters.class || filters.topic);
  if (!sourceInfo.classes.length || categoryKey === 'recommend' || categoryKey === 'explainer' || categoryKey === 'knowledge') return [];
  let matches = sourceInfo.classes.filter((c) => classWantedForMacro(c.type_name, categoryKey));
  if (cls) matches = matches.filter((c) => classGroupMatchesText(cls, c.type_name));
  const childParentIds = new Set(sourceInfo.classes.map((c) => String(c.type_pid || '')).filter(Boolean));
  const leaf = matches.filter((c) => !isBroadParentClass(c.type_name) && !childParentIds.has(String(c.type_id)));
  return (leaf.length ? leaf : matches.filter((c) => !isBroadParentClass(c.type_name))).slice(0, AGG_CLASS_LIMIT).map((c) => String(c.type_id));
}
function extractYearFromVod(item) {
  const text = [item.vod_year, item.vod_name, item.vod_remarks, item.type_name].join(' ');
  const m = String(text).match(/(?:19|20)\d{2}/);
  return m ? m[0] : '';
}
function titleDeclaredYear(value) {
  const m = String(value || '').match(/(?:19|20)\d{2}/);
  return m ? m[0] : '';
}
function dedupYearForVod(item) {
  return titleDeclaredYear(item?.vod_name) || extractYearFromVod(item);
}
function qualityRankText(text) {
  const t = String(text || '').toUpperCase();
  if (/4K|2160/.test(t)) return 70;
  if (/1080|\u84dd\u5149|BD|B1080/.test(t)) return 60;
  if (/TC|TS|\u62a2\u5148|\u67aa\u7248/.test(t)) return 15;
  if (/HD|\u9ad8\u6e05|\u6b63\u7247|\u5b8c\u7ed3/.test(t)) return 50;
  if (/\u66f4\u65b0/.test(t)) return 40;
  return 30;
}
function aggQualityRank(item) { return qualityRankText([item.vod_remarks, item.vod_name, item.vod_play_from].join(' ')); }
export function normalizeVodTitle(value) {
  return String(value || '')
    .replace(/[\[\u3010(\uff08].*?[\]\u3011)\uff09]/g, '')
    .replace(/(?:\u56fd\u8bed|\u7ca4\u8bed|\u4e2d\u5b57|\u4e2d\u6587\u5b57\u5e55|\u82f1\u6587|\u82f1\u8bed|\u65e5\u8bed|\u97e9\u8bed|\u6cf0\u8bed|\u9ad8\u6e05|HD|TC|TS|\u62a2\u5148|\u6b63\u7247|\u5b8c\u7ed3|\u5168\u96c6|\u7b2c\d+\u5b63|\u7b2c\d+\u96c6|\u66f4\u65b0\u81f3.*)$/gi, '')
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/[\s\u00b7.\u3002,\uff0c:\uff1a;\uff1b!\uff01?\uff1f_\-\u2014|]+/g, '')
    .trim()
    .toLowerCase();
}
const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
function compareDisplayName(a, b) {
  return NAME_COLLATOR.compare(String(a || ''), String(b || ''));
}
function aggYearMatches(item, wanted) {
  const v = filterValue(wanted);
  if (!v) return true;
  const y = extractYearFromVod(item);
  if (!y) return true;
  const n = parseInt(y, 10);
  if (/^\d{4}$/.test(v)) return y === v;
  if (v === '2020-2022') return n >= 2020 && n <= 2022;
  if (v === '2010s') return n >= 2010 && n <= 2019;
  if (v === 'older') return n > 0 && n < 2010;
  return true;
}
function areaMatches(item, wanted) {
  const v = filterValue(wanted);
  if (!v) return true;
  const hay = aggText(item, item._className);
  return classGroupMatchesText(v, hay);
}
function contentFormForItem(item) {
  const text = aggText(item, item._className);
  if (EXPLAINER_RE.test(text)) return '\u89e3\u8bf4';
  if (COURSE_RE.test(text)) return '\u8bfe\u7a0b';
  if (LIVE_FORM_RE.test(text)) return '\u73b0\u573a';
  if (COLLECTION_RE.test(text)) return '\u5408\u96c6';
  if (SNIPPET_RE.test(text)) return '\u7247\u6bb5';
  if (/\u77ed\u89c6\u9891|\u5feb\u770b|\u901f\u770b/.test(text)) return '\u77ed\u89c6\u9891';
  return '\u6b63\u7247';
}
function formMatches(item, wanted) {
  const v = filterValue(wanted);
  if (!v) return true;
  if (v === '\u6b63\u7247') return contentFormForItem(item) === '\u6b63\u7247';
  if (v === '\u82b1\u7d6e\u9884\u544a') return SNIPPET_RE.test(aggText(item, item._className));
  return contentFormForItem(item) === v || classGroupMatchesText(v, aggText(item, item._className));
}
function stateMatches(item, wanted) {
  const v = filterValue(wanted);
  if (!v) return true;
  const text = aggText(item, item._className);
  const complete = /(\u5b8c\u7ed3|\u5168\d+\u96c6|\u5168\u96c6|\u5df2\u5b8c\u7ed3)/.test(text);
  const updating = /(\u66f4\u65b0|\u66f4\u65b0\u81f3|\u8fde\u8f7d)/.test(text) && !complete;
  if (v === '\u5df2\u5b8c\u7ed3') return complete;
  if (v === '\u66f4\u65b0\u4e2d') return updating || !complete;
  if (v === '\u5408\u96c6') return COLLECTION_RE.test(text);
  return true;
}
function episodeMatches(item, wanted) {
  const v = filterValue(wanted);
  if (!v) return true;
  const text = aggText(item, item._className);
  const m = text.match(/(?:\u5168|\u7b2c|\u66f4\u65b0\u81f3)?(\d{1,4})\u96c6/);
  if (!m) return true;
  const n = parseInt(m[1], 10);
  if (v === '0-30') return n <= 30;
  if (v === '31-80') return n >= 31 && n <= 80;
  if (v === '80+') return n > 80;
  return true;
}
function durationMatches(item, wanted) {
  const v = filterValue(wanted);
  if (!v) return true;
  const form = contentFormForItem(item);
  if (v === '\u5408\u96c6') return form === '\u5408\u96c6';
  if (v === '\u77ed\u89c6\u9891') return form === '\u77ed\u89c6\u9891' || /\b([1-9]|1\d|2\d)\s*(min|\u5206\u949f)/i.test(aggText(item, item._className));
  if (v === '\u957f\u89c6\u9891') return form !== '\u77ed\u89c6\u9891';
  return true;
}
function aggItemMatches(item, categoryOrKey, filters) {
  const category = typeof categoryOrKey === 'string' ? aggCategoryByKey(categoryOrKey) : (categoryOrKey || AGG_CATEGORIES[0]);
  if (category.key !== 'recommend' && !categoryMatchesPrimary(category, item.primary_category || item._macro)) return false;
  if (!aggYearMatches(item, filters.year)) return false;
  if (!areaMatches(item, filters.area)) return false;
  if (!classGroupMatchesText(filters.lang, [item.vod_lang, item.vod_name, item.vod_remarks].join(' '))) return false;
  const cls = filterValue(filters.class);
  if (cls && !classGroupMatchesText(cls, aggText(item, item._className))) return false;
  const topic = filterValue(filters.topic);
  if (topic && !classGroupMatchesText(topic, aggText(item, item._className))) return false;
  if (!formMatches(item, filters.form)) return false;
  if (!stateMatches(item, filters.state)) return false;
  if (!episodeMatches(item, filters.episodes)) return false;
  if (!durationMatches(item, filters.duration)) return false;
  const q = filterValue(filters.quality);
  if (q) {
    const text = [item.vod_remarks, item.vod_name, item.vod_play_from].join(' ').toUpperCase();
    if (q === 'hd' && qualityRankText(text) < 50) return false;
    else if (q !== 'hd' && q !== '\u6b63\u7247' && !text.includes(q.toUpperCase())) return false;
    else if (q === '\u6b63\u7247' && contentFormForItem(item) !== '\u6b63\u7247') return false;
  }
  return true;
}
function aggDedupKey(item) {
  if (String(item?.canonical_id || '').trim()) return String(item.canonical_id).trim();
  const title = normalizeVodTitle(item.vod_name) || String(item.vod_name || '').trim().toLowerCase() || String(item.vod_id || '');
  const creator = normalizeVodTitle([item?.vod_actor, item?.vod_director].filter(Boolean).join('/'));
  return [title, dedupYearForVod(item), creator].join('|');
}
function episodeNumberFromText(value) {
  const text = String(value || '');
  const matches = [...text.matchAll(/(?:\u66f4\u65b0\u81f3|\u66f4\u65b0|\u5168|\u7b2c)?\s*(\d{1,4})\s*\u96c6/g)];
  return matches.reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
}
function episodeInfoForVod(item) {
  const episodeCount = Number(String(item?.vod_total || '').match(/\d{1,4}/)?.[0] || 0) || episodeNumberFromText(item?.vod_remarks);
  const latestEpisode = Math.max(
    episodeNumberFromText(item?.vod_serial),
    episodeNumberFromText(item?.vod_remarks),
    episodeNumberFromText(item?.vod_name),
    episodeCount,
  );
  return { episodeCount, latestEpisode, episodeDuration: String(item?.vod_duration || '').trim() };
}
function sourceCandidateForVod(item) {
  return { source: item?._sourceSlug || '', id: String(item?.vod_id || '').trim(), updated_at: item?.vod_time || item?.vod_time_add || item?.vod_pubdate || '' };
}
function playLinesForVod(item) {
  const from = String(item?.vod_play_from || '').split('$$$');
  const urls = String(item?.vod_play_url || '').split('$$$');
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    for (const ep of splitCmsEpisodes(urls[i])) out.push({ source: item?._sourceSlug || '', name: from[i] || ep.name || '\u9ad8\u6e05', url: ep.url });
  }
  return out;
}
function aggListItemFromMerged(m) {
  const best = m.best;
  const cat = AGG_CATEGORIES.find((c) => c.key === best._macro) || AGG_CATEGORIES[0];
  const form = contentFormForItem(best);
  const episodeInfo = episodeInfoForVod(best);
  const lineText = m.candidates.length > 1 ? `${best.vod_remarks || ''} \u00b7 ${m.candidates.length}\u7ebf` : (best.vod_remarks || '');
  const semanticTags = [...new Set([
    ...(String(best.semantic_tags || '').split(/[,\s|/]+/).filter(Boolean)),
    best._className,
    best.vod_class,
    best.vod_area,
    best.vod_lang,
    best.vod_actor,
    best.vod_director,
    best.vod_state,
    form,
    cat.name,
  ].filter(Boolean).map((x) => cleanCmsText(x, 40)).filter(Boolean))].join(' ');
  return {
    vod_id: 'agg_' + b64urlEncode(JSON.stringify(m.candidates.slice(0, AGG_DETAIL_LIMIT).map((c) => ({ s: c._sourceSlug, id: c.vod_id })))),
    canonical_id: best.canonical_id || aggDedupKey(best),
    primary_category: best.primary_category || best._macro || '',
    vod_name: best.vod_name,
    vod_pic: best.vod_pic || '',
    type_id: cat.id,
    type_name: cat.name,
    vod_year: extractYearFromVod(best),
    vod_remarks: cleanAggName(lineText || form || '', 80),
    vod_class: cleanCmsText(best.vod_class || best._className || '', 80),
    vod_state: cleanCmsText(best.vod_state || '', 40),
    vod_area: cleanCmsText(best.vod_area || '', 60),
    vod_lang: cleanCmsText(best.vod_lang || '', 40),
    vod_actor: cleanCmsText(best.vod_actor || '', 120),
    vod_director: cleanCmsText(best.vod_director || '', 80),
    vod_time: best.vod_time || '',
    vod_time_add: best.vod_time_add || '',
    vod_pubdate: best.vod_pubdate || '',
    vod_total: best.vod_total || '',
    vod_serial: best.vod_serial || '',
    vod_duration: best.vod_duration || '',
    episode_count: episodeInfo.episodeCount,
    latest_episode: episodeInfo.latestEpisode,
    episode_duration: episodeInfo.episodeDuration,
    source_updated_at: best.vod_time || best.vod_time_add || best.vod_pubdate || '',
    source_candidates: m.candidates.map(sourceCandidateForVod).filter((x) => x.source && x.id),
    play_lines: m.candidates.flatMap(playLinesForVod),
    classification_confidence: Number(best.classification_confidence || 0),
    classification_evidence: best.classification_evidence || [],
    semantic_tags: semanticTags,
    snapshot_filter_evidence: best.snapshot_filter_evidence || '',
  };
}

function betterAggItem(a, b) {
  const ca = Number(a.classification_confidence || 0), cb = Number(b.classification_confidence || 0);
  if (ca !== cb) return ca > cb ? a : b;
  const qa = aggQualityRank(a), qb = aggQualityRank(b);
  if (qa !== qb) return qa > qb ? a : b;
  const sa = SOURCE_RANK[a._sourceSlug] || 0, sb = SOURCE_RANK[b._sourceSlug] || 0;
  if (sa !== sb) return sa > sb ? a : b;
  return String(a.vod_name || '').length <= String(b.vod_name || '').length ? a : b;
}
function mergeAggItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = hotCanonicalKey(item) || aggDedupKey(item);
    const bucket = map.get(key) || [];
    const old = bucket.find((entry) => rowsIdentityCompatible(entry.best, item));
    if (!old) {
      bucket.push({ best: item, candidates: [item] });
      map.set(key, bucket);
    } else {
      if (!old.candidates.some((c) => c._sourceSlug === item._sourceSlug && String(c.vod_id) === String(item.vod_id))) old.candidates.push(item);
      old.best = betterAggItem(old.best, item);
    }
  }
  return [...map.values()].flat();
}
const SEARCH_KNOWLEDGE = [
  { title: '\u5929\u9053', aliases: ['\u9065\u8fdc\u7684\u6551\u4e16\u4e3b'], actors: ['\u738b\u5fd7\u6587', '\u5de6\u5c0f\u9752'], year: '2008', category: 'tv' },
  { title: '\u4eae\u5251', aliases: [], actors: ['\u674e\u5e7c\u658c'], year: '2005', category: 'tv' },
  { title: '\u6f5c\u4f0f', aliases: [], actors: ['\u5b59\u7ea2\u96f7', '\u59da\u6668'], year: '2009', category: 'tv' },
];
function searchNormalize(value) { return normalizeVodTitle(value); }
function searchKnowledgeFor(query) {
  const q = searchNormalize(query);
  if (!q) return [];
  return SEARCH_KNOWLEDGE.filter((entry) => [entry.title, ...(entry.aliases || []), ...(entry.actors || [])].some((x) => {
    const n = searchNormalize(x);
    return n && (n === q || n.includes(q) || q.includes(n));
  }));
}
function searchVariantsFor(query) {
  const out = [];
  const add = (x) => { const v = filterValue(x); if (v && !out.includes(v)) out.push(v); };
  add(query);
  for (const entry of searchKnowledgeFor(query)) {
    add(entry.title);
    for (const a of entry.aliases || []) add(a);
    if (entry.year) add(`${entry.title} ${entry.year}`);
  }
  return out.slice(0, 3);
}
function buildSearchContext(query) {
  const entries = searchKnowledgeFor(query);
  const exactTitles = new Set();
  const actors = new Set();
  for (const entry of entries) {
    exactTitles.add(searchNormalize(entry.title));
    for (const a of entry.aliases || []) exactTitles.add(searchNormalize(a));
    for (const a of entry.actors || []) actors.add(searchNormalize(a));
  }
  exactTitles.add(searchNormalize(query));
  return { query, queryNorm: searchNormalize(query), exactTitles, actors };
}
function searchScoreItem(item, context) {
  if (!context || !context.queryNorm) return 0;
  const title = searchNormalize(item?.vod_name);
  const textNorm = searchNormalize(aggText(item, item?._className));
  let score = 0;
  if (context.exactTitles.has(title)) score += 2000;
  else if ([...context.exactTitles].some((x) => x && (title.includes(x) || x.includes(title)))) score += 1200;
  if (title === context.queryNorm) score += 1000;
  else if (title.includes(context.queryNorm)) score += 300;
  if ([...context.actors].some((a) => a && textNorm.includes(a))) score += 800;
  if (textNorm.includes(context.queryNorm)) score += 120;
  const form = contentFormForItem(item);
  if (form === '\u6b63\u7247') score += 160;
  if (/\u77ed\u5267|\u52a8\u6001\u6f2b\u753b|\u89e3\u8bf4|\u7247\u6bb5/.test(aggText(item, item?._className)) && !context.exactTitles.has(title)) score -= 260;
  return score;
}
function searchScoreMerged(row, context) { return Math.max(searchScoreItem(row.best, context), ...row.candidates.map((x) => searchScoreItem(x, context))); }
function defaultAggCompare(a, b) { return Number(extractYearFromVod(b.best) || 0) - Number(extractYearFromVod(a.best) || 0) || aggQualityRank(b.best) - aggQualityRank(a.best) || (SOURCE_RANK[b.best._sourceSlug] || 0) - (SOURCE_RANK[a.best._sourceSlug] || 0) || compareDisplayName(a.best.vod_name, b.best.vod_name); }
function sortAggMerged(rows, filters, searchContext = null) {
  const sort = filterValue(filters.sort || 'latest');
  const out = [...rows];
  if (searchContext && searchContext.queryNorm) return out.sort((a, b) => searchScoreMerged(b, searchContext) - searchScoreMerged(a, searchContext) || b.candidates.length - a.candidates.length || defaultAggCompare(a, b));
  if (sort === 'quality') return out.sort((a, b) => aggQualityRank(b.best) - aggQualityRank(a.best) || b.candidates.length - a.candidates.length);
  if (sort === 'name') return out.sort((a, b) => compareDisplayName(a.best.vod_name, b.best.vod_name));
  if (sort === 'lines') return out.sort((a, b) => b.candidates.length - a.candidates.length || aggQualityRank(b.best) - aggQualityRank(a.best));
  return out.sort(defaultAggCompare);
}
function searchTermsForCategory(categoryKey, filters) {
  const cls = filterValue(filters.class || filters.topic);
  if (categoryKey === 'explainer') {
    if (cls && cls.includes('\u89e3\u8bf4')) return [cls];
    if (cls === '\u79d1\u6280\u79d1\u666e') return ['\u79d1\u666e', '\u79d1\u6280\u79d1\u666e'];
    return ['\u7535\u5f71\u89e3\u8bf4', '\u5f71\u89c6\u89e3\u8bf4', '\u89e3\u8bf4'];
  }
  if (categoryKey === 'knowledge') {
    if (cls) return [cls.replace(/\u751f\u6d3b\u65c5\u884c/, '\u65c5\u884c').replace(/\u7f8e\u98df\u5065\u8eab/, '\u7f8e\u98df').replace(/\u6e38\u620f\u79d1\u6280/, '\u79d1\u6280').replace(/\u4f53\u80b2\u8d5b\u4e8b/, '\u4f53\u80b2').replace(/\u5c11\u513f\u4eb2\u5b50/, '\u5c11\u513f')];
    return ['\u6f14\u5531\u4f1a', '\u516c\u5f00\u8bfe', '\u79d1\u666e', '\u7f8e\u98df'];
  }
  if (categoryKey === 'documentary') {
    if (cls) return [cls + '\u7eaa\u5f55\u7247', cls + '\u7eaa\u5f55', cls];
    return ['\u7eaa\u5f55\u7247', '\u7eaa\u5f55', '\u7eaa\u5b9e', '\u5e55\u540e\u7eaa\u5f55'];
  }
  if (categoryKey === 'adult') {
    if (cls) return [cls];
    return ['\u4f26\u7406', '\u7406\u8bba', '\u6210\u4eba', '\u4e09\u7ea7'];
  }
  return [];
}
async function collectAggListFromSource(source, categoryOrKey, filters, page, wd, options = {}) {
  const category = typeof categoryOrKey === 'string' ? aggCategoryByKey(categoryOrKey) : (categoryOrKey || AGG_CATEGORIES[0]);
  const categoryKey = category.key;
  const sourceInfo = await getSourceClassInfo(source);
  const baseParams = { ac: 'videolist', pg: page };
  if (wd) baseParams.wd = wd;
  if (filterValue(filters.year) && /^\d{4}$/.test(filterValue(filters.year))) baseParams.year = filterValue(filters.year);
  if (filterValue(filters.area) && !['\u6e2f\u53f0', '\u65e5\u97e9', '\u6b27\u7f8e'].includes(filterValue(filters.area))) baseParams.area = filterValue(filters.area);
  const requests = [];
  if (!wd && (categoryKey === 'explainer' || categoryKey === 'knowledge' || categoryKey === 'documentary' || categoryKey === 'adult')) {
    for (const term of searchTermsForCategory(categoryKey, filters).slice(0, 4)) requests.push({ ...baseParams, wd: term });
  } else {
    requests.push(baseParams);
  }
  const classIds = (!wd && categoryKey !== 'recommend') ? sourceClassIdsFor(sourceInfo, categoryKey, filters) : [];
  for (const t of classIds) requests.push({ ...baseParams, t });
  const uniqReqs = [];
  const reqSeen = new Set();
  for (const req of requests) { const k = JSON.stringify(req); if (!reqSeen.has(k)) { reqSeen.add(k); uniqReqs.push(req); } }
  const jobs = uniqReqs.map((params) => fetchCmsJsonByParams(source, params, 7500).then((value) => ({ params, value })));
  const got = await Promise.allSettled(jobs);
  const rows = [];
  let sourceOk = false;
  for (const r of got) {
    if (r.status !== 'fulfilled' || !r.value.value.ok) continue;
    sourceOk = true;
    const requestTypeId = String(r.value.params.t || '');
    const requestClassName = requestTypeId ? cleanCmsText(sourceInfo.byId[requestTypeId] || '', 40) : '';
    const cleaned = cleanCmsResult(r.value.value.data, false);
    for (const raw of cleaned.list || []) {
      const typeId = String(raw.type_id || raw.type || '');
      const className = cleanCmsText(raw.type_name || sourceInfo.byId[typeId] || requestClassName || '', 40);
      let item = normalizeAggContentItem({
        ...raw,
        type_id: typeId || requestTypeId,
        source_category_id: typeId || requestTypeId,
        source_category_name: className,
      }, className, sourceInfo.categoryMap || {});
      if (item.primary_category === 'recommend' && requestTypeId && categoryKey !== 'recommend') {
        const primary = fallbackPrimaryForCategory(category);
        item = { ...item, primary_category: primary, _macro: primary };
      }
      item = { ...item, type_name: className || raw.type_name || '', _className: className, _sourceSlug: source.slug, _sourceShort: source.short };
      if (aggItemMatches(item, category, filters)) rows.push(item);
    }
  }
  return options.withStatus ? { source, sourceOk, rows } : rows;
}
function decodeAggCandidates(id) {
  const raw = String(id || '').trim();
  if (!raw) return [];
  const token = raw.startsWith('agg_') ? raw.slice(4) : raw;
  try { const parsed = JSON.parse(b64urlDecode(token)); return Array.isArray(parsed) ? parsed.filter((x) => x && x.s && x.id).slice(0, AGG_DETAIL_LIMIT) : []; } catch {}
  const m = raw.match(/^([a-z0-9_]+)[:|](.+)$/i);
  return m ? [{ s: m[1], id: m[2] }] : [];
}
const detailExpansionCache = new Map();
const DETAIL_SOURCE_PRIORITY = {
  baidu: 100,
  bfzy: 95,
  taopian: 90,
  huya: 85,
  hhzy: 80,
  hongniu: 75,
  guangsu: 70,
  sony: 65,
  ffzy: 60,
  wujin: 55,
  modu: 50,
  yhzy: 45,
  xinlang: 40,
  lzi: 30,
  sdzy: 25,
};
function firstPlayableUrlFromVod(vod) {
  const urlGroups = String(vod?.vod_play_url || '').split('$$$');
  for (const group of urlGroups) {
    for (const ep of splitCmsEpisodes(group)) if (isPlayableCmsUrl(ep.url)) return ep.url;
  }
  return '';
}
function playUrlReliabilityScore(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    if (/lzcdn2[0-9]\.com$/.test(host)) return -80;
    if (/bdzybf|baofeng|taopianplay|huya|hhzy|hongniu|guangsu|ffzy|wujin|modu|apiyhzy|xinlang/i.test(host)) return 30;
    if (/cloudfront|akamai|aliyun|byte|cdn/i.test(host)) return 10;
    return 0;
  } catch { return 0; }
}
function detailSourceScore(row) {
  const base = DETAIL_SOURCE_PRIORITY[row?.source?.slug] ?? (SOURCE_RANK[row?.source?.slug] || 0);
  return base + playUrlReliabilityScore(firstPlayableUrlFromVod(row?.vod));
}
function cleanPlayFlag(value, source) {
  const raw = cleanCmsText(value || '', 20);
  if (!raw || /(m3u8|yun|liangzi|db|sd|bfzy|sn|tp|hh|hn|gs|hy|no)/i.test(raw)) return `${source.short}\u9ad8\u6e05`.slice(0, 24);
  const readable = raw.replace(/\s+/g, '') || '\u9ad8\u6e05';
  return `${source.short}${readable}`.slice(0, 24);
}

function splitEnvList(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const list = raw.split(/[|,\n]+/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list : fallback;
}
function snapshotBases(env) {
  return splitEnvList(env && env.SNAPSHOT_BASES, DEFAULT_SNAPSHOT_BASES);
}
function isSnapshotBypass(params) {
  return /^(1|true|yes|dynamic)$/i.test(String(params.get('force') || params.get('dynamic') || ''));
}
function snapshotFilterToken(value) {
  return b64urlEncode(String(value || ''));
}
function snapshotBasePath(category, packPage = 1, clean = false) {
  const prefix = clean ? 'catalog-packs/clean/' : 'catalog-packs/';
  return prefix + 't' + category.id + '-p' + packPage + '-limit' + SNAPSHOT_PACK_LIMIT + '.json';
}
function snapshotSearchPath(wd, packPage = 1, clean = false) {
  const prefix = clean ? 'search-packs/clean/' : 'search-packs/';
  return prefix + encodeURIComponent(String(wd || '')) + '-p' + packPage + '-limit' + SNAPSHOT_PACK_LIMIT + '.json';
}
function snapshotFilterPath(category, key, value, packPage = 1, clean = false) {
  const prefix = clean ? 'filter-packs/clean/' : 'filter-packs/';
  return prefix + 't' + category.id + '/' + key + '-' + snapshotFilterToken(value) + '-p' + packPage + '-limit' + SNAPSHOT_PACK_LIMIT + '.json';
}
function snapshotCleanFilterIndexPath(category, key, value) {
  return 'filter-index/clean/t' + category.id + '/' + key + '-' + snapshotFilterToken(value) + '-limit' + SNAPSHOT_PACK_LIMIT + '.json';
}
function snapshotFilterEntries(filters) {
  const keys = ['year', 'area', 'class', 'form', 'quality', 'state', 'episodes', 'duration', 'topic'];
  const out = [];
  for (const key of keys) {
    const value = filterValue(filters && filters[key]);
    if (value) out.push([key, value]);
  }
  return out;
}
function snapshotPackPagesForRequest(page, limit) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(LIMIT_MAX, Number(limit) || LIMIT_DEFAULT));
  const start = (safePage - 1) * safeLimit;
  const end = start + safeLimit - 1;
  const first = Math.floor(start / SNAPSHOT_PACK_LIMIT) + 1;
  const last = Math.floor(end / SNAPSHOT_PACK_LIMIT) + 1;
  const pages = [];
  for (let p = first; p <= last; p++) pages.push(p);
  return { pages, start, safePage, safeLimit, relativeStart: start - (first - 1) * SNAPSHOT_PACK_LIMIT };
}
function snapshotApplyPaging(firstPack, packs, page, limit, mode, extra = {}) {
  const meta = snapshotPackPagesForRequest(page, limit);
  const combined = dedupeSnapshotList(packs.flatMap((p) => Array.isArray(p?.list) ? p.list : []));
  const list = combined.slice(meta.relativeStart, meta.relativeStart + meta.safeLimit);
  const total = Number(firstPack?.total || combined.length || list.length || 0);
  return {
    ...firstPack,
    ...extra,
    page: meta.safePage,
    pagecount: Math.max(1, Math.ceil(total / meta.safeLimit)),
    limit: meta.safeLimit,
    total,
    list,
    snapshot_mode: mode,
  };
}
function snapshotApplyListPaging(firstPack, listAll, page, limit, mode, extra = {}) {
  const meta = snapshotPackPagesForRequest(page, limit);
  const all = Array.isArray(listAll) ? listAll : [];
  const baseTotal = Number(firstPack?.total);
  const total = Number.isFinite(baseTotal) ? Math.max(baseTotal, all.length) : all.length;
  return {
    ...firstPack,
    ...extra,
    page: meta.safePage,
    pagecount: Math.max(1, Math.ceil(total / meta.safeLimit)),
    limit: meta.safeLimit,
    total,
    list: all.slice(meta.start, meta.start + meta.safeLimit),
    snapshot_mode: mode,
  };
}
function snapshotListItemMatches(item, key, value) {
  if (!filterValue(value)) return true;
  if (key === 'year') return aggYearMatches(item, value);
  if (key === 'area') return areaMatches(item, value);
  if (key === 'class' || key === 'topic') return classGroupMatchesText(value, aggText(item, item?._className));
  if (key === 'form') return formMatches(item, value);
  if (key === 'state') return stateMatches(item, value);
  if (key === 'episodes') return episodeMatches(item, value);
  if (key === 'duration') return durationMatches(item, value);
  if (key === 'quality') return aggFilterOptionMatches(item, '', 'quality', value);
  return true;
}
function snapshotDedupKey(item) {
  if (String(item?.canonical_id || '').trim()) return String(item.canonical_id).trim();
  const title = normalizeVodTitle(item?.vod_name) || String(item?.vod_name || '').trim().toLowerCase() || String(item?.vod_id || '');
  const creator = normalizeVodTitle([item?.vod_actor, item?.vod_director].filter(Boolean).join('/'));
  return [title, dedupYearForVod(item), creator].join('|');
}
function betterSnapshotItem(a, b) {
  const qa = aggQualityRank(a), qb = aggQualityRank(b);
  if (qa !== qb) return qa > qb ? a : b;
  const al = Number(String(a?.vod_remarks || '').match(/(\d+)\s*\u7ebf/)?.[1] || 0);
  const bl = Number(String(b?.vod_remarks || '').match(/(\d+)\s*\u7ebf/)?.[1] || 0);
  if (al !== bl) return al > bl ? a : b;
  return String(a?.vod_name || '').length <= String(b?.vod_name || '').length ? a : b;
}
function dedupeSnapshotList(list) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const key = snapshotDedupKey(item);
    const old = map.get(key);
    map.set(key, old ? betterSnapshotItem(old, item) : item);
  }
  return [...map.values()];
}
function sortSnapshotList(list, filters) {
  const sort = filterValue(filters && filters.sort || 'latest');
  const out = dedupeSnapshotList(list);
  if (sort === 'quality') return out.sort((a, b) => aggQualityRank(b) - aggQualityRank(a));
  if (sort === 'name') return out.sort((a, b) => compareDisplayName(a.vod_name, b.vod_name));
  if (sort === 'lines') return out.sort((a, b) => {
    const al = Number(String(a.vod_remarks || '').match(/(\d+)\s*\u7ebf/)?.[1] || 0);
    const bl = Number(String(b.vod_remarks || '').match(/(\d+)\s*\u7ebf/)?.[1] || 0);
    return bl - al || aggQualityRank(b) - aggQualityRank(a) || compareDisplayName(a.vod_name, b.vod_name);
  });
  return out.sort((a, b) => Number(extractYearFromVod(b) || 0) - Number(extractYearFromVod(a) || 0) || aggQualityRank(b) - aggQualityRank(a) || compareDisplayName(a.vod_name, b.vod_name));
}
function hasExplicitSnapshotSort(filters) {
  const sort = filterValue(filters && filters.sort);
  return Boolean(sort && sort !== 'latest');
}
async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json,*/*' }, redirect: 'follow', signal: controller.signal });
    if (!res.ok) return null;
    const textBody = await res.text();
    if (!textBody || /^\s*</.test(textBody)) return null;
    return JSON.parse(textBody);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function snapshotUrl(base, relPath) {
  const urlPath = String(relPath || '').replace(/^\/+/, '').replace(/%/g, '%25');
  return String(base || '').replace(/\/+$/, '') + '/' + urlPath;
}
function snapshotGeneratedTime(manifest) {
  const candidates = [manifest?.snapshotGeneratedAt, manifest?.generatedAt, manifest?.coverageAuditAt, manifest?.sourceDiscoveryAt];
  for (const value of candidates) {
    const t = Date.parse(value || '');
    if (Number.isFinite(t)) return t;
  }
  return 0;
}
function isValidSnapshotPayload(value) {
  return Boolean(value && typeof value === 'object' && (
    value.code === 1
    || value.ok === true
    || String(value.version || '').trim()
    || String(value.generatedAt || '').trim()
  ));
}
export function isValidSnapshotManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.ok !== true) return false;
  const revision = String(manifest.content_revision || manifest.revision || '').trim();
  if (!revision || !snapshotGeneratedTime(manifest)) return false;
  const categories = Array.isArray(manifest.categories) ? manifest.categories : [];
  const expectedNames = new Set(AGG_CATEGORIES.map((category) => category.name));
  if (categories.length !== expectedNames.size) return false;
  const seenNames = new Set();
  for (const category of categories) {
    const name = String(category?.type_name || category?.name || '').trim();
    if (!expectedNames.has(name) || seenNames.has(name)) return false;
    seenNames.add(name);
    const total = Number(category?.total ?? category?.count ?? 0);
    if (category?.visible === false || total < 1) return false;
  }
  if (seenNames.size !== AGG_CATEGORIES.length) return false;
  const fullRevision = String(manifest.variants?.full?.revision || revision).trim();
  const cleanRevision = String(manifest.variants?.clean?.revision || revision).trim();
  return fullRevision === revision && cleanRevision === revision;
}
function isFreshSnapshotManifest(manifest, now = Date.now()) {
  const t = snapshotGeneratedTime(manifest);
  return Boolean(t && now - t <= SNAPSHOT_VISIBLE_FRESH_MS);
}
async function fetchSnapshotCandidate(base, relPath) {
  const url = snapshotUrl(base, relPath);
  const got = await fetchJsonWithTimeout(url, SNAPSHOT_FETCH_TIMEOUT_MS);
  return isValidSnapshotPayload(got) ? { data: got, base, url } : null;
}
function previousSnapshotBase(base) {
  const value = String(base || '').replace(/\/+$/, '');
  if (!value) return '';
  if (/\/snapshot\/latest$/i.test(value)) return value.replace(/\/snapshot\/latest$/i, '/snapshot/previous');
  return '';
}
function previousSnapshotBases(env) {
  return [...new Set(snapshotBases(env).map(previousSnapshotBase).filter(Boolean))];
}
function kvBinding(env) {
  return env?.TVBOX_KV || env?.KV || null;
}
async function readJsonKv(env, key) {
  const kv = kvBinding(env);
  if (!kv || typeof kv.get !== 'function') return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function writeJsonKv(env, key, value, ttlSeconds = 604800) {
  const kv = kvBinding(env);
  if (!kv || typeof kv.put !== 'function') return false;
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return false;
  }
}
async function readHotCatalogPackage(env) {
  const pointer = await readJsonKv(env, HOT_ACTIVE_KV_KEY);
  const packageKeys = [pointer?.package_key, ...(pointer?.previous_keys || [])].filter(Boolean);
  for (const key of packageKeys) {
    const packageData = await readJsonKv(env, key);
    if (packageData && Array.isArray(packageData.rows)) return { ...packageData, pointer };
  }
  return null;
}
function hotRowCategoryMatches(row, category) {
  if (!category) return true;
  if (category.key === 'recommend') return true;
  const wanted = category.canonicalKeys || [category.key];
  const actual = String(row?.primary_category || row?._macro || row?.type_name || '').trim();
  if (wanted.includes(actual)) return true;
  if (actual === 'theatrical_movie' || actual === 'web_movie' || actual === 'other_movie') return wanted.includes('movie');
  if (actual === 'tv_series' || actual === 'web_series') return wanted.includes('tv');
  if (actual === 'web_short') return wanted.includes('short');
  return false;
}
function hotRowsForRequest(packageData, category, wd, filters, policy = {}) {
  const rows = Array.isArray(packageData?.rows)
    ? packageData.rows.filter((row) => hotRowCategoryMatches(row, category) && (policy.includeAdult !== false || !isAdultAggRecord(row)))
    : [];
  const variants = wd ? searchVariantsFor(wd) : [];
  let filtered = variants.length ? variants.flatMap((query) => filterHotRows(rows, { query })) : rows;
  const seen = new Set();
  filtered = filtered.filter((row) => {
    const key = String(row?.canonical_id || row?.vod_id || row?.vod_name || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const [key, value] of snapshotFilterEntries(filters)) filtered = filtered.filter((row) => snapshotListItemMatches(row, key, value));
  return filtered;
}
async function hotKvOverlayForSnapshot(env, category, page, limit, wd, filters, snapshotPayload, policy = {}) {
  const packageData = await readHotCatalogPackage(env);
  if (!packageData?.rows?.length) return null;
  const rows = hotRowsForRequest(packageData, category, wd, filters, policy);
  if (!rows.length) return null;
  const base = snapshotPayload || { code: 1, msg: 'ok', page: 1, pagecount: 1, limit: SNAPSHOT_PACK_LIMIT, class: aggClasses(category.key, rows, {}) };
  const baseList = Array.isArray(base.list) ? base.list : [];
  const merged = mergeHotAndSnapshotLists(rows, baseList, filters, wd ? buildSearchContext(wd) : null);
  return snapshotApplyListPaging(base, merged.list, page, limit, 'kv-hot-overlay', {
    hot_kv_available: true,
    hot_kv_revision: packageData.revision || packageData.pointer?.revision || '',
    hot_kv_content_changed_at: packageData.content_changed_at || packageData.pointer?.content_changed_at || '',
    hot_rows_used: rows.length,
    hot_overlay_applied: true,
    hot_duplicate_removed: merged.duplicateRemoved,
  });
}
async function readLastGoodSnapshotManifest(env) {
  const saved = await readJsonKv(env, SNAPSHOT_LAST_GOOD_KV_KEY);
  if (!saved) return null;
  const manifest = saved.manifest || saved;
  return isValidSnapshotManifest(manifest) ? { data: manifest, base: saved.base || manifest.__snapshotBase || '', url: saved.url || '' } : null;
}
async function writeLastGoodSnapshotManifest(env, candidate) {
  if (!candidate?.data) return false;
  const stored = { manifest: candidate.data, base: candidate.base || candidate.data.__snapshotBase || '', url: candidate.url || '', storedAt: new Date().toISOString() };
  return writeJsonKv(env, SNAPSHOT_LAST_GOOD_KV_KEY, stored, 7 * 24 * 60 * 60);
}
async function fetchLatestSnapshotManifest(env) {
  const cacheKey = 'manifest.json';
  const cached = snapshotMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.t < SNAPSHOT_CACHE_TTL_MS) return cached.v;

  const now = Date.now();
  const candidates = [];
  for (const base of snapshotBases(env)) {
    const candidate = await fetchSnapshotCandidate(base, 'manifest.json');
    if (candidate?.data && isValidSnapshotManifest(candidate.data)) candidates.push(candidate);
  }
  candidates.sort((a, b) => snapshotGeneratedTime(b.data) - snapshotGeneratedTime(a.data));
  const fresh = candidates.find((c) => isFreshSnapshotManifest(c.data, now));
  if (fresh) {
    const value = { ...fresh.data, __snapshotBase: fresh.base, __snapshotUrl: fresh.url, __snapshotFresh: true };
    snapshotMemoryCache.set(cacheKey, { t: now, v: value, source: fresh.url });
    if (String(env?.WRITE_SNAPSHOT_LAST_GOOD || '') === '1') await writeLastGoodSnapshotManifest(env, { ...fresh, data: value });
    return value;
  }

  if (candidates[0]?.data) {
    const newest = candidates[0];
    const value = { ...newest.data, __snapshotBase: newest.base, __snapshotUrl: newest.url, __snapshotFresh: false, __snapshotStale: true };
    snapshotMemoryCache.set(cacheKey, { t: now, v: value, source: newest.url });
    return value;
  }

  const previousCandidates = [];
  for (const base of previousSnapshotBases(env)) {
    const candidate = await fetchSnapshotCandidate(base, 'manifest.json');
    if (candidate?.data && isValidSnapshotManifest(candidate.data)) previousCandidates.push(candidate);
  }
  previousCandidates.sort((a, b) => snapshotGeneratedTime(b.data) - snapshotGeneratedTime(a.data));
  if (previousCandidates[0]?.data) {
    const previous = previousCandidates[0];
    const value = { ...previous.data, __snapshotBase: previous.base, __snapshotUrl: previous.url, __snapshotFresh: false, __snapshotFromPrevious: true };
    snapshotMemoryCache.set(cacheKey, { t: now, v: value, source: previous.url });
    return value;
  }

  const lastGood = await readLastGoodSnapshotManifest(env);
  if (lastGood?.data) {
    const value = { ...lastGood.data, __snapshotBase: lastGood.base || lastGood.data.__snapshotBase || '', __snapshotUrl: lastGood.url || lastGood.data.__snapshotUrl || '', __snapshotFresh: isFreshSnapshotManifest(lastGood.data, now), __snapshotFromLastGood: true };
    snapshotMemoryCache.set(cacheKey, { t: now, v: value, source: value.__snapshotUrl || 'kv:last-good' });
    return value;
  }

  snapshotMemoryCache.set(cacheKey, { t: now, v: null, source: '' });
  return null;
}

function hotBaseFromSnapshotBase(base) {
  const value = String(base || '').replace(/\/+$/, '');
  if (!value) return '';
  return value
    .replace(/\/static\/snapshot\/latest$/i, '/static/hot/latest')
    .replace(/\/dist\/snapshot\/latest$/i, '/dist/hot/latest')
    .replace(/\/snapshot\/latest$/i, '/hot/latest');
}
function hotBases(env) {
  const explicit = splitEnvList(env && env.HOT_BASES, []);
  const derived = snapshotBases(env).map(hotBaseFromSnapshotBase).filter(Boolean);
  return [...new Set([...explicit, ...derived])];
}
function isFreshHotManifest(manifest, now = Date.now()) {
  if (!manifest || manifest.ok === false) return false;
  if (Array.isArray(manifest.errors) && manifest.errors.length) return false;
  const t = Date.parse(manifest.finishedAt || manifest.generatedAt || '');
  return Number.isFinite(t) && now - t <= HOT_SNAPSHOT_FRESH_MS;
}
async function fetchHotJson(env, relPath) {
  if (!relPath) return null;
  const cacheKey = 'hot/' + relPath;
  const cached = snapshotMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.t < SNAPSHOT_CACHE_TTL_MS) return cached.v;
  if (relPath !== 'manifest.json') {
    const manifest = await fetchHotJson(env, 'manifest.json');
    if (!manifest?.__hotBase) return null;
    const got = await fetchJsonWithTimeout(snapshotUrl(manifest.__hotBase, relPath), SNAPSHOT_FETCH_TIMEOUT_MS);
    const value = isValidSnapshotPayload(got) ? got : null;
    snapshotMemoryCache.set(cacheKey, { t: Date.now(), v: value, source: manifest.__hotBase });
    return value;
  }
  for (const base of hotBases(env)) {
    const got = await fetchJsonWithTimeout(snapshotUrl(base, 'manifest.json'), SNAPSHOT_FETCH_TIMEOUT_MS);
    if (isFreshHotManifest(got)) {
      const value = { ...got, __hotBase: base, __hotFresh: true };
      snapshotMemoryCache.set(cacheKey, { t: Date.now(), v: value, source: base });
      return value;
    }
  }
  snapshotMemoryCache.set(cacheKey, { t: Date.now(), v: null, source: '' });
  return null;
}
function hotCatalogPath(category) {
  return 'catalog/' + category.id + '.json';
}
function hotSearchPath(term) {
  return 'search/' + encodeURIComponent(String(term || '')) + '.json';
}
function mergeHotAndSnapshotLists(hotList, snapshotList, filters, searchContext = null) {
  const hot = Array.isArray(hotList) ? hotList : [];
  const snapshot = Array.isArray(snapshotList) ? snapshotList : [];
  const combined = [...hot, ...snapshot];
  const list = mergeHotRows(combined).rows;
  const hotKeys = new Set(hot.map((item) => hotCanonicalKey(item)).filter(Boolean));
  const isHot = (item) => hotKeys.has(hotCanonicalKey(item));
  if (searchContext) list.sort((a, b) => searchScoreItem(b, searchContext) - searchScoreItem(a, searchContext) || Number(isHot(b)) - Number(isHot(a)) || compareDisplayName(a.vod_name, b.vod_name));
  else list.sort((a, b) => Number(isHot(b)) - Number(isHot(a)) || compareDisplayName(a.vod_name, b.vod_name));
  return { list, duplicateRemoved: combined.length - list.length, hotRowsUsed: hot.length };
}
async function hotOverlayForSnapshot(env, category, page, limit, wd, filters, snapshotPayload, policy = {}) {
  const kvOverlay = await hotKvOverlayForSnapshot(env, category, page, limit, wd, filters, snapshotPayload, policy);
  if (kvOverlay) return kvOverlay;
  const manifest = await fetchHotJson(env, 'manifest.json');
  if (!manifest?.__hotFresh) return snapshotPayload;
  let hotPayload = null;
  let termsHit = [];
  if (wd) {
    const rows = [];
    const seen = new Set();
    for (const term of searchVariantsFor(wd)) {
      const pack = await fetchHotJson(env, hotSearchPath(term));
      if (!pack || !Array.isArray(pack.list) || !pack.list.length) continue;
      termsHit.push(term);
      for (const item of pack.list) {
        if (policy.includeAdult === false && isAdultAggRecord(item)) continue;
        const key = String(item.vod_id || item.vod_name || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(item);
      }
      if (rows.length >= SNAPSHOT_PACK_LIMIT) break;
    }
    if (rows.length) hotPayload = { ...(snapshotPayload || {}), list: rows, total: rows.length };
  } else if (HOT_OVERLAY_CATEGORY_KEYS.has(category.key) && !snapshotFilterEntries(filters).length && !hasExplicitSnapshotSort(filters)) {
    const pack = await fetchHotJson(env, hotCatalogPath(category));
    if (pack && Array.isArray(pack.list) && pack.list.length) {
      const list = policy.includeAdult === false ? pack.list.filter((item) => !isAdultAggRecord(item)) : pack.list;
      if (list.length) hotPayload = { ...pack, list };
    }
  }
  if (!hotPayload?.list?.length) return snapshotPayload;
  const baseList = Array.isArray(snapshotPayload?.list) ? snapshotPayload.list : [];
  const context = wd ? buildSearchContext(wd) : null;
  const merged = mergeHotAndSnapshotLists(hotPayload.list, baseList, filters, context);
  const extra = {
    hot_manifest_available: true,
    hot_manifest_fresh: true,
    hot_overlay_applied: merged.hotRowsUsed > 0,
    hot_rows_used: merged.hotRowsUsed,
    hot_duplicate_removed: merged.duplicateRemoved,
    hot_search_terms_hit: termsHit,
    hot_overlay_generated_at: manifest.generatedAt || manifest.finishedAt || '',
  };
  const first = snapshotPayload || hotPayload || { code: 1, msg: 'ok', page: 1, limit: SNAPSHOT_PACK_LIMIT, class: aggClasses(category.key, [], {}) };
  return snapshotApplyListPaging(first, merged.list, page, limit, wd ? 'hot-search-overlay' : 'hot-catalog-overlay', extra);
}
async function selectedSnapshotBase(env) {
  const manifest = await fetchLatestSnapshotManifest(env);
  return manifest?.__snapshotBase || '';
}
async function fetchSnapshotJson(env, relPath) {
  if (!relPath) return null;
  const cacheKey = relPath;
  const cached = snapshotMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.t < SNAPSHOT_CACHE_TTL_MS) return cached.v;
  if (relPath === 'manifest.json') return fetchLatestSnapshotManifest(env);
  const preferred = await selectedSnapshotBase(env);
  const bases = preferred ? [preferred, ...snapshotBases(env).filter((b) => b !== preferred)] : snapshotBases(env);
  for (const base of bases) {
    const url = snapshotUrl(base, relPath);
    const got = await fetchJsonWithTimeout(url, SNAPSHOT_FETCH_TIMEOUT_MS);
    if (isValidSnapshotPayload(got)) {
      snapshotMemoryCache.set(cacheKey, { t: Date.now(), v: got, source: url });
      return got;
    }
  }
  return null;
}
function normalizeRuntimeSources(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const allowedByPhysicalKey = new Map(HOT_REFRESH_SOURCES.map((source) => [source.physicalSourceKey, source]));
  const selected = new Map();
  for (const row of rows) {
    if (String(row?.status || '').toUpperCase() !== 'ACTIVE') continue;
    const slug = String(row?.slug || '').trim().toLowerCase();
    const api = String(row?.api || '').trim();
    if (!slug || !/^https?:\/\//i.test(api)) continue;
    let physicalKey = '';
    try { physicalKey = new URL(api).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    const allowed = allowedByPhysicalKey.get(physicalKey);
    if (!allowed || allowed.slug !== slug || selected.has(physicalKey)) continue;
    selected.set(physicalKey, allowed);
  }
  return [...selected.values()];
}
async function runtimeCmsSources(env) {
  const payload = await fetchSnapshotJson(env, 'sources.json');
  const sources = normalizeRuntimeSources(payload);
  return sources.length === HOT_REFRESH_SOURCES.length ? sources : HOT_REFRESH_SOURCES;
}
async function fetchSnapshotPacks(env, pathForPage, page, limit) {
  const meta = snapshotPackPagesForRequest(page, limit);
  const packs = [];
  for (const packPage of meta.pages) {
    const got = await fetchSnapshotJson(env, pathForPage(packPage));
    if (!got || !Array.isArray(got.list)) return null;
    packs.push(got);
  }
  return packs;
}
function cleanFilterWindowFromIndex(index, page, limit) {
  const sourcePackLimit = Number(index?.source_pack_limit);
  const counts = Array.isArray(index?.clean_counts)
    ? index.clean_counts.map((value) => Math.max(0, Number(value) || 0))
    : [];
  if (sourcePackLimit !== SNAPSHOT_PACK_LIMIT || !counts.length) return null;
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(LIMIT_MAX, Number(limit) || LIMIT_DEFAULT));
  const total = Math.max(0, Number(index?.total) || 0);
  const start = (safePage - 1) * safeLimit;
  const end = Math.min(total, start + safeLimit);
  if (start >= total) return { pages: [], safePage, safeLimit, total, relativeStart: 0, expectedCleanCount: 0 };

  let prefix = 0;
  let first = -1;
  let last = -1;
  let prefixBeforeFirst = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const next = prefix + counts[i];
    if (first < 0 && next > start) {
      first = i;
      prefixBeforeFirst = prefix;
    }
    if (first >= 0 && next >= end) {
      last = i;
      break;
    }
    prefix = next;
  }
  if (first < 0 || last < first) return null;
  const pages = [];
  let expectedCleanCount = 0;
  for (let i = first; i <= last; i += 1) {
    pages.push(i + 1);
    expectedCleanCount += counts[i];
  }
  return {
    pages,
    safePage,
    safeLimit,
    total,
    relativeStart: start - prefixBeforeFirst,
    expectedCleanCount,
  };
}
async function cleanFilterPayloadFromIndex(env, category, key, value, page, limit, index) {
  const window = cleanFilterWindowFromIndex(index, page, limit);
  if (!window) return null;
  const sourcePages = window.pages.length ? window.pages : [1];
  const packs = [];
  for (const packPage of sourcePages) {
    const pack = await fetchSnapshotJson(env, snapshotFilterPath(category, key, value, packPage, false));
    if (!pack || !Array.isArray(pack.list)) return null;
    const indexRevision = String(index?.content_revision || '').trim();
    const packRevision = String(pack?.content_revision || '').trim();
    if (indexRevision && packRevision && indexRevision !== packRevision) return null;
    packs.push(pack);
  }
  const cleanRows = packs.flatMap((pack) => pack.list.filter((item) => !isAdultAggRecord(item)));
  if (window.pages.length && cleanRows.length !== window.expectedCleanCount) return null;
  const list = window.pages.length
    ? cleanRows.slice(window.relativeStart, window.relativeStart + window.safeLimit)
    : [];
  return {
    ...packs[0],
    page: window.safePage,
    pagecount: Math.max(1, Math.ceil(window.total / window.safeLimit)),
    limit: window.safeLimit,
    total: window.total,
    list,
    policy: 'clean-no-adult',
    snapshot_mode: 'clean-filter-index',
    snapshot_filter: { key, value },
    snapshot_clean_index: { source_pages: sourcePages, source_pack_limit: SNAPSHOT_PACK_LIMIT },
  };
}
async function snapshotAggResponse(request, env, category, page, limit, wd, params, filters, policy = {}) {
  if (isSnapshotBypass(params)) return null;
  const clean = policy.includeAdult === false;
  if (wd) {
    const variants = searchVariantsFor(wd);
    const rows = [];
    const seen = new Set();
    let firstPack = null;
    for (const term of variants) {
      const pack = await fetchSnapshotJson(env, snapshotSearchPath(term, 1, clean));
      if (!pack || !Array.isArray(pack.list) || !pack.list.length) continue;
      if (!firstPack) firstPack = pack;
      for (const item of pack.list) {
        const key = String(item.vod_id || item.vod_name || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(item);
      }
    }
    if (rows.length) {
      const context = buildSearchContext(wd);
      const sorted = dedupeSnapshotList(rows).sort((a, b) => searchScoreItem(b, context) - searchScoreItem(a, context) || compareDisplayName(a.vod_name, b.vod_name));
      const snapshotPayload = snapshotApplyListPaging(firstPack || { code: 1, msg: 'ok', page: 1, limit: SNAPSHOT_PACK_LIMIT }, sorted, page, limit, 'search-pack', { snapshot_search: { terms: variants } });
      return hotOverlayForSnapshot(env, category, page, limit, wd, filters, snapshotPayload, policy);
    }
    return null;
  }

  const entries = snapshotFilterEntries(filters);
  if (entries.length === 1) {
    const [key, value] = entries[0];
    if (clean) {
      const index = await fetchSnapshotJson(env, snapshotCleanFilterIndexPath(category, key, value));
      const indexedPayload = index
        ? await cleanFilterPayloadFromIndex(env, category, key, value, page, limit, index)
        : null;
      if (indexedPayload) return hotOverlayForSnapshot(env, category, page, limit, wd, filters, indexedPayload, policy);
    }
    const packs = await fetchSnapshotPacks(env, (packPage) => snapshotFilterPath(category, key, value, packPage, clean), page, limit);
    if (packs && packs[0]?.list?.length) {
      if (hasExplicitSnapshotSort(filters)) {
        const sorted = sortSnapshotList(packs.flatMap((p) => Array.isArray(p.list) ? p.list : []), filters);
        const filteredPayload = snapshotApplyListPaging(packs[0], sorted, page, limit, 'filter-pack-sort', { snapshot_filter: { key, value } });
        return hotOverlayForSnapshot(env, category, page, limit, wd, filters, filteredPayload, policy);
      }
      const filteredPayload = snapshotApplyPaging(packs[0], packs, page, limit, 'filter-pack', { snapshot_filter: { key, value } });
      return hotOverlayForSnapshot(env, category, page, limit, wd, filters, filteredPayload, policy);
    }
  }

  const basePacks = await fetchSnapshotPacks(env, (packPage) => snapshotBasePath(category, packPage, clean), page, limit);
  if (!basePacks || !basePacks[0]?.list?.length) return null;

  if (!entries.length) {
    if (hasExplicitSnapshotSort(filters)) {
      const sortPacks = [];
      for (const packPage of [1, 2]) {
        const got = await fetchSnapshotJson(env, snapshotBasePath(category, packPage, clean));
        if (got && Array.isArray(got.list)) sortPacks.push(got);
      }
      if (sortPacks.length) {
        const sorted = sortSnapshotList(sortPacks.flatMap((p) => p.list), filters);
        return snapshotApplyListPaging(sortPacks[0], sorted, page, limit, 'catalog-local-sort');
      }
    }
    const snapshotPayload = snapshotApplyPaging(basePacks[0], basePacks, page, limit, 'catalog-pack');
    return hotOverlayForSnapshot(env, category, page, limit, wd, filters, snapshotPayload, policy);
  }

  const localFilterPacks = [];
  for (const packPage of [1, 2]) {
    const got = await fetchSnapshotJson(env, snapshotBasePath(category, packPage, clean));
    if (got && Array.isArray(got.list)) localFilterPacks.push(got);
  }
  if (!localFilterPacks.length) return null;
  let filtered = localFilterPacks.flatMap((p) => Array.isArray(p.list) ? p.list : []);
  for (const [key, value] of entries) filtered = filtered.filter((item) => snapshotListItemMatches(item, key, value));
  filtered = sortSnapshotList(filtered, filters);
  if (!filtered.length) return null;
  const first = { ...basePacks[0], total: filtered.length, list: filtered };
  const filteredPayload = snapshotApplyListPaging(first, filtered, page, limit, 'catalog-local-filter', { snapshot_filter: Object.fromEntries(entries), root_cause: 'SNAPSHOT_MISS' });
  return hotOverlayForSnapshot(env, category, page, limit, wd, filters, filteredPayload, policy);
}
function v73Mirrors(origin) {
  return [
    { name: '全量主入口', url: V73_PRIMARY_ORIGIN + '/config.json', host: V73_PRIMARY_HOST, role: 'primary', contentPolicy: 'full' },
    { name: '全量同构入口', url: V73_SECONDARY_ORIGIN + '/config.json', host: V73_SECONDARY_HOST, role: 'secondary', contentPolicy: 'full' },
    { name: '洁净主入口', url: V73_PRIMARY_ORIGIN + '/config-clean.json', host: V73_PRIMARY_HOST, role: 'primary-clean', contentPolicy: 'clean-no-adult' },
    { name: '洁净同构入口', url: V73_SECONDARY_ORIGIN + '/config-clean.json', host: V73_SECONDARY_HOST, role: 'secondary-clean', contentPolicy: 'clean-no-adult' },
    { name: '当前全量入口', url: origin + '/config.json', host: new URL(origin).host, role: 'current', contentPolicy: 'full' },
    { name: '当前洁净入口', url: origin + '/config-clean.json', host: new URL(origin).host, role: 'current-clean', contentPolicy: 'clean-no-adult' },
    { name: '回滚入口', url: 'https://tvbox-source-hub.feng-yang.workers.dev/config.json', host: 'tvbox-source-hub.feng-yang.workers.dev', role: 'rollback' },
  ];
}
async function statusV73(request, env, ctx) {
  const origin = new URL(request.url).origin;
  const forceFresh = forceFreshFromRequest(request);
  const manifest = await fetchSnapshotJson(env, 'manifest.json');
  const updateInfo = await visibleUpdateInfo(env, manifest, { forceFresh });
  const hotUpdate = await readHotUpdateInfo(env, { forceFresh });
  const interactionHotProbeScheduled = scheduleInteractionHotProbe(request, env, ctx, updateInfo, 'status');
  return json({
    ok: true,
    version: VERSION,
    project: V73_PROJECT,
    mode: 'domestic-free-snapshot-first',
    generatedAt: new Date().toISOString(),
    entry: origin + '/config.json',
    cleanEntry: origin + '/config-clean.json',
    primary: V73_PRIMARY_ORIGIN + '/config.json',
    secondary: V73_SECONDARY_ORIGIN + '/config.json',
    primaryClean: V73_PRIMARY_ORIGIN + '/config-clean.json',
    secondaryClean: V73_SECONDARY_ORIGIN + '/config-clean.json',
    sourceDiscoveryAt: manifest?.sourceDiscoveryAt || '',
    coverageAuditAt: manifest?.coverageAuditAt || '',
    snapshotGeneratedAt: manifest?.generatedAt || '',
    visibleUpdateText: updateInfo.visibleUpdateText,
    visibleUpdateSource: updateInfo.source,
    visibleUpdateAt: updateInfo.at,
    hotUpdate: hotUpdate ? { ok: true, generatedAt: hotUpdate.at, visibleUpdateText: hotUpdate.visibleUpdateText, source: hotUpdate.source, probe: hotUpdate.probe } : { ok: false },
    interactionRefresh: { enabled: true, trigger: 'config/list/search/detail/status when hot probe is stale or missing', minIntervalMinutes: Math.round(HOT_INTERACTION_PROBE_MIN_INTERVAL_MS / 60000), maxFallbackWritesPerDay: HOT_INTERACTION_PROBE_MAX_DAILY_WRITES, scheduled: interactionHotProbeScheduled, persistenceSlotMinutes: HOT_UPDATE_TARGET_MINUTES },
    coverageSummary: manifest?.coverageSummary || null,
    sourceSummary: manifest?.sourceSummary || null,
    snapshot: { available: Boolean(manifest), manifest: manifest || null, bases: snapshotBases(env) },
    hotOverlay: { available: Boolean(await fetchHotJson(env, 'manifest.json')), bases: hotBases(env), freshnessMs: HOT_SNAPSHOT_FRESH_MS },
    liveDelivery: liveDeliveryPolicy(origin),
    fallbackOrder: ['worker-memory-cache', 'kv-hot-package', 'cloudflare-pages-snapshot', 'github-snapshot-branch', 'last-known-good-snapshot', 'bounded-dynamic-cms-aggregate', 'maintenance-status'],
    updateCadence: {
      target: 'content refresh target <= 5 minutes by Cloudflare Cron, interaction fallback when hot state is stale, P95 visible guard <= 10 minutes, visible label memory <= 15 seconds, static snapshots <= 6 hours by GitHub Actions, config no-cache with ETag, aggregate edge cache 60 seconds, worker snapshot memory cache <= 5 minutes',
      hotProbeTargetMinutes: HOT_UPDATE_TARGET_MINUTES,
      hotProbeFreshGuardMinutes: HOT_UPDATE_FRESH_GUARD_MINUTES,
      hotHealthHeartbeatMinutes: HOT_HEALTH_HEARTBEAT_MINUTES,
      currentVisibleText: updateInfo.visibleUpdateText,
      freshDiagnostic: origin + '/status.json?fresh=1',
    },
    compatibility: ['TVBox', 'FongMi', '影视仓'],
  }, forceFresh ? 0 : 30);
}
async function mirrorsV73(request, env) {
  const origin = new URL(request.url).origin;
  return json({ ok: true, version: VERSION, mirrors: v73Mirrors(origin), snapshotBases: snapshotBases(env) }, 300);
}
async function snapshotV73(request, env) {
  const manifest = await fetchSnapshotJson(env, 'manifest.json');
  const categories = await fetchSnapshotJson(env, 'categories.json');
  return json({ ok: Boolean(manifest), version: VERSION, manifest: manifest || null, categories: categories || null, bases: snapshotBases(env) }, manifest ? 120 : 30, 200);
}

async function resolveAggDetailCandidates(candidates, sources = CMS_SOURCES) {
  const sourceMap = new Map([...CMS_SOURCES, ...(sources || [])].map((source) => [source.slug, source]));
  const tasks = candidates.slice(0, AGG_DETAIL_LIMIT).map(async (c) => {
    const source = sourceMap.get(c.s) || cmsSourceBySlug(c.s);
    if (!source) return null;
    try {
      const attempts = [
        { ac: 'videolist', ids: c.id },
        { ac: 'detail', ids: c.id },
      ];
      for (const params of attempts) {
        const got = await fetchCmsJsonByParams(source, params, 8500);
        if (!got.ok) continue;
        const cleaned = cleanCmsResult(got.data, true);
        const vod = (cleaned.list || [])[0];
        if (vod) return { source, vod };
      }
      return null;
    } catch { return null; }
  });
  return (await Promise.allSettled(tasks))
    .map((r) => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean)
    .sort((a, b) => detailSourceScore(b) - detailSourceScore(a) || (SOURCE_RANK[b.source.slug] || 0) - (SOURCE_RANK[a.source.slug] || 0));
}
async function expandAggDetailCandidatesByTitle(resolved, candidates, sources = CMS_SOURCES) {
  if (!resolved.length || candidates.length >= 3) return candidates;
  const bestScore = Math.max(...resolved.map((row) => detailSourceScore(row)));
  const firstPlayable = firstPlayableUrlFromVod(resolved[0]?.vod);
  const shouldExpand = candidates.length < 2 && (bestScore < 50 || playUrlReliabilityScore(firstPlayable) < 0);
  if (!shouldExpand) return candidates;
  const firstTitle = cleanAggName(resolved[0].vod?.vod_name || '', 120);
  const normalized = normalizeVodTitle(firstTitle);
  if (!normalized) return candidates;
  const cached = detailExpansionCache.get(normalized);
  if (cached) return cached;
  const seen = new Set(candidates.map((c) => c.s + ':' + c.id));
  const rows = [];
  const tasks = sources.map((source) => collectAggListFromSource(source, 'recommend', {}, 1, firstTitle).catch(() => []));
  for (const r of await Promise.allSettled(tasks)) if (r.status === 'fulfilled') rows.push(...r.value);
  const extra = [];
  for (const row of rows) {
    if (normalizeVodTitle(row.vod_name) !== normalized) continue;
    const key = row._sourceSlug + ':' + row.vod_id;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ s: row._sourceSlug, id: row.vod_id });
    if (candidates.length + extra.length >= AGG_DETAIL_LIMIT) break;
  }
  const expanded = extra.length ? candidates.concat(extra).slice(0, AGG_DETAIL_LIMIT) : candidates;
  if (detailExpansionCache.size > 200) detailExpansionCache.clear();
  detailExpansionCache.set(normalized, expanded);
  return expanded;
}
async function aggDetail(request, env, ids, policy = {}, diagnostics = {}) {
  const idList = String(ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  const candidates = [];
  for (const id of idList) candidates.push(...decodeAggCandidates(id));
  const unique = [];
  const seen = new Set();
  for (const c of candidates) { const key = c.s + ':' + c.id; if (!seen.has(key)) { seen.add(key); unique.push(c); } }
  const detailSources = await runtimeCmsSources(env);
  let resolved = await resolveAggDetailCandidates(unique, detailSources);
  const expandedUnique = await expandAggDetailCandidatesByTitle(resolved, unique, detailSources);
  if (expandedUnique.length > unique.length) resolved = await resolveAggDetailCandidates(expandedUnique, detailSources);
  if (policy.includeAdult === false) resolved = resolved.filter(({ vod }) => !isAdultAggRecord({ ...vod, _macro: macroForTypeName(vod?.type_name || '') }));
  if (!resolved.length) {
    const empty = stampAggDiagnostics({ code: 1, msg: 'no valid direct play url', list: [] }, {
      ...diagnostics,
      sourceQuorum: { required: Math.ceil(Math.max(1, candidates.length) * 0.6), succeeded: 0, total: candidates.length, ratio: 0, basis: 'detail-candidates' },
      degraded: true,
      fallbackLevel: 'bounded-dynamic-detail',
    });
    return json(sanitizeAggResponseForPolicy(empty, policy), 0, 200, revalidatedEdgeHeaders(300));
  }
  const first = resolved[0].vod;
  const playFrom = [], playUrl = [], urlSeen = new Set();
  for (const { source, vod } of resolved) {
    const fromGroups = String(vod.vod_play_from || '').split('$$$');
    const urlGroups = String(vod.vod_play_url || '').split('$$$');
    for (let i = 0; i < urlGroups.length; i++) {
      const eps = splitCmsEpisodes(urlGroups[i]).filter((ep) => isPlayableCmsUrl(ep.url));
      const cleanedEps = [];
      for (const ep of eps) { if (urlSeen.has(ep.url)) continue; urlSeen.add(ep.url); cleanedEps.push((cleanCmsText(ep.name || '\u64ad\u653e', 40) || '\u64ad\u653e') + '$' + ep.url); }
      if (cleanedEps.length) { playFrom.push(cleanPlayFlag(fromGroups[i] || '\u9ad8\u6e05', source)); playUrl.push(cleanedEps.join('#')); }
    }
  }
  const typeName = cleanCmsText(first.type_name || '', 30);
  const modeled = normalizeAggContentItem(first, typeName, {});
  const cat = AGG_CATEGORIES.find((c) => c.key === modeled.primary_category) || AGG_CATEGORIES[0];
  const payload = stampAggDiagnostics({ code: 1, msg: 'ok', list: [{ ...first, canonical_id: modeled.canonical_id, primary_category: modeled.primary_category, classification_confidence: modeled.classification_confidence, classification_evidence: modeled.classification_evidence, type_id: cat.id, type_name: cat.name, vod_name: cleanAggName(first.vod_name, 120), vod_year: first.vod_year || extractYearFromVod(first), vod_remarks: cleanAggName(first.vod_remarks || `${playFrom.length}\u7ebf`, 80), vod_content: cleanCmsText(first.vod_content || '\u5df2\u805a\u5408\u591a\u8def\u53ef\u64ad\u653e\u76f4\u8fde\uff0c\u81ea\u52a8\u8fc7\u6ee4\u5e7f\u544a\u3001\u89e3\u6790\u9875\u548c\u65e0\u6548\u64ad\u653e\u5730\u5740\u3002', 800), vod_play_from: playFrom.join('$$$'), vod_play_url: playUrl.join('$$$') }] }, {
    ...diagnostics,
    category: cat,
    sourceQuorum: { required: Math.ceil(Math.max(1, candidates.length) * 0.6), succeeded: resolved.length, total: candidates.length, ratio: candidates.length ? Number((resolved.length / candidates.length).toFixed(4)) : 1, basis: 'detail-candidates' },
    degraded: resolved.length < candidates.length,
    fallbackLevel: 'bounded-dynamic-detail',
  });
  return json(sanitizeAggResponseForPolicy(payload, policy), 0, 200, revalidatedEdgeHeaders(300));
}
async function agg(request, env, policy = {}, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const forceFresh = forceFreshFromRequest(request);
  const manifest = await fetchSnapshotJson(env, 'manifest.json');
  const updateInfo = await visibleUpdateInfo(env, manifest, { forceFresh });
  const ac = (params.get('ac') || '').toLowerCase();
  const ids = (params.get('ids') || params.get('id') || '').trim();
  if (ids) {
    scheduleInteractionHotProbe(request, env, ctx, updateInfo, 'agg-detail');
    return aggDetail(request, env, ids, policy, { manifest, updateInfo });
  }
  const filters = parseAggFilters(params);
  let category = getAggCategoryParam(params);
  if (!hasAggCategoryParam(params) && category.key === 'recommend') category = inferAggCategoryFromFilters(filters) || category;
  const page = parseInt(params.get('pg') || params.get('page') || '1', 10) || 1;
  const limit = Math.min(LIMIT_MAX, parseInt(params.get('limit') || String(LIMIT_DEFAULT), 10) || LIMIT_DEFAULT);
  const wd = (params.get('wd') || params.get('search') || params.get('q') || '').trim();
  scheduleInteractionHotProbe(request, env, ctx, updateInfo, wd ? 'agg-search' : 'agg-list');
  const snapshotHit = await snapshotAggResponse(request, env, category, page, limit, wd, params, filters, policy);
  if (snapshotHit) {
    const cleanCategoryTotal = Number(manifest?.variants?.clean?.categories?.[String(category.id)]?.total);
    const cleanTotal = policy.includeAdult === false
      ? Number.isFinite(cleanCategoryTotal)
        ? cleanCategoryTotal
        : category.key === 'recommend' && !wd && snapshotFilterEntries(filters).length === 0
          ? Number(manifest?.variants?.clean?.total)
          : category.key === ADULT_CATEGORY_KEY ? 0 : undefined
      : undefined;
    const responsePolicy = Number.isFinite(cleanTotal) ? { ...policy, cleanTotal } : policy;
    const payload = stampAggDiagnostics(stampAggResponseWithUpdate(sanitizeAggResponseForPolicy(snapshotHit, responsePolicy), updateInfo), {
      manifest,
      category,
      updateInfo,
      fallbackLevel: snapshotFallbackLevel(manifest, snapshotHit),
    });
    return json(payload, 0, 200, forceFresh ? {} : revalidatedEdgeHeaders(60));
  }
  const sources = selectedSources(filters);
  const pagesToPull = [Math.max(1, page)];
  if (page === 1 && !wd) pagesToPull.push(2);
  const searchTerms = wd ? searchVariantsFor(wd) : [''];
  const tasks = [];
  for (const source of sources) for (const pg of pagesToPull) for (const term of searchTerms) tasks.push(collectAggListFromSource(source, category, filters, pg, term, { withStatus: true }));
  const settled = await Promise.allSettled(tasks);
  const rawItems = [];
  const successfulSources = new Set();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.sourceOk) successfulSources.add(r.value.source.slug);
    rawItems.push(...r.value.rows);
  }
  const merged = sortAggMerged(mergeAggItems(rawItems), filters, wd ? buildSearchContext(wd) : null);
  const p = pageList(merged.map(aggListItemFromMerged), page, limit);
  const responseFilters = aggFiltersForResponse(category.key, merged);
  const sourceQuorum = {
    required: Math.ceil(sources.length * 0.6),
    succeeded: successfulSources.size,
    total: sources.length,
    ratio: sources.length ? Number((successfulSources.size / sources.length).toFixed(4)) : 0,
    basis: 'bounded-dynamic-aggregate',
  };
  const rootCause = merged.length ? 'OK' : (successfulSources.size < sourceQuorum.required ? 'API_ERROR' : 'SOURCE_COVERAGE_GAP');
  const payload = stampAggDiagnostics(stampAggResponseWithUpdate(sanitizeAggResponseForPolicy({ code: 1, msg: merged.length ? 'ok' : 'maintenance fallback has no matching content', class: aggClasses(category.key, merged, policy), filters: responseFilters, page, pagecount: Math.max(page + (p.list.length >= limit ? 1 : 0), 1), limit, total: merged.length, list: p.list, root_cause: rootCause }, policy), updateInfo), {
    manifest,
    category,
    updateInfo,
    sourceQuorum,
    degraded: successfulSources.size < sourceQuorum.required,
    fallbackLevel: 'bounded-dynamic-aggregate',
  });
  return json(payload, 0, 200, forceFresh ? {} : revalidatedEdgeHeaders(60));
}

function formatChinaReverseUpdateCode(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}`.split('').reverse().join('');
}
function updateInfoFromIso(iso, source = 'snapshot') {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return { at: new Date(t).toISOString(), time: t, visibleUpdateText: formatChinaReverseUpdateCode(new Date(t).toISOString()), source };
}
function visibleUpdateTextFromManifest(manifest) {
  const existing = String(manifest?.visibleUpdateText || '').trim();
  if (/^\d{12}$/.test(existing)) return existing;
  return formatChinaReverseUpdateCode(manifest?.snapshotGeneratedAt || manifest?.generatedAt || manifest?.coverageAuditAt || manifest?.sourceDiscoveryAt);
}
function manifestUpdateInfo(manifest) {
  const t = snapshotGeneratedTime(manifest);
  if (!t) return null;
  const info = updateInfoFromIso(new Date(t).toISOString(), 'snapshot');
  if (info && /^\d{12}$/.test(String(manifest?.visibleUpdateText || ''))) info.visibleUpdateText = String(manifest.visibleUpdateText).trim();
  return info;
}
function forceFreshFromRequest(request) {
  try {
    const v = new URL(request.url).searchParams.get('fresh');
    return ['1', 'true', 'yes', 'force'].includes(String(v || '').toLowerCase());
  } catch {
    return false;
  }
}
function clockNowMs(env) {
  const injected = typeof env?.__clock === 'function' ? Number(env.__clock()) : NaN;
  return Number.isFinite(injected) ? injected : Date.now();
}
async function readHotUpdateInfo(env, options = {}) {
  const now = clockNowMs(env);
  const owner = kvBinding(env);
  if (!options.forceFresh && hotUpdateMemoryCache.owner === owner && hotUpdateMemoryCache.v && now - hotUpdateMemoryCache.t < HOT_UPDATE_MEMORY_TTL_MS) return hotUpdateMemoryCache.v;
  const [raw, pointer] = await Promise.all([
    readJsonKv(env, HOT_UPDATE_KV_KEY),
    readJsonKv(env, HOT_ACTIVE_KV_KEY),
  ]);
  let value = null;
  const candidates = [
    raw?.ok ? { checkedAt: raw.checkedAt || raw.generatedAt, contentChangedAt: raw.contentChangedAt || raw.generatedAt, probe: raw } : null,
    pointer?.ok ? { checkedAt: pointer.checked_at, contentChangedAt: pointer.content_changed_at, probe: pointer } : null,
  ].filter(Boolean).map((candidate) => ({
    ...candidate,
    probeTime: Date.parse(candidate.checkedAt || ''),
    visibleTime: Date.parse(candidate.contentChangedAt || ''),
  })).filter((candidate) => Number.isFinite(candidate.probeTime))
    .sort((left, right) => right.probeTime - left.probeTime);
  const latest = candidates[0];
  if (latest && now - latest.probeTime <= HOT_PROBE_STATE_MAX_AGE_MS) {
    const visibleIso = Number.isFinite(latest.visibleTime) ? new Date(latest.visibleTime).toISOString() : '';
    const info = visibleIso ? updateInfoFromIso(visibleIso, 'hot-probe') : null;
    if (info) value = { ...info, probeTime: latest.probeTime, checkedAt: new Date(latest.probeTime).toISOString(), probe: latest.probe };
  }
  hotUpdateMemoryCache.t = now;
  hotUpdateMemoryCache.v = value;
  hotUpdateMemoryCache.owner = owner;
  return value;
}
function hotProbeFreshEnough(info, now = Date.now()) {
  const probeTime = Number.isFinite(info?.probeTime) ? info.probeTime : info?.time;
  return Boolean(info?.source === 'hot-probe' && Number.isFinite(probeTime) && now - probeTime <= HOT_PROBE_STATE_MAX_AGE_MS);
}
function interactionHotProbeReason(request, route = 'content') {
  try {
    const url = new URL(request.url);
    const params = url.searchParams;
    const wd = params.get('wd') || params.get('search') || params.get('q') || '';
    const ids = params.get('ids') || params.get('id') || '';
    const ac = params.get('ac') || '';
    const t = params.get('t') || params.get('tid') || params.get('type_id') || params.get('category') || '';
    const action = ids ? 'detail' : wd ? 'search' : ac || t ? 'list' : 'open';
    const target = (wd || ids || t || url.pathname || '').toString().replace(/[^\w:.-]+/g, '_').slice(0, 80);
    return `interaction:${route}:${action}${target ? ':' + target : ''}`;
  } catch {
    return `interaction:${route}`;
  }
}
function scheduleInteractionHotProbe(request, env, ctx, updateInfo, route = 'content') {
  if (!ctx || typeof ctx.waitUntil !== 'function') return false;
  const now = clockNowMs(env);
  if (hotProbeFreshEnough(updateInfo, now)) return false;
  if (!forceFreshFromRequest(request) && hotInteractionProbeMemory.p && now - hotInteractionProbeMemory.t < HOT_INTERACTION_PROBE_MIN_INTERVAL_MS) return false;
  const promise = runHotSourceProbe(env, interactionHotProbeReason(request, route)).catch((err) => ({ ok: false, reason: 'interaction-probe-error', generatedAt: new Date().toISOString(), error: String(err && err.message || err) }));
  hotInteractionProbeMemory.t = now;
  hotInteractionProbeMemory.p = promise;
  ctx.waitUntil(promise);
  return true;
}
async function visibleUpdateInfo(env, manifest, options = {}) {
  const candidates = [manifestUpdateInfo(manifest), await readHotUpdateInfo(env, options)].filter(Boolean);
  if (!candidates.length) return { visibleUpdateText: '', source: 'none', at: '', time: 0 };
  candidates.sort((a, b) => b.time - a.time);
  return candidates[0];
}
function stampAggResponseWithUpdate(payload, info) {
  if (!payload || !info?.visibleUpdateText) return payload;
  const suffix = ` · ${info.visibleUpdateText}`;
  const out = { ...payload, visible_update_text: info.visibleUpdateText, update_label_strategy: info.source };
  if (Array.isArray(out.class)) {
    out.class = out.class.map((c) => {
      if (String(c?.type_id) === '0' || c?.type_name === '推荐') {
        const baseName = String(c.type_name || '推荐').replace(/\s*[·・]\s*\d{12}\s*$/, '') || '推荐';
        return { ...c, type_name: baseName + suffix };
      }
      return c;
    });
  }
  return out;
}
function snapshotFallbackLevel(manifest, payload = {}) {
  if (payload.hot_kv_available || payload.snapshot_mode === 'kv-hot-overlay') return 'kv-hot-package';
  if (payload.hot_manifest_available || String(payload.snapshot_mode || '').startsWith('hot-')) return 'pages-hot-overlay';
  if (manifest?.__snapshotFromPrevious) return 'previous-valid-snapshot';
  if (manifest?.__snapshotStale) return 'stale-valid-snapshot';
  if (manifest?.__snapshotFromLastGood) return 'last-valid-snapshot';
  const base = String(manifest?.__snapshotBase || '');
  if (base.includes('pages.dev')) return 'pages-snapshot';
  if (base.includes('raw.githubusercontent.com')) return 'github-snapshot';
  return 'snapshot';
}
function manifestCategoryUpdatedAt(manifest, category) {
  const row = Array.isArray(manifest?.categories)
    ? manifest.categories.find((item) => String(item?.type_id ?? item?.id) === String(category?.id) || String(item?.type_key ?? item?.key) === String(category?.key))
    : null;
  return row?.updatedAt || row?.updated_at || manifest?.sourceUpdatedAt || manifest?.content_changed_at || manifest?.generatedAt || '';
}
function snapshotSourceQuorum(manifest) {
  const total = Number(manifest?.sourceSummary?.active || manifest?.sourceSummary?.candidateCount || 0);
  return {
    required: total ? Math.ceil(total * 0.6) : 0,
    succeeded: total,
    total,
    ratio: total ? 1 : 0,
    basis: 'validated-snapshot-release',
  };
}
function stampAggDiagnostics(payload, options = {}) {
  const manifest = options.manifest || null;
  const category = options.category || null;
  const updateInfo = options.updateInfo || null;
  const contentRevision = payload?.content_revision
    || payload?.hot_kv_revision
    || manifest?.content_revision
    || manifest?.revision
    || '';
  const contentChangedAt = payload?.hot_kv_content_changed_at
    || manifest?.content_changed_at
    || updateInfo?.at
    || '';
  return {
    ...(payload || {}),
    content_revision: contentRevision,
    content_changed_at: contentChangedAt,
    category_updated_at: options.categoryUpdatedAt || manifestCategoryUpdatedAt(manifest, category),
    source_quorum: options.sourceQuorum || snapshotSourceQuorum(manifest),
    degraded: Boolean(options.degraded ?? payload?.degraded ?? manifest?.degraded ?? false),
    fallback_level: options.fallbackLevel || snapshotFallbackLevel(manifest, payload),
  };
}
async function config(request, env, policy = {}, ctx) {
  const origin = new URL(request.url).origin;
  const forceFresh = forceFreshFromRequest(request);
  const manifest = await fetchSnapshotJson(env, 'manifest.json');
  const updateInfo = await visibleUpdateInfo(env, manifest, { forceFresh });
  scheduleInteractionHotProbe(request, env, ctx, updateInfo, policy.includeAdult === false ? 'config-clean' : 'config');
  const updateText = updateInfo.visibleUpdateText;
  const clean = policy.includeAdult === false;
  const baseName = clean ? '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0' : '\u5f71\u89c6\u70b9\u64ad';
  const siteName = updateText ? `${baseName} · ${updateText}` : baseName;
  const apiBasePath = clean ? '/agg-clean' : '/agg';
  const apiPath = updateText ? `${apiBasePath}/u${updateText}` : apiBasePath;
  const sites = [
    { key: clean ? 'vod_unified_clean' : 'vod_unified', name: siteName, type: 1, api: origin + apiPath, searchable: 1, quickSearch: 1, filterable: 1, changeable: 1 },
  ];
  const etag = weakEtag(`${VERSION}:${clean ? 'clean' : 'full'}:${updateText || 'none'}`);
  const cacheHeaders = { 'cache-control': 'no-cache, max-age=0, must-revalidate', etag };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: cacheHeaders });
  return json({ spider: '', sites, lives: [{ name: '\u7cbe\u9009\u76f4\u64ad', type: 0, url: origin + '/live.txt', playerType: 1 }], parses: [], flags: [], wallpaper: '' }, 0, 200, cacheHeaders);
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}
function normalizeLiveProxyMode(raw, fallback = 'direct') {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return fallback;
  if (['0', 'false', 'no', 'off', 'direct'].includes(value)) return 'direct';
  if (['playlist', 'playlist-only', 'playlist_only', 'playlist-proxy', 'playlist_proxy', 'playlist-proxy-only', 'playlist_proxy_only'].includes(value)) return 'playlist';
  if (['1', 'true', 'yes', 'on', 'proxy', 'full', 'full-proxy', 'full_proxy'].includes(value)) return 'full';
  return fallback;
}
function liveProxyModeFromRequest(request, env) {
  const url = new URL(request.url);
  return normalizeLiveProxyMode(url.searchParams.get('proxy') || url.searchParams.get('mode') || url.searchParams.get('live_proxy') || env?.LIVE_PROXY_MODE, 'direct');
}
function playlistProxyModeFromRequest(request) {
  const url = new URL(request.url);
  return normalizeLiveProxyMode(url.searchParams.get('mode') || url.searchParams.get('proxy') || url.searchParams.get('live_proxy'), 'full') === 'playlist' ? 'playlist' : 'full';
}
function liveFallbackSuffix(mode) {
  if (mode === 'playlist') return '?mode=playlist';
  if (mode === 'full') return '?mode=full';
  return '';
}
function liveChannelUrl(rawUrl, origin, mode) {
  const direct = String(rawUrl || '').trim();
  if (!direct) return '';
  if (mode === 'direct' && isHttpUrl(direct)) return direct;
  const fallbackMode = mode === 'playlist' ? 'playlist' : 'full';
  return origin + '/play/' + b64urlEncode(direct) + '.m3u8' + liveFallbackSuffix(fallbackMode);
}
function liveDeliveryPolicy(origin) {
  return {
    defaultMode: 'DIRECT',
    defaultUrl: origin + '/live.txt',
    playlistProxyFallback: origin + '/live.txt?proxy=playlist',
    fullProxyFallback: origin + '/live.txt?proxy=1',
    defaultProxiesPlaylists: false,
    defaultProxiesMediaSegments: false,
    reason: '\u76f4\u64ad\u9ed8\u8ba4\u76f4\u8fde\u4e0a\u6e38\u5730\u5740\uff0c\u907f\u514d\u5546\u4e1a\u5e76\u53d1\u89c2\u770b\u628a Worker \u514d\u8d39\u8bf7\u6c42\u91cf\u653e\u5927\uff1b/play \u4e0e /p \u4ec5\u4f5c\u4e3a\u663e\u5f0f\u517c\u5bb9\u515c\u5e95\u3002',
  };
}

async function liveTxt(request, env) {
  const origin = new URL(request.url).origin;
  const mode = liveProxyModeFromRequest(request, env);
  const channels = await getChannels(env);
  const lines = [];
  for (const group of LIVE_GROUP_ORDER) {
    const legacyOtherGroup = '\u5907' + '\u7528' + '\u9891\u9053';
    const items = channels.filter((c) => (c.group === group) || (group === '\u5176\u4ed6\u9891\u9053' && c.group === legacyOtherGroup));
    if (!items.length) continue;
    lines.push(group + ',#genre#');
    for (const c of items) {
      const channelUrl = liveChannelUrl(c.url, origin, mode);
      if (channelUrl) lines.push(cleanLineName(c.name) + ',' + channelUrl);
    }
    lines.push('');
  }
  return text(lines.join('\n').trim() + '\n', 'text/plain; charset=utf-8', 300);
}
function absoluteUrl(base, value) {
  try { return new URL(value, base).href; } catch { return value; }
}
function rewriteUriAttrs(line, base, origin, mode = 'full') {
  return line.replace(/URI="([^"]+)"/g, (_, uri) => {
    const abs = absoluteUrl(base, uri);
    return 'URI="' + (mode === 'playlist' ? abs : origin + '/p/' + b64urlEncode(abs)) + '"';
  });
}
function rewriteManifest(body, baseUrl, origin, mode = 'full') {
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith('#')) return line.includes('URI="') ? rewriteUriAttrs(raw, baseUrl, origin, mode) : raw;
    const abs = absoluteUrl(baseUrl, line);
    let isPlaylist = false;
    try {
      const path = new URL(abs).pathname.toLowerCase();
      isPlaylist = path.endsWith('.m3u8') || path.endsWith('.m3u');
    } catch {}
    if (isPlaylist) return origin + '/play/' + b64urlEncode(abs) + '.m3u8' + liveFallbackSuffix(mode === 'playlist' ? 'playlist' : 'full');
    return mode === 'playlist' ? abs : origin + '/p/' + b64urlEncode(abs);
  }).join('\n');
}
async function proxyPlaylist(request, token) {
  const target = b64urlDecode(String(token || '').replace(/\.m3u8$/i, ''));
  const mode = playlistProxyModeFromRequest(request);
  const upstream = await fetch(target, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' });
  const body = await upstream.text();
  if (!upstream.ok || /^\s*</.test(body) || /access denied/i.test(body)) {
    return text('#EXTM3U\n# source temporarily unavailable\n', 'application/vnd.apple.mpegurl; charset=utf-8', 30, upstream.ok ? 502 : upstream.status);
  }
  const origin = new URL(request.url).origin;
  return text(rewriteManifest(body, target, origin, mode), 'application/vnd.apple.mpegurl; charset=utf-8', 120);
}
async function proxyMedia(request, token) {
  const target = b64urlDecode(token);
  const headers = new Headers();
  headers.set('user-agent', UA);
  headers.set('accept', request.headers.get('accept') || '*/*');
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const upstream = await fetch(target, { headers, redirect: 'follow' });
  const outHeaders = new Headers(upstream.headers);
  outHeaders.set('access-control-allow-origin', '*');
  outHeaders.set('cache-control', 'public, max-age=86400');
  outHeaders.delete('content-security-policy');
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}
async function vod(request, env) {
  const origin = new URL(request.url).origin;
  const url = new URL(request.url);
  const params = url.searchParams;
  const items = await getVodItems(env);
  const ac = (params.get('ac') || '').toLowerCase();
  const ids = params.get('ids') || params.get('id') || '';
  const wd = (params.get('wd') || params.get('search') || params.get('q') || '').trim().toLowerCase();
  const category = getCategoryParam(params);
  const page = parseInt(params.get('pg') || params.get('page') || '1', 10) || 1;
  const limit = Math.min(LIMIT_MAX, parseInt(params.get('limit') || String(LIMIT_DEFAULT), 10) || LIMIT_DEFAULT);
  const filterMap = buildFilterMap(items);
  const filters = parseFilters(params);

  if (ids) {
    const wanted = new Set(ids.split(',').map((x) => x.trim()).filter(Boolean));
    const selected = items.filter((x) => wanted.has(x.id));
    return json({ code: 1, msg: 'ok', list: selected.map((x) => vodDetailItem(x, origin)) }, 300);
  }

  let selected = items;
  if (category) selected = selected.filter((x) => x.category === category.key || x.type_name === category.name);
  if (wd) selected = selected.filter((x) => itemSearchText(x).toLowerCase().includes(wd));
  selected = selected.filter((x) => itemMatchesFilters(x, filters));
  selected = sortItems(selected, filters);

  const p = pageList(selected.map(vodListItem), page, limit);
  return json({
    code: 1,
    msg: 'ok',
    class: vodClasses(items),
    filters: filterMap,
    page: p.page,
    pagecount: p.pagecount,
    limit,
    total: p.total,
    list: p.list,
  }, 300);
}
async function health(request, env) {
  const origin = new URL(request.url).origin;
  const channels = await getChannels(env);
  const healthChannels = channels.map((c) => ({ ...c, group: c.group === ('\u5907' + '\u7528' + '\u9891\u9053') ? '\u5176\u4ed6\u9891\u9053' : c.group }));
  const vodItems = await getVodItems(env);
  const filterMap = buildFilterMap(vodItems);
  return json({
    version: VERSION,
    ok: true,
    live: { total: channels.length, counts: countBy(healthChannels, 'group'), url: origin + '/live.txt', delivery: liveDeliveryPolicy(origin) },
    vod: {
      total: vodItems.length,
      counts: countBy(vodItems, 'type_name'),
      categories: VOD_CATEGORIES.map((c) => ({ type_id: c.id, type_name: c.name, legacy_id: c.key })),
      filterKeys: ['年代', '年份', '题材', '大小', '排序'],
      filterCounts: Object.fromEntries(VOD_CATEGORIES.map((c) => [c.name, (filterMap[c.id] || []).reduce((sum, f) => sum + Math.max(0, f.value.length - 1), 0)])),
      api: origin + '/vod',
    },
    aggregate: { api: origin + '/agg', entry: '\u5f71\u89c6\u70b9\u64ad', categories: AGG_CATEGORIES.map((c) => ({ type_id: c.id, type_name: c.name, key: c.key })), filterKeys: ['\u6392\u5e8f', '\u5e74\u4efd', '\u5730\u533a', '\u7c7b\u578b', '\u5185\u5bb9\u5f62\u6001', '\u6e05\u6670\u5ea6'], internalSourceCount: CMS_SOURCES.length, snapshotFirst: true },
    v73: { primary: V73_PRIMARY_ORIGIN + '/config.json', secondary: V73_SECONDARY_ORIGIN + '/config.json', status: origin + '/status.json', mirrors: origin + '/mirrors.json', snapshot: origin + '/snapshot.json' },
    cms: { hidden: true, count: CMS_SOURCES.length },
    config: origin + '/config.json',
  }, 60);
}
async function sources(request, env) {
  const channels = await getChannels(env);
  const vodItems = await getVodItems(env);
  const runtimeSources = await runtimeCmsSources(env);
  return json({
    ok: true,
    version: VERSION,
    policy: '\u5f71\u89c6\u70b9\u64ad\u4f7f\u7528\u591a CMS \u76f4\u8fde\u805a\u5408\uff1b\u4fdd\u7559\u6210\u4eba\u5185\u5bb9\u4e0e\u89e3\u8bf4\u3001\u6f14\u5531\u4f1a\u3001\u516c\u5f00\u8bfe\u3001\u6559\u7a0b\u3001\u79d1\u666e\u7b49\u6709\u6548\u5185\u5bb9\uff1b\u8fc7\u6ee4\u5e7f\u544a\u3001\u89e3\u6790\u9875\u3001iframe \u548c\u65e0\u6548\u64ad\u653e\u5730\u5740\uff1b\u7535\u89c6\u7aef\u53ea\u663e\u793a\u4e00\u4e2a\u70b9\u64ad\u5165\u53e3\u3002',
    live: { total: channels.length, counts: countBy(channels.map((c) => ({ ...c, group: c.group === ('\u5907' + '\u7528' + '\u9891\u9053') ? '\u5176\u4ed6\u9891\u9053' : c.group })), 'group'), groups: LIVE_GROUP_ORDER, delivery: liveDeliveryPolicy(new URL(request.url).origin), channels: channels.map((c) => ({ group: c.group === ('\u5907' + '\u7528' + '\u9891\u9053') ? '\u5176\u4ed6\u9891\u9053' : c.group, name: c.name })) },
    vod: { total: vodItems.length, counts: countBy(vodItems, 'type_name'), categories: VOD_CATEGORIES.map((c) => ({ type_id: c.id, type_name: c.name, legacy_id: c.key })), filterKeys: ['\u5e74\u4ee3', '\u5e74\u4efd', '\u9898\u6750', '\u5927\u5c0f', '\u6392\u5e8f'], items: vodItems.map(vodListItem) },
    aggregate: { entry: '\u5f71\u89c6\u70b9\u64ad', categories: AGG_CATEGORIES.map((c) => ({ type_id: c.id, type_name: c.name, key: c.key })), internalSourceCount: runtimeSources.length, sourceRegistry: { mode: 'validated-snapshot', active: runtimeSources.length, physicalUnique: true }, filterKeys: ['\u6392\u5e8f', '\u5e74\u4efd', '\u5730\u533a', '\u7c7b\u578b', '\u5185\u5bb9\u5f62\u6001', '\u6e05\u6670\u5ea6'] },
  }, 300);
}

function home(request) {
  const origin = new URL(request.url).origin;
  return text([
    'TVBox Source Hub',
    '导入地址：' + origin + '/config.json',
    '直播清单：' + origin + '/live.txt',
    '点播接口：' + origin + '/vod',
    '健康检查：' + origin + '/health',
  ].join('\n') + '\n', 'text/plain; charset=utf-8', 300);
}

async function collectHotRowsFromSource(source, params) {
  const got = await fetchCmsJsonByParams(source, params, 6500);
  if (!got.ok) return { ok: false, status: got.status || 0, rows: [], count: 0, classes: [], categoryMap: {} };
  const cleaned = cleanCmsResult(got.data, false);
  const classes = Array.isArray(cleaned.class) ? cleaned.class : [];
  const byId = Object.fromEntries(classes.map((record) => [String(record.type_id || ''), record.type_name || '']));
  const categoryMap = sourceCategoryMapFromClasses(classes);
  const rows = [];
  for (const raw of Array.isArray(cleaned.list) ? cleaned.list.slice(0, 120) : []) {
    const typeId = String(raw.type_id || raw.type || '').trim();
    const className = cleanCmsText(raw.type_name || byId[typeId] || '', 40);
    const normalized = normalizeAggContentItem({ ...raw, source_category_id: typeId, source_category_name: className }, className, categoryMap);
    rows.push({ ...normalized, type_name: className, _className: className, _sourceSlug: source.slug, _sourceShort: source.short });
  }
  return { ok: rows.length > 0, status: got.status, rows, count: rows.length, classes, categoryMap };
}
async function runHotSourceProbeImpl(env, reason = 'cron') {
  const checkedAt = new Date(clockNowMs(env)).toISOString();
  const probeSources = await runtimeCmsSources(env);
  const deepCategories = AGG_CATEGORIES.filter((category) => category.key !== 'recommend');
  const rotation = Math.floor(clockNowMs(env) / (5 * 60 * 1000)) % Math.max(1, deepCategories.length);
  const deepCategory = deepCategories[rotation];
  const firstSettled = await Promise.allSettled(
    probeSources.map((source, index) => collectHotRowsFromSource(source, { ac: 'videolist', pg: 1 })
      .then((result) => ({ source, result, page: 1, deep: false, index, categoryId: '' }))),
  );
  const deepJobs = [];
  for (const settledRow of firstSettled) {
    if (settledRow.status !== 'fulfilled' || !deepCategory) continue;
    const { source, result, index } = settledRow.value;
    const sourceClass = (result.classes || []).find((record) => {
      const id = String(record?.type_id ?? record?.id ?? '').trim();
      const primary = result.categoryMap?.[id] || macroForTypeName(record?.type_name ?? record?.name ?? '');
      return categoryMatchesPrimary(deepCategory, primary);
    });
    const categoryId = String(sourceClass?.type_id ?? sourceClass?.id ?? '').trim();
    if (!categoryId) continue;
    deepJobs.push(collectHotRowsFromSource(source, { ac: 'videolist', t: categoryId, pg: 1 })
      .then((deepResult) => ({ source, result: deepResult, page: 1, deep: true, index, categoryId })));
  }
  const deepSettled = await Promise.allSettled(deepJobs);
  const settled = [...firstSettled, ...deepSettled];
  const sourceMap = new Map();
  const rawRows = [];
  for (const settledRow of settled) {
    if (settledRow.status !== 'fulfilled') continue;
    const { source, result, page, deep, categoryId } = settledRow.value;
    const current = sourceMap.get(source.slug) || { slug: source.slug, ok: false, count: 0, pages: [], category_ids: [], samples: [], updated_at: '', _updated_at_ms: 0, future_timestamp_count: 0, clock_skew_timestamp_count: 0 };
    current.ok = current.ok || result.ok;
    current.count += result.count;
    current.pages.push(page);
    if (deep && categoryId) current.category_ids.push(categoryId);
    current.samples.push(...result.rows.slice(0, 3).map((item) => cleanAggName(item.vod_name || '', 80)).filter(Boolean));
    const timestampEvidence = latestPlausibleSourceTimestamp(result.rows, {
      nowMs: clockNowMs(env),
      fields: ['vod_time', 'vod_time_add', 'vod_pubdate', 'source_updated_at'],
    });
    if (timestampEvidence.ms > current._updated_at_ms) {
      current._updated_at_ms = timestampEvidence.ms;
      current.updated_at = timestampEvidence.raw;
    }
    current.future_timestamp_count += timestampEvidence.futureRejectedCount;
    current.clock_skew_timestamp_count += timestampEvidence.clockSkewCappedCount;
    sourceMap.set(source.slug, current);
    rawRows.push(...result.rows);
  }
  const sources = [...sourceMap.values()].map(({ _updated_at_ms, ...item }) => ({
    ...item,
    pages: [...new Set(item.pages)],
    category_ids: [...new Set(item.category_ids)],
    samples: [...new Set(item.samples)].slice(0, 3),
  }));
  const okSources = sources.filter((s) => s.ok).length;
  const totalItems = rawRows.length;
  const ok = okSources >= Math.ceil(probeSources.length * 0.6) && totalItems > 0;
  const [previous, previousHealth] = await Promise.all([
    readHotCatalogPackage(env),
    readJsonKv(env, HOT_UPDATE_KV_KEY),
  ]);
  let nextPackage = null;
  let changed = false;
  let persisted = false;
  if (ok) {
    const merged = mergeAggItems(rawRows);
    const currentRows = merged.map(aggListItemFromMerged).map((row) => ({ ...row, hot_seen_at: checkedAt }));
    const retentionCutoff = clockNowMs(env) - HOT_ROW_RETENTION_MS;
    const retainedRows = (Array.isArray(previous?.rows) ? previous.rows : []).filter((row) => {
      const seenAt = Date.parse(row?.hot_seen_at || previous?.checked_at || previous?.pointer?.checked_at || '');
      return Number.isFinite(seenAt) && seenAt >= retentionCutoff;
    });
    const list = mergeHotRows([...retainedRows, ...currentRows]).rows;
    const preliminary = buildHotPackage(list, { checkedAt, contentChangedAt: previous?.content_changed_at || checkedAt });
    changed = shouldPublishHotPackage(previous, preliminary);
    const contentChangedAt = changed ? checkedAt : (previous?.content_changed_at || checkedAt);
    nextPackage = buildHotPackage(list, { checkedAt, contentChangedAt, revision: changed ? `hot-${preliminary.content_hash}` : (previous?.revision || `hot-${preliminary.content_hash}`) });
    const previousPublishTime = Date.parse(previous?.pointer?.checked_at || '');
    const currentPublishSlot = Math.floor(clockNowMs(env) / HOT_PUBLISH_SLOT_MS);
    const previousPublishSlot = Number.isFinite(previousPublishTime) ? Math.floor(previousPublishTime / HOT_PUBLISH_SLOT_MS) : -1;
    const publishSlotAvailable = currentPublishSlot !== previousPublishSlot;
    if (changed && nextPackage && publishSlotAvailable) {
      const packageKey = HOT_PACKAGE_PREFIX + nextPackage.revision;
      const previousKeys = [previous?.pointer?.package_key, ...(previous?.pointer?.previous_keys || [])].filter((key) => key && key !== packageKey).slice(0, 2);
      const packageWritten = await writeJsonKv(env, packageKey, nextPackage, HOT_PACKAGE_TTL_SECONDS);
      const pointerWritten = packageWritten && await writeJsonKv(env, HOT_ACTIVE_KV_KEY, {
        ok: true,
        package_key: packageKey,
        previous_keys: previousKeys,
        revision: nextPackage.revision,
        content_hash: nextPackage.content_hash,
        checked_at: checkedAt,
        content_changed_at: contentChangedAt,
      }, HOT_PACKAGE_TTL_SECONDS);
      persisted = Boolean(pointerWritten);
    }
    const effectiveContentChangedAt = changed && !persisted
      ? (previous?.content_changed_at || previous?.pointer?.content_changed_at || '')
      : nextPackage.content_changed_at;
    const sourceQuorum = {
      required: Math.ceil(probeSources.length * 0.6),
      succeeded: okSources,
      total: probeSources.length,
      ratio: probeSources.length ? Number((okSources / probeSources.length).toFixed(4)) : 0,
    };
    const payload = {
      ok: true,
      reason,
      generatedAt: checkedAt,
      checkedAt,
      contentChangedAt: effectiveContentChangedAt,
      contentChanged: changed,
      visibleUpdateText: formatChinaReverseUpdateCode(effectiveContentChangedAt),
      contentHash: nextPackage.content_hash,
      revision: nextPackage.revision,
      published: changed && persisted,
      persisted,
      publicationDeferred: changed && !publishSlotAvailable,
      publicationSlot: currentPublishSlot,
      sourceQuorum,
      degraded: okSources < probeSources.length,
      fallbackLevel: persisted || !changed ? 'kv-hot-package' : 'previous-valid-package',
      okSources,
      checkedSources: sources.length,
      totalItems,
      deepCategory: deepCategory ? { id: deepCategory.id, key: deepCategory.key, name: deepCategory.name } : null,
      externalRequests: settled.length,
      sources,
    };
    const previousHealthTime = Date.parse(previousHealth?.checkedAt || previousHealth?.generatedAt || '');
    const healthDue = !Number.isFinite(previousHealthTime) || clockNowMs(env) - previousHealthTime >= HOT_HEALTH_HEARTBEAT_MS;
    const healthWritten = healthDue
      ? await writeJsonKv(env, HOT_UPDATE_KV_KEY, payload, HOT_LAST_SUCCESS_TTL_SECONDS)
      : false;
    hotUpdateMemoryCache.t = clockNowMs(env);
    hotUpdateMemoryCache.owner = kvBinding(env);
    const visibleInfo = effectiveContentChangedAt ? updateInfoFromIso(effectiveContentChangedAt, 'hot-probe') : null;
    hotUpdateMemoryCache.v = visibleInfo ? { ...visibleInfo, probeTime: Date.parse(checkedAt), checkedAt, probe: payload } : null;
    return { ...payload, healthWritten, healthDue, healthHeartbeatMinutes: HOT_HEALTH_HEARTBEAT_MINUTES };
  }
  return { ok: false, reason, generatedAt: checkedAt, checkedAt, contentChanged: false, visibleUpdateText: previous?.content_changed_at ? formatChinaReverseUpdateCode(previous.content_changed_at) : '', okSources, checkedSources: sources.length, totalItems, deepCategory: deepCategory ? { id: deepCategory.id, key: deepCategory.key, name: deepCategory.name } : null, externalRequests: settled.length, sources };
}
function runHotSourceProbe(env, reason = 'cron') {
  if (hotProbeRuntime.promise) return hotProbeRuntime.promise;
  const promise = runHotSourceProbeImpl(env, reason).finally(() => { hotProbeRuntime.promise = null; });
  hotProbeRuntime.promise = promise;
  return promise;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHotSourceProbe(env, event?.cron || 'scheduled'));
  },
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return text('', 'text/plain; charset=utf-8', 86400);
      if (url.pathname === '/config.json' || url.pathname === '/config') return config(request, env, {}, ctx);
      if (url.pathname === '/config-clean.json' || url.pathname === '/config-clean' || url.pathname === '/clean/config.json') return config(request, env, { includeAdult: false }, ctx);
      if (url.pathname === '/live.txt' || url.pathname === '/live') return liveTxt(request, env);
      if (url.pathname === '/agg' || url.pathname === '/agg/' || url.pathname.startsWith('/agg/u')) return agg(request, env, {}, ctx);
      if (url.pathname === '/agg-clean' || url.pathname === '/agg-clean/' || url.pathname.startsWith('/agg-clean/u')) return agg(request, env, { includeAdult: false }, ctx);
      if (url.pathname === '/vod' || url.pathname === '/vod/') return vod(request, env);
      if (url.pathname.startsWith('/cms/')) return cms(request, env, decodeURIComponent(url.pathname.slice('/cms/'.length)).replace(/\/$/, ''));
      if (url.pathname === '/health') return health(request, env);
      if (url.pathname === '/status.json' || url.pathname === '/status') return statusV73(request, env, ctx);
      if (url.pathname === '/mirrors.json' || url.pathname === '/mirrors') return mirrorsV73(request, env);
      if (url.pathname === '/snapshot.json' || url.pathname === '/snapshot') return snapshotV73(request, env);
      if (url.pathname === '/sources.json' || url.pathname === '/sources') return sources(request, env);
      if (url.pathname.startsWith('/play/')) return proxyPlaylist(request, decodeURIComponent(url.pathname.slice('/play/'.length)));
      if (url.pathname.startsWith('/p/')) return proxyMedia(request, decodeURIComponent(url.pathname.slice('/p/'.length)));
      return home(request);
    } catch (err) {
      return json({ ok: false, version: VERSION, error: String(err && err.message || err) }, 30, 500);
    }
  },
};
