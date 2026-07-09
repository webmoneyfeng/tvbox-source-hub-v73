import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');

const INPUTS = {
  release: 'audit/release-readiness-latest.json',
  zero: 'audit/zero-complaint-latest.json',
  free: 'audit/free-tier-latest.json',
  sla: 'audit/update-sla-latest.json',
};

const ALLOWED_PREDEPLOY_ROOT_CAUSES = ['OK', 'NEEDS_WORKER_DEPLOY', 'NEEDS_PAGES_DEPLOY'];

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function summarizeRootCauses(rows = []) {
  const out = {};
  for (const row of asArray(rows)) {
    const key = String(row?.root_cause || 'UNKNOWN');
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function sourceOk(input) {
  return Boolean(input?.ok && input?.data && typeof input.data === 'object');
}

function complaint(kind, root_cause, severity, message, evidence = {}) {
  return { kind, root_cause, severity, message, evidence };
}

function releaseRootCauses(release) {
  const summaryCauses = release?.data?.summary?.byRootCause;
  if (summaryCauses && typeof summaryCauses === 'object' && Object.keys(summaryCauses).length) return summaryCauses;
  return summarizeRootCauses(release?.data?.rows || []);
}

function hasOnlyAllowedPredeployRootCauses(causes) {
  const keys = Object.keys(causes || {});
  return keys.length > 0 && keys.every((k) => ALLOWED_PREDEPLOY_ROOT_CAUSES.includes(k));
}

function updateSlaFailCount(sla) {
  if (!sourceOk(sla)) return 1;
  const summary = sla.data.summary || {};
  if (Number.isFinite(Number(summary.fail))) return num(summary.fail);
  return asArray(sla.data.endpoints).filter((x) => x.result === 'FAIL').length;
}

function classifyCommercialReadiness({ release, zero, free, sla }) {
  const blockers = [];
  const warnings = [];

  if (!sourceOk(release)) blockers.push(complaint('release', 'RELEASE_READINESS_MISSING', 'P1', 'release readiness audit is missing or unreadable'));
  if (!sourceOk(zero)) blockers.push(complaint('zero_complaint', 'ZERO_COMPLAINT_MISSING', 'P1', 'zero complaint audit is missing or unreadable'));
  if (!sourceOk(free)) blockers.push(complaint('free_tier', 'FREE_TIER_MISSING', 'P1', 'free tier audit is missing or unreadable'));
  if (!sourceOk(sla)) blockers.push(complaint('update_sla', 'UPDATE_SLA_MISSING', 'P1', 'update SLA audit is missing or unreadable'));

  const causes = sourceOk(release) ? releaseRootCauses(release) : {};
  const productionDeployRequired = Boolean(release?.data?.summary?.production_deploy_required);
  const onlyAllowedPredeploy = hasOnlyAllowedPredeployRootCauses(causes);
  const hasNeedsWorker = num(causes.NEEDS_WORKER_DEPLOY) > 0;
  const hasNeedsPages = num(causes.NEEDS_PAGES_DEPLOY) > 0;
  const nonDeployCauses = Object.keys(causes).filter((k) => !ALLOWED_PREDEPLOY_ROOT_CAUSES.includes(k));

  for (const cause of nonDeployCauses) {
    blockers.push(complaint('release', cause, 'P1', 'release readiness has a non-deploy blocker', { count: causes[cause] }));
  }

  if (hasNeedsWorker) blockers.push(complaint('release', 'NEEDS_WORKER_DEPLOY', 'P0', 'production Worker still exposes stale visible freshness surfaces', { count: causes.NEEDS_WORKER_DEPLOY }));
  if (hasNeedsPages) blockers.push(complaint('release', 'NEEDS_PAGES_DEPLOY', 'P0', 'Cloudflare Pages static fallback is stale or incomplete', { count: causes.NEEDS_PAGES_DEPLOY }));

  const freeFail = sourceOk(free) ? num(free.data.fail) : 1;
  const freeWarn = sourceOk(free) ? num(free.data.warn) : 0;
  if (freeFail > 0) blockers.push(complaint('free_tier', 'FREE_TIER_FAIL', 'P1', 'free-tier audit has hard failures', { fail: freeFail }));
  if (freeWarn > 0) warnings.push(complaint('free_tier', 'FREE_TIER_WARN', 'P2', 'free-tier audit has warnings', { warn: freeWarn }));

  const p0 = sourceOk(zero) ? num(zero.data.p0_count) : 1;
  const p1 = sourceOk(zero) ? num(zero.data.p1_count) : 1;
  if (p0 > 0) blockers.push(complaint('zero_complaint', 'P0_COMPLAINTS', 'P0', 'zero complaint gate has P0 issues', { p0 }));
  if (p1 > 0) blockers.push(complaint('zero_complaint', 'P1_COMPLAINTS', 'P1', 'zero complaint gate has P1 issues', { p1 }));

  const slaFail = updateSlaFailCount(sla);
  if (slaFail > 0) blockers.push(complaint('update_sla', 'UPDATE_SLA_FAIL', 'P1', 'update SLA audit has failing endpoints', { fail: slaFail }));

  let stage9PredeployGate = 'BLOCKED_BEFORE_DEPLOY';
  if (sourceOk(release) && onlyAllowedPredeploy && productionDeployRequired && (hasNeedsWorker || hasNeedsPages) && nonDeployCauses.length === 0 && freeFail === 0 && slaFail === 0) {
    stage9PredeployGate = 'READY_FOR_APPROVED_DEPLOY';
  }
  if (sourceOk(release) && !productionDeployRequired && onlyAllowedPredeploy && !hasNeedsWorker && !hasNeedsPages && nonDeployCauses.length === 0) {
    stage9PredeployGate = 'DEPLOYED';
  }

  const zeroCommercialReady = Boolean(zero?.data?.commercial_ready) && String(zero?.data?.zero_complaint_gate || '').toUpperCase() === 'PASS' && p0 === 0 && p1 === 0;
  const commercialPromotionGate = stage9PredeployGate === 'DEPLOYED' && zeroCommercialReady && freeFail === 0 && slaFail === 0 ? 'PASS' : 'NOT_READY';

  let nextAction = 'FIX_PREDEPLOY_BLOCKERS';
  if (stage9PredeployGate === 'READY_FOR_APPROVED_DEPLOY') nextAction = 'AWAIT_APPROVAL_THEN_DEPLOY_WORKER_PAGES';
  if (stage9PredeployGate === 'DEPLOYED' && commercialPromotionGate !== 'PASS') nextAction = 'RUN_POST_DEPLOY_TV_AND_ZERO_COMPLAINT_AUDITS';
  if (commercialPromotionGate === 'PASS') nextAction = 'START_STAGE10_COMMERCIAL_TRIAL';

  return {
    generatedAt: nowIso(),
    stage9_predeploy_gate: stage9PredeployGate,
    commercial_promotion_gate: commercialPromotionGate,
    production_deploy_required: productionDeployRequired,
    next_action: nextAction,
    allowed_predeploy_root_causes: ALLOWED_PREDEPLOY_ROOT_CAUSES,
    release_root_causes: causes,
    inputs: {
      release_ok: sourceOk(release),
      zero_ok: sourceOk(zero),
      free_ok: sourceOk(free),
      sla_ok: sourceOk(sla),
    },
    zero_complaint: sourceOk(zero) ? {
      commercial_ready: Boolean(zero.data.commercial_ready),
      gate: zero.data.zero_complaint_gate || '',
      p0_count: p0,
      p1_count: p1,
      p2_count: num(zero.data.p2_count),
      p3_count: num(zero.data.p3_count),
    } : null,
    free_tier: sourceOk(free) ? { pass: num(free.data.pass), warn: freeWarn, fail: freeFail } : null,
    update_sla: sourceOk(sla) ? { fail: slaFail, summary: sla.data.summary || null } : null,
    blockers,
    warnings,
  };
}

async function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, path: relPath, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, path: relPath, error: String(error && error.message || error), data: null };
  }
}

function markdownReport(report) {
  const lines = [];
  lines.push('# v7.4 Stage 9 Commercial Readiness Preflight');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- stage9_predeploy_gate: ${report.stage9_predeploy_gate}`);
  lines.push(`- commercial_promotion_gate: ${report.commercial_promotion_gate}`);
  lines.push(`- production_deploy_required: ${report.production_deploy_required}`);
  lines.push(`- next_action: ${report.next_action}`);
  lines.push(`- release_root_causes: ${Object.entries(report.release_root_causes || {}).map(([k, v]) => `${k}=${v}`).join('; ') || 'none'}`);
  lines.push('');
  lines.push('## Blockers');
  if (!report.blockers.length) lines.push('- none');
  for (const blocker of report.blockers) lines.push(`- ${blocker.severity}; ${blocker.kind}; ${blocker.root_cause}; ${blocker.message}`);
  lines.push('');
  lines.push('## Warnings');
  if (!report.warnings.length) lines.push('- none');
  for (const warning of report.warnings) lines.push(`- ${warning.severity}; ${warning.kind}; ${warning.root_cause}; ${warning.message}`);
  lines.push('');
  lines.push('## Interpretation');
  if (report.next_action === 'AWAIT_APPROVAL_THEN_DEPLOY_WORKER_PAGES') {
    lines.push('- The current state is suitable for an explicitly approved Worker + Pages production deploy. It is not commercial-ready yet because post-deploy TV-side verification is still required.');
  } else if (report.next_action === 'START_STAGE10_COMMERCIAL_TRIAL') {
    lines.push('- The service passed the commercial preflight and can move to Stage 10 commercial trial planning.');
  } else {
    lines.push('- Fix blockers before requesting or executing production deployment.');
  }
  lines.push('');
  return lines.join('\n');
}

async function auditCommercialReadiness() {
  const [release, zero, free, sla] = await Promise.all([
    readJson(INPUTS.release),
    readJson(INPUTS.zero),
    readJson(INPUTS.free),
    readJson(INPUTS.sla),
  ]);
  const report = classifyCommercialReadiness({ release, zero, free, sla });
  report.input_paths = INPUTS;
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'commercial-readiness-latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'commercial-readiness-summary.md'), markdownReport(report), 'utf8');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditCommercialReadiness().then((report) => {
    console.log(JSON.stringify({
      generatedAt: report.generatedAt,
      stage9_predeploy_gate: report.stage9_predeploy_gate,
      commercial_promotion_gate: report.commercial_promotion_gate,
      production_deploy_required: report.production_deploy_required,
      next_action: report.next_action,
      blockers: report.blockers.length,
      warnings: report.warnings.length,
    }, null, 2));
    if (report.stage9_predeploy_gate === 'BLOCKED_BEFORE_DEPLOY') process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  classifyCommercialReadiness,
  summarizeRootCauses,
  auditCommercialReadiness,
};
