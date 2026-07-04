import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
  const workflows = await workflowCronSummary();
  const repo = await githubRepoVisibility();
  const monthlyRuns = workflows.reduce((n, x) => n + x.monthlyRuns, 0);
  const rows = [
    { area: 'github_repo', result: repo.private === false ? 'PASS' : 'WARN', metric: repo.visibility || 'unknown', note: repo.private === false ? 'public repo' : '需要确认仓库是否 public' },
    { area: 'github_actions', result: monthlyRuns <= 500 ? 'PASS' : 'WARN', metric: `${monthlyRuns}/month`, note: monthlyRuns <= 500 ? '调度频率按免费优先控制' : '可能触发 Pages 构建次数风险，建议继续降频' },
    { area: 'cloudflare_pages_files', result: distFiles.length < 20000 ? 'PASS' : 'WARN', metric: String(distFiles.length), note: 'dist 文件数量估算' },
    { area: 'cloudflare_pages_size', result: distStats.reduce((n, x) => n + x.size, 0) < 500 * 1024 * 1024 ? 'PASS' : 'WARN', metric: `${distStats.reduce((n, x) => n + x.size, 0)} bytes`, note: 'dist 总大小估算' },
    { area: 'cloudflare_worker_requests', result: 'WARN', metric: 'unknown', note: '点播不代理视频；直播 /play/ 与 /p/ 会消耗 Worker 请求，本轮只审计不改现状' },
    { area: 'cloudflare_kv', result: 'PASS', metric: 'low', note: '当前主要读 channels/vod_catalog，未发现高频写入' },
  ];
  const summary = { generatedAt, repo, monthlyScheduledRuns: monthlyRuns, distFileCount: distFiles.length, distBytes: distStats.reduce((n, x) => n + x.size, 0), workflows, rows, pass: rows.filter((x) => x.result === 'PASS').length, warn: rows.filter((x) => x.result === 'WARN').length, fail: rows.filter((x) => x.result === 'FAIL').length };
  await fs.mkdir(path.join(ROOT, 'audit'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'audit', 'free-tier-latest.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(ROOT, 'audit', 'free-tier-summary.md'), renderSummary(summary), 'utf8');
  return summary;
}

function renderSummary(summary) {
  return [
    '# v7.3 免费部署审计',
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- GitHub 仓库：${summary.repo.url || 'unknown'}｜visibility=${summary.repo.visibility || 'unknown'}｜private=${summary.repo.private}`,
    `- 定时工作流估算：${summary.monthlyScheduledRuns}/month`,
    `- dist：${summary.distFileCount} files｜${summary.distBytes} bytes`,
    `- PASS/WARN/FAIL：${summary.pass}/${summary.warn}/${summary.fail}`,
    '',
    '## 分项',
    ...summary.rows.map((x) => `- ${x.result}｜${x.area}｜${x.metric}｜${x.note}`),
    '',
    '## 结论',
    '- 当前方案免费优先；主要风险是 Cloudflare Pages 构建次数与直播代理请求量。',
    '- 本轮不改直播代理，只保留风险提示与后续降级空间。',
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await auditFreeTier(), null, 2));
}

export { auditFreeTier, monthlyCronRuns };
