import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGES_DEPLOY_MONTHLY_WARN_LIMIT = 500;
const PAGES_FILE_WARN_LIMIT = 20000;
const PAGES_SIZE_WARN_LIMIT_BYTES = 500 * 1024 * 1024;
const KV_WRITE_FREE_DAILY_LIMIT = 1000;
const KV_WRITE_DAILY_RELEASE_GATE = 650;
const HOT_CONTENT_WRITES_PER_SLOT = 2;
const HOT_HEALTH_HEARTBEAT_MINUTES = 30;
const INTERACTION_HOT_PROBE_MIN_INTERVAL_MINUTES = 5;
const WORKER_DAILY_REQUEST_GATE = 80_000;
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');

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

function dailyCronRuns(expr) {
  return monthlyCronRuns(expr) / 30;
}

function interactionFallbackDailyRuns(minIntervalMinutes = INTERACTION_HOT_PROBE_MIN_INTERVAL_MINUTES) {
  return Math.ceil((24 * 60) / Math.max(1, Number(minIntervalMinutes) || INTERACTION_HOT_PROBE_MIN_INTERVAL_MINUTES));
}

function estimateHotKvWrites(dailyCronRuns, options = {}) {
  const slots = Math.max(0, Math.ceil(Number(dailyCronRuns) || 0));
  const writesPerSlot = Math.max(0, Number(options.contentWritesPerSlot ?? HOT_CONTENT_WRITES_PER_SLOT));
  const heartbeatMinutes = Math.max(1, Number(options.heartbeatMinutes ?? HOT_HEALTH_HEARTBEAT_MINUTES));
  const contentWrites = slots * writesPerSlot;
  const healthWrites = Math.ceil((24 * 60) / heartbeatMinutes);
  return {
    cronSlots: slots,
    contentWrites,
    healthWrites,
    interactionWrites: 0,
    totalWrites: contentWrites + healthWrites,
  };
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

async function workerCronSummary() {
  const candidates = ['wrangler.toml', 'wrangler.jsonc', 'wrangler.json'];
  for (const file of candidates) {
    const full = path.join(ROOT, file);
    let text = '';
    try { text = await fs.readFile(full, 'utf8'); } catch { continue; }
    const crons = file.endsWith('.toml')
      ? [...text.matchAll(/crons\s*=\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]))
      : (() => { try { return JSON.parse(text.replace(/\/\/.*$/gm, '')).triggers?.crons || []; } catch { return []; } })();
    if (crons.length) {
      return {
        file,
        crons,
        dailyRuns: crons.reduce((n, c) => n + dailyCronRuns(c), 0),
        monthlyRuns: crons.reduce((n, c) => n + monthlyCronRuns(c), 0),
      };
    }
  }
  return { file: '', crons: [], dailyRuns: 0, monthlyRuns: 0 };
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

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'TVBoxSourceHubFreeTierAudit/7.3', accept: 'text/plain,application/vnd.apple.mpegurl,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseLiveText(raw) {
  const groups = [];
  const channels = [];
  let currentGroup = '';
  for (const lineRaw of String(raw || '').split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (line.includes('#genre#')) {
      currentGroup = line.split(',')[0].trim();
      if (currentGroup) groups.push(currentGroup);
      continue;
    }
    const comma = line.indexOf(',');
    if (comma <= 0) continue;
    const name = line.slice(0, comma).trim();
    const url = line.slice(comma + 1).trim();
    if (name && url) channels.push({ group: currentGroup || '未分组', name, url });
  }
  return { groups: [...new Set(groups)], channels };
}

function summarizeLiveProxyFromChannels(channels, publicBase = PUBLIC_BASE) {
  let proxiedChannels = 0;
  let directChannels = 0;
  let unknownChannels = 0;
  for (const channel of channels || []) {
    try {
      const url = new URL(channel.url);
      if (url.origin === publicBase && url.pathname.startsWith('/play/')) proxiedChannels++;
      else if (/^https?:$/i.test(url.protocol)) directChannels++;
      else unknownChannels++;
    } catch {
      unknownChannels++;
    }
  }
  const totalChannels = (channels || []).length;
  return {
    totalChannels,
    proxiedChannels,
    directChannels,
    unknownChannels,
    proxyRatio: totalChannels ? proxiedChannels / totalChannels : 0,
  };
}

function countProxyPlaylistChildren(body, publicBase = PUBLIC_BASE) {
  const lines = String(body || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const mediaLines = lines.filter((line) => !line.startsWith('#'));
  const proxiedChildLines = mediaLines.filter((line) => line.startsWith(publicBase + '/play/') || line.startsWith(publicBase + '/p/'));
  return {
    mediaLines: mediaLines.length,
    proxiedChildLines: proxiedChildLines.length,
    directChildLines: mediaLines.length - proxiedChildLines.length,
    childProxyRatio: mediaLines.length ? proxiedChildLines.length / mediaLines.length : 0,
  };
}

async function analyzeLiveProxy(publicBase = PUBLIC_BASE) {
  const liveTxtUrl = publicBase + '/live.txt';
  try {
    const liveTxt = await fetchText(liveTxtUrl);
    const parsed = parseLiveText(liveTxt);
    const summary = summarizeLiveProxyFromChannels(parsed.channels, publicBase);
    const sampleChannel = parsed.channels.find((channel) => channel.url);
    let samplePlaylist = null;
    if (sampleChannel) {
      try {
        const playlistText = await fetchText(sampleChannel.url);
        samplePlaylist = {
          ok: true,
          channelName: sampleChannel.name,
          url: sampleChannel.url,
          ...countProxyPlaylistChildren(playlistText, publicBase),
        };
      } catch (err) {
        samplePlaylist = {
          ok: false,
          channelName: sampleChannel.name,
          url: sampleChannel.url,
          error: String(err && err.message || err),
        };
      }
    }
    return {
      ok: true,
      liveTxtUrl,
      groupCount: parsed.groups.length,
      ...summary,
      samplePlaylist,
    };
  } catch (err) {
    return {
      ok: false,
      liveTxtUrl,
      error: String(err && err.message || err),
    };
  }
}

async function auditFreeTier() {
  const generatedAt = new Date().toISOString();
  const distFiles = await walk(path.join(ROOT, 'dist'));
  const distStats = await Promise.all(distFiles.map(async (f) => ({ f, size: (await fs.stat(f)).size })));
  const distBytes = distStats.reduce((n, x) => n + x.size, 0);
  const workflows = await workflowCronSummary();
  const workerCrons = await workerCronSummary();
  const repo = await githubRepoVisibility();
  const liveProxy = await analyzeLiveProxy(PUBLIC_BASE);
  const monthlyRuns = workflows.reduce((n, x) => n + x.monthlyRuns, 0);
  const kvEstimate = estimateHotKvWrites(workerCrons.dailyRuns);
  const estimatedScheduledKvWrites = kvEstimate.contentWrites + kvEstimate.healthWrites;
  const estimatedInteractionProbeDailyWrites = kvEstimate.interactionWrites;
  const estimatedDailyKvWrites = kvEstimate.totalWrites;
  const estimatedDailyWorkerRequests = Math.max(0, Number(process.env.ESTIMATED_DAILY_WORKER_REQUESTS || WORKER_DAILY_REQUEST_GATE));
  const workerRequestMetric = liveProxy.ok
    ? `${liveProxy.proxiedChannels}/${liveProxy.totalChannels} proxied`
    : 'live-audit-unavailable';
  const workerRequestNote = liveProxy.ok
    ? [
        `live.txt groups=${liveProxy.groupCount} channels=${liveProxy.totalChannels}`,
        `直播直连=${liveProxy.directChannels}，经 Worker 代理=${liveProxy.proxiedChannels}，代理占比=${Math.round(liveProxy.proxyRatio * 100)}%`,
        liveProxy.samplePlaylist?.ok
          ? `抽样播放清单子链接 ${liveProxy.samplePlaylist.proxiedChildLines}/${liveProxy.samplePlaylist.mediaLines} 继续走 Worker`
          : `抽样播放清单未取到：${liveProxy.samplePlaylist?.error || 'no-sample'}`,
      ].join('；')
    : `未能抓取 ${liveProxy.liveTxtUrl}：${liveProxy.error}`;
  const rows = [
    { area: 'github_repo', result: repo.private === false ? 'PASS' : 'WARN', metric: repo.visibility || 'unknown', note: repo.private === false ? '\u516c\u5171\u4ed3\u5e93\uff0cGitHub Actions \u6807\u51c6 runner \u6309\u514d\u8d39\u4f18\u5148\u65b9\u6848\u4f7f\u7528\u3002' : '\u9700\u8981\u786e\u8ba4\u4ed3\u5e93\u4e3a public\uff0c\u5426\u5219 GitHub Actions \u53ef\u80fd\u6d88\u8017\u79c1\u6709\u4ed3\u5e93\u989d\u5ea6\u3002' },
    { area: 'github_actions_schedule', result: monthlyRuns <= PAGES_DEPLOY_MONTHLY_WARN_LIMIT ? 'PASS' : 'WARN', metric: `${monthlyRuns}/month`, note: monthlyRuns <= PAGES_DEPLOY_MONTHLY_WARN_LIMIT ? '\u5b9a\u65f6\u5237\u65b0\u9891\u7387\u6309\u514d\u8d39\u4f18\u5148\u63a7\u5236\uff0c\u4fdd\u7559\u4eba\u5de5\u53d1\u5e03\u4f59\u91cf\u3002' : '\u5b9a\u65f6\u5237\u65b0\u6b21\u6570\u8fc7\u9ad8\uff0c\u53ef\u80fd\u89e6\u53d1 Pages \u6784\u5efa/\u90e8\u7f72\u9891\u7387\u98ce\u9669\uff0c\u5efa\u8bae\u964d\u9891\u3002' },
    { area: 'cloudflare_pages_files', result: distFiles.length < PAGES_FILE_WARN_LIMIT ? 'PASS' : 'WARN', metric: String(distFiles.length), note: 'dist \u9759\u6001\u5feb\u7167\u91c7\u7528\u6253\u5305\u6587\u4ef6\uff0c\u4e0d\u91c7\u7528\u6bcf\u4e2a\u8282\u76ee\u4e00\u4e2a\u6587\u4ef6\u3002' },
    { area: 'cloudflare_pages_size', result: distBytes < PAGES_SIZE_WARN_LIMIT_BYTES ? 'PASS' : 'WARN', metric: `${distBytes} bytes`, note: 'dist \u603b\u4f53\u79ef\u5904\u4e8e\u8f7b\u91cf\u7ea7\u9759\u6001\u5206\u53d1\u8303\u56f4\u3002' },
    { area: 'cloudflare_worker_requests', result: liveProxy.ok && liveProxy.proxiedChannels === 0 ? 'PASS' : 'WARN', metric: workerRequestMetric, note: workerRequestNote },
    {
      area: 'cloudflare_kv_hot_probe_writes',
      result: estimatedDailyKvWrites <= KV_WRITE_DAILY_RELEASE_GATE ? 'PASS' : 'FAIL',
      metric: `${Math.round(estimatedDailyKvWrites)}/${KV_WRITE_FREE_DAILY_LIMIT} writes/day`,
      note: estimatedDailyKvWrites <= KV_WRITE_DAILY_RELEASE_GATE
        ? `\u6bcf5\u5206\u949f\u6700\u591a\u4e00\u6b21\u539f\u5b50\u5185\u5bb9\u53d1\u5e03\uff1a${kvEstimate.contentWrites}/day\uff1b30\u5206\u949f\u5065\u5eb7\u5fc3\u8df3\uff1a${kvEstimate.healthWrites}/day\uff1b\u4ea4\u4e92\u89e6\u53d1\u590d\u7528\u540c\u4e00\u53d1\u5e03\u65f6\u9699\uff0c\u4e0d\u53e0\u52a0\u9884\u7b97\u3002`
        : `KV \u5199\u5165\u4f30\u7b97\u8d85\u8fc7\u53d1\u5e03\u786c\u95f8\u95e8 ${KV_WRITE_DAILY_RELEASE_GATE}/day\u3002`,
    },
    {
      area: 'cloudflare_worker_request_budget',
      result: estimatedDailyWorkerRequests <= WORKER_DAILY_REQUEST_GATE ? 'PASS' : 'FAIL',
      metric: `${estimatedDailyWorkerRequests}/${WORKER_DAILY_REQUEST_GATE} requests/day`,
      note: '\u4e0d\u4ee3\u7406\u89c6\u9891\u5206\u7247\uff1b\u7528KV\u70ed\u5305\u3001Pages\u5feb\u7167\u548c\u8fb9\u7f18\u7f13\u5b58\u5c06\u65e5\u8bf7\u6c42\u9884\u7b97\u538b\u572880000\u4ee5\u5185\u3002',
    },
  ];
  const summary = { generatedAt, repo, publicBase: PUBLIC_BASE, monthlyScheduledRuns: monthlyRuns, workerCrons, kvEstimate, estimatedScheduledKvWrites, estimatedInteractionProbeDailyWrites, estimatedDailyKvWrites, estimatedDailyWorkerRequests, distFileCount: distFiles.length, distBytes, workflows, liveProxy, rows, pass: rows.filter((x) => x.result === 'PASS').length, warn: rows.filter((x) => x.result === 'WARN').length, fail: rows.filter((x) => x.result === 'FAIL').length };
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
    `- \u5ba1\u8ba1\u5165\u53e3\uff1a${summary.publicBase}`,
    `- \u5b9a\u65f6\u5de5\u4f5c\u6d41\u4f30\u7b97\uff1a${summary.monthlyScheduledRuns}/month`,
    `- Worker Cron\uff1a${summary.workerCrons.crons.join(', ') || 'none'}\uff1b\u4f30\u7b97 KV writes=${Math.round(summary.estimatedDailyKvWrites)}/day`,
    `- dist\uff1a${summary.distFileCount} files\uff1b${summary.distBytes} bytes`,
    `- PASS/WARN/FAIL\uff1a${summary.pass}/${summary.warn}/${summary.fail}`,
    '',
    '## \u5206\u9879',
    ...summary.rows.map((x) => `- ${x.result}\uff1b${x.area}\uff1b${x.metric}\uff1b${x.note}`),
    '',
    '## \u7ed3\u8bba',
    '- \u5f53\u524d\u65b9\u6848\u4ecd\u6309\u5b8c\u5168\u514d\u8d39\u4f18\u5148\u8bbe\u8ba1\uff1aGitHub public repo + Actions \u5b9a\u65f6\u5237\u65b0 + Cloudflare Pages \u9759\u6001\u5feb\u7167 + Worker \u8f7b\u91cf\u8def\u7531\u3002',
    `- \u4e3b\u8981\u98ce\u9669\u4e0d\u662f\u70b9\u64ad\u5feb\u7167\uff0c\u800c\u662f\u76f4\u64ad\u4ee3\u7406\u8bf7\u6c42\u91cf\u4e0e\u8fc7\u9ad8\u5237\u65b0\u9891\u7387\uff1b\u5f53\u524d\u5ba1\u8ba1\u89c2\u6d4b\u5230 ${summary.liveProxy?.proxiedChannels ?? 0}/${summary.liveProxy?.totalChannels ?? 0} \u6761\u76f4\u64ad\u9891\u9053\u8d70 Worker \u4ee3\u7406\u94fe\u8def\u3002`,
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await auditFreeTier(), null, 2));
}

export { auditFreeTier, countProxyPlaylistChildren, estimateHotKvWrites, interactionFallbackDailyRuns, monthlyCronRuns, parseLiveText, summarizeLiveProxyFromChannels };
