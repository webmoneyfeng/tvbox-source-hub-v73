import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const APPROVAL_TOKEN = 'WORKER_PAGES_PRODUCTION_APPROVED';
const PRIMARY_BASE = 'https://tv.webhome.eu.org';
const SECONDARY_BASE = 'https://tv.webclound.eu.org';

function parseArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes('--execute');
  const dryRun = !execute || argv.includes('--dry-run');
  return { execute, dryRun: execute ? false : dryRun };
}

function assertExecutionApproval({ execute, env = process.env } = {}) {
  if (!execute) return true;
  if (env.TVBOX_DEPLOY_APPROVED !== APPROVAL_TOKEN) {
    throw new Error(`Production deploy blocked: set TVBOX_DEPLOY_APPROVED=${APPROVAL_TOKEN} only after the user explicitly approves deploying Worker and Pages.`);
  }
  return true;
}

function npmCmd(script) {
  return process.platform === 'win32' ? ['cmd.exe', ['/c', 'npm', 'run', script]] : ['npm', ['run', script]];
}

function npxCmd(args) {
  return process.platform === 'win32' ? ['cmd.exe', ['/c', 'npx', ...args]] : ['npx', args];
}

function makeStep(name, command, args, options = {}) {
  return {
    name,
    command,
    args,
    env: options.env || {},
    allowFailure: Boolean(options.allowFailure),
    risky: Boolean(options.risky),
    reason: options.reason || '',
  };
}

function buildCommandPlan({ execute = false, primaryBase = PRIMARY_BASE, secondaryBase = SECONDARY_BASE } = {}) {
  const [npm, checkArgs] = npmCmd('check');
  const [npmRelease, releaseArgs] = npmCmd('audit:release-readiness');
  const [wranglerDry, wranglerDryArgs] = npxCmd(['wrangler', 'deploy', '--dry-run', '--outdir', '.wrangler\\dry-run-v73']);
  const plan = [
    makeStep('npm_check', npm, checkArgs, { reason: 'syntax, unit and policy tests must pass before any deploy' }),
    makeStep('release_readiness_precheck', npmRelease, releaseArgs, { allowFailure: true, reason: 'pre-deploy readiness is expected to flag NEEDS_WORKER_DEPLOY/NEEDS_PAGES_DEPLOY' }),
    makeStep('worker_dry_run', wranglerDry, wranglerDryArgs, { reason: 'Cloudflare Worker packaging validation without production mutation' }),
  ];
  if (!execute) return plan;

  const [wranglerDeploy, wranglerDeployArgs] = npxCmd(['wrangler', 'deploy']);
  const [pagesDeploy, pagesDeployArgs] = npxCmd(['wrangler', 'pages', 'deploy', 'dist', '--project-name', 'tvbox-source-hub-v73', '--branch', 'main']);
  const [npmValidate, validateArgs] = npmCmd('validate:online');
  const [npmVisible, visibleArgs] = npmCmd('audit:visible-freshness');
  const [npmCache, cacheArgs] = npmCmd('audit:tv-cache-update');
  const [npmZero, zeroArgs] = npmCmd('audit:zero-complaint');
  plan.push(
    makeStep('worker_deploy', wranglerDeploy, wranglerDeployArgs, { risky: true, reason: 'publish Worker routes for primary and secondary domains' }),
    makeStep('pages_deploy', pagesDeploy, pagesDeployArgs, { risky: true, reason: 'publish static snapshot/config/config-clean fallback to Pages' }),
    makeStep('validate_primary', npmValidate, validateArgs, { env: { TVBOX_BASE: primaryBase }, reason: 'validate full and clean TVBox endpoints on primary domain' }),
    makeStep('validate_secondary', npmValidate, validateArgs, { env: { TVBOX_BASE: secondaryBase }, reason: 'validate full and clean TVBox endpoints on secondary domain' }),
    makeStep('release_readiness_postcheck', npmRelease, releaseArgs, { reason: 'release readiness should clear Worker/Pages deploy requirements after deploy' }),
    makeStep('visible_freshness_audit', npmVisible, visibleArgs, { env: { TVBOX_BASE: primaryBase }, reason: 'visible timestamp surfaces must be fresh' }),
    makeStep('tv_cache_update_audit', npmCache, cacheArgs, { env: { TVBOX_BASE: primaryBase }, reason: 'cached old aggregate paths must stamp current update code' }),
    makeStep('zero_complaint_gate', npmZero, zeroArgs, { reason: 'commercial P0/P1/P2 gate after deploy' }),
  );
  return plan;
}

function riskyCommandCount(plan) {
  return plan.filter((step) => step.risky).length;
}

function shellLine(step) {
  const envPrefix = Object.entries(step.env || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
  return `${envPrefix ? envPrefix + ' ' : ''}${step.command} ${step.args.join(' ')}`.trim();
}

async function runStep(step, options = {}) {
  const env = { ...process.env, ...(step.env || {}) };
  const dryPrint = options.printOnly;
  if (dryPrint) {
    console.log(`[plan] ${step.name}: ${shellLine(step)}`);
    return { step: step.name, code: 0, skipped: true };
  }
  console.log(`\n[run] ${step.name}: ${shellLine(step)}`);
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, { cwd: ROOT, env, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || step.allowFailure) resolve({ step: step.name, code, allowFailure: step.allowFailure });
      else reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

async function runPlan(plan, options = {}) {
  const results = [];
  for (const step of plan) results.push(await runStep(step, options));
  return results;
}

async function main() {
  const args = parseArgs();
  assertExecutionApproval({ execute: args.execute, env: process.env });
  const plan = buildCommandPlan({ execute: args.execute });
  console.log(JSON.stringify({ execute: args.execute, riskyCommandCount: riskyCommandCount(plan), steps: plan.map((step) => ({ name: step.name, risky: step.risky, allowFailure: step.allowFailure, reason: step.reason })) }, null, 2));
  await runPlan(plan, { printOnly: !args.execute });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

export {
  APPROVAL_TOKEN,
  assertExecutionApproval,
  buildCommandPlan,
  parseArgs,
  riskyCommandCount,
};
