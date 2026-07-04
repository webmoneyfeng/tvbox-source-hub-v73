import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRecord,
  comboSemanticStats,
  compareDisplayName,
  duplicateRate,
  parseLiveText,
  searchTermMatches,
  validateConfigPayload,
} from './audit-tv-remote-full-v73.mjs';

test('config validation requires one visible 影视点播 site and rejects forbidden wording', () => {
  const ok = validateConfigPayload({
    sites: [{ key: 'vod_unified', name: '影视点播', api: 'https://tv.webhome.eu.org/agg' }],
    lives: [{ name: '精选直播', url: 'https://tv.webhome.eu.org/live.txt' }],
  });
  assert.equal(ok.schema_ok, true);
  assert.equal(ok.content_shape_ok, true);

  const bad = validateConfigPayload({
    sites: [{ key: 'vod_unified', name: '备用影视点播', api: 'https://tv.webhome.eu.org/agg' }],
  });
  assert.equal(bad.schema_ok, true);
  assert.equal(bad.content_shape_ok, false);
  assert.match(bad.fix_suggestion, /禁止文案/);
});

test('single-filter empty result is a filter logic failure, but empty combo is diagnosed as over-constrained', () => {
  const single = classifyRecord({
    element_type: 'single_filter',
    http_status: 200,
    schema_ok: true,
    content_shape_ok: true,
    list_count: 0,
    empty_allowed: false,
    snapshot_mode: '',
    api_root_cause: '',
  });
  assert.equal(single.root_cause, 'FILTER_LOGIC_BUG');
  assert.equal(single.result, 'FAIL');

  const combo = classifyRecord({
    element_type: 'combo_filter',
    http_status: 200,
    schema_ok: true,
    content_shape_ok: true,
    list_count: 0,
    empty_allowed: true,
    snapshot_mode: '',
    api_root_cause: '',
  });
  assert.equal(combo.root_cause, 'SOURCE_COVERAGE_GAP');
  assert.equal(combo.path_cause, 'COMBO_OVER_CONSTRAINED');
  assert.equal(combo.result, 'WARN');
});

test('live text parser extracts groups and channels from TVBox txt format', () => {
  const parsed = parseLiveText('央视频道,#genre#\nCCTV-1,https://example.com/a.m3u8\n\n卫视频道,#genre#\n湖南卫视,https://example.com/b.m3u8\n');
  assert.deepEqual(parsed.groups, ['央视频道', '卫视频道']);
  assert.equal(parsed.channels.length, 2);
  assert.equal(parsed.channels[1].group, '卫视频道');
});

test('name sorting and duplicate checks use the same semantic basis as Worker audit', () => {
  assert.ok(compareDisplayName('阿凡达2', '阿凡达10') < 0);
  const dupes = duplicateRate([
    { vod_name: '插翅难飞 (2026)', vod_year: '2026', type_name: '电影' },
    { vod_name: '插翅难飞2026', vod_year: '2026', type_name: '电影' },
    { vod_name: '万米危机', vod_year: '2026', type_name: '电影' },
  ]);
  assert.equal(dupes, 1 / 3);
});


test('playback probes accept HTTP 206 partial content as valid media response', () => {
  const record = classifyRecord({
    element_type: 'playback',
    http_status: 206,
    schema_ok: true,
    content_shape_ok: true,
    list_count: 1,
    expects_list: false,
    playable_rate: 1,
  });
  assert.equal(record.root_cause, 'OK');
  assert.equal(record.result, 'PASS');
});

test('combo semantic checks can use exposed list evidence fields', () => {
  const stats = comboSemanticStats({ year: '2026', class: '??' }, [{
    vod_name: '??',
    vod_year: '2026',
    type_name: '??',
    vod_class: '???',
    semantic_tags: 'class ?? ??',
  }]);
  assert.equal(stats.semanticHitRate, 1);
  assert.equal(stats.unknownRate, 0);
});


test('broad search term ?? matches normal media categories semantically', () => {
  assert.equal(searchTermMatches({ vod_name: '????', type_name: '??', vod_remarks: '???' }, '??'), true);
  assert.equal(searchTermMatches({ vod_name: '?????2018', type_name: '??', vod_remarks: '???' }, '??'), true);
});
