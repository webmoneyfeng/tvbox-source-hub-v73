import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const VALIDATION_PATH = 'dist/snapshot/latest/validation.json';
const REMOTE_AUDIT_PATH = 'audit/tv-remote-full-latest.json';
const OUT_JSON = 'audit/snapshot-warning-triage-latest.json';
const OUT_MD = 'audit/snapshot-warning-triage-summary.md';

const TRIAGE_TYPES = {
  UI_HIDE_CANDIDATE: 'UI_HIDE_CANDIDATE',
  SOURCE_TAG_GAP: 'SOURCE_TAG_GAP',
  TAG_PARSE_GAP: 'TAG_PARSE_GAP',
  SNAPSHOT_PACK_GAP: 'SNAPSHOT_PACK_GAP',
  SOURCE_PHYSICAL_LIMIT: 'SOURCE_PHYSICAL_LIMIT',
};

function rel(...parts) {
  return path.join(ROOT, ...parts);
}
async function readJson(relativePath) {
  const abs = rel(...relativePath.split('/'));
  const text = await fs.readFile(abs, 'utf8');
  return JSON.parse(text);
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function countBy(rows, getter) {
  const out = {};
  for (const row of rows) {
    const key = typeof getter === 'function' ? getter(row) : row?.[getter];
    const value = String(key || 'UNKNOWN');
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}
function stableKey(t, key, value) {
  return `${String(t)}\u0000${String(key)}\u0000${String(value)}`;
}
function parseWarning(warning) {
  const text = String(warning || '').trim();
  const filter = text.match(/^filter\s+([^/]+)\/([^/]+)\/(.+?)\s+page\s+(\d+)\s+empty$/);
  if (filter) {
    return { kind: 'filter', t: filter[1], key: filter[2], value: filter[3], page: Number(filter[4]), raw: text };
  }
  const searchVariant = text.match(/^search\s+(.+?)\s+used\s+(.+)$/);
  if (searchVariant) {
    return { kind: 'search', term: searchVariant[1], searchSource: searchVariant[2], raw: text };
  }
  return { kind: 'unknown', raw: text };
}
function decodeFilterFromRequestUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const t = parsed.searchParams.get('t') || '';
    const f = parsed.searchParams.get('f') || '{}';
    const obj = JSON.parse(f);
    const entries = Object.entries(obj || {});
    if (!entries.length) return null;
    const [key, value] = entries[0];
    return { t, key, value: String(value) };
  } catch {
    return null;
  }
}
function remoteFilterIndex(remoteAudit) {
  const out = new Map();
  for (const row of asArray(remoteAudit?.records)) {
    if (row?.element_type !== 'single_filter') continue;
    const parsed = decodeFilterFromRequestUrl(row.request_url);
    if (!parsed) continue;
    out.set(stableKey(parsed.t, parsed.key, parsed.value), row);
  }
  return out;
}
function validationFilterIndex(validation) {
  const out = new Map();
  for (const row of asArray(validation?.filters)) {
    const key = stableKey(row.t, row.key, row.value);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}
function categoryName(validation, t) {
  return asArray(validation?.categories).find((x) => String(x.t) === String(t))?.name || String(t || '');
}
function classifyFilterWarning(parsed, validationRows, remoteRow, validation) {
  const firstRow = validationRows.find((x) => Number(x.page) === Number(parsed.page)) || validationRows[0] || {};
  const anyOkValidation = validationRows.some((x) => x.ok && Number(x.count || 0) > 0);
  const remotePass = remoteRow?.result === 'PASS' && Number(remoteRow?.list_count || 0) > 0;
  const remoteVisible = Boolean(remoteRow);
  const base = {
    warning: parsed.raw,
    kind: parsed.kind,
    category_id: parsed.t,
    category: firstRow.category || categoryName(validation, parsed.t),
    filter_key: parsed.key,
    filter_name: firstRow.filterName || parsed.key,
    option_name: firstRow.optionName || parsed.value,
    option_value: parsed.value,
    page: parsed.page,
    validation_count: Number(firstRow.count || 0),
    validation_total: Number(firstRow.total || 0),
    validation_evidence: firstRow.evidence || '',
    validation_has_other_ok_page: anyOkValidation,
    remote_path_id: remoteRow?.path_id || '',
    remote_result: remoteRow?.result || '',
    remote_list_count: Number(remoteRow?.list_count || 0),
    remote_semantic_hit_rate: remoteRow?.semantic_hit_rate ?? null,
    user_visible: remoteVisible,
    current_tv_blocking: false,
  };

  if (remotePass) {
    return {
      ...base,
      triage_type: TRIAGE_TYPES.SNAPSHOT_PACK_GAP,
      severity: 'P3',
      user_visible: true,
      current_tv_blocking: false,
      confidence: 0.92,
      rationale: '静态快照验证显示该筛选包为空，但当前线上遥控器同按钮已返回非空且语义通过，说明更像快照包或验证时点陈旧，不是当前电视端按钮失效。',
      fix_suggestion: '优先重跑 generate:snapshot 并确认 filter-packs 与 validation 同步；若仍复现，再检查该筛选包是否被动态兜底掩盖。',
    };
  }

  if (remoteVisible && !remotePass) {
    const root = remoteRow?.root_cause || '';
    const type = /PLAYBACK/.test(root) ? TRIAGE_TYPES.SOURCE_PHYSICAL_LIMIT : TRIAGE_TYPES.TAG_PARSE_GAP;
    return {
      ...base,
      triage_type: type,
      severity: 'P2',
      user_visible: true,
      current_tv_blocking: true,
      confidence: 0.86,
      rationale: '当前线上遥控器仍能看到该按钮，但返回未通过，属于用户可感知风险，不能只按源缺失处理。',
      fix_suggestion: remoteRow?.fix_suggestion || '沿请求参数、快照命中、标签解析、去重排序和播放过滤逐层回溯。',
    };
  }

  const key = String(parsed.key || '');
  const semanticSparseKeys = new Set(['episodes', 'duration', 'state', 'quality']);
  const sourceCoverageKeys = new Set(['area', 'class', 'topic']);
  if (!remoteVisible) {
    const sparse = semanticSparseKeys.has(key);
    return {
      ...base,
      triage_type: sparse ? TRIAGE_TYPES.SOURCE_TAG_GAP : TRIAGE_TYPES.UI_HIDE_CANDIDATE,
      severity: 'P3',
      user_visible: false,
      current_tv_blocking: false,
      confidence: sparse ? 0.76 : 0.82,
      rationale: sparse
        ? '该筛选当前未出现在遥控器可见路径中，且属于依赖源侧元数据的筛选；更可能是源标签缺失或证据不足，规则应保留但暂不暴露为空按钮。'
        : '该筛选当前未出现在遥控器可见路径中，说明已被电视端可见层规避；保留规则继续观察，不把空按钮暴露给用户。',
      fix_suggestion: sparse
        ? '补充标题、备注、集数、状态、清晰度等推断规则；当审计能证明非空且语义正确时自动恢复可见。'
        : '不要删除规则；继续扩源或补解析，等源能力满足后再让该按钮重新进入电视端。',
    };
  }

  if (sourceCoverageKeys.has(key)) {
    return {
      ...base,
      triage_type: TRIAGE_TYPES.TAG_PARSE_GAP,
      severity: 'P2',
      user_visible: true,
      current_tv_blocking: true,
      confidence: 0.7,
      rationale: '分类、地区、主题类按钮用户语义明确；若可见却为空，优先怀疑映射、解析或快照命中缺口，而不是直接判源没有。',
      fix_suggestion: '检查源分类名、标题、备注、semantic_tags 和 filter-pack 生成规则，确认是否存在解析漏读或静态包缺失。',
    };
  }

  return {
    ...base,
    triage_type: TRIAGE_TYPES.SOURCE_TAG_GAP,
    severity: 'P3',
    user_visible: remoteVisible,
    current_tv_blocking: remoteVisible,
    confidence: 0.62,
    rationale: '缺少足够证据证明是接口错误或源不可用，先归为源标签或证据不足并进入观察。',
    fix_suggestion: '补足源侧证据追踪，区分源覆盖不足、标签缺失和解析缺口。',
  };
}
function classifySearchWarning(parsed) {
  return {
    warning: parsed.raw,
    kind: parsed.kind,
    term: parsed.term,
    search_source: parsed.searchSource,
    triage_type: TRIAGE_TYPES.TAG_PARSE_GAP,
    severity: 'P3',
    user_visible: true,
    current_tv_blocking: false,
    confidence: 0.84,
    rationale: '搜索已通过变体召回兜底返回，但原始别名或关键词没有直接命中，说明别名召回仍依赖规则补丁；当前不阻塞用户，但需要持续补齐别名和主演索引。',
    fix_suggestion: '把该别名、主演、年份证据固化到覆盖片单和搜索索引，避免只靠单次动态变体兜底。',
  };
}
function classifyUnknownWarning(parsed) {
  return {
    warning: parsed.raw,
    kind: parsed.kind,
    triage_type: TRIAGE_TYPES.UI_HIDE_CANDIDATE,
    severity: 'P3',
    user_visible: false,
    current_tv_blocking: false,
    confidence: 0.4,
    rationale: 'warning 格式未被当前分诊器识别，先作为不可见观察项处理，防止误判为用户投诉。',
    fix_suggestion: '补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。',
  };
}
function summarizeRows(rows) {
  const blocking = rows.filter((x) => x.current_tv_blocking);
  return {
    total: rows.length,
    unclassified: rows.filter((x) => !x.triage_type).length,
    user_visible: rows.filter((x) => x.user_visible).length,
    current_tv_blocking: blocking.length,
    by_type: countBy(rows, 'triage_type'),
    by_severity: countBy(rows, 'severity'),
    by_visibility: countBy(rows, (x) => x.user_visible ? 'visible' : 'hidden_or_not_exposed'),
    by_category: countBy(rows.filter((x) => x.category), 'category'),
    by_filter_key: countBy(rows.filter((x) => x.filter_key), 'filter_key'),
  };
}
function renderMarkdown(result) {
  const summary = result.summary;
  const byTypeLines = Object.entries(summary.by_type).map(([k, v]) => `- ${k}：${v}`);
  const visibleBlocking = result.rows.filter((x) => x.current_tv_blocking);
  const groups = Object.entries(summary.by_category).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const examples = result.rows.slice(0, 80).map((x, i) => {
    const label = x.kind === 'filter'
      ? `${x.category}/${x.filter_name}/${x.option_name}`
      : `搜索/${x.term || x.warning}`;
    return `${i + 1}. ${x.severity}；${x.triage_type}；${label}；可见=${x.user_visible ? '是' : '否'}；阻塞=${x.current_tv_blocking ? '是' : '否'}；建议：${x.fix_suggestion}`;
  });
  return [
    '# v7.4 快照 Warning 分诊报告',
    '',
    '## 总结',
    '',
    `- 生成时间：${result.generatedAt}`,
    `- 输入：${VALIDATION_PATH}；${REMOTE_AUDIT_PATH}`,
    `- warning 总数：${summary.total}`,
    `- 未分类：${summary.unclassified}`,
    `- 当前电视端可见：${summary.user_visible}`,
    `- 当前电视端阻塞：${summary.current_tv_blocking}`,
    `- P级分布：${Object.entries(summary.by_severity).map(([k, v]) => `${k}=${v}`).join('；')}`,
    '',
    '## 根因分布',
    '',
    ...(byTypeLines.length ? byTypeLines : ['- 无']),
    '',
    '## 分类分布 Top',
    '',
    ...(groups.length ? groups.map(([k, v]) => `- ${k}：${v}`) : ['- 无']),
    '',
    '## 当前用户可感知阻塞',
    '',
    ...(visibleBlocking.length
      ? visibleBlocking.map((x) => `- ${x.severity}；${x.triage_type}；${x.category || '搜索'}/${x.filter_name || x.term}/${x.option_name || ''}；${x.rationale}`)
      : ['- 暂无。当前 warnings 没有证据证明会造成电视端按钮空壳；多数属于静态快照包、验证时点或不可见规则观察项。']),
    '',
    '## 分诊明细',
    '',
    ...(examples.length ? examples : ['- 无']),
    '',
    '## 终局承接',
    '',
    '- 终局：用户喜欢、0投诉、可商业化收费的 TVBox/FongMi/影视仓 点播 + 直播源。',
    '- 全局：快照 warning 不能再只是一个数字，必须转成可解释、可治理、可复测的投诉风险。',
    '- 局部：本报告区分静态包缺口、标签解析缺口、源标签缺口、不可见按钮候选和物理限制。',
    '- 节点：每条 warning 都保留分类、筛选项、当前遥控器证据和修复建议。',
    '- 末梢：只有当前电视端可见且会导致空结果或错结果的按钮，才升级为 P2/P1 修复；不可见或已由动态兜底修复的保留观察。',
    '',
  ].join('\n');
}

async function triageSnapshotWarnings() {
  const generatedAt = new Date().toISOString();
  const validation = await readJson(VALIDATION_PATH);
  let remoteAudit = null;
  try { remoteAudit = await readJson(REMOTE_AUDIT_PATH); } catch { remoteAudit = { records: [] }; }
  const remoteIdx = remoteFilterIndex(remoteAudit);
  const validationIdx = validationFilterIndex(validation);
  const rows = [];

  for (const warning of asArray(validation.warnings)) {
    const parsed = parseWarning(warning);
    if (parsed.kind === 'filter') {
      const key = stableKey(parsed.t, parsed.key, parsed.value);
      rows.push(classifyFilterWarning(parsed, validationIdx.get(key) || [], remoteIdx.get(key), validation));
    } else if (parsed.kind === 'search') {
      rows.push(classifySearchWarning(parsed));
    } else {
      rows.push(classifyUnknownWarning(parsed));
    }
  }

  const result = {
    generatedAt,
    input: {
      validation: VALIDATION_PATH,
      remoteAudit: REMOTE_AUDIT_PATH,
      validationGeneratedAt: validation.generatedAt || '',
      remoteAuditGeneratedAt: remoteAudit?.generatedAt || '',
    },
    summary: summarizeRows(rows),
    rows,
  };
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(rel(...OUT_JSON.split('/')), JSON.stringify(result, null, 2) + '\n', 'utf8');
  await fs.writeFile(rel(...OUT_MD.split('/')), renderMarkdown(result), 'utf8');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await triageSnapshotWarnings();
  console.log(JSON.stringify({
    generatedAt: result.generatedAt,
    total: result.summary.total,
    unclassified: result.summary.unclassified,
    current_tv_blocking: result.summary.current_tv_blocking,
    by_type: result.summary.by_type,
    by_severity: result.summary.by_severity,
  }, null, 2));
}

export { triageSnapshotWarnings };
