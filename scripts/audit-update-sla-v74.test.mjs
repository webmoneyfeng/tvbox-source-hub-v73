import assert from 'node:assert/strict';
import test from 'node:test';

import { maxCronGapMinutes, workflowScheduleCheckFromCrons } from './audit-update-sla-v74.mjs';

test('hot-refresh cron every 6 hours passes free-tier static freshness target', () => {
  assert.equal(maxCronGapMinutes(['7 */6 * * *']), 360);
  const check = workflowScheduleCheckFromCrons(['7 */6 * * *'], 6 * 60 * 60 * 1000);
  assert.equal(check.result, 'PASS');
  assert.equal(check.root_cause, 'OK');
  assert.equal(check.max_gap_minutes, 360);
});

test('twice daily hot-refresh cron fails 6-hour static freshness target', () => {
  assert.equal(maxCronGapMinutes(['7 1,13 * * *']), 720);
  const check = workflowScheduleCheckFromCrons(['7 1,13 * * *'], 6 * 60 * 60 * 1000);
  assert.equal(check.result, 'FAIL');
  assert.equal(check.root_cause, 'HOT_WORKFLOW_SCHEDULE_GAP');
  assert.equal(check.max_gap_minutes, 720);
});
