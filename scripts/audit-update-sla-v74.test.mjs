import assert from 'node:assert/strict';
import test from 'node:test';

import { maxCronGapMinutes, workflowScheduleCheckFromCrons } from './audit-update-sla-v74.mjs';

test('hot-refresh cron every 15 minutes passes commercial static freshness target', () => {
  assert.equal(maxCronGapMinutes(['7,22,37,52 * * * *']), 15);
  const check = workflowScheduleCheckFromCrons(['7,22,37,52 * * * *'], 15 * 60 * 1000);
  assert.equal(check.result, 'PASS');
  assert.equal(check.root_cause, 'OK');
  assert.equal(check.max_gap_minutes, 15);
});

test('twice daily hot-refresh cron fails static freshness target', () => {
  assert.equal(maxCronGapMinutes(['7 1,13 * * *']), 720);
  const check = workflowScheduleCheckFromCrons(['7 1,13 * * *'], 15 * 60 * 1000);
  assert.equal(check.result, 'FAIL');
  assert.equal(check.root_cause, 'HOT_WORKFLOW_SCHEDULE_GAP');
  assert.equal(check.max_gap_minutes, 720);
});
