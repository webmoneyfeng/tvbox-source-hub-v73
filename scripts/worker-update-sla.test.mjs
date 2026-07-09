import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';

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

test('status documents commercial visible update SLA as 2 minute hot probe and 6 minute freshness guard', async () => {
  const res = await worker.fetch(new Request('https://tv.webhome.eu.org/status.json?fresh=1'), envWithFreshHotProbe());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const data = await res.json();
  assert.equal(data.visibleUpdateSource, 'hot-probe');
  assert.equal(data.updateCadence.hotProbeTargetMinutes, 2);
  assert.equal(data.updateCadence.hotProbeFreshGuardMinutes, 6);
  assert.match(data.updateCadence.target, /hot probe <= 2 minutes/);
  assert.match(data.updateCadence.target, /hot visible guard <= 6 minutes/);
});
