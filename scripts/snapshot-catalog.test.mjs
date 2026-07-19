import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SNAPSHOT_CATEGORIES,
  SNAPSHOT_PRIMARY_CATEGORIES,
  LEGACY_CATEGORY_PACKS,
  buildCatalogViews,
  buildSnapshotIndexes,
  buildSnapshotRevision,
  crawlIncrementalCatalog,
  extractUpdatedAt,
  mergeSnapshotRows,
  normalizeSnapshotRows,
  snapshotRetentionGate,
} from '../src/snapshot-catalog.mjs';

function movie(overrides = {}) {
  return {
    vod_id: 'movie-1',
    vod_name: '流浪地球',
    vod_year: '2019',
    vod_actor: '吴京',
    type_id: '10',
    type_name: '院线电影',
    vod_time: '2026-07-18 08:00:00',
    ...overrides,
  };
}

test('snapshot category contract exposes 13 visible views, 12 primary owners and legacy unions', () => {
  assert.deepEqual(
    SNAPSHOT_CATEGORIES.map(({ id, key, name }) => [id, key, name]),
    [
      ['0', 'recommend', '推荐'],
      ['10', 'theatrical_movie', '院线电影'],
      ['11', 'web_movie', '网络电影'],
      ['12', 'other_movie', '其他电影'],
      ['20', 'tv_series', '电视剧'],
      ['21', 'web_series', '网络剧'],
      ['6', 'web_short', '网络短剧'],
      ['3', 'variety', '综艺'],
      ['4', 'anime', '动漫'],
      ['5', 'documentary', '纪录片'],
      ['7', 'explainer', '解说'],
      ['8', 'knowledge', '文娱知识'],
      ['9', 'adult', '成人伦理'],
    ],
  );
  assert.deepEqual(LEGACY_CATEGORY_PACKS, {
    1: ['theatrical_movie', 'web_movie', 'other_movie'],
    2: ['tv_series', 'web_series'],
    6: ['web_short'],
  });
  assert.equal(SNAPSHOT_CATEGORIES.length, 13);
  assert.equal(SNAPSHOT_PRIMARY_CATEGORIES.length, 12);
  assert.equal(SNAPSHOT_PRIMARY_CATEGORIES.some((category) => category.key === 'recommend'), false);
});

test('normalization delegates canonical id and primary category to content-model', () => {
  const [row] = normalizeSnapshotRows([movie()]);
  assert.match(row.canonical_id, /^meta:/);
  assert.equal(row.primary_category, 'theatrical_movie');
  assert.equal(row.source_category_id, '10');
  assert.equal(row.vod_time, '2026-07-18 08:00:00');
});

test('global dedupe ignores category and merges source candidates and play lines', () => {
  const rows = normalizeSnapshotRows([
    movie({
      source_category_id: '10',
      _sourceSlug: 'alpha',
      vod_id: 'a-1',
      play_lines: [{ source: 'alpha', name: '高清', url: 'https://a.test/1.m3u8' }],
    }),
    movie({
      type_id: '11',
      type_name: '网络电影',
      source_category_id: '11',
      _sourceSlug: 'beta',
      vod_id: 'b-9',
      play_lines: [{ source: 'beta', name: '蓝光', url: 'https://b.test/1.m3u8' }],
    }),
  ]);
  const merged = mergeSnapshotRows(rows);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.duplicate_count, 1);
  assert.equal(merged.rows[0].primary_category, 'theatrical_movie');
  assert.match(merged.rows[0].vod_id, /^agg_/);
  assert.deepEqual(merged.rows[0].source_candidates.map((x) => x.source).sort(), ['alpha', 'beta']);
  assert.equal(merged.rows[0].play_lines.length, 2);
});

test('semantic dedupe merges external and fallback identities only when title year and creators agree', () => {
  const common = {
    vod_name: '唐人街探案网剧',
    vod_year: '2020',
    vod_actor: '邱泽,张钧甯',
    vod_director: '柯汶利,戴墨',
    type_id: '21',
    type_name: '网络剧',
  };
  const merged = mergeSnapshotRows([
    movie({ ...common, vod_id: 'with-external', vod_douban_id: '30354606', _sourceSlug: 'alpha' }),
    movie({ ...common, vod_id: 'without-external', vod_douban_id: '0', _sourceSlug: 'beta' }),
  ]);
  const disjoint = mergeSnapshotRows([
    movie({ ...common, vod_id: 'creator-a', vod_actor: '演员甲', vod_director: '导演甲', _sourceSlug: 'alpha' }),
    movie({ ...common, vod_id: 'creator-b', vod_actor: '演员乙', vod_director: '导演乙', _sourceSlug: 'beta' }),
  ]);
  const conflictingExternal = mergeSnapshotRows([
    movie({ ...common, vod_id: 'ext-a', vod_douban_id: '111', _sourceSlug: 'alpha' }),
    movie({ ...common, vod_id: 'ext-b', vod_douban_id: '222', _sourceSlug: 'beta' }),
  ]);

  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].canonical_id, 'ext:douban:30354606');
  assert.deepEqual(merged.rows[0].source_candidates.map((row) => row.source).sort(), ['alpha', 'beta']);
  assert.equal(disjoint.rows.length, 2);
  assert.equal(conflictingExternal.rows.length, 2);
});

test('catalog views keep primary categories mutually exclusive and derive recommendation', () => {
  const rows = normalizeSnapshotRows([
    movie(),
    movie({ vod_id: 'web-movie', vod_name: '网大甲', vod_year: '2025', vod_actor: '甲', type_id: '11', type_name: '网络电影' }),
    movie({ vod_id: 'other-movie', vod_name: '电影乙', vod_year: '2024', vod_actor: '乙', type_id: '12', type_name: '其他电影' }),
    movie({ vod_id: 'tv', vod_name: '天道', vod_year: '2008', vod_actor: '王志文', type_id: '20', type_name: '电视剧' }),
    movie({ vod_id: 'web-tv', vod_name: '网剧丙', vod_year: '2026', vod_actor: '丙', type_id: '21', type_name: '网络剧' }),
    movie({ vod_id: 'short', vod_name: '微短剧丁', vod_year: '2026', vod_actor: '丁', type_id: '6', type_name: '网络短剧' }),
  ]);
  const views = buildCatalogViews(rows);
  const primaryIds = SNAPSHOT_PRIMARY_CATEGORIES.flatMap((category) => views.canonical[category.key].map((row) => row.canonical_id));
  assert.equal(primaryIds.length, new Set(primaryIds).size);
  assert.equal(views.canonical.recommend.length, views.rows.length);
  assert.equal(views.canonical.recommend.some((row) => row.primary_category === 'recommend'), false);
  assert.equal(views.legacy['1'].length, 3);
  assert.equal(views.legacy['2'].length, 2);
  assert.equal(views.legacy['6'].length, 1);
  assert.equal(new Set(views.legacy['1'].map((row) => row.canonical_id)).size, 3);
});

test('snapshot indexes use 500-1000 row shards and full/clean share one revision', () => {
  const rows = Array.from({ length: 1_501 }, (_, index) => movie({
    vod_id: `m-${index}`,
    vod_name: index === 1_499 ? '\u5348\u591c\u6210\u4eba\u5267\u573a' : `院线电影${index}`,
    vod_year: String(2000 + (index % 27)),
    vod_actor: `演员${index}`,
    type_id: index === 1_500 ? '9' : '10',
    type_name: index === 1_500 ? '成人伦理' : '院线电影',
  }));
  const normalized = normalizeSnapshotRows(rows);
  const revision = buildSnapshotRevision(normalized);
  const indexes = buildSnapshotIndexes(normalized, { revision, shardSize: 750 });
  assert.equal(indexes.full.revision, revision);
  assert.equal(indexes.clean.revision, revision);
  assert.deepEqual(indexes.full.catalogShards.map((x) => x.rows.length), [750, 750, 1]);
  assert.deepEqual(indexes.full.searchShards.map((x) => x.documents.length), [750, 750, 1]);
  assert.equal(indexes.full.total, 1_501);
  assert.equal(indexes.clean.total, 1_499);
  assert.equal(indexes.clean.catalogShards.flatMap((x) => x.rows).some((x) => x.primary_category === 'adult'), false);
  assert.equal(indexes.clean.catalogShards.flatMap((x) => x.rows).some((x) => x.vod_id === 'm-1499'), false);
  assert.throws(() => buildSnapshotIndexes(normalized, { revision, shardSize: 499 }), /500.*1000/);
  assert.throws(() => buildSnapshotIndexes(normalized, { revision, shardSize: 1001 }), /500.*1000/);
});

test('snapshot indexes split large rows by serialized byte budget without dropping playback data', () => {
  const rows = Array.from({ length: 520 }, (_, index) => movie({
    vod_id: `large-${index}`,
    vod_name: `large-title-${index}`,
    vod_actor: `large-actor-${index}`,
    vod_play_from: 'direct',
    vod_play_url: `episode$https://media.example/${index}/${'x'.repeat(4096)}.m3u8`,
  }));
  const maxShardBytes = 128 * 1024;
  const indexes = buildSnapshotIndexes(rows, { shardSize: 500, maxShardBytes });
  assert.equal(indexes.full.catalogShards.flatMap((shard) => shard.rows).length, rows.length);
  assert.equal(indexes.full.catalogShards.length > 2, true);
  assert.equal(indexes.full.catalogShards.every((shard) => Buffer.byteLength(JSON.stringify(shard, null, 2), 'utf8') <= maxShardBytes), true);
  assert.equal(indexes.full.searchShards.every((shard) => Buffer.byteLength(JSON.stringify(shard, null, 2), 'utf8') <= maxShardBytes), true);
  assert.match(indexes.full.catalogShards[0].rows[0].vod_play_url, /media\.example/u);
  assert.equal(indexes.full.catalogShards.map((shard) => shard.start).every((start, index, starts) => index === 0 || start > starts[index - 1]), true);
  assert.throws(
    () => buildSnapshotIndexes([rows[0]], { shardSize: 500, maxShardBytes: 1024 }),
    /single snapshot shard item exceeds/u,
  );
});

test('revision is content-derived and does not change with row order or generated time', () => {
  const rows = normalizeSnapshotRows([
    movie(),
    movie({ vod_id: 'm2', vod_name: '电影乙', vod_actor: '演员乙', vod_year: '2024', type_id: '12', type_name: '其他电影' }),
  ]);
  assert.equal(buildSnapshotRevision(rows), buildSnapshotRevision([...rows].reverse()));
  assert.notEqual(buildSnapshotRevision(rows), buildSnapshotRevision(rows.map((row, index) => index ? row : { ...row, vod_serial: '更新至12集' })));
});

test('atomic publication rejects catastrophic catalog shrink even when the source quorum is healthy', () => {
  assert.equal(snapshotRetentionGate({ previousCount: 990, nextCount: 401, sourceQuorumRatio: 1 }).ok, false);
  assert.equal(snapshotRetentionGate({ previousCount: 990, nextCount: 900, sourceQuorumRatio: 1 }).ok, true);
  assert.equal(snapshotRetentionGate({ previousCount: 0, nextCount: 20, sourceQuorumRatio: 1 }).ok, true);
});

test('incremental crawl stops only after two older unchanged pages and keeps prior catalog', async () => {
  const previousRows = normalizeSnapshotRows([
    movie({ vod_id: 'old-1', vod_name: '旧片一', vod_actor: '甲', vod_time: '2026-07-17 12:00:00' }),
    movie({ vod_id: 'old-2', vod_name: '旧片二', vod_actor: '乙', vod_time: '2026-07-17 11:00:00' }),
  ]);
  const pages = new Map([
    [1, { page: 1, pagecount: 9, list: [movie({ vod_id: 'new', vod_name: '新片', vod_actor: '新', vod_time: '2026-07-18 09:00:00' })] }],
    [2, { page: 2, pagecount: 9, list: [movie({ vod_id: 'old-1', vod_name: '旧片一', vod_actor: '甲', vod_time: '2026-07-17 12:00:00' })] }],
    [3, { page: 3, pagecount: 9, list: [movie({ vod_id: 'old-2', vod_name: '旧片二', vod_actor: '乙', vod_time: '2026-07-17 11:00:00' })] }],
    [4, { page: 4, pagecount: 9, list: [movie({ vod_id: 'must-not-fetch', vod_name: '不应抓取', vod_actor: '丙' })] }],
  ]);
  const fetched = [];
  const checkpoints = [];
  const result = await crawlIncrementalCatalog({
    previousRows,
    watermark: '2026-07-18T00:00:00.000Z',
    fetchPage: async (page) => { fetched.push(page); return pages.get(page); },
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
    maxPages: 20,
  });
  assert.deepEqual(fetched, [1, 2, 3]);
  assert.equal(result.stopReason, 'two-stale-pages');
  assert.equal(result.rows.some((row) => row.vod_name === '新片'), true);
  assert.equal(result.rows.some((row) => row.vod_name === '旧片一'), true);
  assert.equal(result.nextPage, 4);
  assert.equal(checkpoints.at(-1).consecutiveStalePages, 2);
  assert.equal(extractUpdatedAt(result.rows), '2026-07-18T01:00:00.000Z');
});

test('future upstream timestamps remain raw evidence but cannot advance watermarks', async () => {
  const nowMs = Date.parse('2026-07-19T00:00:00.000Z');
  const poisoned = normalizeSnapshotRows([
    movie({
      vod_id: 'future-poisoned',
      vod_name: '未来时间污染样例',
      vod_time: '2026-08-07 12:00:00',
      vod_time_add: '2026-07-18 23:30:00',
    }),
  ]);
  assert.equal(poisoned[0].vod_time, '2026-08-07 12:00:00');
  assert.equal(extractUpdatedAt(poisoned, { nowMs }), '2026-07-18T15:30:00.000Z');
  assert.equal(extractUpdatedAt([
    movie({ vod_id: 'future-only', vod_time: '2026-08-07 12:00:00', vod_time_add: '' }),
  ], { nowMs }), '');

  const previousRows = normalizeSnapshotRows([
    movie({ vod_id: 'stable', vod_name: '稳定节目', vod_time: '2026-07-18 10:00:00' }),
  ]);
  const fetched = [];
  const result = await crawlIncrementalCatalog({
    nowMs,
    previousRows,
    watermark: '2026-08-07T04:00:00.000Z',
    maxPages: 5,
    fetchPage: async (page) => {
      fetched.push(page);
      return {
        page,
        pagecount: 2,
        list: [movie({ vod_id: 'stable', vod_name: '稳定节目', vod_time: '2026-07-18 10:00:00' })],
      };
    },
  });
  assert.deepEqual(fetched, [1, 2]);
  assert.equal(result.stopReason, 'pagecount');
  assert.equal(result.watermark, '2026-07-18T02:00:00.000Z');
});

test('resume starts from persisted next page and preserves collected rows', async () => {
  const fetched = [];
  const collectedRows = normalizeSnapshotRows([
    movie({ vod_id: 'resume-1', vod_name: '已抓页面节目', vod_actor: '甲' }),
  ]);
  const result = await crawlIncrementalCatalog({
    previousRows: [],
    collectedRows,
    resume: { nextPage: 3, consecutiveStalePages: 0 },
    fetchPage: async (page) => {
      fetched.push(page);
      return { page, pagecount: 3, list: [movie({ vod_id: 'resume-2', vod_name: '续跑节目', vod_actor: '乙' })] };
    },
  });
  assert.deepEqual(fetched, [3]);
  assert.equal(result.stopReason, 'pagecount');
  assert.equal(result.rows.length, 2);
});

test('generator publishes an atomic 13-class snapshot with legacy packs and one dual-policy revision', { timeout: 30_000 }, async () => {
  const samples = Object.fromEntries(SNAPSHOT_CATEGORIES.map((category, index) => [category.id, [{
    vod_id: `vod-${category.id}`,
    vod_name: category.key === 'tv_series' ? '天道' : `${category.name}样例`,
    vod_sub: category.key === 'tv_series' ? '遥远的救世主' : '',
    vod_actor: category.key === 'tv_series' ? '王志文' : `演员${index}`,
    vod_director: `导演${index}`,
    vod_year: '2026',
    vod_time: '2026-07-18 10:00:00',
    vod_class: '\u52a8\u4f5c',
    type_id: category.id,
    type_name: category.name,
    vod_remarks: '高清',
  }]]));
  samples['12'][0].vod_name = '单手灭天道你跟我说这是练气期';
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push(url.pathname + url.search);
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (url.pathname !== '/agg') {
      response.statusCode = 404;
      response.end(JSON.stringify({ code: 0, list: [] }));
      return;
    }
    if (url.searchParams.get('ids')) {
      response.end(JSON.stringify({ code: 1, list: [{
        ...samples['10'][0],
        vod_play_from: '直连',
        vod_play_url: '正片$https://media.test/movie.m3u8',
      }] }));
      return;
    }
    const categoryId = url.searchParams.get('t') || '0';
    response.end(JSON.stringify({
      code: 1,
      msg: 'ok',
      page: 1,
      pagecount: 1,
      limit: 24,
      total: 1,
      class: SNAPSHOT_CATEGORIES.map((category) => ({ type_id: category.id, type_name: category.name })),
      filters: { [categoryId]: [{ key: 'class', name: '\u7c7b\u578b', value: [{ n: '\u52a8\u4f5c', v: '\u52a8\u4f5c' }] }] },
      list: samples[categoryId] || [],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const output = await mkdtemp(path.join(tmpdir(), 'tvbox-snapshot-test-'));
  const runGenerator = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/generate-snapshot.mjs'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        SNAPSHOT_SOURCE_BASE: `http://127.0.0.1:${address.port}`,
        SNAPSHOT_CRAWL_MODE: 'aggregate',
        SNAPSHOT_OUTPUT_DIR: output,
        SNAPSHOT_CRAWL_LIMIT: '24',
        SNAPSHOT_MAX_PAGES: '10',
        SNAPSHOT_SHARD_SIZE: '500',
        STATIC_SNAPSHOT_BASES: '',
        PUBLIC_BASE: 'https://tv.example.test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`generator exited ${code}\noutput=${output}\nrequests=${JSON.stringify(requests)}\n${stdout}\n${stderr}`));
    });
  });

  let completed = false;
  try {
    await runGenerator();
    const latest = path.join(output, 'snapshot', 'latest');
    const manifest = JSON.parse(await readFile(path.join(latest, 'manifest.json'), 'utf8'));
    const sources = JSON.parse(await readFile(path.join(latest, 'sources.json'), 'utf8'));
    const config = JSON.parse(await readFile(path.join(output, 'config.json'), 'utf8'));
    const cleanConfig = JSON.parse(await readFile(path.join(output, 'config-clean.json'), 'utf8'));
    const tianDaoSearch = JSON.parse(await readFile(path.join(latest, 'search-packs', `${encodeURIComponent('天道')}-p1-limit24.json`), 'utf8'));
    const aliasSearch = JSON.parse(await readFile(path.join(latest, 'search-packs', `${encodeURIComponent('遥远的救世主')}-p1-limit24.json`), 'utf8'));
    const actorSearch = JSON.parse(await readFile(path.join(latest, 'search-packs', `${encodeURIComponent('王志文')}-p1-limit24.json`), 'utf8'));
    const cleanFilterIndex = JSON.parse(await readFile(path.join(latest, 'filter-index', 'clean', 't10', `class-${Buffer.from('\u52a8\u4f5c').toString('base64url')}-limit24.json`), 'utf8'));
    assert.equal(manifest.categories.length, 13);
    assert.equal(manifest.categories.find((category) => category.type_id === '0')?.total, 12);
    assert.equal(manifest.categories.filter((category) => category.type_id !== '0').every((category) => category.total === 1), true);
    assert.equal(manifest.variants.full.revision, manifest.variants.clean.revision);
    assert.equal(manifest.variants.full.total, 12);
    assert.equal(manifest.variants.clean.total, 11);
    assert.equal(manifest.variants.clean.categories['20'].total, 1);
    assert.equal(manifest.cleanFilterIndexCount > 0, true);
    assert.equal(cleanFilterIndex.total, 1);
    assert.deepEqual(cleanFilterIndex.clean_counts, [1]);
    assert.equal(manifest.shardSize, 500);
    assert.equal(manifest.indexes.full.catalogShards[0].count, 12);
    assert.equal(manifest.indexes.clean.catalogShards[0].count, 11);
    assert.equal(manifest.legacyPacks['1'].canonicalKeys.length, 3);
    assert.equal(manifest.legacyPacks['2'].canonicalKeys.length, 2);
    assert.deepEqual(manifest.legacyPacks['6'].canonicalKeys, ['web_short']);
    assert.equal(manifest.files.sources, 'sources.json');
    assert.equal(sources.count > 0, true);
    assert.equal(sources.count, new Set(sources.rows.map((row) => row.physicalSourceKey)).size);
    await readFile(path.join(latest, 'catalog-packs', 't1-p1-limit24.json'), 'utf8');
    await readFile(path.join(latest, 'catalog-packs', 't2-p1-limit24.json'), 'utf8');
    await readFile(path.join(latest, 'catalog-packs', 't6-p1-limit24.json'), 'utf8');
    await readFile(path.join(latest, 'catalog-packs', 'clean', 't20-p1-limit24.json'), 'utf8');
    assert.match(config.sites[0].name, /^影视点播 · \d{12}$/u);
    assert.match(cleanConfig.sites[0].name, /^影视点播洁净 · \d{12}$/u);
    assert.equal(requests.some((entry) => new URL(entry, 'http://127.0.0.1').searchParams.get('wd') === '天道'), true);
    assert.equal(tianDaoSearch.list[0]?.vod_name, '天道');
    assert.equal(aliasSearch.list[0]?.vod_name, '天道');
    assert.equal(actorSearch.list[0]?.vod_name, '天道');
    assert.equal(path.basename(latest), 'latest');

    const firstChangedAt = manifest.content_changed_at;
    await runGenerator();
    const secondManifest = JSON.parse(await readFile(path.join(latest, 'manifest.json'), 'utf8'));
    const previous = path.join(output, 'snapshot', 'previous');
    const previousAfterUnchangedBuild = JSON.parse(await readFile(path.join(previous, 'manifest.json'), 'utf8'));
    assert.equal(secondManifest.revision, manifest.revision);
    assert.equal(secondManifest.content_changed_at, firstChangedAt);
    assert.equal(secondManifest.variants.full.revision, secondManifest.variants.clean.revision);
    assert.equal(secondManifest.fileBudget.prunedFromPrevious > 0, true);
    assert.equal(previousAfterUnchangedBuild.revision, manifest.revision);
    await readFile(path.join(previous, 'catalog-packs', 't20-p1-limit24.json'), 'utf8');
    await assert.rejects(readFile(path.join(previous, 'filter-packs', 't10', `class-${Buffer.from('\u52a8\u4f5c').toString('base64url')}-p1-limit24.json`), 'utf8'), /ENOENT/u);
    await assert.rejects(readFile(path.join(previous, 'filter-index', 'clean', 't10', `class-${Buffer.from('\u52a8\u4f5c').toString('base64url')}-limit24.json`), 'utf8'), /ENOENT/u);

    samples['20'][0].vod_serial = '12';
    samples['20'][0].vod_remarks = '更新至12集';
    await runGenerator();
    const thirdManifest = JSON.parse(await readFile(path.join(latest, 'manifest.json'), 'utf8'));
    const previousAfterChangedBuild = JSON.parse(await readFile(path.join(previous, 'manifest.json'), 'utf8'));
    assert.notEqual(thirdManifest.revision, secondManifest.revision);
    assert.equal(previousAfterChangedBuild.revision, secondManifest.revision);
    assert.equal(thirdManifest.content_changed_at === secondManifest.content_changed_at, false);
    completed = true;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (completed) await rm(output, { recursive: true, force: true });
  }
});
