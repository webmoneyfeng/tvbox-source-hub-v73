import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyConfigSurface,
  classifyPagesStaticSurface,
  classifyWorkerSurface,
  decodeReverseUpdateCode,
  summarizeReleaseGate,
} from './audit-release-readiness-v74.mjs';

test('decodeReverseUpdateCode decodes reversed Beijing timestamp codes', () => {
  const decoded = decodeReverseUpdateCode('815001706202');
  assert.equal(decoded.valid, true);
  assert.equal(decoded.display, '2026-07-10 05:18');
  assert.equal(decoded.iso, '2026-07-10T05:18:00+08:00');
});

test('classifyConfigSurface requires a matching visible timestamp and versioned API code', () => {
  const visible = classifyConfigSurface({
    source: 'local-dist-full',
    expectedName: '影视点播',
    expectedApiPrefix: 'https://tv.webhome.eu.org/agg/u',
    payload: { sites: [{ name: '影视点播 · 815001706202', api: 'https://tv.webhome.eu.org/agg/u815001706202' }] },
  });
  assert.equal(visible.result, 'PASS');
  assert.equal(visible.root_cause, 'OK');

  const stableWithoutVisibleTime = classifyConfigSurface({
    source: 'online-worker-full',
    expectedName: '影视点播',
    expectedApiPrefix: 'https://tv.webhome.eu.org/agg/u',
    payload: { sites: [{ name: '影视点播', api: 'https://tv.webhome.eu.org/agg/u815001706202' }] },
  });
  assert.equal(stableWithoutVisibleTime.result, 'WARN');
  assert.equal(stableWithoutVisibleTime.root_cause, 'VISIBLE_UPDATE_MISSING');

  const mismatch = classifyConfigSurface({
    source: 'online-worker-full',
    expectedName: '影视点播',
    expectedApiPrefix: 'https://tv.webhome.eu.org/agg/u',
    payload: { sites: [{ name: '影视点播 · 815001706202', api: 'https://tv.webhome.eu.org/agg/u904001706202' }] },
  });
  assert.equal(mismatch.result, 'FAIL');
  assert.equal(mismatch.root_cause, 'UPDATE_CODE_MISMATCH');
});

test('worker surface classifies online drift as deploy-required only when the local artifact already satisfies the contract', () => {
  const online = { source: 'online-worker-full-config', result: 'WARN', root_cause: 'VISIBLE_UPDATE_MISSING', message: 'old worker' };
  const localPass = { source: 'local-dist-full-config', result: 'PASS', root_cause: 'OK' };
  const deploy = classifyWorkerSurface({ onlineRow: online, localRow: localPass });
  assert.equal(deploy.result, 'WARN');
  assert.equal(deploy.root_cause, 'NEEDS_WORKER_DEPLOY');
  assert.equal(deploy.online_root_cause, 'VISIBLE_UPDATE_MISSING');

  const localFail = { source: 'local-dist-full-config', result: 'FAIL', root_cause: 'UPDATE_CODE_MISMATCH' };
  const unresolved = classifyWorkerSurface({ onlineRow: online, localRow: localFail });
  assert.equal(unresolved.root_cause, 'VISIBLE_UPDATE_MISSING');
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

test('classifyPagesStaticSurface accepts Pages manifest matching local static snapshot even when Worker hot code is newer', () => {
  const rows = classifyPagesStaticSurface({
    pagesConfig: { ok: true, status: 200, data: { sites: [{ name: '\u5f71\u89c6\u70b9\u64ad · 904001706202', api: 'https://tv.webhome.eu.org/agg/u904001706202' }] } },
    pagesCleanConfig: { ok: true, status: 200, data: { sites: [{ name: '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0 · 904001706202', api: 'https://tv.webhome.eu.org/agg-clean/u904001706202' }] } },
    pagesManifest: { ok: true, status: 200, data: { visibleUpdateText: '904001706202', generatedAt: '2026-07-10T10:04:00.000Z' } },
    currentWorkerCode: '835001706202',
    expectedStaticCode: '904001706202',
    expectedFullName: '\u5f71\u89c6\u70b9\u64ad',
    expectedCleanName: '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0',
    publicBase: 'https://tv.webhome.eu.org',
  });
  const manifest = rows.find((row) => row.source === 'pages-manifest');
  assert.equal(manifest.result, 'PASS');
  assert.equal(manifest.root_cause, 'OK');
  assert.equal(manifest.visibleUpdateText, '904001706202');
  assert.equal(manifest.currentWorkerCode, '835001706202');
  assert.equal(manifest.expectedStaticCode, '904001706202');
});

test('classifyPagesStaticSurface flags Pages manifest that does not match local static snapshot', () => {
  const rows = classifyPagesStaticSurface({
    pagesConfig: { ok: true, status: 200, data: { sites: [{ name: '\u5f71\u89c6\u70b9\u64ad · 904001706202', api: 'https://tv.webhome.eu.org/agg/u904001706202' }] } },
    pagesCleanConfig: { ok: true, status: 200, data: { sites: [{ name: '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0 · 904001706202', api: 'https://tv.webhome.eu.org/agg-clean/u904001706202' }] } },
    pagesManifest: { ok: true, status: 200, data: { visibleUpdateText: '012270706202', generatedAt: '2026-07-07T14:10:17.496Z' } },
    currentWorkerCode: '255001706202',
    expectedStaticCode: '904001706202',
    expectedFullName: '\u5f71\u89c6\u70b9\u64ad',
    expectedCleanName: '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0',
    publicBase: 'https://tv.webhome.eu.org',
  });
  const manifest = rows.find((row) => row.source === 'pages-manifest');
  assert.equal(manifest.result, 'WARN');
  assert.equal(manifest.root_cause, 'NEEDS_PAGES_DEPLOY');
  assert.equal(manifest.visibleUpdateText, '012270706202');
  assert.equal(manifest.expectedStaticCode, '904001706202');
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
