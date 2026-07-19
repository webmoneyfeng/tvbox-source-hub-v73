import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';

function jsonResponse(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

function makeVod(name, id, extra = {}) {
  return {
    vod_id: id,
    vod_name: name,
    vod_pic: '',
    type_id: extra.type_id || '1',
    type_name: extra.type_name || '电影',
    vod_year: extra.vod_year || '2026',
    vod_remarks: extra.vod_remarks || '高清 · 2线',
    vod_class: extra.vod_class || '动作',
    semantic_tags: extra.semantic_tags || '电影 正片 高清',
    ...extra,
  };
}

function installHotOverlayFetchMock() {
  const realFetch = globalThis.fetch;
  const now = new Date().toISOString();
  const revision = 'snapshot-hot-overlay-test';
  const snapshotManifest = {
    ok: true,
    version: 'test',
    generatedAt: now,
    revision,
    content_revision: revision,
    categories: [
      '推荐', '院线电影', '网络电影', '其他电影', '电视剧', '网络剧', '网络短剧',
      '综艺', '动漫', '纪录片', '解说', '文娱知识', '成人伦理',
    ].map((type_name, index) => ({ type_id: String(index), type_name, count: 1, total: 1 })),
    variants: { full: { revision, total: 13 }, clean: { revision, total: 12 } },
    errors: [],
    warnings: [],
  };
  const hotManifest = { ok: true, version: 'test', generatedAt: now, finishedAt: now, errors: [], warnings: [], files: { catalog: 'catalog-hot.json', search: 'search-hot.json' } };
  const categories = [{ type_id: '1', type_name: '电影', filters: [] }];
  const snapshotMoviePack = { code: 1, msg: 'ok', class: categories, page: 1, pagecount: 5, limit: 24, total: 100, list: [makeVod('快照旧电影', 'snap-old'), makeVod('同名影片', 'snap-dup', { vod_year: '2025' })] };
  const cleanMoviePack = { code: 1, msg: 'ok', class: categories, page: 1, pagecount: 1, limit: 24, total: 1, list: [makeVod('洁净专属电影', 'clean-only')] };
  const cleanFilterIndex = { code: 1, msg: 'ok', content_revision: revision, policy: 'clean-no-adult', source_pack_limit: 24, source_pagecount: 2, source_total: 9, total: 8, clean_counts: [7, 1] };
  const fullFilterPack1 = {
    code: 1,
    msg: 'ok',
    content_revision: revision,
    class: categories,
    page: 1,
    pagecount: 2,
    limit: 24,
    total: 9,
    list: [
      ...Array.from({ length: 7 }, (_, index) => makeVod(`洁净筛选电影${index + 1}`, `clean-filter-${index + 1}`)),
      makeVod('成人筛选电影', 'adult-filter', { type_id: '9', type_name: '成人伦理' }),
    ],
  };
  const fullFilterPack2 = { ...fullFilterPack1, page: 2, list: [makeVod('洁净补位电影', 'clean-refill')] };
  const hotMoviePack = { code: 1, msg: 'ok', class: categories, page: 1, pagecount: 1, limit: 24, total: 2, list: [makeVod('热点新电影', 'hot-new'), makeVod('同名影片', 'hot-dup', { vod_year: '2025', vod_remarks: '4K · 3线' })], hot_category: { t: '1', name: '电影' } };
  const snapshotSearchPack = { code: 1, msg: 'ok', class: categories, page: 1, pagecount: 1, limit: 24, total: 1, list: [makeVod('天道快照旧结果', 'snap-search', { type_id: '2', type_name: '剧集', semantic_tags: '剧集 正片' })] };
  const cleanSearchPack = { code: 1, msg: 'ok', class: categories, page: 1, pagecount: 1, limit: 24, total: 1, list: [makeVod('洁净天道结果', 'clean-search', { type_id: '2', type_name: '剧集', semantic_tags: '剧集 正片' })] };
  const hotSearchPack = { code: 1, msg: 'ok', class: categories, page: 1, pagecount: 1, limit: 24, total: 1, list: [makeVod('天道', 'hot-tiandao', { type_id: '2', type_name: '剧集', vod_year: '2008', semantic_tags: '剧集 正片 王志文' })], hot_search: { wd: '天道' } };
  hotSearchPack.list.push(makeVod('\u5929\u9053\u8272\u60c5\u5f71\u7247', 'hot-adult-search', { type_id: '12', type_name: '\u5176\u4ed6\u7535\u5f71', vod_class: '\u5267\u60c5,\u8272\u60c5', vod_content: '\u8272\u60c5\u5185\u5bb9' }));

  globalThis.fetch = async (input) => {
    const url = String(input?.url || input || '');
    if (url.endsWith('/snapshot/latest/manifest.json')) return jsonResponse(snapshotManifest);
    if (url.endsWith('/snapshot/latest/catalog-packs/clean/t1-p1-limit24.json')) return jsonResponse(cleanMoviePack);
    if (url.endsWith('/snapshot/latest/catalog-packs/t1-p1-limit24.json')) return jsonResponse(snapshotMoviePack);
    if (url.endsWith(`/snapshot/latest/filter-index/clean/t1/class-${Buffer.from('动作').toString('base64url')}-limit24.json`)) return jsonResponse(cleanFilterIndex);
    if (url.endsWith(`/snapshot/latest/filter-packs/t1/class-${Buffer.from('动作').toString('base64url')}-p1-limit24.json`)) return jsonResponse(fullFilterPack1);
    if (url.endsWith(`/snapshot/latest/filter-packs/t1/class-${Buffer.from('动作').toString('base64url')}-p2-limit24.json`)) return jsonResponse(fullFilterPack2);
    const decodedPath = (() => { try { return decodeURIComponent(new URL(url).pathname); } catch { return url; } })();
    const decodedTwicePath = (() => { try { return decodeURIComponent(decodedPath); } catch { return decodedPath; } })();
    if (decodedPath.endsWith('/snapshot/latest/search-packs/%E5%A4%A9%E9%81%93-p1-limit24.json') || decodedTwicePath.endsWith('/snapshot/latest/search-packs/??-p1-limit24.json') || url.endsWith('/snapshot/latest/search-packs/%E5%A4%A9%E9%81%93-p1-limit24.json')) return jsonResponse(snapshotSearchPack);
    if (decodedTwicePath.includes('/snapshot/latest/search-packs/clean/') && decodedTwicePath.endsWith('/天道-p1-limit24.json')) return jsonResponse(cleanSearchPack);
    if (url.endsWith('/hot/latest/manifest.json')) return jsonResponse(hotManifest);
    if (url.endsWith('/hot/latest/catalog/1.json')) return jsonResponse(hotMoviePack);
    if (decodedPath.endsWith('/hot/latest/search/%E5%A4%A9%E9%81%93.json') || decodedTwicePath.endsWith('/hot/latest/search/??.json') || url.endsWith('/hot/latest/search/%25E5%25A4%25A9%25E9%2581%2593.json')) return jsonResponse(hotSearchPack);
    return new Response('{}', { status: 404 });
  };
  return () => { globalThis.fetch = realFetch; };
}

function env() {
  return {
    SNAPSHOT_BASES: 'https://static.example.test/snapshot/latest',
    TVBOX_KV: { async get() { return null; } },
  };
}

test('aggregate category overlays hot rows before snapshot rows and reports hot diagnostics', async () => {
  const restore = installHotOverlayFetchMock();
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg?ac=videolist&t=1&pg=1&limit=8'), env());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.hot_overlay_applied, true);
    assert.equal(data.hot_rows_used, 2);
    assert.equal(data.hot_duplicate_removed, 1);
    assert.equal(data.total, 100);
    assert.equal(data.list[0].vod_name, '热点新电影');
    assert.deepEqual(data.list.map((x) => x.vod_name).filter((x) => x === '同名影片'), ['同名影片']);
  } finally {
    restore();
  }
});

test('aggregate search overlays hot search rows and keeps exact title first', async () => {
  const restore = installHotOverlayFetchMock();
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg?wd=天道&limit=8'), env());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.hot_overlay_applied, true);
    assert.equal(data.hot_rows_used, 2);
    assert.deepEqual(data.hot_search_terms_hit, ['天道']);
    assert.equal(data.list[0].vod_name, '天道');
  } finally {
    restore();
  }
});

test('clean search hot overlay removes strong erotic evidence even outside adult category', async () => {
  const restore = installHotOverlayFetchMock();
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg-clean?wd=天道&limit=8'), env());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.list.some((item) => item.vod_id === 'hot-adult-search'), false);
  } finally {
    restore();
  }
});

test('clean aggregate reads the clean search pack', async () => {
  const restore = installHotOverlayFetchMock();
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg-clean?wd=天道&limit=8'), env());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content_policy, 'clean-no-adult');
    assert.equal(data.list.some((item) => item.vod_name === '洁净天道结果'), true);
  } finally {
    restore();
  }
});

test('clean aggregate reads the clean category pack before applying the clean policy', async () => {
  const restore = installHotOverlayFetchMock();
  try {
    const res = await worker.fetch(new Request('https://tv.webhome.eu.org/agg-clean?ac=videolist&t=1&pg=1&limit=8'), env());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content_policy, 'clean-no-adult');
    assert.equal(data.list.some((item) => item.vod_name === '洁净专属电影'), true);
    assert.equal(data.list.some((item) => /成人|伦理/.test(item.vod_name || '')), false);
  } finally {
    restore();
  }
});

test('clean aggregate uses the clean filter index to refill a page from full filter packs', async () => {
  const restore = installHotOverlayFetchMock();
  try {
    const filter = encodeURIComponent(JSON.stringify({ class: '动作' }));
    const res = await worker.fetch(new Request(`https://tv.webhome.eu.org/agg-clean?ac=videolist&t=1&pg=1&limit=8&f=${filter}`), env());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content_policy, 'clean-no-adult');
    assert.equal(data.snapshot_mode, 'clean-filter-index');
    assert.equal(data.total, 8);
    assert.equal(data.list.length, 8);
    assert.equal(data.list.some((item) => item.vod_name === '洁净补位电影'), true);
    assert.equal(data.list.some((item) => /成人|伦理/.test(item.vod_name || '')), false);
  } finally {
    restore();
  }
});
