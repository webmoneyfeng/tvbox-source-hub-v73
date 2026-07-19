import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHotPackage,
  filterHotRows,
  mergeHotRows,
  shouldPublishHotPackage,
} from '../src/hot-catalog.mjs';

const TIAN_DAO = '\u5929\u9053';
const MOVIE = '\u5176\u4ed6\u7535\u5f71';
const SERIES = '\u7535\u89c6\u5267';

function row(overrides = {}) {
  return {
    canonical_id: 'tv:tian-dao:2008',
    vod_id: 'sony-1',
    vod_name: TIAN_DAO,
    vod_year: '2008',
    primary_category: SERIES,
    classification_confidence: 0.98,
    classification_evidence: ['source_category'],
    episode_count: 10,
    latest_episode: 10,
    source_candidates: [{ source: 'sony', id: 'sony-1' }],
    play_lines: [],
    ...overrides,
  };
}

test('mergeHotRows merges the same program across sources and keeps one primary category', () => {
  const merged = mergeHotRows([
    row(),
    row({ vod_id: 'baidu-9', source_candidates: [{ source: 'baidu', id: 'baidu-9' }], play_lines: [{ source: 'baidu', url: 'https://media.example/9.m3u8' }] }),
    row({ canonical_id: 'movie:other:2020', vod_id: 'movie-1', vod_name: '\u7535\u5f71', primary_category: MOVIE }),
  ]);

  assert.equal(merged.rows.length, 2);
  const series = merged.rows.find((x) => x.canonical_id === 'tv:tian-dao:2008');
  assert.equal(series.primary_category, SERIES);
  assert.deepEqual(series.source_candidates.map((x) => x.source), ['sony', 'baidu']);
  assert.equal(merged.duplicate_count, 1);
});

test('buildHotPackage changes content hash when a new episode appears, but not for a probe timestamp', () => {
  const first = buildHotPackage([row()], { checkedAt: '2026-07-18T00:00:00.000Z', contentChangedAt: '2026-07-18T00:00:00.000Z' });
  const same = buildHotPackage([row()], { checkedAt: '2026-07-18T00:05:00.000Z', contentChangedAt: '2026-07-18T00:00:00.000Z' });
  const next = buildHotPackage([row({ episode_count: 12, latest_episode: 12 })], { checkedAt: '2026-07-18T00:10:00.000Z', contentChangedAt: '2026-07-18T00:10:00.000Z' });

  assert.equal(first.content_hash, same.content_hash);
  assert.equal(shouldPublishHotPackage(first, same), false);
  assert.notEqual(first.content_hash, next.content_hash);
  assert.equal(shouldPublishHotPackage(first, next), true);
});

test('filterHotRows supports category and search without duplicate rows', () => {
  const rows = [row(), row({ canonical_id: 'movie:1', vod_id: 'movie-1', vod_name: '\u52a8\u4f5c\u7247', primary_category: MOVIE })];
  const category = filterHotRows(rows, { category: SERIES });
  const search = filterHotRows(rows, { query: TIAN_DAO });

  assert.equal(category.length, 1);
  assert.equal(search.length, 1);
  assert.equal(search[0].vod_name, TIAN_DAO);
});
