import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_TOKEN,
  assertExecutionApproval,
  buildCommandPlan,
  parseArgs,
  riskyCommandCount,
} from './deploy-cloudflare-v74.mjs';

test('parseArgs defaults to dry run and never executes production without flag', () => {
  assert.deepEqual(parseArgs([]), { execute: false, dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run']), { execute: false, dryRun: true });
  assert.deepEqual(parseArgs(['--execute']), { execute: true, dryRun: false });
});

test('assertExecutionApproval blocks production deploy without exact approval token', () => {
  assert.throws(() => assertExecutionApproval({ execute: true, env: {} }), /TVBOX_DEPLOY_APPROVED/);
  assert.throws(() => assertExecutionApproval({ execute: true, env: { TVBOX_DEPLOY_APPROVED: 'yes' } }), /TVBOX_DEPLOY_APPROVED/);
  assert.doesNotThrow(() => assertExecutionApproval({ execute: true, env: { TVBOX_DEPLOY_APPROVED: APPROVAL_TOKEN } }));
  assert.doesNotThrow(() => assertExecutionApproval({ execute: false, env: {} }));
});

test('buildCommandPlan dry run validates without production deploy commands', () => {
  const plan = buildCommandPlan({ execute: false });
  assert.equal(riskyCommandCount(plan), 0);
  assert.equal(plan.some((step) => step.name === 'worker_dry_run'), true);
  assert.equal(plan.some((step) => step.name === 'worker_deploy'), false);
  assert.equal(plan.some((step) => step.name === 'pages_deploy'), false);
  assert.equal(plan.find((step) => step.name === 'release_readiness_precheck').allowFailure, true);
});

test('buildCommandPlan execute deploys Worker then Pages then post-validates both entries', () => {
  const plan = buildCommandPlan({ execute: true, primaryBase: 'https://tv.webhome.eu.org', secondaryBase: 'https://tv.webclound.eu.org' });
  assert.equal(plan[0].name, 'npm_check');
  assert.equal(plan[1].name, 'release_readiness_precheck');
  assert.equal(plan[2].name, 'worker_dry_run');
  const workerIndex = plan.findIndex((step) => step.name === 'worker_deploy');
  const pagesIndex = plan.findIndex((step) => step.name === 'pages_deploy');
  const primaryValidateIndex = plan.findIndex((step) => step.name === 'validate_primary');
  assert.ok(workerIndex > 0);
  assert.ok(pagesIndex > workerIndex);
  assert.ok(primaryValidateIndex > pagesIndex);
  assert.equal(riskyCommandCount(plan), 2);
  assert.deepEqual(plan.find((step) => step.name === 'validate_secondary').env, { TVBOX_BASE: 'https://tv.webclound.eu.org' });
});
