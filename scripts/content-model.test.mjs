import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DERIVED_VIEW_CATEGORIES,
  PRIMARY_CATEGORIES,
  buildCanonicalId,
  classifyContent,
  classifySourceCategoryName,
  normalizeContentItem,
} from '../src/content-model.mjs';

test('primary categories are 12 mutually exclusive content owners and recommend is derived', () => {
  assert.deepEqual(PRIMARY_CATEGORIES, [
    'theatrical_movie',
    'web_movie',
    'other_movie',
    'tv_series',
    'web_series',
    'web_short',
    'variety',
    'anime',
    'documentary',
    'explainer',
    'knowledge',
    'adult',
  ]);
  assert.equal(new Set(PRIMARY_CATEGORIES).size, 12);
  assert.deepEqual(DERIVED_VIEW_CATEGORIES, ['recommend']);
  assert.equal(PRIMARY_CATEGORIES.includes('recommend'), false);
});

test('content without stronger evidence falls back to a content owner, never recommend', () => {
  const result = classifyContent({ vod_name: '\u672a\u5206\u7c7b\u89c6\u9891' });

  assert.equal(result.primary_category, 'other_movie');
  assert.equal(result.classification_evidence[0].source, 'fallback');
});

test('source class names map retained video domains without inventing release channels', () => {
  assert.equal(classifySourceCategoryName('\u4f53\u80b2\u8d5b\u4e8b'), 'knowledge');
  assert.equal(classifySourceCategoryName('\u5f71\u89c6\u89e3\u8bf4'), 'explainer');
  assert.equal(classifySourceCategoryName('\u53cd\u8f6c\u723d\u6587'), 'web_short');
  assert.equal(classifySourceCategoryName('\u7535\u5f71/\u52a8\u4f5c\u7247'), 'other_movie');
  assert.equal(classifySourceCategoryName('\u7f51\u7edc\u7535\u5f71'), 'web_movie');
  assert.equal(classifySourceCategoryName('\u52a8\u4f5c\u7247'), 'other_movie');
  assert.notEqual(classifySourceCategoryName('\u52a8\u4f5c\u7247'), 'theatrical_movie');
});

test('normalization preserves the commercial metadata fields', () => {
  const normalized = normalizeContentItem({
    vod_name: '\u6d4b\u8bd5\u5267\u96c6',
    vod_time: ' 2026-07-18 10:00:00 ',
    vod_time_add: ' 1784340000 ',
    vod_pubdate: ' 2026-07-17 ',
    vod_total: ' 24 ',
    vod_serial: ' \u66f4\u65b0\u81f324\u96c6 ',
    vod_duration: ' 12\u5206\u949f ',
    source_payload_marker: 'keep-me',
  });

  assert.deepEqual(
    Object.fromEntries([
      'vod_time',
      'vod_time_add',
      'vod_pubdate',
      'vod_total',
      'vod_serial',
      'vod_duration',
    ].map((field) => [field, normalized[field]])),
    {
      vod_time: '2026-07-18 10:00:00',
      vod_time_add: '1784340000',
      vod_pubdate: '2026-07-17',
      vod_total: '24',
      vod_serial: '\u66f4\u65b0\u81f324\u96c6',
      vod_duration: '12\u5206\u949f',
    },
  );
  assert.equal(normalized.source_payload_marker, 'keep-me');
});

test('\u6253\u62fc is not web_short solely because it is marked \u51689\u96c6', () => {
  const result = classifyContent({
    vod_name: '\u6253\u62fc',
    vod_remarks: '\u51689\u96c6',
    vod_total: '9',
  });

  assert.equal(result.primary_category, 'tv_series');
  assert.notEqual(result.primary_category, 'web_short');
});

test('\u66fc\u54c8\u987f\u6253\u62fc\u65e5\u8bb0 is not web_short solely because it is marked \u516812\u96c6', () => {
  const result = classifyContent({
    vod_name: '\u66fc\u54c8\u987f\u6253\u62fc\u65e5\u8bb0',
    vod_remarks: '\u516812\u96c6',
    vod_serial: '\u516812\u96c6',
  });

  assert.equal(result.primary_category, 'tv_series');
  assert.notEqual(result.primary_category, 'web_short');
});

test('movie classification distinguishes theatrical, web, and unknown release channels', () => {
  const cases = [
    {
      item: { vod_name: '\u9662\u7ebf\u65b0\u7247', explicit_tags: ['\u9662\u7ebf\u7535\u5f71'] },
      category: 'theatrical_movie',
      channel: 'theatrical',
    },
    {
      item: { vod_name: '\u7f51\u7edc\u9996\u6620', explicit_tags: ['\u7f51\u7edc\u7535\u5f71'] },
      category: 'web_movie',
      channel: 'web',
    },
    {
      item: { vod_name: '\u672a\u77e5\u53d1\u884c\u5f71\u7247', explicit_tags: ['\u7535\u5f71'] },
      category: 'other_movie',
      channel: 'unknown',
    },
  ];

  for (const { item, category, channel } of cases) {
    const result = classifyContent(item);
    assert.equal(result.primary_category, category);
    assert.equal(result.movie_release_channel, channel);
  }
});

test('explicit web-series tags classify a long-form series as web_series', () => {
  const result = classifyContent({
    vod_name: '\u6f2b\u957f\u590f\u5929',
    explicit_tags: ['\u7f51\u7edc\u5267'],
    vod_duration: '45\u5206\u949f',
    vod_total: '24',
  });

  assert.equal(result.primary_category, 'web_series');
  assert.equal(result.classification_evidence[0].source, 'explicit_tags');
  assert.ok(result.classification_confidence >= 0.9);
  assert.equal(result.classification_confidence_level, 'high');
});

test('duration at most 15 minutes plus at least 20 episodes classifies web_short', () => {
  const result = classifyContent({
    vod_name: '\u6781\u901f\u604b\u7231',
    type_name: '\u5267\u96c6',
    vod_duration: '00:12:30',
    vod_total: '24',
  });

  assert.equal(result.primary_category, 'web_short');
  assert.equal(result.classification_evidence[0].source, 'duration_episode');
  assert.ok(result.classification_confidence >= 0.7);
  assert.equal(result.classification_confidence_level, 'medium');
  assert.equal(result.classification_confidence_score, result.classification_confidence);
});

test('source category ID mapping outranks conflicting explicit tags', () => {
  const result = classifyContent(
    {
      source_category_id: 'doc-7',
      explicit_tags: ['\u7f51\u7edc\u77ed\u5267'],
    },
    { sourceCategoryMap: { 'doc-7': 'documentary' } },
  );

  assert.equal(result.primary_category, 'documentary');
  assert.equal(result.classification_evidence[0].source, 'source_category_id');
  assert.ok(result.classification_confidence >= 0.9);
  assert.equal(result.classification_confidence_level, 'high');
});

test('generic source movie category yields to trusted release-channel metadata', () => {
  const web = classifyContent(
    { source_category_id: 'movie-generic', release_channel: 'web', explicit_tags: ['电影'] },
    { sourceCategoryMap: { 'movie-generic': 'other_movie' } },
  );
  const theatrical = classifyContent(
    { source_category_id: 'movie-generic', release_channel: 'theatrical', explicit_tags: ['电影'] },
    { sourceCategoryMap: { 'movie-generic': 'other_movie' } },
  );

  assert.equal(web.primary_category, 'web_movie');
  assert.equal(web.movie_release_channel, 'web');
  assert.equal(theatrical.primary_category, 'theatrical_movie');
  assert.equal(theatrical.movie_release_channel, 'theatrical');
});

test('generic source series category yields to explicit web-series evidence but not a weak cinema title', () => {
  const webSeries = classifyContent(
    { source_category_id: 'series-generic', explicit_tags: ['网络剧'] },
    { sourceCategoryMap: { 'series-generic': 'tv_series' } },
  );
  const cinemaTitleOnly = classifyContent(
    { source_category_id: 'movie-generic', vod_name: '特级院线' },
    { sourceCategoryMap: { 'movie-generic': 'other_movie' } },
  );

  assert.equal(webSeries.primary_category, 'web_series');
  assert.equal(cinemaTitleOnly.primary_category, 'other_movie');
});

test('fallback canonical ID is independent from category', () => {
  const identity = {
    vod_name: '\u6f2b\u957f\u590f\u5929',
    vod_year: '2025',
    season: '2',
    creators: ['\u5f20\u4e09', '\u674e\u56db'],
  };

  const seriesId = buildCanonicalId({
    ...identity,
    primary_category: 'tv_series',
    source_category_id: 'tv',
  });
  const webId = buildCanonicalId({
    ...identity,
    primary_category: 'web_series',
    source_category_id: 'web',
  });

  assert.equal(seriesId, webId);
  assert.match(seriesId, /^meta:/);
});

test('canonical ID prefers an external ID over fallback metadata', () => {
  const first = buildCanonicalId({
    vod_name: '\u9738\u738b\u522b\u59ec',
    vod_year: '1993',
    external_ids: { douban: ' 1291546 ' },
  });
  const second = buildCanonicalId({
    vod_name: '\u5b8c\u5168\u4e0d\u540c\u7684\u6807\u9898',
    vod_year: '2026',
    primary_category: 'other_movie',
    external_ids: { douban: '1291546' },
  });

  assert.equal(first, 'ext:douban:1291546');
  assert.equal(second, first);
});

test('canonical ID normalizes external provider keys before lookup', () => {
  const id = buildCanonicalId({
    vod_name: 'case-insensitive-provider',
    external_ids: { TMDB: ' 98765 ' },
  });

  assert.equal(id, 'ext:tmdb:98765');
});

test('canonical ID accepts MacCMS vod_douban_id as a stable external identity', () => {
  const id = buildCanonicalId({
    vod_name: '同名片源标题可变化',
    vod_year: '2026',
    vod_douban_id: ' 38424286 ',
  });

  assert.equal(id, 'ext:douban:38424286');
});

test('zero and placeholder external IDs never collapse unrelated programs', () => {
  const first = buildCanonicalId({ vod_name: '节目甲', vod_year: '2026', vod_douban_id: 0 });
  const second = buildCanonicalId({ vod_name: '节目乙', vod_year: '2026', vod_douban_id: '0' });

  assert.match(first, /^meta:/u);
  assert.match(second, /^meta:/u);
  assert.notEqual(first, second);
});
