import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyVisibleFreshness,
  extractUpdateCode,
  parseReverseUpdateCode,
  surfaceFreshnessCheck,
} from './audit-visible-freshness-surfaces-v74.mjs';

test('parseReverseUpdateCode decodes reversed Beijing timestamp codes', () => {
  const parsed = parseReverseUpdateCode('433001706202');
  assert.equal(parsed.iso, '2026-07-09T19:34:00.000Z');
});

test('extractUpdateCode reads codes from site names api paths and class names', () => {
  assert.equal(extractUpdateCode('\u5f71\u89c6\u70b9\u64ad \u00b7 433001706202'), '433001706202');
  assert.equal(extractUpdateCode('https://tv.webhome.eu.org/agg/u433001706202'), '433001706202');
  assert.equal(extractUpdateCode('\u63a8\u8350 \u00b7 433001706202'), '433001706202');
});

test('surfaceFreshnessCheck fails stale or missing visible update surfaces', () => {
  const now = Date.UTC(2026, 6, 9, 19, 40, 0);
  const ok = surfaceFreshnessCheck({
    id: 'config.site',
    http_status: 200,
    schema_ok: true,
    update_code: '433001706202',
    update_time: Date.UTC(2026, 6, 9, 19, 34, 0),
  }, now, 6 * 60 * 1000);
  assert.equal(ok.result, 'PASS');
  assert.equal(ok.root_cause, 'OK');

  const stale = surfaceFreshnessCheck({
    id: 'config.site',
    http_status: 200,
    schema_ok: true,
    update_code: '003001706202',
    update_time: Date.UTC(2026, 6, 9, 19, 30, 0),
  }, now, 6 * 60 * 1000);
  assert.equal(stale.result, 'FAIL');
  assert.equal(stale.root_cause, 'SERVICE_UPDATE_STALE');

  const missing = surfaceFreshnessCheck({ id: 'agg.class', http_status: 200, schema_ok: true, update_code: '' }, now, 6 * 60 * 1000);
  assert.equal(missing.result, 'FAIL');
  assert.equal(missing.root_cause, 'SURFACE_MISSING_UPDATE_CODE');
});

test('classifyVisibleFreshness distinguishes app local cache from service stale', () => {
  const freshSurfaces = [
    { id: 'config.site', result: 'PASS', update_code: '433001706202', user_visible: true },
    { id: 'agg.old_path', result: 'PASS', update_code: '433001706202', user_visible: true, list_count: 8 },
    { id: 'status', result: 'PASS', update_code: '433001706202', user_visible: false },
  ];
  const cached = classifyVisibleFreshness(freshSurfaces, '003001706202');
  assert.equal(cached.diagnosis, 'APP_LOCAL_SITE_CACHE');
  assert.equal(cached.result, 'WARN');

  const allFresh = classifyVisibleFreshness(freshSurfaces, '433001706202');
  assert.equal(allFresh.diagnosis, 'SERVICE_FRESH');
  assert.equal(allFresh.result, 'PASS');

  const stale = classifyVisibleFreshness([
    { id: 'config.site', result: 'FAIL', root_cause: 'SERVICE_UPDATE_STALE', update_code: '003001706202', user_visible: true },
  ], '');
  assert.equal(stale.diagnosis, 'SERVICE_UPDATE_STALE');
  assert.equal(stale.result, 'FAIL');
});
