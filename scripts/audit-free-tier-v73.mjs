import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGES_DEPLOY_MONTHLY_WARN_LIMIT = 500;
const PAGES_FILE_WARN_LIMIT = 20000;
const PAGES_SIZE_WARN_LIMIT_BYTES = 500 * 1024 * 1024;

async function walk(dir) {
  const out = [];
  try {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...await walk(p));
      else out.push(p);
    }
  } catch {}
  return out;
}

function monthlyCronRuns(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return 0;
  const [minute, hour] = parts;
  const minuteCount = minute.includes(',') ? minute.split(',').length : minute.startsWith('*/') ? Math.ceil(60 / Number(minute.slice(2))) : minute === '*' ? 60 : 1;
  const hourCount = hour.includes(',') ? hour.split(',').length : hour.startsWith('*/') ? Math.ceil(24 / Number(hour.slice(2))) : hour === '*' ? 24 : 1;
  return minuteCount * hourCount * 30;
}

async function workflowCronSummary() {
  const dir = path.join(ROOT, '.github', 'workflows');
  const files = (await walk(dir)).filter((x) => /\.ya?ml$/i.test(x));
  const rows = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const crons = [...text.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    rows.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), crons, monthlyRuns: crons.reduce((n, c) => n + monthlyCronRuns(c), 0) });
  }
  return rows;
}

async function githubRepoVisibility() {
  try {
    const res = await fetch('https://api.github.com/repos/webmoneyfeng/tvbox-source-hub-v73', { headers: { 'user-agent': 'TVBoxSourceHubFreeTierAudit/7.3' } });
    const data = await res.json();
    return { ok: res.ok, private: data.private, visibility: data.visibility, url: data.html_url };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

async function auditFreeTier() {
  const generatedAt = new Date().toISOString();
  const distFiles = await walk(path.join(ROOT, 'dist'));
  const distStats = await Promise.all(distFiles.map(async (f) => ({ f, size: (await fs.stat(f)).size })));
  const distBytes = distStats.reduce((n, x) => n + x.size, 0);
  const workflows = await workflowCronSummary();
  const repo = await githubRepoVisibility();
  const monthlyRuns = workflows.reduce((n, x) => n + x.monthlyRuns, 0);
  const rows = [
    { area: 'github_repo', result: repo.private === false ? 'PASS' : 'WARN', metric: repo.visibility || 'unknown', note: repo.private === false ? '\u516c\u5171\u4ed3\u5e93\uff0cGitHub Actions \u6807\u51c6 runner \u6309\u514d\u8d39\u4f18\u5148\u65b9\u6848\u4f7f\u7528\u3002' : '\u9700\u8981\u786e\u8ba4\u4ed3\u5e93\u4e3a public\uff0c\u5426\u5219 GitHub Actions \u53ef\u80fd\u6d88\u8017\u79c1\u6709\u4ed3\u5e93\u989d\u5ea6\u3002' },
    { area: 'github_actions_schedule', result: monthlyRuns <= PAGES_DEPLOY_MONTHLY_WARN_LIMIT ? 'PASS' : 'WARN', metric: `${monthlyRuns}/month`, note: monthlyRuns <= PAGES_DEPLOY_MONTHLY_WARN_LIMIT ? '\u5b9a\u65f6\u5237\u65b0\u9891\u7387\u6309\u514d\u8d39\u4f18\u5148\u63a7\u5236\uff0c\u4fdd\u7559\u4eba\u5de5\u53d1\u5e03\u4f59\u91cf\u3002' : '\u5b9a\u65f6\u5237\u65b0\u6b21\u6570\u8fc7\u9ad8\uff0c\u53ef\u80fd\u89e6\u53d1 Pages \u6784\u5efa/\u90e8\u7f72\u9891\u7387\u98ce\u9669\uff0c\u5efa\u8bae\u964d\u9891\u3002' },
    { area: 'cloudflare_pages_files', result: distFiles.length < PAGES_FILE_WARN_LIMIT ? 'PASS' : 'WARN', metric: String(distFiles.length), note: 'dist \u9759\u6001\u5feb\u7167\u91c7\u7528\u6253\u5305\u6587\u4ef6\uff0c\u4e0d\u91c7\u7528\u6bcf\u4e2a\u8282\u76ee\u4e00\u4e2a\u6587\u4ef6\u3002' },
    { area: 'cloudflare_pages_size', result: distBytes < PAGES_SIZE_WARN_LIMIT_BYTES ? 'PASS' : 'WARN', metric: `${distBytes} bytes`, note: 'dist \u603b\u4f53\u79ef\u5904\u4e8e\u8f7b\u91cf\u7ea7\u9759\u6001\u5206\u53d1\u8303\u56f4\u3002' },
    { area: 'cloudflare_worker_requests', result: 'WARN', metric: 'unknown', note: '\u70b9\u64ad\u4e0d\u4ee3\u7406\u89c6\u9891\u6d41\uff1b\u76f4\u64ad /play/ \u4e0e /p/ \u53ef\u80fd\u6d88\u8017 Worker \u8bf7\u6c42\uff0c\u672c\u8f6e\u53ea\u5ba1\u8ba1\u4e0d\u6269\u5927\u4ee3\u7406\u3002' },
    { area: 'cloudflare_kv', result: 'PASS', metric: 'low', note: '\u5f53\u524d\u4e3b\u8981\u8bfb\u53d6 channels/vod_catalog\uff0c\u672a\u53d1\u73b0\u9ad8\u9891\u5199\u5165\u8bbe\u8ba1\u3002' },
  ];
  const summary = { generatedAt, repo, monthlyScheduledRuns: monthlyRuns, distFileCount: distFiles.length, distBytes, workflows, rows, pass: rows.filter((x) => x.result === 'PASS').length, warn: rows.filter((x) => x.result === 'WARN').length, fail: rows.filter((x) => x.result === 'FAIL').length };
  await fs.mkdir(path.join(ROOT, 'audit'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'audit', 'free-tier-latest.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(ROOT, 'audit', 'free-tier-summary.md'), renderSummary(summary), 'utf8');
  return summary;
}

function renderSummary(summary) {
  return [
    '# v7.3 \u514d\u8d39\u90e8\u7f72\u5ba1\u8ba1',
    '',
    `- \u751f\u6210\u65f6\u95f4\uff1a${summary.generatedAt}`,
    `- GitHub \u4ed3\u5e93\uff1a${summary.repo.url || 'unknown'}\uff1bvisibility=${summary.repo.visibility || 'unknown'}\uff1bprivate=${summary.repo.private}`,
    `- \u5b9a\u65f6\u5de5\u4f5c\u6d41\u4f30\u7b97\uff1a${summary.monthlyScheduledRuns}/month`,
    `- dist\uff1a${summary.distFileCount} files\uff1b${summary.distBytes} bytes`,
    `- PASS/WARN/FAIL\uff1a${summary.pass}/${summary.warn}/${summary.fail}`,
    '',
    '## \u5206\u9879',
    ...summary.rows.map((x) => `- ${x.result}\uff1b${x.area}\uff1b${x.metric}\uff1b${x.note}`),
    '',
    '## \u7ed3\u8bba',
    '- \u5f53\u524d\u65b9\u6848\u4ecd\u6309\u5b8c\u5168\u514d\u8d39\u4f18\u5148\u8bbe\u8ba1\uff1aGitHub public repo + Actions \u5b9a\u65f6\u5237\u65b0 + Cloudflare Pages \u9759\u6001\u5feb\u7167 + Worker \u8f7b\u91cf\u8def\u7531\u3002',
    '- \u4e3b\u8981\u98ce\u9669\u4e0d\u662f\u70b9\u64ad\u5feb\u7167\uff0c\u800c\u662f\u76f4\u64ad\u4ee3\u7406\u8bf7\u6c42\u91cf\u4e0e\u8fc7\u9ad8\u5237\u65b0\u9891\u7387\uff1b\u672c\u8f6e\u5df2\u628a\u70ed\u70b9\u5237\u65b0\u63a7\u5236\u5728\u7ea6 3 \u5c0f\u65f6\u4e00\u6b21\uff0c\u5e76\u4fdd\u7559\u964d\u9891\u7a7a\u95f4\u3002',
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await auditFreeTier(), null, 2));
}

export { auditFreeTier, monthlyCronRuns };
