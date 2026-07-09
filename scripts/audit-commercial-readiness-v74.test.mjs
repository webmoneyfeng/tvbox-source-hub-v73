import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCommercialReadiness,
  summarizeRootCauses,
} from './audit-commercial-readiness-v74.mjs';

function releaseReadiness(overrides = {}) {
  return {
    ok: true,
    data: {
      summary: {
        gate: 'FAIL',
        byRootCause: { OK: 3, NEEDS_WORKER_DEPLOY: 2, NEEDS_PAGES_DEPLOY: 3 },
        production_deploy_required: true,
        ...(overrides.summary || {}),
      },
      rows: overrides.rows || [
        { source: 'worker-status', result: 'PASS', root_cause: 'OK' },
        { source: 'online-worker-full-config', result: 'WARN', root_cause: 'NEEDS_WORKER_DEPLOY' },
        { source: 'pages-full-config', result: 'FAIL', root_cause: 'NEEDS_PAGES_DEPLOY' },
      ],
    },
  };
}

function zeroComplaint(overrides = {}) {
  return {
    ok: true,
    data: {
      commercial_ready: false,
      zero_complaint_gate: 'WARN',
      p0_count: 0,
      p1_count: 0,
      p2_count: 0,
      p3_count: 1,
      blocking_complaints: [],
      ...(overrides.data || {}),
    },
  };
}

function freeTier(overrides = {}) {
  return {
    ok: true,
    data: {
      pass: 6,
      warn: 0,
      fail: 0,
      rows: [],
      ...(overrides.data || {}),
    },
  };
}

function updateSla(overrides = {}) {
  return {
    ok: true,
    data: {
      summary: { gate: 'PASS', fail: 0, warn: 0 },
      endpoints: [],
      ...(overrides.data || {}),
    },
  };
}

test('summarizeRootCauses counts rows without trusting missing summary', () => {
  const counts = summarizeRootCauses([
    { root_cause: 'OK' },
    { root_cause: 'OK' },
    { root_cause: 'NEEDS_PAGES_DEPLOY' },
    { root_cause: '' },
  ]);
  assert.deepEqual(counts, { OK: 2, NEEDS_PAGES_DEPLOY: 1, UNKNOWN: 1 });
});

test('classifyCommercialReadiness marks current predeploy state as ready for approved deploy but not commercial ready', () => {
  const result = classifyCommercialReadiness({
    release: releaseReadiness(),
    zero: zeroComplaint(),
    free: freeTier(),
    sla: updateSla(),
  });
  assert.equal(result.stage9_predeploy_gate, 'READY_FOR_APPROVED_DEPLOY');
  assert.equal(result.production_deploy_required, true);
  assert.equal(result.commercial_promotion_gate, 'NOT_READY');
  assert.equal(result.next_action, 'AWAIT_APPROVAL_THEN_DEPLOY_WORKER_PAGES');
  assert.deepEqual(result.allowed_predeploy_root_causes.sort(), ['NEEDS_PAGES_DEPLOY', 'NEEDS_WORKER_DEPLOY', 'OK'].sort());
  assert.equal(result.blockers.some((x) => x.root_cause === 'NEEDS_WORKER_DEPLOY'), true);
  assert.equal(result.blockers.some((x) => x.root_cause === 'NEEDS_PAGES_DEPLOY'), true);
});

test('classifyCommercialReadiness passes commercial gate only after deploy and zero complaint readiness', () => {
  const result = classifyCommercialReadiness({
    release: releaseReadiness({ summary: { gate: 'PASS', byRootCause: { OK: 8 }, production_deploy_required: false }, rows: [{ source: 'worker-status', result: 'PASS', root_cause: 'OK' }] }),
    zero: zeroComplaint({ data: { commercial_ready: true, zero_complaint_gate: 'PASS', p0_count: 0, p1_count: 0, p2_count: 0, p3_count: 0 } }),
    free: freeTier(),
    sla: updateSla(),
  });
  assert.equal(result.stage9_predeploy_gate, 'DEPLOYED');
  assert.equal(result.commercial_promotion_gate, 'PASS');
  assert.equal(result.next_action, 'START_STAGE10_COMMERCIAL_TRIAL');
  assert.equal(result.blockers.length, 0);
});

test('classifyCommercialReadiness blocks approved deploy when release readiness has non-deploy hard failures', () => {
  const result = classifyCommercialReadiness({
    release: releaseReadiness({ summary: { gate: 'FAIL', byRootCause: { OK: 2, SCHEMA_REGRESSION: 1 }, production_deploy_required: true }, rows: [{ source: 'config', result: 'FAIL', root_cause: 'SCHEMA_REGRESSION' }] }),
    zero: zeroComplaint(),
    free: freeTier(),
    sla: updateSla(),
  });
  assert.equal(result.stage9_predeploy_gate, 'BLOCKED_BEFORE_DEPLOY');
  assert.equal(result.next_action, 'FIX_PREDEPLOY_BLOCKERS');
  assert.equal(result.blockers.some((x) => x.root_cause === 'SCHEMA_REGRESSION'), true);
});

test('classifyCommercialReadiness treats free tier hard failures as commercial blockers', () => {
  const result = classifyCommercialReadiness({
    release: releaseReadiness({ summary: { gate: 'PASS', byRootCause: { OK: 8 }, production_deploy_required: false }, rows: [{ root_cause: 'OK', result: 'PASS' }] }),
    zero: zeroComplaint({ data: { commercial_ready: true, zero_complaint_gate: 'PASS', p0_count: 0, p1_count: 0, p2_count: 0, p3_count: 0 } }),
    free: freeTier({ data: { fail: 1, rows: [{ area: 'cloudflare_worker_requests', result: 'FAIL', metric: 'too_many_proxy_requests' }] } }),
    sla: updateSla(),
  });
  assert.equal(result.commercial_promotion_gate, 'NOT_READY');
  assert.equal(result.blockers.some((x) => x.root_cause === 'FREE_TIER_FAIL'), true);
});
