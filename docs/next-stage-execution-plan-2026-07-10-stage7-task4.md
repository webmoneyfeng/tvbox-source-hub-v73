# TVBox v7.4 Stage 7 Task 4 执行计划：Worker Hot Overlay 与热点内容无感合并

## 阶段名称

Stage 7 Task 4：Worker 读取 `dist/hot/latest` 热点快照，并与现有 snapshot-first 响应合并。

## 上一阶段证据

上一阶段 Stage 7 Task 3 已完成热点快照生成闭环：

- 新增脚本：`scripts/generate-hot-snapshot-v74.mjs`
- 新增命令：`npm run generate:hot-snapshot`
- 新增产物：`dist/hot/latest/manifest.json`
- 热点范围：推荐、电影、剧集、短剧、解说、文娱知识、天道、遥远的救世主、王志文、2026、电影、解说、演唱会、公开课、直播频道。
- 最新本地验证：`durationMs < 10000`，远低于 180000ms 门槛。
- 最新本地验证：`validation.errors = 0`，`validation.warnings = 0`。
- 主入口和同构入口 `validate:online` 均通过。

## 终局承接

终局目标不是“生成了热点文件”，而是用户打开电视端时能无感看到更新后的热点内容、追更内容和热点搜索召回。

Task 4 对终局的贡献：

1. 把热点快照从静态产物变成电视端实际可感知的内容更新能力。
2. 减少“电视剧更新了但电视端还看不到下一集”的投诉。
3. 减少“搜索热点剧名/主演时结果旧或排序不合理”的投诉。
4. 在免费优先架构下避免每个用户请求都动态 fanout 多源，降低 Worker 超限风险。

## 全局影响

| 层级 | 本阶段要改变什么 | 不改变什么 |
|---|---|---|
| 用户入口层 | 用户无感获得热点内容更新 | 不新增电视端站点入口 |
| 更新服务层 | hot snapshot 成为 snapshot 之上的新鲜层 | Cloudflare Cron hot-probe 仍只负责更新时间和源健康 |
| 聚合索引层 | `/agg`、`/agg-clean` 可读取 hot catalog/search | 不替代全量 snapshot |
| 去重排序层 | hot rows 与 snapshot rows 合并后去重排序 | 不允许同节目在第一页重复 |
| 双版本层 | clean 版合并后再次过滤成人内容 | full 版继续保留成人内容 |
| 免费承载层 | 优先读静态 hot 文件，失败回退 snapshot | 不代理视频流，不在用户路径写 KV |
| 审计层 | remote-full 增加 hot overlay 证据 | 不把 200 响应误判为用户体验通过 |

## 局部任务

### 1. Worker 读取 hot manifest

文件：

- `src/worker.mjs`

要求：

- 从现有 `snapshotBases(env)` 派生 hot base：
  - `https://.../snapshot/latest` 对应 `https://.../hot/latest`
  - GitHub raw、Pages、自有域名静态路径都应兼容。
- 新增读取：
  - `hot/latest/manifest.json`
  - `hot/latest/catalog-hot.json`
  - `hot/latest/search-hot.json`
- 若 hot manifest 不存在、过旧、errors 非空，则静默回退现有 snapshot。

### 2. 分类列表 overlay

路径：

```text
/agg
/agg?ac=videolist&t=...
/agg?ac=detail&t=...&pg=...
/agg-clean
```

规则：

- 对推荐、电影、剧集、短剧、解说、文娱知识优先使用 hot rows。
- 再追加 snapshot rows。
- 按 canonical title + year + macro 去重。
- 排序权重：hot freshness > 播放有效 > 多线路 > 清晰度 > 更新时间 > 标题干净度。
- `limit=8/12/24/48` 都必须可裁剪。

### 3. 搜索 overlay

路径：

```text
/agg?wd=天道
/agg?wd=遥远的救世主
/agg?wd=王志文
/agg?wd=2026
/agg?wd=演唱会
/agg?wd=公开课
```

规则：

- 先查 `search-hot.json` 和对应 `search/*.json`。
- 命中后与 snapshot/dynamic 搜索合并。
- 精确片名、别名、主演命中优先于泛匹配。
- 正片优先于解说、片段、短视频，但解说类搜索仍保留解说。

### 4. 洁净版安全边界

路径：

```text
/agg-clean
/agg-clean?wd=...
```

规则：

- hot rows 与 snapshot rows 合并后必须再次执行 `sanitizeAggResponseForPolicy(..., { includeAdult: false })`。
- clean 版不得暴露成人分类、成人筛选、成人标题、成人备注。
- full 版不得被 clean 逻辑误伤。

### 5. 审计增强

文件：

- `scripts/audit-tv-remote-full-v73.mjs`
- `scripts/validate-online-v73.mjs`

新增记录：

```text
hot_manifest_available
hot_manifest_fresh
hot_overlay_applied
hot_rows_used
hot_duplicate_removed
hot_search_terms_hit
```

新增根因：

```text
HOT_MANIFEST_MISS
HOT_MANIFEST_STALE
HOT_OVERLAY_BYPASSED
HOT_DEDUP_BUG
HOT_SEARCH_RANKING_BUG
```

## 节点任务

| 节点 | 必须证明 | 证据 |
|---|---|---|
| hot manifest | 可读取、未过期、errors=0 | `/status.json` 或审计报告 |
| catalog overlay | 热点分类可优先使用 hot rows | `/agg?fresh=1&t=0/1/2/6/7/8` |
| search overlay | 热点搜索词能命中 hot rows | `/agg?wd=天道/王志文/演唱会` |
| dedupe | hot + snapshot 合并后第一页不重复 | remote-full duplicate_rate |
| clean | clean 版无成人暴露 | validate online + clean policy test |
| fallback | hot 缺失时 snapshot 仍可用 | 单元测试 mock 缺失 hot |

## 末梢遥控器验证

电视端抽查路径：

```text
导入 config.json
进入影视点播
进入推荐
搜索 天道
搜索 王志文
搜索 演唱会
进入剧集
进入短剧
进入文娱知识
返回首页
导入 config-clean.json
重复搜索 天道/王志文/演唱会
确认无成人分类和成人结果
```

每条路径必须记录：

```text
path_id
request_url
list_count
hot_overlay_applied
duplicate_rate
semantic_hit_rate
detail_ok_rate
playable_rate
root_cause
```

## 风险与免费额度

| 风险 | 控制 |
|---|---|
| hot 文件过大 | 当前仅 6 类 + 8 搜索 + 直播清单，远小于 Pages 文件限制 |
| hot 读取增加请求 | Worker 先内存缓存，失败回退 snapshot |
| hot 与 snapshot 重复 | 合并后 canonical 去重 |
| hot 内容错误污染 clean | clean 合并后再次二次过滤 |
| hot 过旧 | manifest freshness 超阈值则不使用 |
| 免费额度 | 用户路径只读静态文件/缓存，不写 KV，不代理视频流 |

## 验收命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run generate:hot-snapshot
npm run check
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run validate:online
$env:TVBOX_BASE='https://tv.webclound.eu.org'; npm run validate:online
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run audit:remote-full
npx wrangler deploy --dry-run
```

## 失败回退

1. hot manifest 读取失败：回退现有 snapshot，不影响用户。
2. hot overlay 导致重复：关闭 overlay，只保留 hot 生成。
3. clean 版暴露成人：立即回滚 Worker，标记 P0。
4. 搜索排序变差：仅对搜索 overlay 降级，分类 overlay 保留。
5. Worker 资源超限：降低 hot 读取频率和 rows 数量，继续使用静态 snapshot。

## 下一阶段入口

Task 4 完成后，进入 Stage 7 Task 5：

```text
把更新时间 SLA、hot overlay、热点搜索、追更路径加入全量遥控器审计 L13/L14，
用电视端路径级证据证明不是“接口能通”，而是“按钮语义、数量、格式、排序、详情、播放、缓存一致性都符合预期”。
```
