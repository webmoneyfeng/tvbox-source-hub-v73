import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditFetchPath,
  classifyRecord,
  comboSemanticStats,
  compareDisplayName,
  duplicateRate,
  sortScore,
  parseLiveText,
  searchTermMatches,
  validateConfigPayload,
} from './audit-tv-remote-full-v73.mjs';
import { normalizeVodTitle } from '../src/worker.mjs';

test('config validation accepts the visible update-code site and rejects forbidden wording', () => {
  const ok = validateConfigPayload({
    sites: [{ key: 'vod_unified', name: '\u5f71\u89c6\u70b9\u64ad \u00b7 854150706202', api: 'https://tv.webhome.eu.org/agg' }],
    lives: [{ name: '\u7cbe\u9009\u76f4\u64ad', url: 'https://tv.webhome.eu.org/live.txt' }],
  });
  assert.equal(ok.schema_ok, true);
  assert.equal(ok.content_shape_ok, true);

  const legacy = validateConfigPayload({
    sites: [{ key: 'vod_unified', name: '\u5f71\u89c6\u70b9\u64ad', api: 'https://tv.webhome.eu.org/agg' }],
  });
  assert.equal(legacy.content_shape_ok, true);

  const oldVisible = validateConfigPayload({
    sites: [{ key: 'vod_unified', name: '\u5f71\u89c6\u70b9\u64ad \u00b7 \u6e90\u66f4\u65b0 07-05 01:57', api: 'https://tv.webhome.eu.org/agg' }],
  });
  assert.equal(oldVisible.content_shape_ok, true);

  const bad = validateConfigPayload({
    sites: [{ key: 'vod_unified', name: '\u5907\u7528\u5f71\u89c6\u70b9\u64ad', api: 'https://tv.webhome.eu.org/agg' }],
  });
  assert.equal(bad.schema_ok, true);
  assert.equal(bad.content_shape_ok, false);
  assert.match(bad.fix_suggestion, /\u7981\u6b62\u6587\u6848/);
});

test('audit fetch cache-busts agg requests without changing non-agg endpoints', () => {
  const agg = auditFetchPath('/agg?wd=%E7%94%B5%E5%BD%B1&limit=12');
  assert.match(agg, /^\/agg\?wd=%E7%94%B5%E5%BD%B1&limit=12&audit_run=rc-/);
  assert.equal(auditFetchPath('/config.json'), '/config.json');
  assert.equal(auditFetchPath('/live.txt'), '/live.txt');
  assert.equal(auditFetchPath('/agg?wd=x&audit_run=manual'), '/agg?wd=x&audit_run=manual');
});

test('worker title canonicalization removes Chinese punctuation that creates visible search duplicates', () => {
  assert.equal(normalizeVodTitle('开拍啦，怪兽大电影'), normalizeVodTitle('开拍啦！怪兽大电影'));
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

test('duplicate checks prefer title year for cross-year concerts and gala programs', () => {
  const dupes = duplicateRate([
    { vod_name: '更好2025·江苏卫视跨年演唱会', vod_year: '2025', type_name: '文娱知识' },
    { vod_name: '更好2025·江苏卫视跨年演唱会', vod_year: '2024', type_name: '文娱知识' },
    { vod_name: '湖南卫视2022-2023年跨年演唱会', vod_year: '2022', type_name: '文娱知识' },
    { vod_name: '湖南卫视2022-2023年跨年演唱会', vod_year: '2023', type_name: '文娱知识' },
  ]);
  assert.equal(dupes, 2 / 4);
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
  const stats = comboSemanticStats({ year: '2026', class: '\u52a8\u4f5c' }, [{
    vod_name: '\u52a8\u4f5c\u5927\u7247',
    vod_year: '2026',
    type_name: '\u7535\u5f71',
    vod_class: '\u52a8\u4f5c\u7247',
    semantic_tags: 'class \u52a8\u4f5c \u7535\u5f71',
  }]);
  assert.equal(stats.semanticHitRate, 1);
  assert.equal(stats.unknownRate, 0);
});


test('broad search term \u5f71\u89c6 matches normal media categories semantically', () => {
  assert.equal(searchTermMatches({ vod_name: '\u7ecf\u5178\u7535\u5f71', type_name: '\u7535\u5f71', vod_remarks: '\u9ad8\u6e05\u6b63\u7247' }, '\u5f71\u89c6'), true);
  assert.equal(searchTermMatches({ vod_name: '\u5929\u9053\u7535\u89c6\u52672018', type_name: '\u5267\u96c6', vod_remarks: '\u738b\u5fd7\u6587\u4e3b\u6f14' }, '\u5f71\u89c6'), true);
});


test('sort latest semantics prefers vod_year over historical years in documentary titles', () => {
  const rows = [
    { vod_name: '1958\u5e74\u4e16\u754c\u676f\u5b98\u65b9\u7eaa\u5f55\u7247', vod_year: '2023' },
    { vod_name: '2002\u5e74\u4e16\u754c\u676f\u5b98\u65b9\u7eaa\u5f55\u7247', vod_year: '2023' },
    { vod_name: '\u718a\u732b\u8ba1\u52122\u5e55\u540e\u7eaa\u5f55', vod_year: '2026' },
  ];
  assert.equal(sortScore('sort', 'latest', [rows[2], rows[0], rows[1]]).semanticHitRate, 1);
});
