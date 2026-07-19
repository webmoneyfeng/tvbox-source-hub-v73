import { classifySourceCategoryName, normalizeContentItem } from './content-model.mjs';
import { extractUpdatedAt, mergeSnapshotRows } from './snapshot-catalog.mjs';
import { latestPlausibleSourceTimestamp } from './source-time.mjs';

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCmsPayload(payload) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) && (payload.data.list || payload.data.class) ? payload.data : payload)
    : {};
  const list = Array.isArray(root.list) ? root.list : [];
  const classes = Array.isArray(root.class) ? root.class : (Array.isArray(root.classes) ? root.classes : []);
  return {
    ...root,
    page: Math.max(1, number(root.page ?? root.pageindex ?? root.pageIndex, 1)),
    pagecount: Math.max(0, number(root.pagecount ?? root.page_count ?? root.pageCount, 0)),
    limit: Math.max(0, number(root.limit ?? root.pagesize ?? root.pageSize, list.length)),
    total: Math.max(0, number(root.total ?? root.recordcount ?? root.recordCount, list.length)),
    class: classes,
    list,
  };
}

export function buildSourceCategoryMap(classes = []) {
  const out = {};
  for (const record of Array.isArray(classes) ? classes : []) {
    const id = text(record?.type_id ?? record?.id);
    const name = text(record?.type_name ?? record?.name);
    const category = classifySourceCategoryName(name);
    if (id && category) out[id] = category;
  }
  return out;
}

function classNameMap(classes = []) {
  const out = {};
  for (const record of Array.isArray(classes) ? classes : []) {
    const id = text(record?.type_id ?? record?.id);
    const name = text(record?.type_name ?? record?.name);
    if (id && name) out[id] = name;
  }
  return out;
}

export function normalizeSourceRows(payload, source, sourceCategoryMap = {}) {
  const normalizedPayload = normalizeCmsPayload(payload);
  const byId = classNameMap(normalizedPayload.class);
  return normalizedPayload.list
    .filter((row) => row && typeof row === 'object' && (row.vod_id || row.id || row.vod_name || row.name))
    .map((row) => {
      const typeId = text(row.type_id ?? row.type ?? row.category_id);
      const typeName = text(row.type_name ?? row.source_category_name ?? byId[typeId]);
      const prepared = {
        ...row,
        vod_id: text(row.vod_id ?? row.id),
        type_id: typeId,
        type_name: typeName,
        source_category_id: typeId,
        source_category_name: typeName,
        _sourceSlug: text(source?.slug),
        _sourceShort: text(source?.short ?? source?.name ?? source?.slug),
        source_url: text(source?.api),
      };
      return normalizeContentItem(prepared, { sourceCategoryMap });
    });
}

export function sourceRowsFromPrevious(rows, source) {
  const slug = text(source?.slug);
  if (!slug) return [];
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidates = Array.isArray(row?.source_candidates) ? row.source_candidates : [];
    const candidate = candidates.find((value) => text(value?.source) === slug);
    if (!candidate?.id) continue;
    out.push({
      ...row,
      vod_id: text(candidate.id),
      _sourceSlug: slug,
      _sourceShort: text(source?.short ?? source?.name ?? slug),
      source_url: text(candidate.url || source?.api),
      source_candidates: [{ ...candidate, source: slug, id: text(candidate.id), url: text(candidate.url || source?.api) }],
      play_lines: (Array.isArray(row?.play_lines) ? row.play_lines : []).filter((line) => text(line?.source) === slug),
    });
  }
  return out;
}

export function buildSourcePagePlan(state = {}, pagecount = 0, pagesPerRun = 12) {
  const depth = Math.max(0, Math.trunc(number(pagesPerRun, 12)));
  const maximum = Math.max(0, Math.trunc(number(pagecount, 0)));
  if (maximum === 1 || depth === 0) return { pages: [1], nextPage: 2, pagecount: maximum };
  const firstDeepPage = Math.max(2, Math.trunc(number(state?.nextPage, 2)));
  const pages = [1];
  let cursor = firstDeepPage;
  for (let index = 0; index < depth; index += 1) {
    if (maximum > 1 && cursor > maximum) cursor = 2;
    if (!pages.includes(cursor)) pages.push(cursor);
    cursor += 1;
  }
  if (maximum > 1 && cursor > maximum) cursor = 2;
  return { pages, nextPage: cursor, pagecount: maximum };
}

async function mapLimit(items, limit, worker) {
  const input = Array.from(items || []);
  if (!input.length) return [];
  const width = Math.max(1, Math.min(Math.trunc(number(limit, 4)), input.length));
  const output = new Array(input.length);
  let next = 0;
  async function run() {
    while (next < input.length) {
      const index = next;
      next += 1;
      output[index] = await worker(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, run));
  return output;
}

export async function crawlSourceWindow(options = {}) {
  const source = options.source || {};
  if (typeof options.fetchPage !== 'function') throw new TypeError('crawlSourceWindow requires fetchPage(page)');
  const errors = [];
  let classes = [];
  if (typeof options.fetchClasses === 'function') {
    try { classes = await options.fetchClasses(); } catch (error) { errors.push(`classes: ${error.message}`); }
  }

  let firstPayload = null;
  try {
    firstPayload = normalizeCmsPayload(await options.fetchPage(1));
  } catch (error) {
    errors.push(`page 1: ${error.message}`);
  }
  if (firstPayload?.class?.length) classes = [...classes, ...firstPayload.class];
  const categoryMap = buildSourceCategoryMap(classes);
  const plan = buildSourcePagePlan(options.state, firstPayload?.pagecount || 0, options.pagesPerRun);
  const remainingPages = plan.pages.filter((page) => page !== 1);
  const pageResults = await mapLimit(remainingPages, options.concurrency || 4, async (page) => {
    try {
      return { page, payload: normalizeCmsPayload(await options.fetchPage(page)), error: '' };
    } catch (error) {
      return { page, payload: null, error: error.message };
    }
  });
  for (const result of pageResults) if (result.error) errors.push(`page ${result.page}: ${result.error}`);
  const payloads = [firstPayload, ...pageResults.map((result) => result.payload)].filter(Boolean);
  const freshRows = payloads.flatMap((payload) => normalizeSourceRows({ ...payload, class: classes }, source, categoryMap));
  const retainedRows = Array.isArray(options.previousRows) ? options.previousRows : [];
  const merged = mergeSnapshotRows([...retainedRows, ...freshRows]);
  const observedPagecount = Math.max(firstPayload?.pagecount || 0, ...payloads.map((payload) => payload.pagecount || 0));
  const finalPlan = buildSourcePagePlan(options.state, observedPagecount, options.pagesPerRun);
  const timestampEvidence = latestPlausibleSourceTimestamp(merged.rows, {
    nowMs: options.nowMs,
    maxFutureSkewMs: options.maxFutureSkewMs,
  });
  return {
    ok: freshRows.length > 0,
    source: text(source.slug),
    rows: merged.rows,
    freshRows,
    duplicate_count: merged.duplicate_count,
    pages: finalPlan.pages,
    nextPage: finalPlan.nextPage,
    pagecount: observedPagecount,
    watermark: extractUpdatedAt(merged.rows, { nowMs: options.nowMs, maxFutureSkewMs: options.maxFutureSkewMs }),
    timestampAnomalies: {
      futureRejected: timestampEvidence.futureRejectedCount,
      clockSkewCapped: timestampEvidence.clockSkewCappedCount,
    },
    classCount: classes.length,
    classes,
    categoryMap,
    errors,
  };
}

export default Object.freeze({
  buildSourceCategoryMap,
  buildSourcePagePlan,
  crawlSourceWindow,
  normalizeCmsPayload,
  normalizeSourceRows,
  sourceRowsFromPrevious,
});
