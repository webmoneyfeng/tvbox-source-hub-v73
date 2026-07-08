import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';
import { parseLiveText, summarizeLiveProxyFromChannels } from './audit-free-tier-v73.mjs';

const CHANNELS = [
  { group: '电影频道', name: 'Direct Movie', url: 'https://direct.example.com/movie/live.m3u8' },
  { group: '经典电影', name: 'Direct Classic', url: 'https://cdn.example.com/classic/index.m3u8' },
];

function envWithChannels(channels = CHANNELS) {
  return {
    TVBOX_KV: {
      async get(key) {
        if (key === 'channels') return JSON.stringify(channels);
        if (key === 'vod_catalog') return '[]';
        return null;
      },
    },
  };
}

async function readTextResponse(url, env = envWithChannels()) {
  const res = await worker.fetch(new Request(url), env);
  assert.equal(res.status, 200);
  return res.text();
}

test('default live.txt uses direct upstream URLs to avoid Worker media amplification', async () => {
  const body = await readTextResponse('https://tv.webhome.eu.org/live.txt');
  const parsed = parseLiveText(body);
  assert.equal(parsed.channels.length, 2);
  assert.ok(parsed.channels.every((channel) => channel.url.startsWith('https://')));
  assert.ok(parsed.channels.every((channel) => !channel.url.startsWith('https://tv.webhome.eu.org/play/')));
  const summary = summarizeLiveProxyFromChannels(parsed.channels, 'https://tv.webhome.eu.org');
  assert.equal(summary.totalChannels, 2);
  assert.equal(summary.proxiedChannels, 0);
  assert.equal(summary.directChannels, 2);
});

test('live.txt keeps explicit proxy fallback for incompatible TV players', async () => {
  const body = await readTextResponse('https://tv.webhome.eu.org/live.txt?proxy=1');
  const parsed = parseLiveText(body);
  assert.equal(parsed.channels.length, 2);
  assert.ok(parsed.channels.every((channel) => channel.url.startsWith('https://tv.webhome.eu.org/play/')));
  assert.ok(parsed.channels.every((channel) => channel.url.endsWith('.m3u8?mode=full')));
});

test('health exposes live delivery policy for commercial free-tier audits', async () => {
  const res = await worker.fetch(new Request('https://tv.webhome.eu.org/health'), envWithChannels());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.live.delivery.defaultMode, 'DIRECT');
  assert.equal(data.live.delivery.defaultProxiesMediaSegments, false);
  assert.equal(data.live.delivery.fullProxyFallback, 'https://tv.webhome.eu.org/live.txt?proxy=1');
});
