import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVariantCases,
  classifyVariantRecord,
  contentPolicyExpected,
  extractUpdateCode,
  requestVariantPath,
  searchSemanticCheck,
} from './audit-app-request-variants-v74.mjs';

test('buildVariantCases covers TVBox FongMi video warehouse full and clean variants', () => {
  const full = buildVariantCases('/agg', '111111111111');
  const clean = buildVariantCases('/agg-clean', '111111111111');
  const fullPaths = full.map((x) => x.path);
  const cleanPaths = clean.map((x) => x.path);

  assert.ok(fullPaths.includes('/agg?ac=videolist&t=1&pg=1&limit=8'));
  assert.ok(fullPaths.includes('/agg?ac=detail&t=1&pg=1&limit=8'));
  assert.ok(fullPaths.includes('/agg?wd=%E5%A4%A9%E9%81%93&limit=8'));
  assert.ok(fullPaths.includes('/agg?search=%E5%A4%A9%E9%81%93&limit=8'));
  assert.ok(fullPaths.includes('/agg?q=%E5%A4%A9%E9%81%93&limit=8'));
  assert.ok(fullPaths.includes('/agg/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1'));
  assert.ok(cleanPaths.includes('/agg-clean/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1'));
  assert.equal(full.every((x) => x.content_policy === 'full'), true);
  assert.equal(clean.every((x) => x.content_policy === 'clean-no-adult'), true);
});

test('requestVariantPath preserves manual audit_run and cache busts other aggregate paths', () => {
  assert.match(requestVariantPath('/agg?wd=x'), /^\/agg\?wd=x&audit_run=app-/);
  assert.equal(requestVariantPath('/agg?wd=x&audit_run=manual'), '/agg?wd=x&audit_run=manual');
  assert.match(requestVariantPath('/agg-clean/u111111111111?pg=1'), /^\/agg-clean\/u111111111111\?pg=1&audit_run=app-/);
});

test('classifyVariantRecord detects API schema search clean and detail-list regressions', () => {
  assert.equal(classifyVariantRecord({ http_status: 503 }).root_cause, 'API_ERROR');
  assert.equal(classifyVariantRecord({ http_status: 200, schema_ok: false }).root_cause, 'SCHEMA_REGRESSION');

  const emptyList = classifyVariantRecord({
    id: 'tvbox.videolist.t',
    http_status: 200,
    schema_ok: true,
    expects_list: true,
    list_count: 0,
    content_policy_ok: true,
  });
  assert.equal(emptyList.root_cause, 'APP_REQUEST_VARIANT');
  assert.equal(emptyList.result, 'FAIL');

  const cleanBad = classifyVariantRecord({
    id: 'clean.videolist.t',
    http_status: 200,
    schema_ok: true,
    expects_list: true,
    list_count: 8,
    content_policy: 'full',
    expected_content_policy: 'clean-no-adult',
    content_policy_ok: false,
  });
  assert.equal(cleanBad.root_cause, 'CLEAN_POLICY_REGRESSION');

  const detailList = classifyVariantRecord({
    id: 'fongmi.detail_without_ids',
    http_status: 200,
    schema_ok: true,
    expects_list: true,
    list_count: 8,
    content_policy_ok: true,
  });
  assert.equal(detailList.root_cause, 'OK');
});

test('searchSemanticCheck requires Tian Dao variants to contain semantic evidence', () => {
  const ok = searchSemanticCheck('\u5929\u9053', [
    { vod_name: '\u5929\u9053', vod_actor: '\u738b\u5fd7\u6587', vod_remarks: '\u5df2\u5b8c\u7ed3' },
  ]);
  assert.equal(ok.semantic_ok, true);
  assert.equal(ok.hit_count, 1);

  const miss = searchSemanticCheck('\u5929\u9053', [
    { vod_name: '\u5929\u5929\u5411\u4e0a', vod_actor: '', vod_remarks: '' },
  ]);
  assert.equal(miss.semantic_ok, false);
});

test('content policy and update code helpers are deterministic', () => {
  assert.equal(contentPolicyExpected('/agg'), 'full');
  assert.equal(contentPolicyExpected('/agg-clean'), 'clean-no-adult');
  assert.equal(contentPolicyExpected('/agg-clean/u111111111111'), 'clean-no-adult');
  assert.equal(extractUpdateCode('\u5f71\u89c6\u70b9\u64ad \u00b7 813001706202'), '813001706202');
  assert.equal(extractUpdateCode('https://tv.webhome.eu.org/agg/u813001706202'), '813001706202');
});
