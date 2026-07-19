import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative) => readFile(path.join(ROOT, relative), 'utf8');

test('CI runs one deterministic repository check with pinned Node 20 runtime actions', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /actions\/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0/u);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(workflow, /branches:\s*\n\s*- main\s*\n\s*- 'codex\/\*\*'/u);
  assert.doesNotMatch(workflow, /- snapshot/u);
  assert.equal((workflow.match(/npm run check/gu) || []).length, 1);
  assert.match(workflow, /cancel-in-progress:\s*true/u);
});

test('catalog release restores dist correctly and only publishes the snapshot branch', async () => {
  const workflow = await read('.github/workflows/catalog-release.yml');
  assert.match(workflow, /cron:\s*'17 \*\/6 \* \* \*'/u);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/u);
  assert.match(workflow, /group:\s*catalog-release-snapshot/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /SNAPSHOT_BRANCH:\s*snapshot/u);
  assert.match(workflow, /SNAPSHOT_CRAWL_MODE:\s*direct-sources/u);
  assert.match(workflow, /git archive "FETCH_HEAD:dist" \| tar -x -C dist/u);
  assert.match(workflow, /HEAD:refs\/heads\/\$\{SNAPSHOT_BRANCH\}/u);
  assert.equal((workflow.match(/npm run check/gu) || []).length, 1);
  assert.doesNotMatch(workflow, /git push origin HEAD:main/u);
});

test('catalog release requires all 13 categories to be visible and non-empty', async () => {
  const workflow = await read('.github/workflows/catalog-release.yml');
  assert.match(workflow, /categorySchemaCount/u);
  assert.match(workflow, /all 13 categories must be visible/u);
  assert.match(workflow, /all 13 category totals must be positive/u);
  assert.doesNotMatch(workflow, /allowedHiddenRootCauses/u);
  assert.doesNotMatch(workflow, /SOURCE_COVERAGE_GAP/u);
});

test('repository check includes the source-time policy and direct-source crawler syntax and tests', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.check, /node --check src\/source-time\.mjs/u);
  assert.match(pkg.scripts.check, /node --check src\/release-metadata\.mjs/u);
  assert.match(pkg.scripts.check, /node --check src\/snapshot-source-crawler\.mjs/u);
  assert.match(pkg.scripts.check, /scripts\/release-metadata\.test\.mjs/u);
  assert.match(pkg.scripts.check, /scripts\/snapshot-source-crawler\.test\.mjs/u);
  assert.match(pkg.scripts.check, /scripts\/workflow-contract\.test\.mjs/u);
});

test('snapshot generator defaults to the current primary service rather than the read-only rollback Worker', async () => {
  const generator = await read('scripts/generate-snapshot.mjs');
  assert.match(generator, /TVBOX_SOURCE_BASE \|\| 'https:\/\/tv\.webhome\.eu\.org'/u);
  assert.doesNotMatch(generator, /TVBOX_SOURCE_BASE \|\| 'https:\/\/tvbox-source-hub\.feng-yang\.workers\.dev'/u);
  assert.match(generator, /required category \$\{category\.id\}\/\$\{category\.name\} empty/u);
  assert.doesNotMatch(generator, /EVIDENCE_GATED_CATEGORY_KEYS/u);
});

test('interrupted snapshot build directory is ignored as a disposable process fragment', async () => {
  const ignore = await read('.gitignore');
  assert.match(ignore, /^dist\/snapshot\/\.building\/$/mu);
});

test('direct-source crawl checkpoints bypass published artifact limits without weakening Pages limits', async () => {
  const generator = await read('scripts/generate-snapshot.mjs');
  assert.match(generator, /if \(!resumed\) await writeJsonFileAtomic\(path\.join\(building, relativeFile\), result\);/u);
  assert.doesNotMatch(generator, /if \(!resumed\) await writeJson\(`snapshot\/latest\/\$\{relativeFile\}`, result\);/u);
  assert.match(generator, /if \(bytes > MAX_FILE_BYTES\) throw new Error\(`\$\{rel\} exceeds \$\{MAX_FILE_BYTES\} byte snapshot file limit`\);/u);
  assert.match(generator, /buildSnapshotIndexes\(views\.rows, \{ revision, shardSize: SHARD_SIZE, maxShardBytes: MAX_FILE_BYTES \}\)/u);
  assert.match(generator, /child === '\.crawl' \|\| child\.startsWith\(`\.crawl\$\{path\.sep\}`\) \|\| child === 'build-state\.json'/u);
  assert.match(generator, /await rm\(path\.join\(building, '\.crawl'\), \{ recursive: true, force: true \}\);[\s\S]*await rename\(building, LATEST\);/u);
});

test('release metadata uses the public subject payload instead of the rate-limited movie payload', async () => {
  const generator = await read('scripts/generate-snapshot.mjs');
  assert.match(generator, /rexxar\/api\/v2\/subject\/\{id\}\?for_mobile=1/u);
  assert.doesNotMatch(generator, /rexxar\/api\/v2\/movie\/\{id\}/u);
});

test('compatibility hot snapshot uses the canonical 13-category schema and global semantic merge', async () => {
  const hot = await read('scripts/generate-hot-snapshot-v74.mjs');
  assert.match(hot, /SNAPSHOT_CATEGORIES\.map/u);
  assert.match(hot, /mergeSnapshotRows\(rows \|\| \[\]\)\.rows/u);
  assert.match(hot, /\{ t: '1', key: 'movie'/u);
  assert.match(hot, /\{ t: '2', key: 'tv'/u);
  assert.doesNotMatch(hot, /const macro = String\(item\?\.type_id/u);
});
