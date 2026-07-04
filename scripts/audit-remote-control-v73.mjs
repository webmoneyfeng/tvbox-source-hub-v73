import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.AUDIT_LIMIT || 24);
const DETAIL_SAMPLE = Number(process.env.AUDIT_DETAIL_SAMPLE || 1);
const TIMEOUT = Number(process.env.AUDIT_TIMEOUT_MS || 25000);
const CATEGORIES = Array.from({ length: 10 }, (_, i) => String(i));

const ROOT_CAUSE = {
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
const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

function fullUrl(pathname) {
  return BASE + pathname;
}
async function fetchJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(fullUrl(pathname), { headers: { accept: 'application/json,*/*', 'user-agent': 'TVBoxRemoteSemanticAudit/7.3' }, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { status: res.status, data, text };
  } catch (err) {
    return { status: 0, data: { error: String(err && err.message || err) }, text: '' };
  } finally {
    clearTimeout(timer);
  }
}
function filterValue(value) {
  return String(value || '').trim();
}
function requestPath(t, pg = 1, filter = null) {
  const base = `/agg?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}&limit=${LIMIT}`;
  return filter ? base + '&f=' + encodeURIComponent(JSON.stringify(filter)) : base;
}
function textOf(item) {
  return [item?.type_name, item?.vod_name, item?.vod_sub, item?.vod_remarks, item?.vod_area, item?.vod_lang, item?.vod_year, item?.vod_content, item?.vod_play_from, item?.semantic_tags, item?.snapshot_filter_evidence].join(' ');
}
function normalizeTitle(value) {
  return String(value || '')
    .replace(/[\[\u3010(（].*?[\]\u3011)）]/g, '')
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/[\s·.。,，:：;；!！?？_\-—|]+/g, '')
    .trim()
    .toLowerCase();
}
function compareDisplayName(a, b) {
  return NAME_COLLATOR.compare(String(a || ''), String(b || ''));
}
function extractYear(item) {
  const m = textOf(item).match(/(?:19|20)\d{2}/);
  return m ? m[0] : '';
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
function sortScore(key, value, list) {
  const v = filterValue(value);
  if (key !== 'sort' || list.length < 2) return { semanticHitRate: 1, unknownRate: 0, examples: [] };
  let ordered = 0;
  for (let i = 1; i < list.length; i++) {
    if (v === 'name') ordered += compareDisplayName(list[i - 1].vod_name, list[i].vod_name) <= 0 ? 1 : 0;
    else if (v === 'quality') ordered += qualityRank(list[i - 1]) >= qualityRank(list[i]) ? 1 : 0;
    else if (v === 'lines') ordered += lineCount(list[i - 1]) >= lineCount(list[i]) ? 1 : 0;
    else ordered += Number(extractYear(list[i - 1]) || 0) >= Number(extractYear(list[i]) || 0) ? 1 : 0;
  }
  return { semanticHitRate: ordered / (list.length - 1), unknownRate: 0, examples: [] };
}
function lineCount(item) {
  return Number(String(item?.vod_remarks || '').match(/(\d+)\s*线/)?.[1] || 0);
}
function duplicateRate(list) {
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
  const urls = String(vod?.vod_play_url || '').split('$$$').flatMap((g) => g.split('#').map((x) => x.split('$').pop()).filter(Boolean));
  const invalid = urls.filter((u) => /iframe|player\.html|<html|解析|广告/i.test(u));
  return { lines: from.length, urls: urls.length, playable: urls.length > 0 && invalid.length === 0 };
}
async function detailRates(list) {
  if (DETAIL_SAMPLE <= 0) return { detailOkRate: 1, playableRate: 1, detail: [] };
  const sample = list.slice(0, DETAIL_SAMPLE).filter((x) => x.vod_id);
  if (!sample.length) return { detailOkRate: 0, playableRate: 0, detail: [] };
  const rows = [];
  for (const item of sample) {
    const got = await fetchJson(`/agg?ac=detail&ids=${encodeURIComponent(item.vod_id)}`);
    const vod = got.data?.list?.[0];
    const stats = lineStats(vod);
    rows.push({ name: item.vod_name, status: got.status, ok: got.status === 200 && stats.lines > 0, ...stats });
  }
  return {
    detailOkRate: rows.filter((x) => x.ok).length / rows.length,
    playableRate: rows.filter((x) => x.playable).length / rows.length,
    detail: rows,
  };
}
function semanticStats(key, value, list) {
  if (key === 'sort') return sortScore(key, value, list);
  if (!list.length) return { semanticHitRate: 0, unknownRate: 0, examples: [] };
  let hit = 0, unknown = 0;
  const examples = [];
  for (const item of list) {
    const r = assertItem(key, value, item);
    if (r.hit) hit++;
    if (r.unknown) unknown++;
    if (!r.hit && examples.length < 3) examples.push({ name: item.vod_name, type: item.type_name, year: item.vod_year, remarks: item.vod_remarks });
  }
  return { semanticHitRate: hit / list.length, unknownRate: unknown / list.length, examples };
}
function classify(record, categoryVisible) {
  if (record.http_status !== 200) return [ROOT_CAUSE.API_ERROR, '接口异常或 Worker 资源超限，先修接口性能/快照命中。'];
  if (record.list_count === 0) {
    if (record.snapshot_mode === 'catalog-local-filter' || record.api_root_cause === ROOT_CAUSE.SNAPSHOT_MISS) return [ROOT_CAUSE.SNAPSHOT_MISS, '筛选按钮未命中专用快照包，应生成或修复 filter-packs。'];
    if (categoryVisible) return [ROOT_CAUSE.FILTER_LOGIC_BUG, '按钮在电视端可见但请求为空，检查筛选参数解析、标签映射和源分类展开。'];
    return [ROOT_CAUSE.SOURCE_COVERAGE_GAP, '当前源未覆盖该按钮语义内容，规则保留但不应暴露空按钮。'];
  }
  if (record.semantic_hit_rate < 0.6) return [ROOT_CAUSE.SEMANTIC_MISMATCH, '返回内容与按钮语义明显不符，修分类/映射/去重。'];
  if (record.semantic_hit_rate < 0.85) return [ROOT_CAUSE.TAG_PARSE_GAP, '部分内容语义证据不足，补关键词、标题/备注解析或分类映射。'];
  if (record.unknown_rate > 0.4) return [ROOT_CAUSE.SOURCE_TAG_GAP, '源缺少年份/地区/清晰度等结构标签，尽量用标题和备注推断。'];
  if (record.detail_ok_rate < 0.9 || record.playable_rate < 0.8) return [ROOT_CAUSE.PLAYBACK_FAIL, '列表语义正确但详情/播放线路不足，检查播放线路过滤。'];
  return [ROOT_CAUSE.OK, '按钮返回符合当前语义标准。'];
}
async function auditButton(category, filterGroup, option, categoryVisible) {
  const key = filterGroup.key;
  const value = option.v;
  const path = requestPath(category.type_id, 1, { [key]: value });
  const got = await fetchJson(path);
  const list = Array.isArray(got.data?.list) ? got.data.list : [];
  const sem = semanticStats(key, value, list);
  const detail = got.status === 200 && list.length ? await detailRates(list) : { detailOkRate: 0, playableRate: 0, detail: [] };
  const record = {
    category: category.type_name,
    category_id: String(category.type_id),
    filter_key: key,
    filter_name: filterGroup.name || key,
    option_name: option.n || value,
    option_value: value,
    request_url: fullUrl(path),
    http_status: got.status,
    list_count: list.length,
    total_count: Number(got.data?.total || 0),
    snapshot_mode: got.data?.snapshot_mode || '',
    api_root_cause: got.data?.root_cause || '',
    semantic_hit_rate: Number(sem.semanticHitRate.toFixed(4)),
    unknown_rate: Number(sem.unknownRate.toFixed(4)),
    duplicate_rate: Number(duplicateRate(list).toFixed(4)),
    detail_ok_rate: Number(detail.detailOkRate.toFixed(4)),
    playable_rate: Number(detail.playableRate.toFixed(4)),
    examples: sem.examples,
    detail_examples: detail.detail,
    evidence: list[0]?.snapshot_filter_evidence || '',
  };
  const [rootCause, fixSuggestion] = classify(record, categoryVisible);
  record.root_cause = rootCause;
  record.fix_suggestion = fixSuggestion;
  record.result = rootCause === ROOT_CAUSE.OK ? 'PASS' : (rootCause === ROOT_CAUSE.SOURCE_TAG_GAP || rootCause === ROOT_CAUSE.TAG_PARSE_GAP ? 'WARN' : 'FAIL');
  return record;
}
function filtersForCategory(data, t) {
  return data?.filters?.[String(t)] || data?.class?.find((c) => String(c.type_id) === String(t))?.filters || [];
}
async function main() {
  await mkdir(AUDIT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const report = { base: BASE, generatedAt, limit: LIMIT, categories: [], buttons: [], summary: {} };

  const config = await fetchJson('/config.json');
  report.config = { status: config.status, visibleSites: config.data?.sites?.length || 0, siteName: config.data?.sites?.[0]?.name || '' };

  for (const t of CATEGORIES) {
    const got = await fetchJson(requestPath(t));
    const classRow = got.data?.class?.find((c) => String(c.type_id) === String(t)) || { type_id: t, type_name: String(t) };
    const filters = filtersForCategory(got.data, t);
    const categoryRecord = {
      type_id: String(t),
      type_name: classRow.type_name,
      http_status: got.status,
      list_count: got.data?.list?.length || 0,
      total_count: got.data?.total || 0,
      snapshot_mode: got.data?.snapshot_mode || '',
      filter_groups: filters.length,
    };
    report.categories.push(categoryRecord);
    for (const group of filters) {
      for (const option of group.value || []) {
        if (!filterValue(option.v)) continue;
        report.buttons.push(await auditButton(classRow, group, option, categoryRecord.list_count > 0));
      }
    }
  }

  const totalButtons = report.buttons.length;
  const byCause = {};
  const byResult = {};
  for (const b of report.buttons) {
    byCause[b.root_cause] = (byCause[b.root_cause] || 0) + 1;
    byResult[b.result] = (byResult[b.result] || 0) + 1;
  }
  report.summary = {
    totalButtons,
    pass: byResult.PASS || 0,
    warn: byResult.WARN || 0,
    fail: byResult.FAIL || 0,
    byCause,
    categoryEmpty: report.categories.filter((c) => c.http_status !== 200 || c.list_count === 0).map((c) => c.type_name),
    apiErrors: report.buttons.filter((b) => b.root_cause === ROOT_CAUSE.API_ERROR).length,
    snapshotMisses: report.buttons.filter((b) => b.root_cause === ROOT_CAUSE.SNAPSHOT_MISS).length,
    logicBugs: report.buttons.filter((b) => b.root_cause === ROOT_CAUSE.FILTER_LOGIC_BUG).length,
  };

  await writeFile(path.join(AUDIT_DIR, 'remote-control-latest.json'), JSON.stringify(report, null, 2), 'utf8');
  const failing = report.buttons.filter((b) => b.result === 'FAIL').slice(0, 30);
  const md = [
    '# TVBox/FongMi/影视仓 v7.3 遥控器语义审计',
    '',
    `- 基准入口：${BASE}`,
    `- 生成时间：${generatedAt}`,
    `- 按钮总数：${totalButtons}`,
    `- PASS/WARN/FAIL：${report.summary.pass}/${report.summary.warn}/${report.summary.fail}`,
    `- 根因分布：${Object.entries(byCause).map(([k, v]) => `${k}=${v}`).join('，') || '无'}`,
    '',
    '## 空分类或接口异常分类',
    '',
    report.summary.categoryEmpty.length ? report.summary.categoryEmpty.map((x) => `- ${x}`).join('\n') : '- 无',
    '',
    '## 失败按钮样例',
    '',
    failing.length ? failing.map((b) => `- ${b.category} / ${b.filter_name} / ${b.option_name}：${b.root_cause}；命中率 ${Math.round(b.semantic_hit_rate * 100)}%；${b.fix_suggestion}`).join('\n') : '- 无',
    '',
    '## 判定说明',
    '',
    '- 空结果不会被直接删除；会归因到 API、快照、筛选逻辑、标签解析、源覆盖或播放链路。',
    '- 电视端是否展示按钮应由审计结果和快照能力共同决定，规则库继续保留。',
    '',
  ].join('\n');
  await writeFile(path.join(AUDIT_DIR, 'remote-control-summary.md'), md, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.apiErrors || report.summary.snapshotMisses || report.summary.logicBugs) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
