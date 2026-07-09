import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCachedAggPath,
  cachedAggContentCheck,
  classifyCacheUpdateRelation,
  extractFirstUpdateCode,
  parseReverseUpdateCode,
} from './audit-tv-cache-update-v74.mjs';

test('parseReverseUpdateCode decodes visible update code in China time', () => {
  const parsed = parseReverseUpdateCode('652001706202');
  assert.equal(parsed.iso, '2026-07-09T18:56:00.000Z');
  assert.equal(new Date(parsed.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), '2026/7/10 02:56:00');
});

test('extractFirstUpdateCode finds the 12 digit code from site class and api path', () => {
  assert.equal(extractFirstUpdateCode('影视点播 · 652001706202'), '652001706202');
  assert.equal(extractFirstUpdateCode('https://tv.webhome.eu.org/agg/u652001706202'), '652001706202');
  assert.equal(extractFirstUpdateCode('推荐 · 652001706202'), '652001706202');
});

test('buildCachedAggPath preserves endpoint kind while replacing stale version code', () => {
  assert.equal(buildCachedAggPath('https://tv.webhome.eu.org/agg/u652001706202', '111111111111'), '/agg/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1');
  assert.equal(buildCachedAggPath('https://tv.webhome.eu.org/agg-clean/u652001706202', '111111111111'), '/agg-clean/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1');
  assert.equal(buildCachedAggPath('/agg', '222222222222'), '/agg/u222222222222?ac=videolist&t=0&pg=1&limit=8&fresh=1');
});

test('classifyCacheUpdateRelation passes same codes and fails stale cached aggregate drift', () => {
  const ok = classifyCacheUpdateRelation('cached_full_vs_config',
    { id: 'cached.full', update_code: '652001706202', update_time: parseReverseUpdateCode('652001706202').time, http_status: 200, schema_ok: true },
    { id: 'primary.config', update_code: '652001706202', update_time: parseReverseUpdateCode('652001706202').time, http_status: 200, schema_ok: true },
    { maxDriftMs: 2 * 60 * 1000, failRoot: 'OLD_API_PATH_STALE' }
  );
  assert.equal(ok.result, 'PASS');
  assert.equal(ok.root_cause, 'OK');

  const stale = classifyCacheUpdateRelation('cached_full_vs_config',
    { id: 'cached.full', update_code: '142001706202', update_time: parseReverseUpdateCode('142001706202').time, http_status: 200, schema_ok: true },
    { id: 'primary.config', update_code: '652001706202', update_time: parseReverseUpdateCode('652001706202').time, http_status: 200, schema_ok: true },
    { maxDriftMs: 2 * 60 * 1000, failRoot: 'OLD_API_PATH_STALE' }
  );
  assert.equal(stale.result, 'FAIL');
  assert.equal(stale.root_cause, 'OLD_API_PATH_STALE');
});


test('cachedAggContentCheck requires a non-empty list and visible current code in class name', () => {
  const ok = cachedAggContentCheck({ id: 'primary.cached_full_agg', list_count: 8, update_code: '652001706202', class0: '?? ? 652001706202' });
  assert.equal(ok.result, 'PASS');

  const empty = cachedAggContentCheck({ id: 'primary.cached_full_agg', list_count: 0, update_code: '652001706202', class0: '?? ? 652001706202' });
  assert.equal(empty.result, 'FAIL');
  assert.equal(empty.root_cause, 'OLD_API_PATH_STALE');

  const hidden = cachedAggContentCheck({ id: 'primary.cached_full_agg', list_count: 8, update_code: '652001706202', class0: '?? ? 142001706202' });
  assert.equal(hidden.result, 'FAIL');
  assert.equal(hidden.root_cause, 'OLD_API_PATH_STALE');
});
