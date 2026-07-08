# TVBox/FongMi/影视仓 v7.3 Free-First 全量实时改造计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在自运营全免费的前提下，把 tvbox-source-hub-v73 打造成可公开订阅收费的 TVBox/FongMi/影视仓服务：电视端功能顶级堪用，直播 + 点播统一准实时更新、语义搜索、跨分类去重、遥控器全量验证；用户持续导入同一入口，更新以“热索引准实时 + 全量快照兜底”的方式无感生效。

**Architecture:** 采用“三层更新”而不是“每次请求全网重抓”。第一层是热索引（Worker/KV/轻量缓存）负责热点节目、连载剧集和直播频道的快速变化；第二层是每日全量快照（Pages/GitHub）负责稳定发布和回滚；第三层是 Worker 路由层，按“热索引 → 快照 → 上次有效版本 → 动态兜底”顺序服务 TVBox/FongMi/影视仓。所有可见列表都经过 canonical 去重与语义映射，任何同一节目在不同分类、筛选、搜索里都只保留一个 canonical item。

**Tech Stack:** Node.js 20、Cloudflare Worker、Cloudflare Pages、Cloudflare KV、GitHub Actions、JSON 快照、`node:test`、`curl`/`fetch` 烟雾测试。

**Free-first target:** 热点更新 5–15 分钟可见，全量更新 24 小时内可见；静态快照优先读取最新 GitHub raw 镜像，再回落 Pages / 自有静态域名；不代理大规模视频流，不依赖付费主机/付费 CDN，不使用登录源、私有 token 源、网盘源作为本阶段主链路；商业化销售配置维护、聚合体验、稳定性和自动化运维能力，不托管视频文件。

---

## Task 1: 固化统一内容模型与 canonical identity

**Files:**
- Create: `data/taxonomy-v74.json`
- Create: `data/content-forms-v74.json`
- Create: `data/search-synonyms-v74.json`
- Create: `data/canonical-key-rules-v74.json`
- Create: `scripts/normalize-title-v74.mjs`
- Modify: `scripts/generate-snapshot.mjs`
- Modify: `src/worker.mjs`
- Test: `scripts/taxonomy-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 覆盖标题去噪、别名命中、年份归一、内容形态识别、canonical key 生成。
  - 用例必须包含：`天道 / 遥远的救世主 / 王志文`、`亮剑`、`演唱会`、`公开课`、`短剧`、`电影解说`。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/taxonomy-v74.test.mjs`
  - Expected: fail，提示 canonical key、别名或内容形态规则尚未就绪。

- [ ] **Step 3: 实现最小模型**
  - 统一字段：`content_id / title / aliases / primary_category / tags / content_form / year / area / quality / duration / episode_state / source_ids`.
  - `content_id` 由“标准化标题 + 年份 + 主要人名/主条目”构成，确保同节目跨分类/跨筛选不重复。

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/taxonomy-v74.test.mjs`
  - Expected: PASS，且 canonical key 对同一节目稳定一致。

- [ ] **Step 5: 提交**
  - `git add data scripts src`
  - `git commit -m "feat: add canonical identity for free-first realtime model"`

---

## Task 2: 把“热更新”和“全量快照”拆成两条发布链

**Files:**
- Create: `scripts/incremental-refresh-v74.mjs`
- Create: `scripts/build-hot-index-v74.mjs`
- Modify: `scripts/generate-snapshot.mjs`
- Modify: `.github/workflows/hot-refresh.yml`
- Modify: `.github/workflows/full-refresh.yml`
- Modify: `wrangler.toml`
- Modify: `src/worker.mjs`
- Test: `scripts/incremental-refresh-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 热更新只刷新“变化项”和最新指针，不触发全量 Pages 重建。
  - 全量快照仍然保留，供回滚与低频兜底。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/incremental-refresh-v74.test.mjs`
  - Expected: fail，说明当前仓库还没有“热索引/全量快照”双链路。

- [ ] **Step 3: 实现最小链路**
  - 热更新写入 KV：`latest_hot_manifest`、`latest_hot_vod_index`、`latest_hot_live_index`。
  - 全量更新继续写 `dist/snapshot/latest/*`。
  - Worker 读取顺序改为：内存缓存 → KV 热指针 → Pages 快照 → GitHub raw 快照 → 动态兜底。

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/incremental-refresh-v74.test.mjs`
  - Expected: PASS，热更新不再依赖 Pages 构建成功与否。

- [ ] **Step 5: 提交**
  - `git add .github/workflows scripts src wrangler.toml`
  - `git commit -m "feat: split hot index from full snapshot"`

---

## Task 3: 直播与点播分流，但统一在同一 canonical 层去重

**Files:**
- Create: `scripts/discover-live-sources-v74.mjs`
- Create: `scripts/discover-vod-sources-v74.mjs`
- Create: `scripts/source-health-v74.mjs`
- Modify: `scripts/generate-snapshot.mjs`
- Modify: `src/worker.mjs`
- Create: `data/live-registry-v74.json`
- Create: `data/vod-registry-v74.json`
- Test: `scripts/source-health-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 直播频道和点播条目必须走不同 ingest 逻辑。
  - 但最终输出必须共享同一 canonical 去重逻辑，不能在 UI 里重复出现。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/source-health-v74.test.mjs`
  - Expected: fail，提示 live/vod registry 尚未分离。

- [ ] **Step 3: 实现最小 ingest**
  - 直播：按 `group -> channel -> stream` 建模，先清洗群组名、频道名、播放地址。
  - 点播：按 `source -> category -> item -> detail/play` 建模。
  - 两者都写入 `source_status`、`health_score`、`last_seen_at`、`last_playable_at`。

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/source-health-v74.test.mjs`
  - Expected: PASS，且 live/vod registry 均能产出健康评分。

- [ ] **Step 5: 提交**
  - `git add data scripts src`
  - `git commit -m "feat: separate live and vod ingestion pipelines"`

---

## Task 4: 做精准标签搜索与跨分类召回

**Files:**
- Create: `scripts/build-search-index-v74.mjs`
- Create: `scripts/search-queries-v74.json`
- Modify: `src/worker.mjs`
- Modify: `scripts/generate-snapshot.mjs`
- Test: `scripts/search-index-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 关键词必须支持：片名、别名、主演、导演、年份 + 片名、内容形态标签。
  - 关键词必须回传“可解释命中证据”，例如 title/alias/actor/year/tag。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/search-index-v74.test.mjs`
  - Expected: fail，说明当前搜索索引仍只依赖单一路径。

- [ ] **Step 3: 实现最小搜索索引**
  - 为每个 canonical item 生成搜索向量：`title + aliases + actors + category tags + form tags + year tags`.
  - 搜索排序：精确片名 > 别名 > 主演 > 标题包含 > 简介包含。

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/search-index-v74.test.mjs`
  - Expected: PASS；`天道 / 遥远的救世主 / 王志文` 必须稳定召回同一 canonical item。

- [ ] **Step 5: 提交**
  - `git add scripts src data`
  - `git commit -m "feat: add semantic search index and tag recall"`

---

## Task 5: 消灭跨分类、跨筛选、跨搜索重复

**Files:**
- Create: `scripts/dedupe-v74.mjs`
- Modify: `scripts/generate-snapshot.mjs`
- Modify: `src/worker.mjs`
- Test: `scripts/dedupe-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 同一个节目出现在不同分类、不同筛选、不同搜索词下时，输出必须是同一个 `content_id`。
  - 列表、筛选、搜索都不能把同一 canonical item 重复渲染为多条。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/dedupe-v74.test.mjs`
  - Expected: fail，说明仍有重复条目没有被归并。

- [ ] **Step 3: 实现最小去重**
  - 去重主键：`content_id`。
  - 辅助键：标题归一、年份、主类型、来源簇。
  - 冲突解决：保留播放线更多、质量更高、更新时间更新、语义更干净的实体。

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/dedupe-v74.test.mjs`
  - Expected: PASS；任意 query/page/filter 的重复率都应接近 0。

- [ ] **Step 5: 提交**
  - `git add scripts src`
  - `git commit -m "feat: dedupe canonical items across all views"`

---

## Task 6: 更新电视端遥控器语义审计，直到逐项通过

**Files:**
- Create: `scripts/audit-tv-remote-full-v74.mjs`
- Create: `scripts/audit-root-cause-v74.mjs`
- Modify: `scripts/audit-free-tier-v73.mjs` (or create `v74` sibling if you prefer version isolation)
- Modify: `.github/workflows/deep-verify.yml`
- Modify: `.github/workflows/manual-release.yml`
- Test: `scripts/audit-tv-remote-full-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 遥控器验证不能只看“可点且有返回”，必须检查返回是否符合按钮语义：数量、格式、内容元素、排序、详情、播放、分页、重进一致性。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/audit-tv-remote-full-v74.test.mjs`
  - Expected: fail，说明审计覆盖还没有进入“语义级”。

- [ ] **Step 3: 实现最小审计**
  - 覆盖层级：L0 配置、L1 入口、L2 分类、L3 列表、L4 筛选组、L5 筛选项、L6 组合筛选、L7 分页、L8 搜索、L9 详情、L10 播放、L11 重进一致性、L12 运维端点。
  - 输出 root cause：`OK / API_ERROR / SNAPSHOT_MISS / FILTER_LOGIC_BUG / TAG_PARSE_GAP / SOURCE_TAG_GAP / SOURCE_COVERAGE_GAP / SEMANTIC_MISMATCH / PLAYBACK_FAIL`.

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/audit-tv-remote-full-v74.test.mjs`
  - Expected: PASS；所有可见按钮都有语义结论，空结果必须有根因。

- [ ] **Step 5: 提交**
  - `git add scripts .github/workflows`
  - `git commit -m "feat: semantic remote-control audit v74"`

---

## Task 7: 把免费优先落地方案写进调度、缓存和发布规则

**Files:**
- Modify: `.github/workflows/hot-refresh.yml`
- Modify: `.github/workflows/full-refresh.yml`
- Modify: `.github/workflows/source-health.yml`
- Modify: `.github/workflows/deep-verify.yml`
- Modify: `wrangler.toml`
- Modify: `README.md`
- Create: `docs/operations/free-first-realtime-architecture.md`

- [ ] **Step 1: 写失败测试/审计**
  - 免费优先必须明确：热更新不触发全量 Pages 构建；全量构建每日一次；用户侧只读快照与热索引。

- [ ] **Step 2: 运行审计确认失败**
  - Run: `npm run audit:free-tier`
  - Expected: 如果热更新还会频繁打到 Pages 构建，审计应提示 WARN。

- [ ] **Step 3: 实现最小发布规则**
  - 热更新：只更新 KV / 小 manifest / 热索引。
  - 全量更新：生成静态快照，再切换指针。
  - Worker：优先读热索引，失败回退快照，最后再动态兜底。

- [ ] **Step 4: 运行审计确认通过**
  - Run: `npm run audit:free-tier`
  - Expected: PASS/WARN/FAIL 维持可控；无 Pages 过量构建风险。

- [ ] **Step 5: 提交**
  - `git add .github/workflows wrangler.toml README.md docs`
  - `git commit -m "docs: codify free-first realtime publish policy"`

---

## Task 8: 端到端验收矩阵

**Files:**
- Modify: `scripts/validate-online-v73.mjs` (or add `v74` sibling)
- Modify: `scripts/audit-source-coverage-v73.mjs` (or add `v74` sibling)
- Create: `scripts/e2e-smoke-v74.mjs`
- Create: `scripts/e2e-smoke-v74.test.mjs`

- [ ] **Step 1: 写失败测试**
  - 主备入口、`/config.json`、`/status.json`、`/snapshot.json`、`/mirrors.json`、`/agg`、`/live.txt` 必须全链路可用。

- [ ] **Step 2: 运行测试确认失败**
  - Run: `node --test scripts/e2e-smoke-v74.test.mjs`
  - Expected: fail，直到所有关键接口和语义路径都能回归通过。

- [ ] **Step 3: 实现最小验收矩阵**
  - 入口：`sites.length = 1`
  - 直播：组非空，抽样播放可用
  - 点播：分类非空，搜索可命中，详情可打开，播放线可用
  - 去重：重复率接近 0
  - 延迟：热更新在可接受小时差内生效

- [ ] **Step 4: 运行测试确认通过**
  - Run: `node --test scripts/e2e-smoke-v74.test.mjs`
  - Expected: PASS。

- [ ] **Step 5: 提交**
  - `git add scripts`
  - `git commit -m "test: add end-to-end smoke gate for release"`

---

## Acceptance Criteria

- 直播与点播都能在免费优先模式下独立更新。
- 同一节目在任何分类、筛选、搜索里都只出现一次 canonical item。
- 关键标签搜索（片名、别名、主演、年份、内容形态）能稳定召回正确内容。
- 遥控器逐层验证不再只看“能返回”，而是看“返回是否符合语义”。
- 免费层面可控：热更新不依赖 Pages 频繁构建，发布链不把请求预算打爆。
- 回滚路径明确：任意新链路失败时，继续回到上一次成功快照。

## Rollout Order

1. 先做 canonical identity + 去重。
2. 再拆热更新/全量快照。
3. 然后做直播与点播分流。
4. 再做搜索与标签召回。
5. 最后上遥控器语义审计和免费层审计。

## Free-tier Operating Rules

- 热更新只写 KV / 热索引，不做全量 Pages 构建。
- 全量快照每日一次，必要时手动触发。
- Worker 只读缓存和快照，避免把回源放在用户请求路径上。
- 直播播放链路尽量轻，不把代理流量当主业务。
- 若某一环超过免费预算，先降频，再缩热源，再优化缓存。
