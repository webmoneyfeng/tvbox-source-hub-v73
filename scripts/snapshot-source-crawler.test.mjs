import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSourceCategoryMap,
  buildSourcePagePlan,
  crawlSourceWindow,
  normalizeCmsPayload,
  normalizeSourceRows,
  sourceRowsFromPrevious,
} from '../src/snapshot-source-crawler.mjs';

const SOURCE = {
  slug: 'alpha',
  short: 'A',
  api: 'https://alpha.example/api.php/provide/vod/',
};

test('CMS payload normalization supports MacCMS and pageindex variants', () => {
  const classic = normalizeCmsPayload({ page: 2, pagecount: 8, limit: 20, total: 150, list: [{ vod_id: '1' }] });
  const pageIndex = normalizeCmsPayload({ pageindex: 3, pagecount: 9, pagesize: 30, recordcount: 260, list: [{ vod_id: '2' }] });

  assert.deepEqual({ page: classic.page, pagecount: classic.pagecount, limit: classic.limit, total: classic.total }, { page: 2, pagecount: 8, limit: 20, total: 150 });
  assert.deepEqual({ page: pageIndex.page, pagecount: pageIndex.pagecount, limit: pageIndex.limit, total: pageIndex.total }, { page: 3, pagecount: 9, limit: 30, total: 260 });
});

test('source classes map to evidence-backed primary owners', () => {
  const map = buildSourceCategoryMap([
    { type_id: '1', type_name: '\u7535\u5f71' },
    { type_id: '2', type_name: '\u7535\u89c6\u5267' },
    { type_id: '3', type_name: '\u4f53\u80b2\u8d5b\u4e8b' },
    { type_id: '4', type_name: '\u7f51\u7edc\u7535\u5f71' },
  ]);

  assert.deepEqual(map, { 1: 'other_movie', 2: 'tv_series', 3: 'knowledge', 4: 'web_movie' });
});

test('source page plan always refreshes page one and advances a wrapping deep cursor', () => {
  const first = buildSourcePagePlan({ nextPage: 4 }, 6, 3);
  const wrapped = buildSourcePagePlan({ nextPage: first.nextPage }, 6, 3);

  assert.deepEqual(first.pages, [1, 4, 5, 6]);
  assert.equal(first.nextPage, 2);
  assert.deepEqual(wrapped.pages, [1, 2, 3, 4]);
  assert.equal(wrapped.nextPage, 5);
});

test('source rows preserve source identity and classify using source classes', () => {
  const payload = normalizeCmsPayload({
    page: 1,
    pagecount: 1,
    class: [{ type_id: '8', type_name: '\u4f53\u80b2\u8d5b\u4e8b' }],
    list: [{ vod_id: 'v8', type_id: '8', vod_name: '\u6bd4\u8d5b\u56de\u653e', vod_time: '2026-07-18 10:00:00' }],
  });
  const rows = normalizeSourceRows(payload, SOURCE, buildSourceCategoryMap(payload.class));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].primary_category, 'knowledge');
  assert.equal(rows[0]._sourceSlug, 'alpha');
  assert.equal(rows[0].source_url, SOURCE.api);
  assert.equal(rows[0].vod_id, 'v8');
});

test('previous merged rows can be reconstructed per source for incremental retention', () => {
  const previous = [{
    canonical_id: 'meta:test',
    vod_id: 'aggregate-id',
    vod_name: '\u65e7\u8282\u76ee',
    primary_category: 'tv_series',
    source_candidates: [
      { source: 'alpha', id: 'alpha-1', url: SOURCE.api },
      { source: 'beta', id: 'beta-9', url: 'https://beta.example/api' },
    ],
  }];
  const rows = sourceRowsFromPrevious(previous, SOURCE);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vod_id, 'alpha-1');
  assert.equal(rows[0]._sourceSlug, 'alpha');
  assert.deepEqual(rows[0].source_candidates, [{ source: 'alpha', id: 'alpha-1', url: SOURCE.api }]);
});

test('source window merges fresh and retained rows while reporting partial page failures', async () => {
  const previousRows = sourceRowsFromPrevious([{
    canonical_id: 'meta:old',
    vod_id: 'old-aggregate',
    vod_name: '\u65e7\u8282\u76ee',
    primary_category: 'tv_series',
    source_candidates: [{ source: 'alpha', id: 'old-1', url: SOURCE.api }],
  }], SOURCE);
  const fetched = [];
  const result = await crawlSourceWindow({
    source: SOURCE,
    previousRows,
    state: { nextPage: 2 },
    pagesPerRun: 2,
    fetchClasses: async () => [{ type_id: '2', type_name: '\u7535\u89c6\u5267' }],
    fetchPage: async (page) => {
      fetched.push(page);
      if (page === 2) throw new Error('transient');
      return { page, pagecount: 4, list: [{ vod_id: `new-${page}`, type_id: '2', vod_name: `\u65b0\u8282\u76ee${page}`, vod_time: '2026-07-18 12:00:00' }] };
    },
  });

  assert.deepEqual(fetched.sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 1);
  assert.equal(result.rows.some((row) => row.vod_name === '\u65e7\u8282\u76ee'), true);
  assert.equal(result.rows.some((row) => row.vod_name === '\u65b0\u8282\u76ee1'), true);
  assert.equal(result.nextPage, 4);
});

test('source window rejects future timestamps from its persisted watermark', async () => {
  const nowMs = Date.parse('2026-07-19T00:00:00.000Z');
  const result = await crawlSourceWindow({
    source: SOURCE,
    nowMs,
    pagesPerRun: 1,
    fetchClasses: async () => [{ type_id: '2', type_name: '\u7535\u89c6\u5267' }],
    fetchPage: async (page) => ({
      page,
      pagecount: 1,
      list: [{
        vod_id: 'future-source-row',
        type_id: '2',
        vod_name: '\u672a\u6765\u65f6\u95f4\u6c61\u67d3',
        vod_time: '2026-08-06 12:00:00',
        vod_time_add: '2026-07-18 23:45:00',
      }],
    }),
  });

  assert.equal(result.rows[0].vod_time, '2026-08-06 12:00:00');
  assert.equal(result.watermark, '2026-07-18T15:45:00.000Z');
});
