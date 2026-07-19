import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_CATEGORIES } from '../src/snapshot-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.AUDIT_LIMIT || 24);
const DETAIL_SAMPLE = Number(process.env.AUDIT_DETAIL_SAMPLE || 5);
const PLAY_SAMPLE = Number(process.env.AUDIT_PLAY_SAMPLE || 2);
const TIMEOUT = Number(process.env.AUDIT_TIMEOUT_MS || 25000);
const PLAY_TIMEOUT = Number(process.env.AUDIT_PLAY_TIMEOUT_MS || 10000);
const AUDIT_RUN_ID = String(process.env.AUDIT_RUN_ID || `rc-${Date.now().toString(36)}`);
export const FULL_CATEGORY_IDS = SNAPSHOT_CATEGORIES.map((category) => category.id);
export const CLEAN_CATEGORY_IDS = SNAPSHOT_CATEGORIES.filter((category) => category.key !== 'adult').map((category) => category.id);
const SEARCH_TERMS = ['影视', '电影', '解说', '演唱会', '公开课', '2026', '动作'];
const REQUIRED_SEARCH_TERMS = new Set(['影视', '电影', '解说', '2026', '动作']);
const CLEAN_POLICY_PROBE_TERMS = ['成人', '伦理'];
const FORBIDDEN_UI_RE = /(备用)/;
const ADULT_STRONG_TEXT_RE = /(成人(?:伦理|影片|电影|内容|专区|福利|写真)|伦理片|情色|三级|里番|番号|福利片|写真片|午夜成人|\bAV\b|\badult\b|\bxxx\b)/iu;
const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

export const ROOT_CAUSE = {
  API_ERROR: 'API_ERROR',
  SNAPSHOT_MISS: 'SNAPSHOT_MISS',
  FILTER_LOGIC_BUG: 'FILTER_LOGIC_BUG',
  TAG_PARSE_GAP: 'TAG_PARSE_GAP',
  SOURCE_TAG_GAP: 'SOURCE_TAG_GAP',
  SOURCE_COVERAGE_GAP: 'SOURCE_COVERAGE_GAP',
  SEMANTIC_MISMATCH: 'SEMANTIC_MISMATCH',
  PLAYBACK_FAIL: 'PLAYBACK_FAIL',
  OK: 'OK',
};
export const PATH_CAUSE = {
  APP_REQUEST_VARIANT: 'APP_REQUEST_VARIANT',
  CACHE_STALE: 'CACHE_STALE',
  COMBO_OVER_CONSTRAINED: 'COMBO_OVER_CONSTRAINED',
  PAGE_BOUNDARY_EMPTY: 'PAGE_BOUNDARY_EMPTY',
  SCHEMA_REGRESSION: 'SCHEMA_REGRESSION',
};

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(4));
}
function fullUrl(pathname) {
  return BASE + pathname;
}
export function auditFetchPath(pathname) {
  const value = String(pathname || '');
  if (!value.startsWith('/agg') || /(?:[?&])audit_run=/.test(value)) return value;
  return value + (value.includes('?') ? '&' : '?') + 'audit_run=' + encodeURIComponent(AUDIT_RUN_ID);
}
function filterValue(value) {
  return String(value || '').trim();
}
function requestPath(t, pg = 1, filter = null, limit = LIMIT) {
  const base = `/agg?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}&limit=${limit}`;
  return filter ? base + '&f=' + encodeURIComponent(JSON.stringify(filter)) : base;
}
function aggregateBase(clean = false) {
  return clean ? '/agg-clean' : '/agg';
}
function policyRequestPath(t, pg = 1, filter = null, limit = LIMIT, clean = false) {
  const base = `${aggregateBase(clean)}?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}&limit=${limit}`;
  return filter ? base + '&f=' + encodeURIComponent(JSON.stringify(filter)) : base;
}
async function fetchText(pathname, timeout = TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(fullUrl(auditFetchPath(pathname)), {
      headers: { accept: '*/*', 'user-agent': 'TVBoxFullRemoteAudit/7.3', 'cache-control': 'no-cache', pragma: 'no-cache' },
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } catch (err) {
    return { status: 0, headers: new Headers(), text: '', error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJson(pathname, timeout = TIMEOUT) {
  const got = await fetchText(pathname, timeout);
  let data = null;
  try { data = JSON.parse(got.text); } catch { data = { raw: got.text.slice(0, 300), error: got.error || '' }; }
  return { ...got, data };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchJsonRetry(pathname, timeout = TIMEOUT, attempts = 2) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await fetchJson(pathname, timeout);
    const list = Array.isArray(last.data?.list) ? last.data.list : [];
    if (last.status === 200 && list.length) return last;
    if (i + 1 < attempts) await sleep(350);
  }
  return last;
}
function textOf(item) {
  return [
    item?.type_name,
    item?.vod_name,
    item?.vod_sub,
    item?.vod_remarks,
    item?.vod_class,
    item?.vod_state,
    item?.vod_area,
    item?.vod_lang,
    item?.vod_year,
    item?.vod_content,
    item?.vod_play_from,
    item?.semantic_tags,
    item?.snapshot_filter_evidence,
  ].join(' ');
}
export function searchTermMatches(item, term) {
  const value = String(term || '').trim();
  const text = textOf(item);
  if (!value) return true;
  if (text.toLowerCase().includes(value.toLowerCase())) return true;
  if (value === '影视') return /(电影|剧集|电视剧|综艺|动漫|纪录片|短剧|解说|文娱知识|成人伦理|影片|院线)/.test(text);
  return classGroupMatches(value, text).hit;
}
function normalizeTitle(value) {
  return String(value || '')
    .replace(/[\[\u3010(（].*?[\]\u3011)）]/g, '')
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/[\s·.。,，:：;；!！?？_\-—|]+/g, '')
    .trim()
    .toLowerCase();
}
export function compareDisplayName(a, b) {
  return NAME_COLLATOR.compare(String(a || ''), String(b || ''));
}
function extractYear(item) {
  const m = textOf(item).match(/(?:19|20)\d{2}/);
  return m ? m[0] : '';
}
function sortYear(item) {
  const fieldYear = String(item?.vod_year || item?.year || '').match(/(?:19|20)\d{2}/)?.[0] || '';
  return fieldYear || extractYear(item);
}
function qualityEvidence(item) {
  const t = textOf(item).toUpperCase();
  if (/4K|2160/.test(t)) return '4k';
  if (/1080|蓝光|BD|B1080/.test(t)) return '1080';
  if (/TC|TS|抢先|枪版/.test(t)) return 'tc';
  if (/HD|高清|正片|完结/.test(t)) return 'hd';
  return '';
}
function qualityRank(item) {
  const q = qualityEvidence(item);
  if (q === '4k') return 70;
  if (q === '1080') return 60;
  if (q === 'hd') return 50;
  if (q === 'tc') return 15;
  return 30;
}
function lineCount(item) {
  return Number(String(item?.vod_remarks || '').match(/(\d+)\s*线/)?.[1] || 0);
}
function classGroupMatches(value, text) {
  const v = filterValue(value);
  if (!v) return { hit: true, unknown: false };
  const hay = String(text || '');
  const rules = [
    ['悬疑犯罪', /(悬疑|犯罪|推理|刑侦|警匪|案件)/],
    ['科幻奇幻', /(科幻|奇幻|魔幻|灾难|冒险)/],
    ['恐怖惊悚', /(恐怖|惊悚|灵异)/],
    ['战争历史', /(战争|历史|古装|传记)/],
    ['港台', /(港台|香港|港剧|港澳|台湾|台剧)/],
    ['日韩', /(日韩|日本|日剧|日漫|韩国|韩剧|韩漫)/],
    ['欧美', /(欧美|美国|英国|法国|德国|美剧|英剧)/],
    ['国漫', /(国漫|国产动漫|中国动漫)/],
    ['日漫', /(日漫|日本动漫|日韩动漫|番剧)/],
    ['音乐现场', /(音乐现场|音乐会|演唱会|LIVE|现场|音乐节)/i],
    ['生活旅行', /(生活|旅行|vlog|VLOG|旅游|探店)/],
    ['美食健身', /(美食|烹饪|健身|运动|瑜伽)/],
    ['游戏科技', /(游戏|科技|测评|数码|电竞)/],
    ['体育赛事', /(体育|赛事|比赛|集锦|回放|篮球|足球|格斗)/],
    ['少儿亲子', /(少儿|儿童|亲子|儿歌|早教|启蒙)/],
    ['电影', /(电影|动作|喜剧|爱情|科幻|恐怖|惊悚|悬疑|剧情|战争|犯罪|影片|院线)/],
    ['剧集', /(剧集|电视剧|连续剧|国产剧|美剧|英剧|港剧|台剧|韩剧|日剧|泰剧)/],
    ['文娱知识', /(文娱|知识|演唱会|音乐|MV|LIVE|公开课|教程|讲座|科普|美食|旅行|游戏|体育|少儿)/i],
  ];
  const found = rules.find(([name]) => name === v);
  if (found) return { hit: found[1].test(hay), unknown: false };
  return { hit: hay.includes(v), unknown: !hay };
}
function contentForm(item) {
  const t = textOf(item);
  if (/(解说|讲解|影评|盘点|剧情解说|电影解说|影视解说|说电影|看电影|案件解说|历史解说|游戏解说|科技科普)/.test(t)) return '解说';
  if (/(公开课|课程|教程|教学|讲座|课堂|培训)/.test(t)) return '课程';
  if (/(演唱会|音乐会|巡演|\bLIVE\b|现场|舞台|音乐节|晚会)/i.test(t)) return '现场';
  if (/(合集|大全|全集|系列|专题|盘点|集锦)/.test(t)) return '合集';
  if (/(预告|花絮|片花|片段|精彩片段|先导)/.test(t)) return '片段';
  if (/(短视频|快看|速看)/.test(t)) return '短视频';
  return '正片';
}
function assertItem(key, value, item) {
  const v = filterValue(value);
  if (!v || key === 'sort') return { hit: true, unknown: false };
  const t = textOf(item);
  if (key === 'year') {
    const y = extractYear(item);
    if (!y) return { hit: false, unknown: true };
    const n = Number(y);
    if (/^\d{4}$/.test(v)) return { hit: y === v, unknown: false };
    if (v === '2020-2022') return { hit: n >= 2020 && n <= 2022, unknown: false };
    if (v === '2010s') return { hit: n >= 2010 && n <= 2019, unknown: false };
    if (v === 'older') return { hit: n > 0 && n < 2010, unknown: false };
    return { hit: true, unknown: false };
  }
  if (key === 'area' || key === 'class' || key === 'topic') return classGroupMatches(v, t);
  if (key === 'form') return { hit: contentForm(item) === v || t.includes(v), unknown: false };
  if (key === 'quality') {
    const q = qualityEvidence(item);
    if (!q && v !== '正片') return { hit: false, unknown: true };
    if (v === 'hd') return { hit: ['hd', '1080', '4k'].includes(q), unknown: false };
    if (v === '4k') return { hit: q === '4k', unknown: false };
    if (v === '1080') return { hit: q === '1080' || q === '4k', unknown: false };
    if (v === 'TC') return { hit: q === 'tc', unknown: false };
    if (v === '正片') return { hit: contentForm(item) === '正片', unknown: false };
    return { hit: t.toUpperCase().includes(v.toUpperCase()), unknown: false };
  }
  if (key === 'state') {
    const complete = /(完结|全\d{1,4}集|全集|已完结)/.test(t);
    const updating = /(更新|更新至|连载)/.test(t) && !complete;
    if (v === '已完结') return { hit: complete, unknown: !complete && !updating };
    if (v === '更新中') return { hit: updating || !complete, unknown: false };
    if (v === '合集') return { hit: contentForm(item) === '合集', unknown: false };
  }
  if (key === 'episodes') {
    const m = t.match(/(?:全|第|更新至)?(\d{1,4})集/);
    if (!m) return { hit: false, unknown: true };
    const n = Number(m[1]);
    if (v === '0-30') return { hit: n <= 30, unknown: false };
    if (v === '31-80') return { hit: n >= 31 && n <= 80, unknown: false };
    if (v === '80+') return { hit: n > 80, unknown: false };
  }
  if (key === 'duration') {
    const form = contentForm(item);
    if (v === '合集') return { hit: form === '合集', unknown: false };
    if (v === '短视频') return { hit: form === '短视频' || /\b([1-9]|1\d|2\d)\s*(min|分钟)/i.test(t), unknown: false };
    if (v === '长视频') return { hit: form !== '短视频', unknown: false };
  }
  return { hit: t.includes(v), unknown: false };
}
export function sortScore(key, value, list) {
  const v = filterValue(value);
  if (key !== 'sort' || list.length < 2) return { semanticHitRate: 1, unknownRate: 0 };
  let ordered = 0;
  for (let i = 1; i < list.length; i++) {
    if (v === 'name') ordered += compareDisplayName(list[i - 1].vod_name, list[i].vod_name) <= 0 ? 1 : 0;
    else if (v === 'quality') ordered += qualityRank(list[i - 1]) >= qualityRank(list[i]) ? 1 : 0;
    else if (v === 'lines') ordered += lineCount(list[i - 1]) >= lineCount(list[i]) ? 1 : 0;
    else ordered += Number(sortYear(list[i - 1]) || 0) >= Number(sortYear(list[i]) || 0) ? 1 : 0;
  }
  return { semanticHitRate: ordered / (list.length - 1), unknownRate: 0 };
}
function semanticStats(filter, list) {
  if (!filter || !filter.key) return { semanticHitRate: 1, unknownRate: 0, examples: [] };
  if (filter.key === 'sort') return { ...sortScore(filter.key, filter.value, list), examples: [] };
  if (!list.length) return { semanticHitRate: 0, unknownRate: 0, examples: [] };
  let hit = 0, unknown = 0;
  const examples = [];
  for (const item of list) {
    const r = assertItem(filter.key, filter.value, item);
    if (r.hit) hit++;
    if (r.unknown) unknown++;
    if (!r.hit && examples.length < 3) examples.push({ name: item.vod_name, type: item.type_name, year: item.vod_year, remarks: item.vod_remarks });
  }
  return { semanticHitRate: hit / list.length, unknownRate: unknown / list.length, examples };
}
export function comboSemanticStats(filters, list) {
  const active = Object.entries(filters || {}).filter(([, value]) => filterValue(value)).map(([key, value]) => ({ key, value }));
  if (!active.length) return { semanticHitRate: 1, unknownRate: 0, examples: [] };
  if (!list.length) return { semanticHitRate: 0, unknownRate: 0, examples: [] };
  let hit = 0, unknown = 0;
  const examples = [];
  for (const item of list) {
    let itemHit = true;
    let itemUnknown = false;
    for (const filter of active) {
      if (filter.key === 'sort') continue;
      const r = assertItem(filter.key, filter.value, item);
      itemHit = itemHit && r.hit;
      itemUnknown = itemUnknown || r.unknown;
    }
    if (itemHit) hit++;
    if (itemUnknown) unknown++;
    if (!itemHit && examples.length < 3) examples.push({ name: item.vod_name, type: item.type_name, year: item.vod_year, remarks: item.vod_remarks });
  }
  return { semanticHitRate: hit / list.length, unknownRate: unknown / list.length, examples };
}
export function duplicateRate(list) {
  if (!list.length) return 0;
  const seen = new Set();
  let duplicates = 0;
  for (const item of list) {
    const key = [normalizeTitle(item.vod_name), extractYear(item), item.type_name || ''].join('|');
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates / list.length;
}
function lineStats(vod) {
  const from = String(vod?.vod_play_from || '').split('$$$').filter(Boolean);
  const groups = String(vod?.vod_play_url || '').split('$$$').filter(Boolean);
  const urls = groups.flatMap((g) => g.split('#').map((x) => x.split('$').pop()).filter(Boolean));
  const invalid = urls.filter((u) => /iframe|player\.html|<html|解析|广告/i.test(u));
  return { lines: from.length, groups: groups.length, urls, urls_count: urls.length, pair_ok: from.length > 0 && from.length === groups.length, playable: urls.length > 0 && invalid.length === 0 };
}
async function fetchPlayableDetailJson(pathname, attempts = 5) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await fetchJson(pathname);
    const stats = lineStats(last?.data?.list?.[0]);
    if (last.status === 200 && stats.lines > 0 && stats.pair_ok && stats.playable) return last;
    if (i + 1 < attempts) await sleep(1000 * (i + 1));
  }
  return last;
}
function validateAggListPayload(data) {
  const list = Array.isArray(data?.list) ? data.list : [];
  const cls = Array.isArray(data?.class) ? data.class : [];
  const shapeOk = list.every((item) => item && item.vod_id && item.vod_name && item.type_id !== undefined && item.type_name);
  return { schema_ok: Boolean(data && Array.isArray(data.list) && Array.isArray(data.class)), content_shape_ok: shapeOk && cls.length > 0 };
}
function adultClassRecord(record) {
  const id = String(record?.type_id ?? record?.id ?? '').trim();
  const key = String(record?.key ?? '').trim().toLowerCase();
  const name = String(record?.type_name ?? record?.name ?? '');
  return id === '9' || key === 'adult' || ADULT_STRONG_TEXT_RE.test(name);
}
function adultFilterText(value) {
  const text = String(value || '').trim();
  return ['成人', '伦理', '理论', '福利', '写真', '午夜'].includes(text) || ADULT_STRONG_TEXT_RE.test(text);
}
function adultListRecord(item) {
  const normalizedCategories = ['primary_category', 'category', '_macro'].map((key) => String(item?.[key] || '').trim().toLowerCase()).filter(Boolean);
  if (normalizedCategories.includes('adult')) return true;
  if (!normalizedCategories.length && String(item?.type_id ?? '') === '9') return true;
  return ADULT_STRONG_TEXT_RE.test([
    item?.type_name,
    item?.vod_name,
    item?.vod_sub,
    item?.vod_remarks,
    item?.vod_class,
    item?.vod_state,
    item?.vod_actor,
    item?.vod_director,
    item?.vod_content,
    item?.semantic_tags,
    item?.snapshot_filter_evidence,
  ].join(' '));
}
export function payloadHasAdultExposure(data) {
  if ((Array.isArray(data?.class) ? data.class : []).some(adultClassRecord)) return true;
  for (const [categoryKey, groups] of Object.entries(data?.filters || {})) {
    if (String(categoryKey).toLowerCase() === 'adult' || String(categoryKey) === '9') return true;
    for (const group of Array.isArray(groups) ? groups : []) {
      if (adultFilterText(group?.key) || adultFilterText(group?.name)) return true;
      if ((Array.isArray(group?.value) ? group.value : []).some((option) => [option?.n, option?.v, option?.name, option?.value].some(adultFilterText))) return true;
    }
  }
  if ((Array.isArray(data?.list) ? data.list : []).some(adultListRecord)) return true;
  return (Array.isArray(data?.sites) ? data.sites : []).some((site) => ADULT_STRONG_TEXT_RE.test(String(site?.name || '')))
    || (Array.isArray(data?.lives) ? data.lives : []).some((live) => ADULT_STRONG_TEXT_RE.test(String(live?.name || '')));
}
export function configUpdateCode(data, options = {}) {
  const siteName = String(data?.sites?.[0]?.name || '');
  const api = String(data?.sites?.[0]?.api || '');
  const baseName = options.clean ? '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0' : '\u5f71\u89c6\u70b9\u64ad';
  const nameCode = siteName.match(new RegExp(`^${baseName} \u00b7 (\\d{12})$`))?.[1] || '';
  const apiCode = api.match(options.clean ? /\/agg-clean\/u(\d{12})(?:$|[/?#])/u : /\/agg\/u(\d{12})(?:$|[/?#])/u)?.[1] || '';
  return nameCode && apiCode && nameCode === apiCode ? nameCode : '';
}
export function validateConfigPayload(data, options = {}) {
  const schema_ok = Boolean(data && Array.isArray(data.sites));
  const text = JSON.stringify(data || {});
  const oneSite = data?.sites?.length === 1;
  const siteName = String(data?.sites?.[0]?.name || '');
  const api = String(data?.sites?.[0]?.api || '');
  const baseName = options.clean ? '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0' : '\u5f71\u89c6\u70b9\u64ad';
  const nameCode = siteName.match(new RegExp(`^${baseName} \u00b7 (\\d{12})$`))?.[1] || '';
  const apiCode = api.match(options.clean ? /\/agg-clean\/u(\d{12})(?:$|[/?#])/u : /\/agg\/u(\d{12})(?:$|[/?#])/u)?.[1] || '';
  const siteNameOk = Boolean(nameCode && apiCode && nameCode === apiCode);
  const forbiddenOk = !FORBIDDEN_UI_RE.test(text);
  const content_shape_ok = Boolean(oneSite && siteNameOk && forbiddenOk);
  let fix_suggestion = '';
  if (!oneSite) fix_suggestion = '\u914d\u7f6e\u5165\u53e3\u6570\u91cf\u4e0d\u7b49\u4e8e 1\u3002';
  else if (!forbiddenOk) fix_suggestion = '\u914d\u7f6e\u5305\u542b\u7981\u6b62\u6587\u6848\u3002';
  else if (!siteNameOk) fix_suggestion = '\u7ad9\u70b9\u540d\u4e0e\u7248\u672c\u5316 API \u5fc5\u987b\u663e\u793a\u540c\u4e00\u4e2a 12 \u4f4d\u5012\u5e8f\u66f4\u65b0\u7f16\u53f7\u3002';
  return { schema_ok, content_shape_ok, fix_suggestion };
}
export function parseLiveText(raw) {
  const groups = [];
  const channels = [];
  let currentGroup = '';
  for (const lineRaw of String(raw || '').split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (line.includes('#genre#')) {
      currentGroup = line.split(',')[0].trim();
      if (currentGroup) groups.push(currentGroup);
      continue;
    }
    const comma = line.indexOf(',');
    if (comma > 0) {
      const name = line.slice(0, comma).trim();
      const url = line.slice(comma + 1).trim();
      if (name && url) channels.push({ group: currentGroup || '未分组', name, url });
    }
  }
  return { groups: [...new Set(groups)], channels };
}
export function classifyRecord(record) {
  const status = Number(record.http_status || 0);
  const statusOk = record.element_type === 'playback' ? status >= 200 && status < 400 : status === 200;
  if (!statusOk) return { root_cause: ROOT_CAUSE.API_ERROR, path_cause: '', result: 'FAIL', fix_suggestion: record.element_type === 'playback' ? '播放地址非 2xx/3xx 或请求超时。' : '接口非 200 或请求超时。' };
  if (record.adult_exposure) return { root_cause: ROOT_CAUSE.SEMANTIC_MISMATCH, path_cause: '', result: 'FAIL', fix_suggestion: '洁净版暴露成人分类、筛选或内容，需在最终输出策略层过滤。' };
  if (!record.schema_ok) return { root_cause: ROOT_CAUSE.API_ERROR, path_cause: PATH_CAUSE.SCHEMA_REGRESSION, result: 'FAIL', fix_suggestion: '响应格式缺少 TVBox/FongMi 必需字段。' };
  if (!record.content_shape_ok) return { root_cause: ROOT_CAUSE.SEMANTIC_MISMATCH, path_cause: PATH_CAUSE.SCHEMA_REGRESSION, result: 'FAIL', fix_suggestion: '响应字段存在但内容结构不符合电视端预期。' };
  if (Number(record.list_count || 0) === 0 && record.expects_list !== false) {
    if (record.empty_allowed) {
      const pathCause = record.element_type === 'pagination' ? PATH_CAUSE.PAGE_BOUNDARY_EMPTY : PATH_CAUSE.COMBO_OVER_CONSTRAINED;
      return { root_cause: ROOT_CAUSE.SOURCE_COVERAGE_GAP, path_cause: pathCause, result: 'WARN', fix_suggestion: '当前路径允许为空，但必须保留诊断记录。' };
    }
    if (record.snapshot_mode === 'catalog-local-filter' || record.api_root_cause === ROOT_CAUSE.SNAPSHOT_MISS) {
      return { root_cause: ROOT_CAUSE.SNAPSHOT_MISS, path_cause: '', result: 'FAIL', fix_suggestion: '请求未命中预计算快照或快照包缺失。' };
    }
    return { root_cause: ROOT_CAUSE.FILTER_LOGIC_BUG, path_cause: '', result: 'FAIL', fix_suggestion: '可见元素返回空，需查请求参数、筛选解析、标签映射或源分类展开。' };
  }
  if (Number(record.duplicate_rate || 0) > 0.05) return { root_cause: ROOT_CAUSE.SEMANTIC_MISMATCH, path_cause: '', result: 'FAIL', fix_suggestion: '重复率超过 5%，需修去重键或排序前去重。' };
  if (Number(record.semantic_hit_rate ?? 1) < 0.6) return { root_cause: ROOT_CAUSE.SEMANTIC_MISMATCH, path_cause: '', result: 'FAIL', fix_suggestion: '返回内容与按钮语义明显不符。' };
  if (Number(record.semantic_hit_rate ?? 1) < 0.85) return { root_cause: ROOT_CAUSE.TAG_PARSE_GAP, path_cause: '', result: 'WARN', fix_suggestion: '部分内容语义证据不足，需补关键词或映射。' };
  if (Number(record.unknown_rate || 0) > 0.4) return { root_cause: ROOT_CAUSE.SOURCE_TAG_GAP, path_cause: '', result: 'WARN', fix_suggestion: '源缺少年份、地区、清晰度等结构标签。' };
  if (Number(record.detail_ok_rate ?? 1) < 0.9 || Number(record.playable_rate ?? 1) < 0.8) {
    return { root_cause: ROOT_CAUSE.PLAYBACK_FAIL, path_cause: '', result: 'FAIL', fix_suggestion: '列表正确但详情或播放线路不足。' };
  }
  return { root_cause: ROOT_CAUSE.OK, path_cause: '', result: 'PASS', fix_suggestion: '' };
}
function attachClassification(record) {
  const c = classifyRecord(record);
  return { ...record, ...c };
}
function recordBase(level, elementType, pathId, remoteSteps, requestUrl) {
  return {
    level,
    element_type: elementType,
    path_id: pathId,
    remote_steps: remoteSteps,
    request_url: requestUrl,
    http_status: 0,
    schema_ok: false,
    list_count: 0,
    total_count: 0,
    semantic_hit_rate: 1,
    content_shape_ok: false,
    changed_from_baseline: true,
    detail_ok_rate: 1,
    playable_rate: 1,
    duplicate_rate: 0,
    empty_allowed: false,
    root_cause: ROOT_CAUSE.API_ERROR,
    path_cause: '',
    fix_suggestion: '',
    result: 'FAIL',
  };
}
async function detailRates(list, clean = false) {
  const sample = list.slice(0, DETAIL_SAMPLE).filter((x) => x.vod_id);
  if (!sample.length) return { detail_ok_rate: 0, playable_rate: 0, detail_examples: [], playable_urls: [] };
  const rows = [];
  const playableUrls = [];
  for (const item of sample) {
    const got = await fetchPlayableDetailJson(`${aggregateBase(clean)}?ac=detail&ids=${encodeURIComponent(item.vod_id)}`);
    const vod = got.data?.list?.[0];
    const stats = lineStats(vod);
    playableUrls.push(...stats.urls.slice(0, PLAY_SAMPLE));
    rows.push({ name: item.vod_name, status: got.status, ok: got.status === 200 && stats.lines > 0 && stats.pair_ok, lines: stats.lines, groups: stats.groups, urls: stats.urls_count, playable: stats.playable });
  }
  return {
    detail_ok_rate: rows.filter((x) => x.ok).length / rows.length,
    playable_rate: rows.filter((x) => x.playable).length / rows.length,
    detail_examples: rows,
    playable_urls: playableUrls.slice(0, PLAY_SAMPLE),
  };
}
async function probePlayableUrl(url) {
  if (!url || /iframe|player\.html|<html|解析|广告/i.test(url)) return { url, ok: false, reason: 'invalid-url-pattern' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAY_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { range: 'bytes=0-2047', accept: '*/*', 'user-agent': 'TVBoxFullRemoteAudit/7.3' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text().catch(() => '');
    const ct = res.headers.get('content-type') || '';
    const isM3u8 = /\.m3u8(\?|$)/i.test(url) || /mpegurl|m3u8/i.test(ct);
    const ok = res.status >= 200 && res.status < 400 && (isM3u8 ? body.includes('#EXTM3U') : (/video|octet-stream/i.test(ct) || /\.(mp4|mkv|flv|ts)(\?|$)/i.test(url)));
    return { url, status: res.status, content_type: ct, ok, m3u8: isM3u8, first_bytes: body.slice(0, 40).replace(/\s+/g, ' ') };
  } catch (err) {
    return { url, status: 0, ok: false, reason: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
async function auditConfig(records, { clean = false } = {}) {
  const pathUrl = clean ? '/config-clean.json' : '/config.json';
  const got = await fetchJson(pathUrl);
  const validation = validateConfigPayload(got.data, { clean });
  const rec = recordBase('L0', 'config', clean ? 'config.clean.import' : 'config.import', [clean ? '导入影视点播洁净配置' : '导入影视点播配置'], fullUrl(pathUrl));
  const adultExposure = clean && payloadHasAdultExposure(got.data);
  records.push(attachClassification({
    ...rec,
    http_status: got.status,
    schema_ok: validation.schema_ok,
    content_shape_ok: validation.content_shape_ok,
    list_count: got.data?.sites?.length || 0,
    total_count: got.data?.sites?.length || 0,
    expects_list: false,
    scope: clean ? 'clean' : 'full',
    adult_exposure: adultExposure,
    update_code: configUpdateCode(got.data, { clean }),
    fix_suggestion: validation.fix_suggestion,
    sites: got.data?.sites || [],
    lives: got.data?.lives || [],
  }));
  return got.data || {};
}
async function auditDualVersionRevision(records, fullConfig, cleanConfig) {
  const fullCode = configUpdateCode(fullConfig, { clean: false });
  const cleanCode = configUpdateCode(cleanConfig, { clean: true });
  const [fullAgg, cleanAgg] = await Promise.all([
    fetchJson(`${aggregateBase(false)}?limit=1`),
    fetchJson(`${aggregateBase(true)}?limit=1`),
  ]);
  const fullRevision = String(fullAgg.data?.content_revision || fullAgg.data?.revision || '').trim();
  const cleanRevision = String(cleanAgg.data?.content_revision || cleanAgg.data?.revision || '').trim();
  const codeMatch = Boolean(fullCode && cleanCode && fullCode === cleanCode);
  const revisionMatch = Boolean(fullRevision && cleanRevision && fullRevision === cleanRevision);
  const cleanPolicyOk = cleanAgg.data?.content_policy === 'clean-no-adult';
  records.push(attachClassification({
    ...recordBase('L1', 'dual_version_revision', 'dual-version.revision', ['导入全量版', '导入洁净版', '比较更新时间码与内容 revision'], `${BASE}/config.json + ${BASE}/config-clean.json`),
    http_status: fullAgg.status === 200 && cleanAgg.status === 200 ? 200 : 0,
    schema_ok: Boolean(fullCode && cleanCode && fullRevision && cleanRevision),
    content_shape_ok: codeMatch && revisionMatch && cleanPolicyOk,
    list_count: 2,
    total_count: 2,
    expects_list: false,
    full_update_code: fullCode,
    clean_update_code: cleanCode,
    full_revision: fullRevision,
    clean_revision: cleanRevision,
    update_code_match: codeMatch,
    content_revision_match: revisionMatch,
    content_policy_ok: cleanPolicyOk,
    adult_exposure: payloadHasAdultExposure(cleanAgg.data),
  }));
}
async function auditOps(records) {
  for (const op of ['status', 'snapshot', 'mirrors', 'sources']) {
    const pathUrl = `/${op}.json`;
    const got = await fetchPlayableDetailJson(pathUrl);
    const rec = recordBase('L12', 'ops', `ops.${op}`, ['导入配置', `检查运维端点 ${op}`], fullUrl(pathUrl));
    records.push(attachClassification({
      ...rec,
      http_status: got.status,
      schema_ok: Boolean(got.data && typeof got.data === 'object'),
      content_shape_ok: got.data?.ok !== false,
      expects_list: false,
    }));
  }
}
async function auditLive(records) {
  const pathUrl = '/live.txt';
  const got = await fetchText(pathUrl);
  const parsed = parseLiveText(got.text);
  const rec = recordBase('L1', 'live_entry', 'live.entry', ['导入配置', '进入精选直播'], fullUrl(pathUrl));
  const probes = [];
  for (const channel of parsed.channels.slice(0, PLAY_SAMPLE)) probes.push(await probePlayableUrl(channel.url));
  records.push(attachClassification({
    ...rec,
    http_status: got.status,
    schema_ok: got.status === 200 && typeof got.text === 'string',
    content_shape_ok: parsed.groups.length > 0 && parsed.channels.length > 0,
    list_count: parsed.channels.length,
    total_count: parsed.channels.length,
    playable_rate: probes.length ? probes.filter((p) => p.ok).length / probes.length : 1,
    live_groups: parsed.groups,
    live_probe_examples: probes,
  }));
}
function filtersForCategory(data, t) {
  return data?.filters?.[String(t)] || data?.class?.find((c) => String(c.type_id) === String(t))?.filters || [];
}
async function auditListPath({ records, level, elementType, pathId, steps, pathUrl, filter = null, emptyAllowed = false, expectsDetail = true, baselineIds = null, clean = false }) {
  const got = await fetchJson(pathUrl);
  const list = Array.isArray(got.data?.list) ? got.data.list : [];
  const shape = validateAggListPayload(got.data);
  const sem = filter?.combo ? comboSemanticStats(filter.combo, list) : semanticStats(filter, list);
  const detail = expectsDetail && list.length ? await detailRates(list, clean) : { detail_ok_rate: 1, playable_rate: 1, detail_examples: [], playable_urls: [] };
  const ids = list.map((x) => String(x.vod_id || '')).filter(Boolean);
  const changed = baselineIds ? ids.slice(0, Math.min(ids.length, baselineIds.length)).join('|') !== baselineIds.slice(0, Math.min(ids.length, baselineIds.length)).join('|') : true;
  const adultExposure = clean && payloadHasAdultExposure(got.data);
  const contentPolicyOk = !clean || got.data?.content_policy === 'clean-no-adult';
  records.push(attachClassification({
    ...recordBase(level, elementType, pathId, steps, fullUrl(pathUrl)),
    http_status: got.status,
    schema_ok: shape.schema_ok,
    content_shape_ok: shape.content_shape_ok && contentPolicyOk,
    list_count: list.length,
    total_count: Number(got.data?.total || 0),
    page: Number(got.data?.page || 0),
    pagecount: Number(got.data?.pagecount || 0),
    snapshot_mode: got.data?.snapshot_mode || '',
    api_root_cause: got.data?.root_cause || '',
    semantic_hit_rate: round(sem.semanticHitRate),
    unknown_rate: round(sem.unknownRate),
    duplicate_rate: round(duplicateRate(list)),
    changed_from_baseline: changed,
    detail_ok_rate: round(detail.detail_ok_rate),
    playable_rate: round(detail.playable_rate),
    empty_allowed: emptyAllowed,
    scope: clean ? 'clean' : 'full',
    content_policy: got.data?.content_policy || '',
    content_policy_ok: contentPolicyOk,
    content_revision: got.data?.content_revision || got.data?.revision || '',
    adult_exposure: adultExposure,
    examples: sem.examples || [],
    detail_examples: detail.detail_examples,
  }));
  return { got, list, ids, filters: filtersForCategory(got.data, pathUrl.match(/[?&]t=([^&]+)/)?.[1] || '') };
}
function visibleOptions(group) {
  return (group?.value || []).filter((option) => filterValue(option?.v));
}
function groupByKey(filters, key) {
  return (filters || []).find((g) => g.key === key);
}
function firstOption(filters, keys) {
  for (const key of keys) {
    const group = groupByKey(filters, key);
    const opt = visibleOptions(group)[0];
    if (opt) return { key, group, option: opt };
  }
  return null;
}
function buildCombos(filters) {
  const out = [];
  const year = firstOption(filters, ['year']);
  const cls = firstOption(filters, ['class', 'topic']);
  const area = firstOption(filters, ['area']);
  const form = firstOption(filters, ['form']);
  const quality = firstOption(filters, ['quality']);
  if (year) out.push({ name: `排序+年份:${year.option.n}`, filter: { sort: 'quality', [year.key]: year.option.v }, emptyAllowed: false });
  if (year && cls) out.push({ name: `年份+类型:${year.option.n}+${cls.option.n}`, filter: { [year.key]: year.option.v, [cls.key]: cls.option.v }, emptyAllowed: true });
  if (area && cls) out.push({ name: `地区+类型:${area.option.n}+${cls.option.n}`, filter: { [area.key]: area.option.v, [cls.key]: cls.option.v }, emptyAllowed: true });
  if (form && quality) out.push({ name: `内容形态+清晰度:${form.option.n}+${quality.option.n}`, filter: { [form.key]: form.option.v, [quality.key]: quality.option.v }, emptyAllowed: true });
  return out;
}
async function auditVod(records, { clean = false } = {}) {
  const categoryContexts = [];
  const categoryIds = clean ? CLEAN_CATEGORY_IDS : FULL_CATEGORY_IDS;
  const pathScope = clean ? 'vod.clean' : 'vod';
  const entryName = clean ? '影视点播洁净' : '影视点播';
  for (const t of categoryIds) {
    const basePath = policyRequestPath(t, 1, null, LIMIT, clean);
    const base = await auditListPath({
      records,
      level: 'L3',
      elementType: 'category',
      pathId: `${pathScope}.category.${t}`,
      steps: ['导入配置', `进入${entryName}`, `选择分类 ${t}`],
      pathUrl: basePath,
      expectsDetail: true,
      clean,
    });
    const classRow = base.got.data?.class?.find((c) => String(c.type_id) === String(t)) || { type_id: t, type_name: String(t) };
    const filters = filtersForCategory(base.got.data, t);
    categoryContexts.push({ t, classRow, filters, baselineIds: base.ids, total: Number(base.got.data?.total || 0), pagecount: Number(base.got.data?.pagecount || 0), clean });

    for (const group of filters) {
      const options = visibleOptions(group);
      const rec = recordBase('L4', 'filter_group', `${pathScope}.category.${t}.filter_group.${group.key}`, ['导入配置', `进入${entryName}`, `选择 ${classRow.type_name}`, `打开筛选组 ${group.name || group.key}`], fullUrl(basePath));
      records.push(attachClassification({
        ...rec,
        http_status: 200,
        schema_ok: Boolean(group.key && Array.isArray(group.value)),
        content_shape_ok: options.length >= 1 && !(options.length === 1 && !filterValue(options[0].v)),
        list_count: options.length,
        total_count: options.length,
        expects_list: false,
        scope: clean ? 'clean' : 'full',
        adult_exposure: clean && payloadHasAdultExposure({ filters: { [t]: [group] } }),
      }));
      for (const option of options) {
        await auditListPath({
          records,
          level: 'L5',
          elementType: 'single_filter',
          pathId: `${pathScope}.category.${t}.filter.${group.key}.${filterValue(option.v)}`,
          steps: ['导入配置', `进入${entryName}`, `选择 ${classRow.type_name}`, `打开筛选组 ${group.name || group.key}`, `${option.n || option.v}`],
          pathUrl: policyRequestPath(t, 1, { [group.key]: option.v }, LIMIT, clean),
          filter: { key: group.key, value: option.v },
          emptyAllowed: false,
          expectsDetail: true,
          baselineIds: base.ids,
          clean,
        });
      }
    }

    for (const combo of buildCombos(filters)) {
      await auditListPath({
        records,
        level: 'L6',
        elementType: 'combo_filter',
        pathId: `${pathScope}.category.${t}.combo.${combo.name}`,
        steps: ['导入配置', `进入${entryName}`, `选择 ${classRow.type_name}`, '组合筛选', combo.name],
        pathUrl: policyRequestPath(t, 1, combo.filter, LIMIT, clean),
        filter: { combo: combo.filter },
        emptyAllowed: combo.emptyAllowed,
        expectsDetail: true,
        baselineIds: base.ids,
        clean,
      });
    }

    if (base.total > LIMIT) {
      const page2 = await auditListPath({
        records,
        level: 'L7',
        elementType: 'pagination',
        pathId: `${pathScope}.category.${t}.page.2`,
        steps: ['导入配置', `进入${entryName}`, `选择 ${classRow.type_name}`, '下一页'],
        pathUrl: policyRequestPath(t, 2, null, LIMIT, clean),
        emptyAllowed: false,
        expectsDetail: false,
        baselineIds: base.ids,
        clean,
      });
      const sameAsPage1 = page2.ids.join('|') === base.ids.join('|');
      if (sameAsPage1) {
        const last = records[records.length - 1];
        last.root_cause = ROOT_CAUSE.SEMANTIC_MISMATCH;
        last.result = 'FAIL';
        last.fix_suggestion = 'pg=2 与 pg=1 完全重复，分页没有产生预期变化。';
      }
      await auditListPath({
        records,
        level: 'L7',
        elementType: 'pagination',
        pathId: `${pathScope}.category.${t}.page.boundary`,
        steps: ['导入配置', `进入${entryName}`, `选择 ${classRow.type_name}`, '跳到末页边界'],
        pathUrl: policyRequestPath(t, Math.max(1, base.pagecount + 1), null, LIMIT, clean),
        emptyAllowed: true,
        expectsDetail: false,
        clean,
      });
    }
  }
  return categoryContexts;
}
async function auditCleanVod(records) {
  return auditVod(records, { clean: true });
}
async function auditSearch(records, { clean = false } = {}) {
  const pathScope = clean ? 'vod.clean' : 'vod';
  const entryName = clean ? '影视点播洁净' : '影视点播';
  for (const term of SEARCH_TERMS) {
    const pathUrl = `${aggregateBase(clean)}?wd=${encodeURIComponent(term)}&limit=${LIMIT}`;
    const got = await fetchJsonRetry(pathUrl);
    const list = Array.isArray(got.data?.list) ? got.data.list : [];
    const shape = validateAggListPayload(got.data);
    let hits = 0;
    const examples = [];
    for (const item of list) {
      const ok = searchTermMatches(item, term);
      if (ok) hits++;
      else if (examples.length < 3) examples.push({ name: item.vod_name, type: item.type_name, remarks: item.vod_remarks });
    }
    const detail = list.length ? await detailRates(list, clean) : { detail_ok_rate: 1, playable_rate: 1, detail_examples: [] };
    const adultExposure = clean && payloadHasAdultExposure(got.data);
    const contentPolicyOk = !clean || got.data?.content_policy === 'clean-no-adult';
    records.push(attachClassification({
      ...recordBase('L8', 'search', `${pathScope}.search.${term}`, ['导入配置', `进入${entryName}`, '打开搜索', `输入 ${term}`], fullUrl(pathUrl)),
      http_status: got.status,
      schema_ok: shape.schema_ok,
      content_shape_ok: shape.content_shape_ok && contentPolicyOk,
      list_count: list.length,
      total_count: Number(got.data?.total || 0),
      semantic_hit_rate: list.length ? round(hits / list.length) : 0,
      duplicate_rate: round(duplicateRate(list)),
      detail_ok_rate: round(detail.detail_ok_rate),
      playable_rate: round(detail.playable_rate),
      empty_allowed: !REQUIRED_SEARCH_TERMS.has(term),
      scope: clean ? 'clean' : 'full',
      content_policy: got.data?.content_policy || '',
      content_policy_ok: contentPolicyOk,
      content_revision: got.data?.content_revision || got.data?.revision || '',
      adult_exposure: adultExposure,
      examples,
      detail_examples: detail.detail_examples,
    }));
  }
}
async function auditCleanPolicySearch(records) {
  for (const term of CLEAN_POLICY_PROBE_TERMS) {
    const pathUrl = `${aggregateBase(true)}?wd=${encodeURIComponent(term)}&limit=${LIMIT}`;
    const got = await fetchJson(pathUrl);
    const list = Array.isArray(got.data?.list) ? got.data.list : [];
    const shape = validateAggListPayload(got.data);
    const adultExposure = payloadHasAdultExposure(got.data);
    const contentPolicyOk = got.data?.content_policy === 'clean-no-adult';
    records.push(attachClassification({
      ...recordBase('L8', 'clean_search_policy', `vod.clean.search.policy.${term}`, ['导入配置', '进入影视点播洁净', '打开搜索', `输入敏感策略探针 ${term}`], fullUrl(pathUrl)),
      http_status: got.status,
      schema_ok: shape.schema_ok,
      content_shape_ok: shape.content_shape_ok && contentPolicyOk,
      list_count: list.length,
      total_count: Number(got.data?.total || 0),
      expects_list: false,
      scope: 'clean',
      content_policy: got.data?.content_policy || '',
      content_policy_ok: contentPolicyOk,
      content_revision: got.data?.content_revision || got.data?.revision || '',
      adult_exposure: adultExposure,
      duplicate_rate: round(duplicateRate(list)),
      clean_probe_term: term,
    }));
  }
}
async function auditDetailsAndPlayback(records, categoryContexts, { clean = false } = {}) {
  const sampleItems = [];
  for (const ctx of categoryContexts.slice(0, 10)) {
    const got = await fetchJson(policyRequestPath(ctx.t, 1, null, Math.min(5, LIMIT), clean));
    sampleItems.push(...(got.data?.list || []).slice(0, 2));
  }
  const unique = [];
  const seen = new Set();
  for (const item of sampleItems) {
    if (!item?.vod_id || seen.has(item.vod_id)) continue;
    seen.add(item.vod_id);
    unique.push(item);
    if (unique.length >= DETAIL_SAMPLE * 2) break;
  }
  for (const item of unique) {
    const pathUrl = `${aggregateBase(clean)}?ac=detail&ids=${encodeURIComponent(item.vod_id)}`;
    const got = await fetchJsonRetry(pathUrl);
    const vod = got.data?.list?.[0];
    const stats = lineStats(vod);
    const adultExposure = clean && payloadHasAdultExposure(got.data);
    const contentPolicyOk = !clean || got.data?.content_policy === 'clean-no-adult';
    const pathScope = clean ? 'vod.clean' : 'vod';
    const entryName = clean ? '影视点播洁净' : '影视点播';
    const detailRecord = attachClassification({
      ...recordBase('L9', 'detail', `${pathScope}.detail.${item.vod_id}`, ['导入配置', `进入${entryName}`, `打开详情 ${item.vod_name}`], fullUrl(pathUrl)),
      http_status: got.status,
      schema_ok: Boolean(got.data && Array.isArray(got.data.list)),
      content_shape_ok: Boolean(vod && vod.vod_name && stats.lines > 0 && stats.pair_ok && contentPolicyOk),
      list_count: got.data?.list?.length || 0,
      total_count: got.data?.list?.length || 0,
      expects_list: true,
      detail_ok_rate: stats.lines > 0 && stats.pair_ok ? 1 : 0,
      playable_rate: stats.playable ? 1 : 0,
      scope: clean ? 'clean' : 'full',
      content_policy: got.data?.content_policy || '',
      content_policy_ok: contentPolicyOk,
      content_revision: got.data?.content_revision || got.data?.revision || '',
      adult_exposure: adultExposure,
      detail_examples: [{ name: vod?.vod_name || item.vod_name, lines: stats.lines, groups: stats.groups, urls: stats.urls_count, pair_ok: stats.pair_ok }],
    });
    records.push(detailRecord);
    for (const url of stats.urls.slice(0, PLAY_SAMPLE)) {
      const probe = await probePlayableUrl(url);
      records.push(attachClassification({
        ...recordBase('L10', 'playback', `${pathScope}.playback.${item.vod_id}.${records.length}`, ['导入配置', `进入${entryName}`, `打开详情 ${item.vod_name}`, '选择播放线路'], url),
        http_status: probe.status || (probe.ok ? 200 : 0),
        schema_ok: !/iframe|player\.html|<html|解析|广告/i.test(url),
        content_shape_ok: probe.ok,
        list_count: 1,
        total_count: 1,
        expects_list: false,
        playable_rate: probe.ok ? 1 : 0,
        scope: clean ? 'clean' : 'full',
        playback_probe: probe,
      }));
    }
  }
}
async function auditStability(records, { clean = false } = {}) {
  const prefix = aggregateBase(clean);
  const pathScope = clean ? 'stability.clean' : 'stability';
  const paths = [
    [clean ? '/config-clean.json' : '/config.json', `${pathScope}.config`],
    [policyRequestPath('10', 1, null, LIMIT, clean), `${pathScope}.cinema.category`],
    [policyRequestPath('10', 1, { year: '2026' }, LIMIT, clean), `${pathScope}.cinema.year.2026`],
    [`${prefix}?wd=${encodeURIComponent('解说')}&limit=${LIMIT}`, `${pathScope}.search.explainer`],
  ];
  for (const [pathUrl, id] of paths) {
    const a = await fetchJson(pathUrl);
    const b = await fetchJson(pathUrl);
    const aList = Array.isArray(a.data?.list) ? a.data.list : [];
    const bList = Array.isArray(b.data?.list) ? b.data.list : [];
    const isConfig = pathUrl === '/config.json' || pathUrl === '/config-clean.json';
    const aEmpty = isConfig ? false : aList.length === 0;
    const bEmpty = isConfig ? false : bList.length === 0;
    const stable = a.status === b.status && aEmpty === bEmpty;
    const adultExposure = clean && (payloadHasAdultExposure(a.data) || payloadHasAdultExposure(b.data));
    records.push(attachClassification({
      ...recordBase('L11', 'stability', id, ['导入配置', '返回上一级', '重新进入', '重复同一路径请求'], fullUrl(pathUrl)),
      http_status: a.status === b.status ? a.status : 0,
      schema_ok: stable,
      content_shape_ok: stable,
      list_count: Math.max(aList.length, bList.length, 1),
      total_count: Math.max(Number(a.data?.total || 0), Number(b.data?.total || 0), 1),
      expects_list: false,
      scope: clean ? 'clean' : 'full',
      adult_exposure: adultExposure,
      first_status: a.status,
      second_status: b.status,
      first_count: aList.length,
      second_count: bList.length,
      path_cause: stable ? '' : PATH_CAUSE.CACHE_STALE,
    }));
  }
}
function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function summarize(report) {
  const records = report.records;
  const byResult = {};
  const byRootCause = {};
  const byPathCause = {};
  for (const r of records) {
    byResult[r.result] = (byResult[r.result] || 0) + 1;
    byRootCause[r.root_cause] = (byRootCause[r.root_cause] || 0) + 1;
    if (r.path_cause) byPathCause[r.path_cause] = (byPathCause[r.path_cause] || 0) + 1;
  }
  const rates = (field) => records.map((r) => Number(r[field])).filter((x) => Number.isFinite(x));
  const min = (field, fallback = 1) => rates(field).length ? Math.min(...rates(field)) : fallback;
  const max = (field, fallback = 0) => rates(field).length ? Math.max(...rates(field)) : fallback;
  const avg = (field, fallback = 1) => {
    const xs = rates(field);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
  };
  const semanticRates = records
    .filter((r) => !(r.empty_allowed && Number(r.list_count || 0) === 0))
    .map((r) => Number(r.semantic_hit_rate))
    .filter((x) => Number.isFinite(x));
  return {
    visible_element_count: records.length,
    pass: byResult.PASS || 0,
    warn: byResult.WARN || 0,
    fail: byResult.FAIL || 0,
    category_fail: records.filter((r) => r.element_type === 'category' && r.result === 'FAIL').length,
    full_category_fail: records.filter((r) => r.element_type === 'category' && r.scope === 'full' && r.result === 'FAIL').length,
    clean_category_fail: records.filter((r) => r.element_type === 'category' && r.scope === 'clean' && r.result === 'FAIL').length,
    single_filter_fail: records.filter((r) => r.element_type === 'single_filter' && r.result === 'FAIL').length,
    clean_search_fail: records.filter((r) => ['search', 'clean_search_policy'].includes(r.element_type) && r.scope === 'clean' && r.result === 'FAIL').length,
    adult_exposure_fail: records.filter((r) => r.adult_exposure === true).length,
    revision_mismatch: records.filter((r) => r.element_type === 'dual_version_revision' && r.result === 'FAIL').length,
    schema_regression: records.filter((r) => r.path_cause === PATH_CAUSE.SCHEMA_REGRESSION).length,
    api_error: records.filter((r) => r.root_cause === ROOT_CAUSE.API_ERROR).length,
    snapshot_miss: records.filter((r) => r.root_cause === ROOT_CAUSE.SNAPSHOT_MISS).length,
    filter_logic_bug: records.filter((r) => r.root_cause === ROOT_CAUSE.FILTER_LOGIC_BUG).length,
    min_semantic_hit_rate: round(semanticRates.length ? Math.min(...semanticRates) : min('semantic_hit_rate')),
    max_duplicate_rate: round(max('duplicate_rate')),
    avg_detail_ok_rate: round(avg('detail_ok_rate')),
    avg_playable_rate: round(avg('playable_rate')),
    byRootCause,
    byPathCause,
  };
}
async function writeReports(report) {
  await mkdir(AUDIT_DIR, { recursive: true });
  await writeFile(path.join(AUDIT_DIR, 'tv-remote-full-latest.json'), JSON.stringify(report, null, 2), 'utf8');
  const failures = report.records.filter((r) => r.result !== 'PASS');
  const csvHeaders = ['result', 'root_cause', 'path_cause', 'level', 'element_type', 'path_id', 'http_status', 'list_count', 'semantic_hit_rate', 'duplicate_rate', 'detail_ok_rate', 'playable_rate', 'request_url', 'fix_suggestion'];
  const csv = [csvHeaders.join(','), ...failures.map((r) => csvHeaders.map((h) => csvEscape(r[h])).join(','))].join('\n') + '\n';
  await writeFile(path.join(AUDIT_DIR, 'tv-remote-full-failures.csv'), csv, 'utf8');
  const md = [
    '# TVBox/FongMi/影视仓 v7.3 遥控器全量元素语义审计',
    '',
    `- 基准入口：${report.base}`,
    `- 生成时间：${report.generatedAt}`,
    `- 可见元素路径数：${report.summary.visible_element_count}`,
    `- PASS/WARN/FAIL：${report.summary.pass}/${report.summary.warn}/${report.summary.fail}`,
    `- 根因分布：${Object.entries(report.summary.byRootCause).map(([k, v]) => `${k}=${v}`).join('，') || '无'}`,
    `- 路径归因：${Object.entries(report.summary.byPathCause).map(([k, v]) => `${k}=${v}`).join('，') || '无'}`,
    '',
    '## 验收指标',
    '',
    `- category_fail=${report.summary.category_fail}`,
    `- full_category_fail=${report.summary.full_category_fail}`,
    `- clean_category_fail=${report.summary.clean_category_fail}`,
    `- single_filter_fail=${report.summary.single_filter_fail}`,
    `- clean_search_fail=${report.summary.clean_search_fail}`,
    `- adult_exposure_fail=${report.summary.adult_exposure_fail}`,
    `- revision_mismatch=${report.summary.revision_mismatch}`,
    `- schema_regression=${report.summary.schema_regression}`,
    `- api_error=${report.summary.api_error}`,
    `- snapshot_miss=${report.summary.snapshot_miss}`,
    `- filter_logic_bug=${report.summary.filter_logic_bug}`,
    `- min_semantic_hit_rate=${report.summary.min_semantic_hit_rate}`,
    `- max_duplicate_rate=${report.summary.max_duplicate_rate}`,
    `- avg_detail_ok_rate=${report.summary.avg_detail_ok_rate}`,
    `- avg_playable_rate=${report.summary.avg_playable_rate}`,
    '',
    '## 需要电视端人工复核的路径',
    '',
    ...(failures.length ? failures.slice(0, 50).map((r) => `- ${r.result} / ${r.root_cause}${r.path_cause ? ` / ${r.path_cause}` : ''}：${r.path_id}；${r.fix_suggestion || '见 JSON 明细'}；${r.request_url}`) : ['- 无']),
    '',
    '## 判定说明',
    '',
    '- 单筛选项空结果默认判为需要修复；组合筛选空结果先归因为条件过窄并保留诊断。',
    '- 如果电视端空而脚本不空，优先按 APP_REQUEST_VARIANT 或 CACHE_STALE 追踪实际请求与缓存。',
  ].join('\n');
  await writeFile(path.join(AUDIT_DIR, 'tv-remote-full-summary.md'), md + '\n', 'utf8');
}
export async function runFullRemoteAudit() {
  const report = { base: BASE, generatedAt: new Date().toISOString(), limit: LIMIT, detailSample: DETAIL_SAMPLE, playSample: PLAY_SAMPLE, records: [], summary: {} };
  const config = await auditConfig(report.records, { clean: false });
  const cleanConfig = await auditConfig(report.records, { clean: true });
  await auditDualVersionRevision(report.records, config, cleanConfig);
  await auditLive(report.records, config);
  await auditOps(report.records);
  const categoryContexts = await auditVod(report.records);
  const cleanCategoryContexts = await auditCleanVod(report.records);
  await auditSearch(report.records);
  await auditSearch(report.records, { clean: true });
  await auditCleanPolicySearch(report.records);
  await auditDetailsAndPlayback(report.records, categoryContexts);
  await auditDetailsAndPlayback(report.records, cleanCategoryContexts, { clean: true });
  await auditStability(report.records);
  await auditStability(report.records, { clean: true });
  report.summary = summarize(report);
  await writeReports(report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFullRemoteAudit().then((report) => {
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.summary.api_error || report.summary.schema_regression || report.summary.snapshot_miss || report.summary.filter_logic_bug || report.summary.category_fail || report.summary.single_filter_fail || report.summary.clean_search_fail || report.summary.adult_exposure_fail || report.summary.revision_mismatch) process.exit(1);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
