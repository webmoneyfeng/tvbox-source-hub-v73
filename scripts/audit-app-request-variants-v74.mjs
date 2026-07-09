import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');

const PRIMARY_BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const SECONDARY_BASE = (process.env.TVBOX_SECONDARY_BASE || 'https://tv.webclound.eu.org').replace(/\/+$/, '');
const STALE_CODE = process.env.TVBOX_STALE_UPDATE_CODE || '111111111111';
const LIMIT = Number(process.env.APP_VARIANT_LIMIT || 8);
const TIMEOUT_MS = Number(process.env.APP_VARIANT_TIMEOUT_MS || 20000);

const ROOT_CAUSES = {
  OK: 'OK',
  API_ERROR: 'API_ERROR',
  SCHEMA_REGRESSION: 'SCHEMA_REGRESSION',
  APP_REQUEST_VARIANT: 'APP_REQUEST_VARIANT',
  CACHE_STALE: 'CACHE_STALE',
  SEARCH_VARIANT_DRIFT: 'SEARCH_VARIANT_DRIFT',
  FILTER_LOGIC_BUG: 'FILTER_LOGIC_BUG',
  CLEAN_POLICY_REGRESSION: 'CLEAN_POLICY_REGRESSION',
  DETAIL_VARIANT_REGRESSION: 'DETAIL_VARIANT_REGRESSION',
  EMPTY_LIST: 'EMPTY_LIST',
};

const TIAN_DAO = '\u5929\u9053';
const TIAN_DAO_ALIAS = '\u9065\u8fdc\u7684\u6551\u4e16\u4e3b';
const TIAN_DAO_ACTOR = '\u738b\u5fd7\u6587';

function enc(value) {
  return encodeURIComponent(String(value));
}

function extractUpdateCode(value) {
  const m = String(value || '').match(/(\d{12})/);
  return m ? m[1] : '';
}

function contentPolicyExpected(basePath) {
  return String(basePath || '').includes('/agg-clean') ? 'clean-no-adult' : 'full';
}

function makeVariant(id, app_profile, basePath, pathValue, options = {}) {
  return {
    id,
    app_profile,
    path: pathValue,
    expects_list: options.expects_list !== false,
    expects_search: Boolean(options.expects_search),
    search_term: options.search_term || '',
    expects_detail_as_list: Boolean(options.expects_detail_as_list),
    content_policy: contentPolicyExpected(basePath),
  };
}

function buildVariantCases(basePath = '/agg', staleCode = STALE_CODE) {
  const base = String(basePath || '/agg').replace(/\/+$/, '');
  const clean = contentPolicyExpected(base) === 'clean-no-adult';
  const prefix = clean ? 'clean' : 'full';
  const f = enc(JSON.stringify({ year: '2026' }));
  return [
    makeVariant(`${prefix}.tvbox.videolist.t`, 'TVBox', base, `${base}?ac=videolist&t=1&pg=1&limit=${LIMIT}`),
    makeVariant(`${prefix}.fongmi.detail_without_ids`, 'FongMi', base, `${base}?ac=detail&t=1&pg=1&limit=${LIMIT}`, { expects_detail_as_list: true }),
    makeVariant(`${prefix}.warehouse.page_alias`, '\u5f71\u89c6\u4ed3', base, `${base}?t=1&page=1&limit=${LIMIT}`),
    makeVariant(`${prefix}.tvbox.tid_alias`, 'TVBox', base, `${base}?tid=1&pg=1&limit=${LIMIT}`),
    makeVariant(`${prefix}.fongmi.type_id_alias`, 'FongMi', base, `${base}?type_id=1&pg=1&limit=${LIMIT}`),
    makeVariant(`${prefix}.warehouse.category_key`, '\u5f71\u89c6\u4ed3', base, `${base}?category=movie&pg=1&limit=${LIMIT}`),
    makeVariant(`${prefix}.tvbox.search_wd`, 'TVBox', base, `${base}?wd=${enc(TIAN_DAO)}&limit=${LIMIT}`, { expects_search: true, search_term: TIAN_DAO }),
    makeVariant(`${prefix}.fongmi.search_param`, 'FongMi', base, `${base}?search=${enc(TIAN_DAO)}&limit=${LIMIT}`, { expects_search: true, search_term: TIAN_DAO }),
    makeVariant(`${prefix}.warehouse.q_param`, '\u5f71\u89c6\u4ed3', base, `${base}?q=${enc(TIAN_DAO)}&limit=${LIMIT}`, { expects_search: true, search_term: TIAN_DAO }),
    makeVariant(`${prefix}.tvbox.search_alias`, 'TVBox', base, `${base}?wd=${enc(TIAN_DAO_ALIAS)}&limit=${LIMIT}`, { expects_search: true, search_term: TIAN_DAO_ALIAS }),
    makeVariant(`${prefix}.tvbox.search_actor`, 'TVBox', base, `${base}?wd=${enc(TIAN_DAO_ACTOR)}&limit=${LIMIT}`, { expects_search: true, search_term: TIAN_DAO_ACTOR }),
    makeVariant(`${prefix}.tvbox.filter_json`, 'TVBox', base, `${base}?t=1&f=${f}&pg=1&limit=${LIMIT}`),
    makeVariant(`${prefix}.tvbox.old_versioned_path`, 'TVBox', base, `${base}/u${staleCode}?ac=videolist&t=0&pg=1&limit=${LIMIT}&fresh=1`),
  ];
}

function requestVariantPath(pathValue) {
  const url = new URL(String(pathValue), 'https://audit.local');
  if (!url.searchParams.has('audit_run')) {
    url.searchParams.set('audit_run', `app-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }
  return `${url.pathname}${url.search}`;
}

function schemaOk(data) {
  return data && typeof data === 'object' && Array.isArray(data.class) && Array.isArray(data.list);
}

function rowText(row) {
  return [
    row?.vod_name,
    row?.vod_sub,
    row?.vod_actor,
    row?.vod_director,
    row?.vod_remarks,
    row?.vod_content,
    row?.type_name,
    row?.vod_class,
    row?.semantic_tags,
    row?.snapshot_filter_evidence,
  ].filter(Boolean).join(' ');
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[\s·・.,，。:：!！?？\-_/\\()[\]【】《》"'“”‘’]/g, '');
}

function searchSemanticCheck(term, rows) {
  const q = normalizeText(term);
  const aliases = {
    [normalizeText(TIAN_DAO)]: [TIAN_DAO, TIAN_DAO_ALIAS, TIAN_DAO_ACTOR],
    [normalizeText(TIAN_DAO_ALIAS)]: [TIAN_DAO, TIAN_DAO_ALIAS, TIAN_DAO_ACTOR],
    [normalizeText(TIAN_DAO_ACTOR)]: [TIAN_DAO, TIAN_DAO_ALIAS, TIAN_DAO_ACTOR],
  };
  const needles = (aliases[q] || [term]).map(normalizeText).filter(Boolean);
  let hit = 0;
  for (const row of rows || []) {
    const hay = normalizeText(rowText(row));
    if (needles.some((n) => hay.includes(n))) hit += 1;
  }
  return {
    search_term: term,
    hit_count: hit,
    total: Array.isArray(rows) ? rows.length : 0,
    semantic_hit_rate: rows?.length ? hit / rows.length : 0,
    semantic_ok: hit > 0,
  };
}

function classifyVariantRecord(record) {
  if (Number(record?.http_status || 0) !== 200) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.API_ERROR };
  }
  if (!record?.schema_ok) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.SCHEMA_REGRESSION };
  }
  if (record?.expected_content_policy === 'clean-no-adult' && record?.content_policy_ok === false) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.CLEAN_POLICY_REGRESSION };
  }
  if (record?.expects_search && record?.semantic_ok === false) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.SEARCH_VARIANT_DRIFT };
  }
  if (record?.expects_list && Number(record?.list_count || 0) <= 0) {
    return { ...record, result: 'FAIL', root_cause: record?.expects_detail_as_list ? ROOT_CAUSES.DETAIL_VARIANT_REGRESSION : ROOT_CAUSES.APP_REQUEST_VARIANT };
  }
  if (record?.cache_code_expected && record?.visible_update_text && record.cache_code_expected !== record.visible_update_text) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.CACHE_STALE };
  }
  return { ...record, result: 'PASS', root_cause: ROOT_CAUSES.OK };
}

async function fetchVariant(base, variant) {
  const pathWithProbe = requestVariantPath(variant.path);
  const url = base + pathWithProbe;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'cache-control': 'no-cache',
        'user-agent': 'TVBoxSourceHubAppVariantAudit/7.4',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text();
    let data = null;
    try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 500) }; }
    const list = Array.isArray(data?.list) ? data.list : [];
    const schema_ok = schemaOk(data);
    const searchStats = variant.expects_search ? searchSemanticCheck(variant.search_term, list) : { semantic_ok: true, semantic_hit_rate: null, hit_count: null };
    const visible = extractUpdateCode(data?.visible_update_text || data?.class?.[0]?.type_name || '');
    const expectedPolicy = variant.content_policy;
    const actualPolicy = data?.content_policy || (variant.path.includes('/agg-clean') ? 'clean-no-adult' : 'full');
    const record = {
      id: variant.id,
      app_profile: variant.app_profile,
      content_policy: actualPolicy,
      expected_content_policy: expectedPolicy,
      content_policy_ok: actualPolicy === expectedPolicy,
      path: variant.path,
      request_url: url,
      http_status: res.status,
      ok: res.ok,
      schema_ok,
      cache_control: res.headers.get('cache-control') || '',
      cf_cache_status: res.headers.get('cf-cache-status') || '',
      duration_ms: Date.now() - startedAt,
      expects_list: variant.expects_list,
      expects_search: variant.expects_search,
      expects_detail_as_list: variant.expects_detail_as_list,
      search_term: variant.search_term,
      list_count: list.length,
      class_count: Array.isArray(data?.class) ? data.class.length : 0,
      visible_update_text: visible,
      class0: data?.class?.[0]?.type_name || '',
      semantic_ok: searchStats.semantic_ok,
      semantic_hit_rate: searchStats.semantic_hit_rate,
      search_hit_count: searchStats.hit_count,
      snapshot_mode: data?.snapshot_mode || '',
      hot_overlay_applied: Boolean(data?.hot_overlay_applied),
      error: res.ok ? '' : `HTTP ${res.status}`,
    };
    return classifyVariantRecord(record);
  } catch (err) {
    return classifyVariantRecord({
      id: variant.id,
      app_profile: variant.app_profile,
      content_policy: '',
      expected_content_policy: variant.content_policy,
      content_policy_ok: false,
      path: variant.path,
      request_url: url,
      http_status: 0,
      ok: false,
      schema_ok: false,
      cache_control: '',
      cf_cache_status: '',
      duration_ms: Date.now() - startedAt,
      expects_list: variant.expects_list,
      expects_search: variant.expects_search,
      expects_detail_as_list: variant.expects_detail_as_list,
      search_term: variant.search_term,
      list_count: 0,
      class_count: 0,
      visible_update_text: '',
      class0: '',
      semantic_ok: false,
      semantic_hit_rate: null,
      search_hit_count: null,
      snapshot_mode: '',
      hot_overlay_applied: false,
      error: String(err?.message || err),
    });
  } finally {
    clearTimeout(timer);
  }
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const k = String(row?.[key] || 'UNKNOWN');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function renderMarkdown(report) {
  const failures = report.records.filter((x) => x.result !== 'PASS');
  return [
    '# v7.4 App 请求变体与缓存路径审计',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 主入口：${report.primaryBase}`,
    `- 同构入口：${report.secondaryBase}`,
    `- 模拟旧更新时间码：${report.staleCode}`,
    `- PASS/WARN/FAIL：${report.summary.pass}/${report.summary.warn}/${report.summary.fail}`,
    `- app_variant_gate：${report.app_variant_gate}`,
    '',
    '## 覆盖范围',
    '',
    '- TVBox：`ac=videolist&t`、`wd`、`f` JSON、旧 `/agg/u旧码`。',
    '- FongMi：`ac=detail&t` 无 `ids` 时按分类列表处理、`search` 参数。',
    '- 影视仓：`page`、`type_id`、`category`、`q` 参数。',
    '- 双版本：全量 `/agg` 与洁净 `/agg-clean` 同步验证。',
    '',
    '## 结果明细',
    '',
    ...report.records.map((x) => `- ${x.result}；${x.scope}.${x.id}；profile=${x.app_profile}；status=${x.http_status}；list=${x.list_count}；class=${x.class_count}；code=${x.visible_update_text || 'none'}；policy=${x.content_policy || 'none'}；root=${x.root_cause}；path=${x.path}`),
    '',
    '## 需关注项',
    '',
    ...(failures.length ? failures.map((x) => `- ${x.result}；${x.scope}.${x.id}；${x.root_cause}；${x.error || x.path}`) : ['- 当前无 FAIL/WARN。']),
    '',
    '## 商业更新时间投诉判断',
    '',
    '- 如果本报告旧 `/agg/u旧码` 路径 PASS，但电视端站点列表仍显示旧码，根因优先归为电视 App 本地配置名缓存。',
    '- 用户实际进入分类后，应以分类名 `推荐 · 当前码` 与 `/status.json.visibleUpdateText` 判断内容层是否更新。',
    '- 若旧码路径、搜索变体或分类变体失败，则归为服务端兼容问题，不能推给电视端缓存。',
    '',
  ].join('\n');
}

async function auditAppRequestVariants() {
  const generatedAt = new Date().toISOString();
  const scopes = [
    { scope: 'primary.full', base: PRIMARY_BASE, basePath: '/agg' },
    { scope: 'primary.clean', base: PRIMARY_BASE, basePath: '/agg-clean' },
    { scope: 'secondary.full', base: SECONDARY_BASE, basePath: '/agg' },
    { scope: 'secondary.clean', base: SECONDARY_BASE, basePath: '/agg-clean' },
  ];
  const records = [];
  for (const scope of scopes) {
    for (const variant of buildVariantCases(scope.basePath, STALE_CODE)) {
      const record = await fetchVariant(scope.base, variant);
      records.push({ ...record, scope: scope.scope, base: scope.base });
    }
  }
  const summary = {
    pass: records.filter((x) => x.result === 'PASS').length,
    warn: records.filter((x) => x.result === 'WARN').length,
    fail: records.filter((x) => x.result === 'FAIL').length,
    byRootCause: countBy(records, 'root_cause'),
  };
  const report = {
    generatedAt,
    primaryBase: PRIMARY_BASE,
    secondaryBase: SECONDARY_BASE,
    staleCode: STALE_CODE,
    records,
    summary,
    app_variant_gate: summary.fail > 0 ? 'FAIL' : summary.warn > 0 ? 'WARN' : 'PASS',
  };
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'app-request-variants-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'app-request-variants-summary.md'), renderMarkdown(report), 'utf8');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditAppRequestVariants();
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    app_variant_gate: report.app_variant_gate,
    pass: report.summary.pass,
    warn: report.summary.warn,
    fail: report.summary.fail,
    byRootCause: report.summary.byRootCause,
  }, null, 2));
  if (report.summary.fail > 0) process.exit(1);
}

export {
  auditAppRequestVariants,
  buildVariantCases,
  classifyVariantRecord,
  contentPolicyExpected,
  extractUpdateCode,
  requestVariantPath,
  searchSemanticCheck,
};
