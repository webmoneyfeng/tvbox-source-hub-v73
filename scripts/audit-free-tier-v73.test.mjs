import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateHotKvWrites, interactionFallbackDailyRuns, monthlyCronRuns } from './audit-free-tier-v73.mjs';

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

test('five-minute hot refresh stays within the 650-write release gate', () => {
  const cronSlots = interactionFallbackDailyRuns(5);
  const estimate = estimateHotKvWrites(cronSlots);
  assert.equal(cronSlots, 288);
  assert.deepEqual(estimate, {
    cronSlots: 288,
    contentWrites: 576,
    healthWrites: 48,
    interactionWrites: 0,
    totalWrites: 624,
  });
  assert.equal(estimate.totalWrites <= 650, true);
});
