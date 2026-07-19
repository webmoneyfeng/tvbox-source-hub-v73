import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import registryDefault, {
  ACTIVE_SOURCE_REGISTRY,
  DEFAULT_HEALTH_WINDOW,
  FULL_SNAPSHOT_SOURCES,
  HOT_REFRESH_SOURCES,
  SOURCE_REGISTRY,
  SOURCE_REGISTRY_SCHEMA_VERSION,
  SOURCE_REGISTRY_SCOPE,
  SOURCE_STATUS_VALUES,
  SOURCE_TIER_VALUES,
  dedupePhysicalSources,
  filterSourceRegistry,
  loadSourceRegistry,
  normalizeCmsApiUrl,
  physicalSourceKey,
} from '../src/source-registry.mjs';

const AUDIT_FILE = new URL('../data/source-registry-v73.json', import.meta.url);
const RUNTIME_FILE = new URL('../src/source-registry.mjs', import.meta.url);
const WORKER_FILE = new URL('../src/worker.mjs', import.meta.url);
const GENERATOR_FILE = new URL('./generate-snapshot.mjs', import.meta.url);

const EXPECTED_PRODUCTION_APIS = Object.freeze([
  'https://suoniapi.com/api.php/provide/vod/',
  'https://lzizy1.com/api.php/provide/vod/',
  'https://api.apibdzy.com/api.php/provide/vod/',
  'http://sdzyapi.com/api.php/provide/vod/',
  'https://bfzyapi.com/api.php/provide/vod/',
  'https://taopianapi.com/cjapi/mc/vod/json.html',
  'https://www.huyaapi.com/api.php/provide/vod/from/hym3u8/',
  'https://hhzyapi.com/api.php/provide/vod/',
  'https://www.hongniuzy2.com/api.php/provide/vod/',
  'https://api.guangsuapi.com/api.php/provide/vod/',
  'https://api.ffzyapi.com/api.php/provide/vod/',
  'https://api.wujinapi.me/api.php/provide/vod/',
  'https://caiji.moduapi.cc/api.php/provide/vod/',
  'https://m3u8.apiyhzy.com/api.php/provide/vod/',
  'https://api.xinlangapi.com/xinlangapi.php/provide/vod/',
  'https://cj.lziapi.com/api.php/provide/vod/',
  'http://ffzy.tv/api.php/provide/vod/',
]);

async function readAuditRegistry() {
  return JSON.parse(await readFile(AUDIT_FILE, 'utf8'));
}

test('Cloudflare registry contains the validated production candidates without physical duplicates', () => {
  assert.equal(SOURCE_REGISTRY.length, 17);
  assert.deepEqual(SOURCE_REGISTRY.map((source) => source.api), EXPECTED_PRODUCTION_APIS);
  assert.equal(new Set(SOURCE_REGISTRY.map((source) => source.slug)).size, 17);
  assert.equal(new Set(SOURCE_REGISTRY.map((source) => source.key)).size, 17);
  assert.equal(new Set(SOURCE_REGISTRY.map((source) => source.canonicalApiUrl)).size, 17);
  assert.equal(new Set(SOURCE_REGISTRY.map((source) => source.physicalSourceKey)).size, 17);
});

test('JSON audit checklist and Cloudflare JS truth are identical', async () => {
  const audit = await readAuditRegistry();
  assert.equal(audit.schemaVersion, SOURCE_REGISTRY_SCHEMA_VERSION);
  assert.equal(audit.scope, SOURCE_REGISTRY_SCOPE);
  assert.equal(audit.sourceOfTruth, 'src/source-registry.mjs');
  assert.equal(audit.unknownSourcesAdded, 2);
  assert.deepEqual(audit.statusValues, SOURCE_STATUS_VALUES);
  assert.deepEqual(audit.tierValues, SOURCE_TIER_VALUES);
  assert.deepEqual(audit.healthWindowPolicy, DEFAULT_HEALTH_WINDOW);
  assert.deepEqual(audit.sources, SOURCE_REGISTRY);
  assert.deepEqual(audit.counts, {
    total: 17,
    active: 11,
    watch: 3,
    rejected: 0,
    blocked: 3,
    hotRefresh: 11,
    fullSnapshot: 11,
  });
});

test('only validated ACTIVE sources enter production data paths', () => {
  assert.deepEqual(SOURCE_STATUS_VALUES, ['ACTIVE', 'WATCH', 'REJECTED', 'BLOCKED']);
  assert.deepEqual(SOURCE_TIER_VALUES, ['main', 'aux']);
  assert.equal(ACTIVE_SOURCE_REGISTRY.length, 11);
  assert.equal(HOT_REFRESH_SOURCES.length, 11);
  assert.equal(FULL_SNAPSHOT_SOURCES.length, 11);

  for (const source of SOURCE_REGISTRY) {
    assert.equal(source.api, normalizeCmsApiUrl(source.api));
    assert.equal(source.canonicalApiUrl, source.api);
    assert.equal(source.physicalSourceKey, physicalSourceKey(source.api));
    assert.deepEqual(source.healthWindow, DEFAULT_HEALTH_WINDOW);
    if (source.status === 'BLOCKED' || source.status === 'REJECTED') {
      assert.equal(source.participatesInHotRefresh, false);
      assert.equal(source.participatesInFullSnapshot, false);
    }
  }
  assert.equal(SOURCE_REGISTRY.filter((source) => source.status === 'WATCH').length, 3);
  assert.equal(SOURCE_REGISTRY.filter((source) => source.status === 'BLOCKED').length, 3);
});

test('CMS API URL normalization is deterministic and physical keys ignore scheme and www mirrors', () => {
  assert.equal(
    normalizeCmsApiUrl(' HTTPS://WWW.HUYAAPI.COM:443//api.php//provide/vod/from/hym3u8/?b=2&a=1#fragment '),
    'https://www.huyaapi.com/api.php/provide/vod/from/hym3u8/?a=1&b=2',
  );
  assert.equal(
    physicalSourceKey('http://huyaapi.com/api.php/provide/vod/'),
    physicalSourceKey('https://www.huyaapi.com/api.php/provide/vod/from/hym3u8/'),
  );
  assert.throws(() => normalizeCmsApiUrl('file:///tmp/source.json'), /http or https/u);
  assert.throws(() => normalizeCmsApiUrl('https://user:secret@example.com/api'), /credentials/u);
});

test('physical-source dedupe deterministically keeps the stronger production entry', () => {
  const production = SOURCE_REGISTRY.find((source) => source.slug === 'baidu');
  const mirror = {
    ...production,
    slug: 'baidu-mirror',
    key: 'cms_baidu_mirror',
    short: '百度镜像',
    name: '百度镜像资源',
    tier: 'aux',
    status: 'WATCH',
    api: 'http://www.api.apibdzy.com/api.php/provide/vod/',
    canonicalApiUrl: 'http://www.api.apibdzy.com/api.php/provide/vod/',
    physicalSourceKey: 'api.apibdzy.com',
    participatesInHotRefresh: false,
    participatesInFullSnapshot: false,
  };

  const result = dedupePhysicalSources([mirror, production]);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, 'baidu');
});

test('registry filtering supports status, tier, hot-refresh, and full-snapshot selection', () => {
  assert.equal(filterSourceRegistry(SOURCE_REGISTRY, { status: 'active' }).length, 11);
  assert.equal(filterSourceRegistry(SOURCE_REGISTRY, { status: 'BLOCKED' }).length, 3);
  assert.equal(filterSourceRegistry(SOURCE_REGISTRY, { tier: 'main' }).length, 9);
  assert.equal(filterSourceRegistry(SOURCE_REGISTRY, { tier: 'aux' }).length, 8);
  assert.equal(filterSourceRegistry(SOURCE_REGISTRY, { hotRefresh: true, fullSnapshot: true }).length, 14);
});

test('loaded exports are recursively frozen and invalid registries fail closed', () => {
  assert.ok(Object.isFrozen(SOURCE_REGISTRY));
  assert.ok(Object.isFrozen(SOURCE_REGISTRY[0]));
  assert.ok(Object.isFrozen(SOURCE_REGISTRY[0].healthWindow));
  assert.ok(Object.isFrozen(registryDefault));
  assert.throws(() => {
    SOURCE_REGISTRY[0].status = 'WATCH';
  }, TypeError);

  assert.throws(
    () => loadSourceRegistry([{ ...SOURCE_REGISTRY[0], status: 'UNKNOWN' }]),
    /unsupported source.status/u,
  );
  assert.throws(
    () => loadSourceRegistry([SOURCE_REGISTRY[0], { ...SOURCE_REGISTRY[0], slug: 'duplicate' }]),
    /duplicate source.key/u,
  );
});

test('Cloudflare runtime module has no Node fs dependency', async () => {
  const sourceText = await readFile(RUNTIME_FILE, 'utf8');
  assert.doesNotMatch(sourceText, /node:fs|from\s+['"]fs(?:\/promises)?['"]/u);
});

test('Worker consumes the registry truth instead of duplicating production sources', async () => {
  const sourceText = await readFile(WORKER_FILE, 'utf8');
  assert.match(sourceText, /import\s*\{[^}]*HOT_REFRESH_SOURCES[^}]*\}\s*from\s*['"]\.\/source-registry\.mjs['"]/su);
  assert.match(sourceText, /const\s+CMS_SOURCES\s*=\s*HOT_REFRESH_SOURCES\s*;/u);
  assert.match(sourceText, /const\s+probeSources\s*=\s*await\s+runtimeCmsSources\(env\)\s*;/u);
  assert.match(sourceText, /sources\.length\s*===\s*HOT_REFRESH_SOURCES\.length\s*\?\s*sources\s*:\s*HOT_REFRESH_SOURCES/u);
  assert.doesNotMatch(sourceText, /const\s+CMS_SOURCES\s*=\s*\[/u);
});

test('snapshot generator admits only the validated full-snapshot registry', async () => {
  const sourceText = await readFile(GENERATOR_FILE, 'utf8');
  assert.match(sourceText, /FULL_SNAPSHOT_SOURCES\.map/u);
  assert.doesNotMatch(sourceText, /auditedAdmittedSources\.length\s*\?\s*auditedAdmittedSources/u);
});
