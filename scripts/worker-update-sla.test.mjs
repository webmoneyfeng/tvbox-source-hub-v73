import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';
import { HOT_REFRESH_SOURCES } from '../src/source-registry.mjs';

function envWithFreshHotProbe() {
  const generatedAt = new Date().toISOString();
  return {
    SNAPSHOT_BASES: 'data:',
    TVBOX_KV: {
      async get(key) {
        if (key === 'hot:last-success') return JSON.stringify({ ok: true, generatedAt, visibleUpdateText: '000000000000', okSources: 2, checkedSources: 6, totalItems: 48 });
        if (key === 'channels') return '[]';
        if (key === 'vod_catalog') return '[]';
        return null;
      },
    },
  };
}

test('status documents commercial visible update SLA as 5 minute target and 10 minute P95 guard', async () => {
  const res = await worker.fetch(new Request('https://tv.webhome.eu.org/status.json?fresh=1'), envWithFreshHotProbe());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const data = await res.json();
  assert.equal(data.visibleUpdateSource, 'hot-probe');
  assert.equal(data.updateCadence.hotProbeTargetMinutes, 5);
  assert.equal(data.updateCadence.hotProbeFreshGuardMinutes, 10);
  assert.match(data.updateCadence.target, /refresh target <= 5 minutes/);
  assert.match(data.updateCadence.target, /P95 visible guard <= 10 minutes/);
});


function installCmsProbeFetchMock(requests = []) {
  const realFetch = globalThis.fetch;
  const classes = [
    ['10', '院线电影'], ['11', '网络电影'], ['12', '其他电影'], ['20', '电视剧'], ['21', '网络剧'],
    ['6', '网络短剧'], ['3', '综艺'], ['4', '动漫'], ['5', '纪录片'], ['7', '解说'], ['8', '文娱知识'], ['9', '成人伦理'],
  ].map(([type_id, type_name]) => ({ type_id, type_name }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const typeId = url.searchParams.get('t') || '20';
    const typeName = classes.find((row) => row.type_id === typeId)?.type_name || '电视剧';
    return new Response(JSON.stringify({
      code: 1,
      class: classes,
      list: [{ vod_id: `${typeId}-cms-1`, vod_name: `${typeName}更新样例`, type_id: typeId, type_name: typeName, vod_serial: '12' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return () => { globalThis.fetch = realFetch; };
}

test('stale or missing hot probe is refreshed in waitUntil on natural aggregate interaction', async () => {
  const restore = installCmsProbeFetchMock();
  const writes = [];
  const env = {
    SNAPSHOT_BASES: 'https://snapshot.invalid/latest',
    TVBOX_KV: {
      async get() { return null; },
      async put(key, value) { writes.push({ key, value: JSON.parse(value) }); },
    },
  };
  const waited = [];
  const ctx = { waitUntil(promise) { waited.push(promise); } };
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg?ac=videolist&t=1&pg=1&limit=8&fresh=1'), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(waited.length, 1);
    await Promise.all(waited);
    assert.deepEqual(writes.map((x) => x.key), [
      'catalog:hot:hot-' + writes[0].value.content_hash,
      'catalog:active',
      'hot:last-success',
    ]);
    assert.equal(writes[2].value.ok, true);
    assert.equal(writes[2].value.contentChanged, true);
    assert.match(writes[2].value.reason, /^interaction:agg-list:list/);
  } finally {
    restore();
  }
});

test('five-minute Cron writes content atomically and limits unchanged health writes to 30 minutes', async () => {
  const requests = [];
  const restore = installCmsProbeFetchMock(requests);
  const store = new Map();
  const writes = [];
  let now = Date.parse('2026-07-18T02:00:00.000Z');
  const env = {
    __clock: () => now,
    SNAPSHOT_BASES: 'data:',
    TVBOX_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) {
        store.set(key, value);
        writes.push({ key, value: JSON.parse(value) });
      },
    },
  };
  async function runCron() {
    const waited = [];
    worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(promise) { waited.push(promise); } });
    await Promise.all(waited);
  }
  try {
    await runCron();
    const firstRunRequests = requests.splice(0);
    const categoryRequests = firstRunRequests.filter((url) => url.searchParams.has('t'));
    assert.equal(firstRunRequests.length, HOT_REFRESH_SOURCES.length * 2);
    assert.equal(categoryRequests.length, HOT_REFRESH_SOURCES.length);
    assert.equal(new Set(categoryRequests.map((url) => url.searchParams.get('t'))).size, 1);
    assert.equal(firstRunRequests.length <= 30, true);
    assert.deepEqual(writes.map((row) => row.key), [
      'catalog:hot:hot-' + writes[0].value.content_hash,
      'catalog:active',
      'hot:last-success',
    ]);
    assert.equal(writes[0].value.rows.some((row) => row.primary_category === 'theatrical_movie'), true);
    assert.equal(writes[0].value.rows.some((row) => row.primary_category === 'tv_series'), true);

    for (let index = 1; index < 12; index++) {
      now += 5 * 60 * 1000;
      await runCron();
    }
    const activePointer = JSON.parse(store.get('catalog:active'));
    const activePackage = JSON.parse(store.get(activePointer.package_key));
    assert.equal(Object.keys(activePackage.categories).length, 12);

    writes.length = 0;
    now += 5 * 60 * 1000;
    await runCron();
    assert.deepEqual(writes.map((row) => row.key), ['hot:last-success']);
    assert.equal(writes[0].value.contentChanged, false);
  } finally {
    restore();
  }
});

test('Cron keeps future upstream timestamps as evidence without publishing them as source freshness', async () => {
  const realFetch = globalThis.fetch;
  const store = new Map();
  const now = Date.parse('2026-07-18T23:00:00.000Z');
  const expectedSourceUpdate = '2026-07-18 22:55:00';
  const classes = [{ type_id: '20', type_name: '电视剧' }];
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 1,
    class: classes,
    list: [{
      vod_id: 'future-clock-row',
      vod_name: '上游未来时间样例',
      type_id: '20',
      type_name: '电视剧',
      vod_time: '2026-08-07 12:00:00',
      vod_time_add: expectedSourceUpdate,
      vod_serial: '12',
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const env = {
    __clock: () => now,
    SNAPSHOT_BASES: 'data:',
    TVBOX_KV: {
      async get(key) { return store.get(key) || null; },
      async put(key, value) { store.set(key, value); },
    },
  };
  try {
    const waited = [];
    worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(promise) { waited.push(promise); } });
    await Promise.all(waited);
    const health = JSON.parse(store.get('hot:last-success'));
    assert.equal(health.sources.length, HOT_REFRESH_SOURCES.length);
    assert.equal(health.sources.every((source) => source.updated_at === expectedSourceUpdate), true);
    const pointer = JSON.parse(store.get('catalog:active'));
    const hotPackage = JSON.parse(store.get(pointer.package_key));
    assert.equal(hotPackage.rows[0].vod_time, '2026-08-07 12:00:00');
    assert.equal(health.contentChangedAt, new Date(now).toISOString());
  } finally {
    globalThis.fetch = realFetch;
  }
});
