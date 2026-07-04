import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCoverage, isPlayableUrl, normalizeTitle, queryTermsForItem, titleMatches } from './audit-source-coverage-v73.mjs';
import { monthlyCronRuns } from './audit-free-tier-v73.mjs';

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

test('playable URL filter rejects parsers and accepts direct media', () => {
  assert.equal(isPlayableUrl('https://example.com/video/index.m3u8'), true);
  assert.equal(isPlayableUrl('https://example.com/player.html?id=1'), false);
});

test('cron monthly estimator handles four-hour schedule', () => {
  assert.equal(monthlyCronRuns('7 */4 * * *'), 180);
});
