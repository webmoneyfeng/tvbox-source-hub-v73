import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyConfigSurface,
  classifyPagesStaticSurface,
  decodeReverseUpdateCode,
  summarizeReleaseGate,
} from './audit-release-readiness-v74.mjs';

test('decodeReverseUpdateCode decodes reversed Beijing timestamp codes', () => {
  const decoded = decodeReverseUpdateCode('815001706202');
  assert.equal(decoded.valid, true);
  assert.equal(decoded.display, '2026-07-10 05:18');
  assert.equal(decoded.iso, '2026-07-10T05:18:00+08:00');
});

test('classifyConfigSurface distinguishes stable local names from deploy-pending dynamic names', () => {
  const stable = classifyConfigSurface({
    source: 'local-dist-full',
    expectedName: '影视点播',
    expectedApiPrefix: 'https://tv.webhome.eu.org/agg/u',
    payload: { sites: [{ name: '影视点播', api: 'https://tv.webhome.eu.org/agg/u815001706202' }] },
  });
  assert.equal(stable.result, 'PASS');
  assert.equal(stable.root_cause, 'OK');

  const dynamic = classifyConfigSurface({
    source: 'online-worker-full',
    expectedName: '影视点播',
    expectedApiPrefix: 'https://tv.webhome.eu.org/agg/u',
    payload: { sites: [{ name: '影视点播 · 815001706202', api: 'https://tv.webhome.eu.org/agg/u815001706202' }] },
  });
  assert.equal(dynamic.result, 'WARN');
  assert.equal(dynamic.root_cause, 'NEEDS_WORKER_DEPLOY');
});

test('classifyPagesStaticSurface flags stale Pages config and missing clean entry as deploy required', () => {
  const rows = classifyPagesStaticSurface({
    pagesConfig: { ok: true, status: 200, data: { sites: [{ name: '影视点播 · 012270706202', api: 'https://tv.webhome.eu.org/agg' }] } },
    pagesCleanConfig: { ok: false, status: 404, data: null },
    pagesManifest: { ok: true, status: 200, data: { visibleUpdateText: '012270706202', generatedAt: '2026-07-07T14:10:17.496Z' } },
    currentWorkerCode: '815001706202',
    expectedFullName: '影视点播',
    expectedCleanName: '影视点播洁净',
    publicBase: 'https://tv.webhome.eu.org',
  });
  const pagesFull = rows.find((row) => row.source === 'pages-full-config');
  assert.equal(pagesFull.root_cause, 'NEEDS_PAGES_DEPLOY');
  assert.equal(pagesFull.result, 'FAIL');
  assert.equal(rows.some((row) => row.root_cause === 'NEEDS_PAGES_DEPLOY'), true);
  assert.equal(rows.some((row) => row.source === 'pages-clean-config' && row.result === 'FAIL'), true);
});

test('summarizeReleaseGate keeps production deploy blocked on approval while surfacing no hard local failures', () => {
  const summary = summarizeReleaseGate([
    { result: 'PASS' },
    { result: 'WARN', root_cause: 'NEEDS_WORKER_DEPLOY' },
    { result: 'WARN', root_cause: 'GITHUB_SYNC_PENDING' },
  ]);
  assert.equal(summary.fail, 0);
  assert.equal(summary.warn, 2);
  assert.equal(summary.production_deploy_required, true);
  assert.equal(summary.gate, 'WARN');
});
