import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDoubanReleaseMetadata,
  classifyDoubanReleaseMetadata,
  enrichRowsWithDoubanMetadata,
  tagReleaseBackfillRow,
} from '../src/release-metadata.mjs';

test('Douban release metadata distinguishes network, theatrical, television and festival-only releases', () => {
  assert.equal(classifyDoubanReleaseMetadata({
    id: '1', subtype: 'movie', is_tv: false, pubdate: ['2026(中国大陆网络)'],
  })?.primary_category, 'web_movie');
  assert.equal(classifyDoubanReleaseMetadata({
    id: '2', subtype: 'movie', is_tv: false, pubdate: ['2025-09-04(中国香港)'],
  })?.primary_category, 'theatrical_movie');
  assert.equal(classifyDoubanReleaseMetadata({
    id: '3', subtype: 'tv', is_tv: true, pubdate: ['2026(中国大陆网络)'],
  })?.primary_category, 'web_series');
  assert.equal(classifyDoubanReleaseMetadata({
    id: '4', subtype: 'movie', is_tv: false, pubdate: ['2025-05-01(戛纳电影节)'],
  }), null);
});

test('Douban enrichment changes only generic owners and adopts the stable external identity', () => {
  const enriched = applyDoubanReleaseMetadata({
    vod_name: '爱上透明的你',
    vod_year: '2026',
    vod_douban_id: '38424286',
    primary_category: 'other_movie',
    classification_evidence: [],
  }, {
    id: '38424286', subtype: 'movie', is_tv: false, pubdate: ['2026(中国大陆网络)'],
  });
  const protectedAnime = applyDoubanReleaseMetadata({
    vod_name: '动画电影',
    vod_douban_id: '9',
    primary_category: 'anime',
  }, {
    id: '9', subtype: 'movie', is_tv: false, pubdate: ['2025-01-01(中国大陆)'],
  });

  assert.equal(enriched.primary_category, 'web_movie');
  assert.equal(enriched.canonical_id, 'ext:douban:38424286');
  assert.equal(enriched.release_channel, 'web');
  assert.equal(enriched.classification_evidence.some((row) => row.source === 'douban_release_metadata'), true);
  assert.equal(protectedAnime.primary_category, 'anime');
});

test('metadata enrichment reuses fresh cache and fetches only missing eligible IDs', async () => {
  const calls = [];
  const nowMs = Date.parse('2026-07-19T04:00:00.000Z');
  const result = await enrichRowsWithDoubanMetadata([
    { vod_name: '缓存电影', vod_douban_id: '100', primary_category: 'other_movie' },
    { vod_name: '新电影', vod_douban_id: '200', primary_category: 'other_movie' },
    { vod_name: '不应查询的动漫', vod_douban_id: '300', primary_category: 'anime' },
  ], {
    nowMs,
    cache: {
      entries: {
        100: { ok: true, fetchedAt: '2026-07-18T04:00:00.000Z', metadata: { id: '100', subtype: 'movie', is_tv: false, pubdate: ['2025-01-01(中国大陆)'] } },
      },
    },
    fetchMetadata: async (id) => {
      calls.push(id);
      return { id, subtype: 'movie', is_tv: false, pubdate: ['2026(中国大陆网络)'] };
    },
  });

  assert.deepEqual(calls, ['200']);
  assert.equal(result.rows.find((row) => row.vod_name === '缓存电影')?.primary_category, 'theatrical_movie');
  assert.equal(result.rows.find((row) => row.vod_name === '新电影')?.primary_category, 'web_movie');
  assert.equal(result.stats.cacheHits, 1);
  assert.equal(result.stats.fetched, 1);
});

test('release-channel search backfill accepts explicit evidence and rejects lexical noise', () => {
  assert.equal(tagReleaseBackfillRow({ vod_name: '唐人街探案网剧' }, 'web_series')?.explicit_tags.includes('网络剧'), true);
  assert.equal(tagReleaseBackfillRow({ vod_name: 'VIP网大 女人的本钱' }, 'web_movie')?.explicit_tags.includes('网络电影'), true);
  assert.equal(tagReleaseBackfillRow({ vod_name: '网络惊魂' }, 'web_movie'), null);
  assert.equal(tagReleaseBackfillRow({ vod_name: '特级院线' }, 'theatrical_movie'), null);
});
