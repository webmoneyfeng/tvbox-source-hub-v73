import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';
import { ACTIVE_SOURCE_REGISTRY } from '../src/source-registry.mjs';

const EXPECTED_CATEGORIES = [
  '\u63a8\u8350',
  '\u9662\u7ebf\u7535\u5f71',
  '\u7f51\u7edc\u7535\u5f71',
  '\u5176\u4ed6\u7535\u5f71',
  '\u7535\u89c6\u5267',
  '\u7f51\u7edc\u5267',
  '\u7f51\u7edc\u77ed\u5267',
  '\u7efc\u827a',
  '\u52a8\u6f2b',
  '\u7eaa\u5f55\u7247',
  '\u89e3\u8bf4',
  '\u6587\u5a31\u77e5\u8bc6',
  '\u6210\u4eba\u4f26\u7406',
];

function cmsPayload() {
  return {
    code: 1,
    class: [
      { type_id: '101', type_name: '\u9662\u7ebf\u7535\u5f71' },
      { type_id: '102', type_name: '\u7f51\u7edc\u7535\u5f71' },
      { type_id: '103', type_name: '\u7535\u5f71' },
      { type_id: '201', type_name: '\u7535\u89c6\u5267' },
      { type_id: '202', type_name: '\u7f51\u7edc\u5267' },
      { type_id: '203', type_name: '\u77ed\u5267' },
    ],
    list: [
      { vod_id: 'm1', vod_name: '\u9662\u7ebfA', type_id: '101', type_name: '\u9662\u7ebf\u7535\u5f71', vod_year: '2026' },
      { vod_id: 'm2', vod_name: '\u7f51\u5927B', type_id: '102', type_name: '\u7f51\u7edc\u7535\u5f71', vod_year: '2026' },
      { vod_id: 'm3', vod_name: '\u666e\u901a\u7535\u5f71C', type_id: '103', type_name: '\u7535\u5f71', vod_year: '2026' },
      { vod_id: 't1', vod_name: '\u6253\u62fc', type_id: '201', type_name: '\u7535\u89c6\u5267', vod_year: '2025', vod_remarks: '\u51689\u96c6', vod_total: '9' },
      { vod_id: 't2', vod_name: '\u7f51\u5267B', type_id: '202', type_name: '\u7f51\u7edc\u5267', vod_year: '2026', vod_total: '24', vod_duration: '45\u5206\u949f' },
      { vod_id: 's1', vod_name: '\u5fae\u77ed\u5267C', type_id: '203', type_name: '\u77ed\u5267', vod_year: '2026', vod_total: '60', vod_duration: '3\u5206\u949f' },
    ],
  };
}

function env() {
  return { SNAPSHOT_BASES: 'data:', TVBOX_KV: { async get() { return null; } } };
}

test('worker exposes 13 primary categories and preserves legacy movie, series, and short aliases', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input?.url || input).startsWith('data:')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(cmsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const movie = await (await worker.fetch(new Request('https://tv.webhome.eu.org/agg?force=dynamic&ac=videolist&t=1&pg=1&limit=24'), env())).json();
    const series = await (await worker.fetch(new Request('https://tv.webhome.eu.org/agg?force=dynamic&ac=videolist&t=2&pg=1&limit=24'), env())).json();
    const short = await (await worker.fetch(new Request('https://tv.webhome.eu.org/agg?force=dynamic&ac=videolist&t=6&pg=1&limit=24'), env())).json();

    assert.deepEqual(movie.class.map((x) => x.type_name), EXPECTED_CATEGORIES);
    assert.deepEqual(new Set(movie.list.map((x) => x.type_name)), new Set(['\u9662\u7ebf\u7535\u5f71', '\u7f51\u7edc\u7535\u5f71', '\u5176\u4ed6\u7535\u5f71']));
    assert.deepEqual(new Set(series.list.map((x) => x.type_name)), new Set(['\u7535\u89c6\u5267', '\u7f51\u7edc\u5267']));
    assert.deepEqual(short.list.map((x) => x.type_name), ['\u7f51\u7edc\u77ed\u5267']);
    assert.equal(short.list.some((x) => x.vod_name === '\u6253\u62fc'), false);
    assert.equal(movie.fallback_level, 'bounded-dynamic-aggregate');
    assert.equal(movie.degraded, false);
    assert.equal(movie.source_quorum.total, ACTIVE_SOURCE_REGISTRY.length);
    assert.equal(movie.source_quorum.succeeded, ACTIVE_SOURCE_REGISTRY.length);
    for (const field of ['content_revision', 'content_changed_at', 'category_updated_at']) {
      assert.equal(Object.hasOwn(movie, field), true, `missing diagnostic field ${field}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
