import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { isValidSnapshotManifest } from '../src/worker.mjs';

const CATEGORY_NAMES = [
  '推荐', '院线电影', '网络电影', '其他电影', '电视剧', '网络剧', '网络短剧',
  '综艺', '动漫', '纪录片', '解说', '文娱知识', '成人伦理',
];

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function validManifest(generatedAt, revision) {
  return {
    ok: true,
    schemaVersion: 2,
    generatedAt,
    snapshotGeneratedAt: generatedAt,
    revision,
    content_revision: revision,
    categories: CATEGORY_NAMES.map((type_name, index) => ({ type_id: String(index), type_name, count: 1, total: 1 })),
    variants: {
      full: { revision, total: 13 },
      clean: { revision, total: 12 },
    },
  };
}

test('snapshot manifest gate requires all 13 categories visible and non-empty', () => {
  const manifest = validManifest(new Date().toISOString(), 'snapshot-contract');
  assert.equal(isValidSnapshotManifest(manifest), true);
  const hidden = structuredClone(manifest);
  hidden.categories[1].visible = false;
  assert.equal(isValidSnapshotManifest(hidden), false);
  const empty = structuredClone(manifest);
  empty.categories[2].total = 0;
  empty.categories[2].count = 0;
  assert.equal(isValidSnapshotManifest(empty), false);
});

test('invalid latest snapshot is rejected and the previous validated snapshot serves the catalog', async () => {
  const originalFetch = globalThis.fetch;
  const now = new Date().toISOString();
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/snapshot/latest/manifest.json')) {
      return response({ ok: true, generatedAt: now, revision: 'broken', categories: [] });
    }
    if (url.endsWith('/snapshot/previous/manifest.json')) {
      return response(validManifest(now, 'snapshot-previous-good'));
    }
    if (url.endsWith('/snapshot/previous/catalog-packs/t10-p1-limit24.json')) {
      return response({
        code: 1,
        msg: 'ok',
        page: 1,
        pagecount: 1,
        limit: 24,
        total: 1,
        list: [{
          canonical_id: 'meta:previous-movie',
          primary_category: 'theatrical_movie',
          vod_id: 'previous-movie',
          vod_name: '前一有效院线电影',
          vod_year: '2026',
          type_id: '10',
          type_name: '院线电影',
        }],
      });
    }
    return response({ code: 0, list: [] }, 503);
  };

  const generatedAt = new Date().toISOString();
  const env = {
    SNAPSHOT_BASES: 'https://snapshot-fallback.test/snapshot/latest',
    TVBOX_KV: {
      async get(key) {
        if (key === 'hot:last-success') return JSON.stringify({ ok: true, generatedAt, contentChangedAt: generatedAt });
        return null;
      },
    },
  };
  try {
    const res = await worker.fetch(
      new Request('https://tv.webhome.eu.org/agg?ac=videolist&t=10&pg=1&limit=24'),
      env,
      { waitUntil() {} },
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.list?.[0]?.vod_name, '前一有效院线电影');
    assert.equal(data.content_revision, 'snapshot-previous-good');
    assert.equal(data.fallback_level, 'previous-valid-snapshot');
    assert.equal(requests.some((url) => url.endsWith('/snapshot/previous/manifest.json')), true);
    assert.equal(requests.some((url) => url.endsWith('/snapshot/previous/catalog-packs/t10-p1-limit24.json')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
