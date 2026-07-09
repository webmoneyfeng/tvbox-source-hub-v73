import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { sanitizeAggResponseForPolicy } from '../src/worker.mjs';

function noSnapshotEnv() {
  return {
    SNAPSHOT_BASES: 'data:',
    TVBOX_KV: {
      async get(key) {
        if (key === 'channels') return '[]';
        if (key === 'vod_catalog') return '[]';
        return null;
      },
    },
  };
}

test('clean config exposes a separate no-adult TVBox entry without changing live delivery', async () => {
  const res = await worker.fetch(new Request('https://tv.webhome.eu.org/config-clean.json'), noSnapshotEnv());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const data = await res.json();
  assert.equal(data.sites.length, 1);
  assert.equal(data.sites[0].key, 'vod_unified_clean');
  assert.equal(data.sites[0].name, '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0');
  assert.match(data.sites[0].api, /^https:\/\/tv\.webhome\.eu\.org\/agg-clean(?:\/u\d{12})?$/);
  assert.equal(data.lives[0].url, 'https://tv.webhome.eu.org/live.txt');
  assert.doesNotMatch(JSON.stringify(data), /成人|伦理/);
});

test('config keeps stable clean site name while versioned api carries hot-probe update code', async () => {
  const env = noSnapshotEnv();
  const generatedAt = new Date().toISOString();
  env.TVBOX_KV.get = async (key) => {
    if (key === 'hot:last-success') return JSON.stringify({ ok: true, generatedAt, visibleUpdateText: '000000000000', okSources: 2, checkedSources: 6, totalItems: 48 });
    if (key === 'channels') return '[]';
    if (key === 'vod_catalog') return '[]';
    return null;
  };
  const res = await worker.fetch(new Request('https://tv.webhome.eu.org/config-clean.json'), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const data = await res.json();
  assert.equal(data.sites[0].key, 'vod_unified_clean');
  assert.equal(data.sites[0].name, '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0');
  assert.match(data.sites[0].api, /^https:\/\/tv\.webhome\.eu\.org\/agg-clean\/u\d{12}$/);
  assert.doesNotMatch(JSON.stringify(data), /成人|伦理/);
});


test('versioned aggregate path from config remains routable and no-store for fresh visible labels', async () => {
  const env = noSnapshotEnv();
  const generatedAt = new Date().toISOString();
  env.TVBOX_KV.get = async (key) => {
    if (key === 'hot:last-success') return JSON.stringify({ ok: true, generatedAt, visibleUpdateText: '000000000000', okSources: 2, checkedSources: 6, totalItems: 48 });
    if (key === 'channels') return '[]';
    if (key === 'vod_catalog') return '[]';
    return null;
  };
  const configRes = await worker.fetch(new Request('https://tv.webhome.eu.org/config.json?fresh=1'), env);
  assert.equal(configRes.status, 200);
  assert.match(configRes.headers.get('cache-control') || '', /no-store/);
  const config = await configRes.json();
  assert.equal(config.sites[0].name, '\u5f71\u89c6\u70b9\u64ad');
  assert.match(config.sites[0].api, /^https:\/\/tv\.webhome\.eu\.org\/agg\/u\d{12}$/);
  const aggRes = await worker.fetch(new Request(config.sites[0].api + '?fresh=1'), env);
  assert.equal(aggRes.status, 200);
  assert.match(aggRes.headers.get('cache-control') || '', /no-store/);
  const agg = await aggRes.json();
  assert.match(agg.class?.[0]?.type_name || '', /\d{12}/);
});


test('cached old aggregate path still stamps the latest hot-probe code in category response', async () => {
  const env = noSnapshotEnv();
  const generatedAt = '2026-07-10T02:46:00.000Z';
  const expectedCode = '640101706202';
  env.TVBOX_KV.get = async (key) => {
    if (key === 'hot:last-success') return JSON.stringify({ ok: true, generatedAt, okSources: 2, checkedSources: 6, totalItems: 48 });
    if (key === 'channels') return '[]';
    if (key === 'vod_catalog') return '[]';
    return null;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1'), env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    const data = await res.json();
    assert.equal(data.visible_update_text, expectedCode);
    assert.equal(data.update_label_strategy, 'hot-probe');
    assert.match(data.class?.[0]?.type_name || '', new RegExp(expectedCode));
  } finally {
    globalThis.fetch = realFetch;
  }
});


test('clean aggregate policy removes adult category, filters and rows while full policy preserves them', () => {
  const payload = {
    code: 1,
    msg: 'ok',
    page: 1,
    pagecount: 1,
    limit: 24,
    total: 2,
    class: [
      { type_id: '1', type_name: '电影', filters: [] },
      { type_id: '9', type_name: '成人伦理', filters: [{ key: 'class', value: [{ n: '成人', v: '成人' }] }] },
    ],
    filters: {
      1: [{ key: 'class', value: [{ n: '动作', v: '动作' }] }],
      9: [{ key: 'class', value: [{ n: '成人', v: '成人' }] }],
      adult: [{ key: 'class', value: [{ n: '伦理', v: '伦理' }] }],
    },
    list: [
      { vod_id: 'movie-1', type_id: '1', type_name: '电影', vod_name: '普通电影', vod_remarks: '高清正片' },
      { vod_id: 'adult-1', type_id: '9', type_name: '成人伦理', vod_name: '午夜成人电影', vod_remarks: '高清' },
    ],
  };

  const clean = sanitizeAggResponseForPolicy(payload, { includeAdult: false });
  assert.deepEqual(clean.class.map((x) => x.type_id), ['1']);
  assert.deepEqual(Object.keys(clean.filters), ['1']);
  assert.deepEqual(clean.list.map((x) => x.vod_id), ['movie-1']);
  assert.equal(clean.total, 1);
  assert.equal(clean.content_policy, 'clean-no-adult');

  const full = sanitizeAggResponseForPolicy(payload, { includeAdult: true });
  assert.equal(full.class.length, 2);
  assert.equal(full.list.length, 2);
  assert.equal(full.content_policy, 'full');
});
