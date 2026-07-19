import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';
import { HOT_REFRESH_SOURCES } from '../src/source-registry.mjs';

const CATEGORY_NAMES = [
  '推荐', '院线电影', '网络电影', '其他电影', '电视剧', '网络剧', '网络短剧',
  '综艺', '动漫', '纪录片', '解说', '文娱知识', '成人伦理',
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

test('Cron intersects stale snapshot rows with the physically unique validated ACTIVE registry', async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.parse('2026-07-18T12:00:00.000Z');
  const revision = 'snapshot-runtime-sources';
  const requests = [];
  const classes = [
    ['10', '院线电影'], ['11', '网络电影'], ['12', '其他电影'], ['20', '电视剧'], ['21', '网络剧'],
    ['6', '网络短剧'], ['3', '综艺'], ['4', '动漫'], ['5', '纪录片'], ['7', '解说'], ['8', '文娱知识'], ['9', '成人伦理'],
  ].map(([type_id, type_name]) => ({ type_id, type_name }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/snapshot/latest/manifest.json')) {
      return json({
        ok: true,
        generatedAt: new Date(now).toISOString(),
        revision,
        content_revision: revision,
        categories: CATEGORY_NAMES.map((type_name, index) => ({ type_id: String(index), type_name, count: 1, total: 1 })),
        variants: { full: { revision, total: 13 }, clean: { revision, total: 12 } },
      });
    }
    if (url.pathname.endsWith('/snapshot/latest/sources.json')) {
      return json({
        ok: true,
        rows: [
          ...HOT_REFRESH_SOURCES,
          { slug: 'rogue', key: 'rogue', short: '越界', name: '越界旧源', api: 'https://rogue.test/api.php/provide/vod/', tier: 'aux', status: 'ACTIVE' },
        ],
      });
    }
    if (HOT_REFRESH_SOURCES.some((source) => new URL(source.api).hostname === url.hostname)) {
      const typeId = url.searchParams.get('t') || '20';
      const typeName = classes.find((row) => row.type_id === typeId)?.type_name || '电视剧';
      return json({ code: 1, class: classes, list: [{ vod_id: `${url.hostname}-${typeId}`, vod_name: `${typeName}更新`, type_id: typeId, type_name: typeName, vod_serial: '12' }] });
    }
    return json({ code: 0, list: [] }, 503);
  };

  const store = new Map();
  const writes = [];
  const env = {
    __clock: () => now,
    SNAPSHOT_BASES: 'https://registry.test/snapshot/latest',
    TVBOX_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) { store.set(key, value); writes.push({ key, value: JSON.parse(value) }); },
    },
  };
  try {
    const waited = [];
    worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(promise) { waited.push(promise); } });
    await Promise.all(waited);
    const expectedHosts = new Set(HOT_REFRESH_SOURCES.map((source) => new URL(source.api).hostname));
    const upstream = requests.filter((url) => expectedHosts.has(url.hostname));
    assert.equal(upstream.length, HOT_REFRESH_SOURCES.length * 2);
    assert.equal(new Set(upstream.map((url) => url.hostname)).size, HOT_REFRESH_SOURCES.length);
    assert.equal(requests.some((url) => url.hostname === 'rogue.test'), false);
    const health = writes.find((row) => row.key === 'hot:last-success')?.value;
    assert.equal(health.sourceQuorum.total, HOT_REFRESH_SOURCES.length);
    assert.equal(health.externalRequests, HOT_REFRESH_SOURCES.length * 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
