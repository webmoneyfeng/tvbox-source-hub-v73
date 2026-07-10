import assert from 'node:assert/strict';
import test from 'node:test';

import { interactionFallbackDailyRuns, monthlyCronRuns } from './audit-free-tier-v73.mjs';

test('free-tier GitHub schedules stay below monthly warning budget after static snapshot downshift', () => {
  const hotRefresh = monthlyCronRuns('7 */6 * * *');
  const fullRefresh = monthlyCronRuns('17 */6 * * *');
  const deepVerify = monthlyCronRuns('31 3 * * *');
  const sourceHealth = monthlyCronRuns('43 4 * * *');
  assert.equal(hotRefresh, 120);
  assert.equal(fullRefresh, 120);
  assert.equal(deepVerify, 30);
  assert.equal(sourceHealth, 30);
  assert.equal(hotRefresh + fullRefresh + deepVerify + sourceHealth, 300);
  assert.equal(hotRefresh + fullRefresh + deepVerify + sourceHealth <= 500, true);
});

test('interaction fallback hot probes keep combined KV write estimate within warning budget', () => {
  const scheduledWorkerCronWrites = 720;
  const fallbackWrites = interactionFallbackDailyRuns();
  assert.equal(fallbackWrites, 96);
  assert.equal(scheduledWorkerCronWrites + fallbackWrites, 816);
  assert.equal(scheduledWorkerCronWrites + fallbackWrites <= 1000 * 0.9, true);
});
