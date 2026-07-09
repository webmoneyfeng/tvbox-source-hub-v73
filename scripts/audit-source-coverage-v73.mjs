import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const SOURCE_REGISTRY = path.join(ROOT, 'data', 'source-candidates-v73.json');
const COVERAGE_CANARY = path.join(ROOT, 'data', 'coverage-canary-v73.json');

const UA = 'Mozilla/5.0 TVBoxSourceHubCoverageAudit/7.3';
const TVBOX_BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SOURCE_AUDIT_TIMEOUT_MS || 12000);
const DETAIL_SAMPLE_LIMIT = Number(process.env.SOURCE_AUDIT_DETAIL_SAMPLE || 1);
const REPEAT_COUNT = Number(process.env.COVERAGE_REPEAT || 3);
const COVERAGE_SOURCE_LIMIT = Number(process.env.COVERAGE_SOURCE_LIMIT || 12);
const SOURCE_AUDIT_CONCURRENCY = Math.max(1, Number(process.env.SOURCE_AUDIT_CONCURRENCY || 6));

const BAD_PLAY_RE = /(player\.html|\/player\b|iframe|\/jx\b|jx\.|jiexi|parse|解析|advert|广告位|公告|客服|商务合作)/i;
const DIRECT_PLAY_RE = /\.(m3u8|mp4|flv|mkv|mov|ts)(?:$|[?#])|m3u8/i;

export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\[\]【】()（）]/g, '')
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/第[一二三四五六七八九十\d]+季/g, '')
    .replace(/[\s\u00b7.,:;!?\-_/\\|·，。：；！？—]+/g, '')
    .trim()
    .toLowerCase();
}

export function isPlayableUrl(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (BAD_PLAY_RE.test(s)) return false;
  return DIRECT_PLAY_RE.test(s);
}

export function splitEpisodes(group) {
  return String(group || '').split('#').map((raw) => {
    const idx = raw.indexOf('$');
    return idx === -1 ? { name: '', url: raw.trim() } : { name: raw.slice(0, idx).trim(), url: raw.slice(idx + 1).trim() };
  }).filter((x) => x.url);
}

function queryUrl(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.href;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function mapLimit(items, limit, worker) {
  const input = Array.from(items || []);
  const width = Math.max(1, Math.min(Number(limit) || 1, input.length || 1));
  const results = new Array(input.length);
  let next = 0;
  async function run() {
    while (next < input.length) {
      const index = next++;
      results[index] = await worker(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, run));
  return results;
}


async function writeJson(rel, data) {
  const file = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function writeText(rel, text) {
  const file = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}

async function fetchText(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*' }, redirect: 'follow', signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, url };
  } catch (err) {
    return { ok: false, status: 0, text: '', url, error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const got = await fetchText(url, timeoutMs);
  try {
    const body = got.text.replace(/^\uFEFF/, '').replace(/^[\s/]*\/\/.*?\n/s, '');
    return { ...got, data: JSON.parse(body) };
  } catch (err) {
    return { ...got, data: null, parseError: String(err && err.message || err) };
  }
}

function normalizeApi(api) {
  const raw = String(api || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  if (!/(api\.php|provide\/vod|apijson|vod\/json|vod\/)/i.test(raw)) return '';
  return raw.replace(/[?#].*$/, '').replace(/\/+$/, '/');
}

function candidateKey(c) {
  return normalizeApi(c.api).toLowerCase();
}

function cleanSlug(value, fallback) {
  const slug = String(value || '').toLowerCase().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return slug || fallback;
}

async function discoverFromSeedConfigs(registry) {
  const found = [];
  for (const cfgUrl of registry.seedConfigs || []) {
    const got = await fetchJson(cfgUrl, 10000);
    if (!got.data || !Array.isArray(got.data.sites)) continue;
    for (const site of got.data.sites) {
      const api = normalizeApi(site.api);
      if (!api) continue;
      found.push({
        slug: cleanSlug(site.key || site.name, `seed_${found.length + 1}`),
        key: String(site.key || site.name || ''),
        short: String(site.name || site.key || '候选').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 6) || '候选',
        name: String(site.name || site.key || '候选源').slice(0, 40),
        api,
        tier: 'watch',
        origin: cfgUrl,
      });
    }
  }
  return found;
}

function mergeCandidates(registry, discovered) {
  const map = new Map();
  const slugSeen = new Map();
  for (const c of [...(registry.candidates || []), ...discovered]) {
    const key = candidateKey(c);
    if (!key) continue;
    if (!map.has(key)) {
      const baseSlug = cleanSlug(c.slug || c.key || c.short || c.name, `source_${map.size + 1}`);
      const seq = slugSeen.get(baseSlug) || 0;
      slugSeen.set(baseSlug, seq + 1);
      const slug = seq ? `${baseSlug}_${seq + 1}` : baseSlug;
      map.set(key, { ...c, slug, api: normalizeApi(c.api) });
    }
  }
  return [...map.values()];
}

function sourceStatus(checks) {
  if (checks.blocked) return 'BLOCKED';
  if (!checks.classOk) return checks.httpStatus === 403 || checks.httpStatus === 451 || checks.timeout ? 'BLOCKED' : 'REJECTED';
  if (checks.searchOk && checks.detailOk && checks.playOk) return 'ACTIVE';
  if (checks.searchOk || checks.detailOk || checks.playOk) return 'WATCH';
  return 'WATCH';
}

function firstPlayableUrl(vod) {
  const groups = String(vod?.vod_play_url || '').split('$$$');
  for (const group of groups) {
    for (const ep of splitEpisodes(group)) if (isPlayableUrl(ep.url)) return ep.url;
  }
  return '';
}

async function detailForCandidate(candidate, vodId) {
  if (!vodId) return { ok: false, playOk: false, detailUrl: '', playableUrl: '' };
  for (const ac of ['videolist', 'detail']) {
    const detailUrl = queryUrl(candidate.api, { ac, ids: vodId });
    const got = await fetchJson(detailUrl, TIMEOUT_MS);
    const list = Array.isArray(got.data?.list) ? got.data.list : [];
    const playableUrl = firstPlayableUrl(list[0]);
    if (list.length) return { ok: true, playOk: Boolean(playableUrl), detailUrl, playableUrl, status: got.status };
  }
  return { ok: false, playOk: false, detailUrl: '', playableUrl: '' };
}

async function auditCandidate(candidate) {
  const listUrl = queryUrl(candidate.api, { ac: 'list' });
  const listGot = await fetchJson(listUrl, TIMEOUT_MS);
  const classes = Array.isArray(listGot.data?.class) ? listGot.data.class : [];
  const searchUrl = queryUrl(candidate.api, { wd: '天道' });
  const searchGot = await fetchJson(searchUrl, TIMEOUT_MS);
  const searchList = Array.isArray(searchGot.data?.list) ? searchGot.data.list : [];
  let detail = { ok: false, playOk: false, detailUrl: '', playableUrl: '' };
  for (const item of searchList.slice(0, DETAIL_SAMPLE_LIMIT)) {
    detail = await detailForCandidate(candidate, item.vod_id || item.id);
    if (detail.ok) break;
  }
  const checks = {
    httpStatus: listGot.status || searchGot.status,
    timeout: /abort|timeout/i.test(String(listGot.error || searchGot.error || '')),
    blocked: [403, 451].includes(listGot.status) || [403, 451].includes(searchGot.status),
    classOk: classes.length > 0,
    searchOk: searchList.length > 0,
    detailOk: detail.ok,
    playOk: detail.playOk,
  };
  return {
    ...candidate,
    status: sourceStatus(checks),
    checks,
    metrics: {
      classCount: classes.length,
      searchCount: searchList.length,
      sampleNames: searchList.slice(0, 8).map((x) => x.vod_name || x.name || ''),
    },
    evidence: { listUrl, searchUrl, detailUrl: detail.detailUrl, playableUrl: detail.playableUrl },
    error: listGot.error || searchGot.error || listGot.parseError || searchGot.parseError || '',
  };
}

function queryTermsForItem(item) {
  return [...new Set([
    item.title,
    ...(item.aliases || []),
    ...(item.actors || []),
    item.year && item.title ? `${item.title} ${item.year}` : '',
  ].filter(Boolean))];
}

function titleMatches(item, vod) {
  const n = normalizeTitle(vod?.vod_name || vod?.name || '');
  if (!n) return false;
  const titles = [item.title, ...(item.aliases || [])].map(normalizeTitle).filter(Boolean);
  return titles.some((t) => n === t || n.includes(t) || t.includes(n));
}

function exactTitleMatches(item, vod) {
  const n = normalizeTitle(vod?.vod_name || vod?.name || '');
  const titles = [item.title, ...(item.aliases || [])].map(normalizeTitle).filter(Boolean);
  return titles.some((t) => n === t);
}

async function searchSourceForCoverage(candidate, item) {
  const hits = [];
  const terms = queryTermsForItem(item);
  const results = await Promise.allSettled(terms.map(async (term) => {
    const got = await fetchJson(queryUrl(candidate.api, { wd: term }), TIMEOUT_MS);
    const list = Array.isArray(got.data?.list) ? got.data.list : [];
    const exact = list.find((x) => exactTitleMatches(item, x));
    const fuzzy = exact || list.find((x) => titleMatches(item, x));
    return fuzzy ? { term, vod_id: fuzzy.vod_id || fuzzy.id || '', vod_name: fuzzy.vod_name || fuzzy.name || '', exact: Boolean(exact) } : null;
  }));
  for (const r of results) if (r.status === 'fulfilled' && r.value) hits.push(r.value);
  return hits;
}

async function searchAggregate(item, repeat = REPEAT_COUNT) {
  const queries = queryTermsForItem(item);
  const runs = [];
  async function probe(term, mode, i) {
    const force = mode === 'dynamic' ? '&force=dynamic' : '';
    const url = `${TVBOX_BASE}/agg?wd=${encodeURIComponent(term)}&limit=24${force}&coverage_probe=${Date.now()}_${i}_${mode}`;
    const got = await fetchJson(url, 18000);
    const list = Array.isArray(got.data?.list) ? got.data.list : [];
    const exactIndex = list.findIndex((x) => exactTitleMatches(item, x));
    const fuzzyIndex = exactIndex >= 0 ? exactIndex : list.findIndex((x) => titleMatches(item, x));
    return {
      mode,
      term,
      status: got.status,
      count: list.length,
      total: got.data?.total || 0,
      exactIndex,
      fuzzyIndex,
      names: list.slice(0, 10).map((x) => x.vod_name || x.name || ''),
      id: fuzzyIndex >= 0 ? list[fuzzyIndex].vod_id : '',
    };
  }
  for (let i = 0; i < repeat; i++) {
    for (const term of queries) {
      const [user, dynamic] = await Promise.allSettled([probe(term, 'user', i), probe(term, 'dynamic', i)]);
      if (user.status === 'fulfilled') runs.push(user.value);
      if (dynamic.status === 'fulfilled') runs.push(dynamic.value);
    }
  }
  return runs;
}

function classifyCoverage(item, sourceHits, aggRuns, detailOk, playOk) {
  const sourceHitCount = sourceHits.reduce((n, x) => n + x.hits.length, 0);
  const userRuns = aggRuns.filter((r) => !r.mode || r.mode === 'user');
  const visibleRuns = userRuns.length ? userRuns : aggRuns;
  const anyAggHit = visibleRuns.some((r) => r.fuzzyIndex >= 0);
  const anyFirstPageFuzzy = visibleRuns.some((r) => r.fuzzyIndex >= 0 && r.fuzzyIndex < 24);
  const anyFirstPageExact = visibleRuns.some((r) => r.exactIndex >= 0 && r.exactIndex < 24);
  const requiredTerms = new Set([item.title, ...(item.aliases || []), ...(item.actors || [])].filter(Boolean));
  const byTerm = new Map();
  for (const run of visibleRuns.filter((r) => !requiredTerms.size || requiredTerms.has(r.term))) {
    if (!byTerm.has(run.term)) byTerm.set(run.term, []);
    byTerm.get(run.term).push(run);
  }
  const provenUserHits = visibleRuns.filter((r) => r.fuzzyIndex >= 0 && r.status >= 200 && r.status < 300).length;
  const provenFirstPageHit = anyFirstPageFuzzy || anyFirstPageExact;
  const transientOnly = [...byTerm.values()].every((runs) => {
    const hits = runs.filter((r) => r.fuzzyIndex >= 0 && r.status >= 200 && r.status < 300).length;
    const misses = runs.filter((r) => r.fuzzyIndex < 0);
    if (!hits || !misses.length) return true;
    return misses.every((r) => Number(r.status) === 503 || Number(r.status) === 502 || Number(r.status) === 504 || Number(r.status) === 0);
  });
  const unstable = [...byTerm.values()].some((runs) => runs.length > 1 && runs.some((r) => r.fuzzyIndex >= 0) && runs.some((r) => r.fuzzyIndex < 0));
  const toleratedTransientJitter = unstable && transientOnly && provenUserHits >= 2 && provenFirstPageHit && detailOk && playOk;
  if (!sourceHitCount) return { result: item.priority === 'critical' ? 'FAIL' : 'WARN', root_cause: 'SOURCE_UNIVERSE_GAP', note: '候选源集合未发现该节目。' };
  if (!anyAggHit) return { result: 'FAIL', root_cause: 'PARSER_GAP', note: '源侧有候选，但聚合搜索未召回。' };
  if (unstable && !toleratedTransientJitter) return { result: 'WARN', root_cause: 'SOURCE_PHYSICAL_LIMIT', note: '重复搜索结果不稳定，可能由源超时或反爬导致。' };
  if (item.priority === 'category') {
    if (!anyFirstPageFuzzy) return { result: 'WARN', root_cause: 'RANKING_SUPPRESSION', note: '已召回但语义相关类目结果未稳定进入第一页。' };
    if (!detailOk) return { result: 'WARN', root_cause: 'PLAYBACK_FILTERED', note: '列表召回但详情失败。' };
    if (!playOk) return { result: 'WARN', root_cause: 'PLAYBACK_FILTERED', note: '详情存在但播放线路无效。' };
    return { result: 'PASS', root_cause: 'OK', note: '' };
  }
  if (!anyFirstPageExact) return { result: 'WARN', root_cause: 'RANKING_SUPPRESSION', note: '已召回但精确结果未稳定进入第一页。' };
  if (!detailOk) return { result: 'WARN', root_cause: 'PLAYBACK_FILTERED', note: '列表召回但详情失败。' };
  if (!playOk) return { result: 'WARN', root_cause: 'PLAYBACK_FILTERED', note: '详情存在但播放线路无效。' };
  return { result: 'PASS', root_cause: 'OK', note: '' };
}

async function detailForAggregate(id) {
  if (!id) return { detailOk: false, playOk: false };
  const got = await fetchJson(`${TVBOX_BASE}/agg?ids=${encodeURIComponent(id)}`, 18000);
  const vod = Array.isArray(got.data?.list) ? got.data.list[0] : null;
  return { detailOk: Boolean(vod), playOk: Boolean(firstPlayableUrl(vod)), status: got.status };
}

async function auditSourcesAndCoverage() {
  const generatedAt = new Date().toISOString();
  const registry = await readJson(SOURCE_REGISTRY);
  const canary = await readJson(COVERAGE_CANARY);
  const discovered = await discoverFromSeedConfigs(registry);
  const candidates = mergeCandidates(registry, discovered);

  const sourceRows = await mapLimit(candidates, SOURCE_AUDIT_CONCURRENCY, auditCandidate);
  const activeRows = sourceRows.filter((x) => x.status === 'ACTIVE');

  const coverageRows = [];
  const coverageSources = sourceRows.filter((x) => x.status === 'ACTIVE' || x.status === 'WATCH').slice(0, COVERAGE_SOURCE_LIMIT);
  for (const item of canary.items || []) {
    const sourceHits = [];
    const sourceProbeResults = await Promise.allSettled(coverageSources.map(async (source) => ({ source, hits: await searchSourceForCoverage(source, item) })));
    for (const r of sourceProbeResults) if (r.status === 'fulfilled' && r.value.hits.length) sourceHits.push({ slug: r.value.source.slug, status: r.value.source.status, hits: r.value.hits });
    const aggRuns = await searchAggregate(item);
    const firstAggHit = (aggRuns.find((r) => (!r.mode || r.mode === 'user') && r.id) || aggRuns.find((r) => r.id))?.id || '';
    const detail = await detailForAggregate(firstAggHit);
    const classification = classifyCoverage(item, sourceHits, aggRuns, detail.detailOk, detail.playOk);
    coverageRows.push({
      ...item,
      queries: queryTermsForItem(item),
      result: classification.result,
      root_cause: classification.root_cause,
      note: classification.note,
      source_hit_count: sourceHits.reduce((n, x) => n + x.hits.length, 0),
      evidence_sources: sourceHits.map((x) => x.slug),
      aggregate_runs: aggRuns,
      detail_ok: detail.detailOk,
      playable: detail.playOk,
    });
  }

  const sourceSummary = {
    generatedAt,
    candidateCount: sourceRows.length,
    active: sourceRows.filter((x) => x.status === 'ACTIVE').length,
    watch: sourceRows.filter((x) => x.status === 'WATCH').length,
    rejected: sourceRows.filter((x) => x.status === 'REJECTED').length,
    blocked: sourceRows.filter((x) => x.status === 'BLOCKED').length,
    activeSlugs: activeRows.map((x) => x.slug),
  };
  const coverageSummary = {
    generatedAt,
    base: TVBOX_BASE,
    total: coverageRows.length,
    pass: coverageRows.filter((x) => x.result === 'PASS').length,
    warn: coverageRows.filter((x) => x.result === 'WARN').length,
    fail: coverageRows.filter((x) => x.result === 'FAIL').length,
    byRootCause: Object.fromEntries([...new Set(coverageRows.map((x) => x.root_cause))].map((k) => [k, coverageRows.filter((x) => x.root_cause === k).length])),
  };

  await writeJson('audit/source-discovery-latest.json', { ...sourceSummary, rows: sourceRows });
  await writeJson('audit/coverage-latest.json', { ...coverageSummary, rows: coverageRows });
  await writeText('audit/source-discovery-summary.md', renderSourceSummary(sourceSummary, sourceRows));
  await writeText('audit/coverage-summary.md', renderCoverageSummary(coverageSummary, coverageRows));
  await writeText('audit/coverage-failures.csv', renderCoverageCsv(coverageRows));
  return { sourceSummary, coverageSummary };
}

function renderSourceSummary(summary, rows) {
  const lines = [
    '# v7.3 源宇宙发现与准入审计',
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- 候选源：${summary.candidateCount}`,
    `- ACTIVE/WATCH/REJECTED/BLOCKED：${summary.active}/${summary.watch}/${summary.rejected}/${summary.blocked}`,
    '',
    '## ACTIVE 源',
    ...rows.filter((x) => x.status === 'ACTIVE').map((x) => `- ${x.slug}｜${x.name}｜分类 ${x.metrics.classCount}｜搜索样本 ${x.metrics.searchCount}`),
    '',
    '## 非 ACTIVE 源',
    ...rows.filter((x) => x.status !== 'ACTIVE').map((x) => `- ${x.status}｜${x.slug}｜${x.name}｜${x.error || x.evidence.listUrl}`),
    ''
  ];
  return lines.join('\n');
}

function renderCoverageSummary(summary, rows) {
  const lines = [
    '# v7.3 覆盖率与缺片根因审计',
    '',
    `- 基准入口：${summary.base}`,
    `- 生成时间：${summary.generatedAt}`,
    `- PASS/WARN/FAIL：${summary.pass}/${summary.warn}/${summary.fail}`,
    `- 根因分布：${Object.entries(summary.byRootCause).map(([k, v]) => `${k}=${v}`).join('，')}`,
    '',
    '## 重点条目',
    ...rows.map((x) => `- ${x.result}｜${x.title}｜${x.root_cause}｜源命中 ${x.source_hit_count}｜详情 ${x.detail_ok ? 'OK' : 'FAIL'}｜播放 ${x.playable ? 'OK' : 'FAIL'}｜${x.note || ''}`),
    ''
  ];
  return lines.join('\n');
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function renderCoverageCsv(rows) {
  const header = ['id', 'title', 'result', 'root_cause', 'source_hit_count', 'evidence_sources', 'detail_ok', 'playable', 'note'];
  return [header.join(','), ...rows.map((x) => [
    x.id, x.title, x.result, x.root_cause, x.source_hit_count, x.evidence_sources.join('|'), x.detail_ok, x.playable, x.note,
  ].map(csvCell).join(','))].join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditSourcesAndCoverage();
  console.log(JSON.stringify(result, null, 2));
}

export { auditSourcesAndCoverage, classifyCoverage, mapLimit, queryTermsForItem, titleMatches };
