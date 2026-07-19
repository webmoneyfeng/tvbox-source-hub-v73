import assert from 'node:assert/strict';
import test from 'node:test';

import { applyProductionRegistryPolicy, classifyCoverage, dedupePhysicalActiveSources, isPlayableUrl, mapLimit, normalizeTitle, queryTermsForItem, rollingSourceStatus, titleMatches } from './audit-source-coverage-v73.mjs';
import { SOURCE_REGISTRY } from '../src/source-registry.mjs';
import { countProxyPlaylistChildren, monthlyCronRuns, parseLiveText, summarizeLiveProxyFromChannels } from './audit-free-tier-v73.mjs';


test('mapLimit preserves input order while bounding concurrent source audits', async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const rows = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    seen.push(value);
    await new Promise((resolve) => setTimeout(resolve, value === 1 ? 30 : 5));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(rows, [10, 20, 30, 40, 50]);
  assert.equal(maxActive, 2);
  assert.deepEqual(seen.slice(0, 2).sort(), [1, 2]);
});

test('source admission counts one ACTIVE source per physical host', () => {
  const rows = dedupePhysicalActiveSources([
    { slug: 'primary', api: 'https://www.example.com/api.php/provide/vod/', tier: 'main', origin: 'current', status: 'ACTIVE', metrics: { searchCount: 3 } },
    { slug: 'mirror', api: 'http://example.com/api.php/provide/vod', tier: 'watch', origin: 'seed', status: 'ACTIVE', metrics: { searchCount: 20 } },
    { slug: 'other', api: 'https://other.example/api.php/provide/vod/', tier: 'aux', origin: 'discovered', status: 'ACTIVE', metrics: { searchCount: 5 } },
  ]);
  assert.deepEqual(rows.filter((row) => row.status === 'ACTIVE').map((row) => row.slug), ['primary', 'other']);
  assert.equal(rows.find((row) => row.slug === 'mirror').admission.code, 'DUPLICATE_PHYSICAL_SOURCE');
  assert.equal(rows.find((row) => row.slug === 'mirror').admission.selectedSlug, 'primary');
});

test('production admission canonicalizes registered sources and quarantines unregistered discoveries', () => {
  const rows = applyProductionRegistryPolicy([
    { slug: 'seed_direct', api: 'https://cj.lziapi.com/api.php/provide/vod/', tier: 'watch', origin: 'seed', status: 'ACTIVE' },
    { slug: 'seed_unregistered', api: 'https://jszyapi.com/api.php/provide/vod/', tier: 'watch', origin: 'seed', status: 'ACTIVE' },
    { slug: 'sony_probe', api: 'https://suoniapi.com/api.php/provide/vod/', tier: 'main', origin: 'seed', status: 'ACTIVE' },
  ], SOURCE_REGISTRY);

  assert.equal(rows[0].slug, 'lzi_direct');
  assert.equal(rows[0].status, 'ACTIVE');
  assert.equal(rows[0].admission.code, 'REGISTERED_ACTIVE');
  assert.equal(rows[1].slug, 'seed_unregistered');
  assert.equal(rows[1].status, 'WATCH');
  assert.equal(rows[1].admission.code, 'UNREGISTERED_CANDIDATE');
  assert.equal(rows[1].admission.observedStatus, 'ACTIVE');
  assert.equal(rows[2].slug, 'sony');
  assert.equal(rows[2].status, 'BLOCKED');
  assert.equal(rows[2].admission.code, 'REGISTERED_BLOCKED');
});

test('rolling source health avoids one-sample flapping and blocks sustained failures', () => {
  const mostlyHealthy = [
    ...Array.from({ length: 22 }, (_, index) => ({ at: String(index), ok: true })),
    { at: '22', ok: false },
    { at: '23', ok: false },
  ];
  assert.deepEqual(rollingSourceStatus(mostlyHealthy, 'BLOCKED'), {
    status: 'ACTIVE', sampleCount: 24, succeeded: 22, successRate: 22 / 24, consecutiveFailures: 2,
  });
  const sustainedFailure = Array.from({ length: 24 }, (_, index) => ({ at: String(index), ok: index < 10 }));
  assert.equal(rollingSourceStatus(sustainedFailure, 'ACTIVE').status, 'BLOCKED');
  assert.equal(rollingSourceStatus([{ at: '0', ok: false }], 'WATCH').status, 'WATCH');
});

test('normalizes classic titles and aliases for coverage checks', () => {
  assert.equal(normalizeTitle('天道 (2008)'), '天道');
  assert.equal(titleMatches({ title: '天道', aliases: ['遥远的救世主'] }, { vod_name: '天道' }), true);
  assert.equal(titleMatches({ title: '天道', aliases: ['遥远的救世主'] }, { vod_name: '遥远的救世主' }), true);
});

test('coverage query terms include title aliases actors and year-title probe', () => {
  const terms = queryTermsForItem({ title: '天道', aliases: ['遥远的救世主'], actors: ['王志文'], year: '2008' });
  assert.deepEqual(terms, ['天道', '遥远的救世主', '王志文', '天道 2008']);
});

test('coverage root cause distinguishes universe gaps and ranking suppression', () => {
  const item = { title: '天道', priority: 'critical' };
  assert.equal(classifyCoverage(item, [], [], false, false).root_cause, 'SOURCE_UNIVERSE_GAP');
  const sourceHits = [{ slug: 'x', hits: [{ vod_name: '天道' }] }];
  const aggRuns = [{ fuzzyIndex: 30, exactIndex: 30 }];
  assert.equal(classifyCoverage(item, sourceHits, aggRuns, true, true).root_cause, 'RANKING_SUPPRESSION');
});


test('coverage classification ignores minority transient 503 when user-visible exact search is repeatedly proven', () => {
  const item = { title: '\u6d41\u6d6a\u5730\u7403', actors: ['\u5434\u4eac'], year: '2019', priority: 'classic' };
  const sourceHits = [{ slug: 'x', hits: [{ vod_name: '\u6d41\u6d6a\u5730\u7403' }] }];
  const aggRuns = [
    { mode: 'user', term: '\u6d41\u6d6a\u5730\u7403', status: 200, fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'user', term: '\u6d41\u6d6a\u5730\u7403', status: 200, fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'user', term: '\u6d41\u6d6a\u5730\u7403', status: 503, fuzzyIndex: -1, exactIndex: -1 },
    { mode: 'user', term: '\u5434\u4eac', status: 200, fuzzyIndex: 0, exactIndex: -1 },
    { mode: 'user', term: '\u5434\u4eac', status: 503, fuzzyIndex: -1, exactIndex: -1 },
    { mode: 'dynamic', term: '\u6d41\u6d6a\u5730\u7403', status: 200, fuzzyIndex: 0, exactIndex: 0 },
  ];
  assert.deepEqual(classifyCoverage(item, sourceHits, aggRuns, true, true), { result: 'PASS', root_cause: 'OK', note: '' });
});

test('coverage classification trusts stable user-visible search over dynamic diagnostic jitter', () => {
  const item = { title: '天道', aliases: ['遥远的救世主'], actors: ['王志文'], year: '2008', priority: 'critical' };
  const sourceHits = [{ slug: 'x', hits: [{ vod_name: '天道' }] }];
  const aggRuns = [
    { mode: 'user', term: '天道', fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'user', term: '天道', fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'user', term: '遥远的救世主', fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'user', term: '王志文', fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'dynamic', term: '天道', fuzzyIndex: -1, exactIndex: -1 },
    { mode: 'dynamic', term: '天道', fuzzyIndex: 0, exactIndex: 0 },
  ];
  assert.deepEqual(classifyCoverage(item, sourceHits, aggRuns, true, true), { result: 'PASS', root_cause: 'OK', note: '' });
});

test('coverage classification separates deployed API errors from parser gaps when dynamic recall is proven', () => {
  const item = { title: '流浪地球', actors: ['吴京'], year: '2019', priority: 'classic' };
  const sourceHits = [{ slug: 'baidu', hits: [{ vod_name: '流浪地球' }] }];
  const aggRuns = [
    { mode: 'user', term: '流浪地球', status: 503, fuzzyIndex: -1, exactIndex: -1 },
    { mode: 'dynamic', term: '流浪地球', status: 200, fuzzyIndex: 0, exactIndex: 0 },
    { mode: 'user', term: '吴京', status: 503, fuzzyIndex: -1, exactIndex: -1 },
    { mode: 'dynamic', term: '吴京', status: 200, fuzzyIndex: 0, exactIndex: -1 },
  ];
  assert.deepEqual(classifyCoverage(item, sourceHits, aggRuns, true, true), {
    result: 'WARN',
    root_cause: 'API_ERROR',
    note: '当前稳定入口返回服务错误；动态召回、详情和播放已证明，需随本次发布修复。',
  });
});

test('category coverage canary passes when first-page fuzzy semantic result exists without exact title', () => {
  const item = { title: '演唱会', aliases: ['音乐现场'], priority: 'category' };
  const sourceHits = [{ slug: 'x', hits: [{ vod_name: '泰勒·斯威夫特：时代巡回演唱会' }] }];
  const aggRuns = [
    { mode: 'user', term: '演唱会', fuzzyIndex: 0, exactIndex: -1 },
    { mode: 'user', term: '音乐现场', fuzzyIndex: 1, exactIndex: -1 },
  ];
  assert.deepEqual(classifyCoverage(item, sourceHits, aggRuns, true, true), { result: 'PASS', root_cause: 'OK', note: '' });
});

test('playable URL filter rejects parsers and accepts direct media', () => {
  assert.equal(isPlayableUrl('https://example.com/video/index.m3u8'), true);
  assert.equal(isPlayableUrl('https://example.com/player.html?id=1'), false);
});

test('cron monthly estimator handles four-hour schedule', () => {
  assert.equal(monthlyCronRuns('7 */4 * * *'), 180);
});

test('free-tier live audit helpers quantify proxied live channels and rewritten playlist children', () => {
  const parsed = parseLiveText([
    '电影频道,#genre#',
    'A,https://tv.webhome.eu.org/play/aaa.m3u8',
    'B,https://direct.example.com/live.m3u8',
    '',
  ].join('\n'));
  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.channels.length, 2);

  const summary = summarizeLiveProxyFromChannels(parsed.channels, 'https://tv.webhome.eu.org');
  assert.equal(summary.totalChannels, 2);
  assert.equal(summary.proxiedChannels, 1);
  assert.equal(summary.directChannels, 1);
  assert.equal(summary.proxyRatio, 0.5);

  const playlist = countProxyPlaylistChildren([
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1',
    'https://tv.webhome.eu.org/play/sub.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2',
    'https://cdn.example.com/direct.m3u8',
    'https://tv.webhome.eu.org/p/seg.ts',
  ].join('\n'), 'https://tv.webhome.eu.org');
  assert.equal(playlist.mediaLines, 3);
  assert.equal(playlist.proxiedChildLines, 2);
  assert.equal(playlist.directChildLines, 1);
});
