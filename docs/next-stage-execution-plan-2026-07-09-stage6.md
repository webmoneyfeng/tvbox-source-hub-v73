# TVBox v7.4 Stage 6 执行计划：线上发布门禁、电视端双入口复核与更新时间 SLA 观测

## 阶段名称

Stage 6：把 Stage 5 的“双入口 + 更新时间兜底 + 快照防污染”从本地有效推进到线上可验证、电视端可感知、投诉可闭环。

## 上一阶段证据

Stage 5 已经完成的本地工程能力：

- 全量入口继续为：
  - `https://tv.webhome.eu.org/config.json`
  - `https://tv.webclound.eu.org/config.json`
  - 对应点播接口：`/agg`
- 洁净入口继续为：
  - `https://tv.webhome.eu.org/config-clean.json`
  - `https://tv.webclound.eu.org/config-clean.json`
  - 对应点播接口：`/agg-clean`
- `src/worker.mjs` 已把 `/config.json` 与 `/config-clean.json` 改为 `no-store`，降低电视 App 和中间缓存继续显示旧入口名的概率。
- `src/worker.mjs` 已把同一个 `visibleUpdateText` 同步展示到 `/agg` 和 `/agg-clean` 的 `推荐` 分类名，作为电视端配置名缓存的兜底可见点。
- `scripts/generate-snapshot.mjs` 已新增本地 `local-known-good` 回退：上游瞬时空响应时优先复用上一版有效包。
- `scripts/generate-snapshot.mjs` 已改为仅在 `SNAPSHOT_CLEAN=1` 时清空 `dist/snapshot/latest`，避免普通刷新先删后失败导致有效快照被破坏。
- `scripts/generate-snapshot.mjs` 已在 `validation.errors.length > 0` 时返回非 0，阻止 GitHub Actions 把坏快照提交发布。
- 本地验证：
  - `npm run check`：25 项测试通过。
  - `npm run generate:snapshot`：`ok=true`。
  - 当前本地 `dist/snapshot/latest/manifest.json`：`visibleUpdateText=230290706202`。
  - 当前本地快照 10 个主分类均非空。

当前残余差距：

- 本地快照与 Worker 修正尚需进入线上主入口、同构入口和 GitHub/Pages 静态镜像。
- 真实电视端是否仍缓存旧 14 点入口名，需要通过“入口名 + 推荐分类更新时间码 + 重新导入/清缓存”三条路径复核。
- `成人伦理 / 类型=剧情` 当前仅为隐藏或观察级 warning，不应阻塞发布，但要进入 Stage 6 审计观察队列。
- 终局商业目标未完成，Stage 6 不能宣称“0 投诉商业完成”，只能建立可运营门禁。

## 终局承接

终局仍然是：

```text
用户喜欢的、0 投诉的、可商业化收费的顶级 TVBOX/FongMi/影视仓 点播 + 直播源。
```

Stage 6 从终局反推，本阶段要解决的是用户可感知的四类投诉风险：

1. **更新慢投诉**：用户看到入口仍是旧时间，认为源没维护。
2. **双入口混乱投诉**：全量版和洁净版更新不同步，或洁净版漏过滤成人内容。
3. **发布污染投诉**：某次上游抖动生成空快照，却把新时间发布到电视端。
4. **电视端差异投诉**：脚本访问正常，但 TVBox/FongMi/影视仓因缓存、请求参数或分页差异仍显示空、旧、重复或错分。

Stage 6 的验收不是“接口 200”，而是：

```text
线上入口、线上聚合、电视端遥控器路径、更新时间显示、快照门禁、投诉种子都能互相证明同一个事实：
用户看到的是最新一版验证通过的可用内容，而不是旧缓存、坏快照或工程假象。
```

## 全局影响

本阶段对应终局全景流程图中的 6 层：

```text
用户入口层
  ↓
双版本入口层
  ↓
更新服务层
  ↓
发布承载层
  ↓
电视端请求层
  ↓
0投诉商业体验总控门禁
```

本阶段不重画终局图，只围绕既有图把“本地有效”推进到“线上真实用户可用”。

## 局部任务 A：发布前冻结与坏快照门禁

### 目标

确保要发布的 `dist` 不是上游瞬时异常污染出来的空包，且全量版、洁净版共用同一更新时间码。

### 需要检查的文件

```text
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\src\worker.mjs
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\generate-snapshot.mjs
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\worker-clean-policy.test.mjs
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\dist\config.json
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\dist\config-clean.json
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\dist\status.json
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\dist\snapshot\latest\manifest.json
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\dist\snapshot\latest\validation.json
```

### 执行命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run check
$env:SNAPSHOT_SOURCE_BASE='https://tv.webhome.eu.org'
$env:PUBLIC_BASE='https://tv.webhome.eu.org'
Remove-Item Env:SNAPSHOT_CLEAN -ErrorAction SilentlyContinue
npm run generate:snapshot
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('dist/snapshot/latest/manifest.json','utf8')); const v=JSON.parse(fs.readFileSync('dist/snapshot/latest/validation.json','utf8')); console.log(JSON.stringify({ok:m.ok, visibleUpdateText:m.visibleUpdateText, errors:v.errors, categories:m.categories?.map(c=>({id:c.type_id,name:c.type_name,count:c.count,total:c.total,filterGroups:c.filterGroups}))},null,2)); if(!m.ok||v.errors.length) process.exit(1);"
```

### 通过标准

```text
npm run check exit 0
generate:snapshot exit 0
manifest.ok = true
validation.errors.length = 0
dist/config.json 与 dist/config-clean.json 时间码一致
10 个主分类 count > 0
filterGroups 对可见分类不为 0，除非该分类明确不展示筛选
```

### 失败回退

- 如果 `generate:snapshot` 失败，不发布 `dist`。
- 如果 `manifest.ok=false`，恢复上一版有效 `dist`。
- 如果只有非电视端可见 warning，进入观察队列，不阻断发布。
- 如果 warning 会导致电视端可见按钮为空，升级为 P2，必须修复后再发布。

## 局部任务 B：GitHub / Pages / Worker 发布同步

### 目标

把 Stage 5/6 本地修正同步到线上，避免用户继续访问旧 Worker 或旧 Pages 快照。

### 执行顺序

1. 检查本地差异：

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
git status -sb
git diff -- src/worker.mjs scripts/generate-snapshot.mjs scripts/worker-clean-policy.test.mjs docs/terminal-global-flow.md docs/goal-mode-terminal-objective.md docs/next-stage-execution-plan-2026-07-09-stage5.md docs/next-stage-execution-plan-2026-07-09-stage6.md
```

2. 只在验证通过后提交：

```powershell
git add src/worker.mjs scripts/generate-snapshot.mjs scripts/worker-clean-policy.test.mjs docs/terminal-global-flow.md docs/goal-mode-terminal-objective.md docs/next-stage-execution-plan-2026-07-09-stage5.md docs/next-stage-execution-plan-2026-07-09-stage6.md dist
git commit -m "fix: harden snapshot freshness and visible update labels"
git push
```

3. 部署 Worker：

```powershell
npx wrangler deploy
```

4. 部署 Pages 静态快照：

```powershell
npx wrangler pages deploy dist --project-name tvbox-source-hub-v73
```

### 通过标准

```text
GitHub 最新提交包含 src / scripts / docs / dist
Worker deploy 返回新的 Version ID
Pages deploy 返回新的 deployment URL
线上 /status.json visibleUpdateText 与本地 manifest 一致或更新
线上 /snapshot.json manifest.ok=true
```

### 失败回退

- GitHub 推送失败：不声称上线，只保留本地已验证状态。
- Worker 部署失败：继续使用上一版 Worker，但不能告诉用户“缓存已修复上线”。
- Pages 部署失败：Worker 仍可读 GitHub raw 或旧 Pages，但本阶段发布状态标记为未完成。
- 任一部署成功但线上验证失败：优先回滚 Worker 或恢复上一版 Pages 快照。

## 局部任务 C：线上双入口同构验证

### 目标

证明全量版和洁净版同时间更新、同时间可导入、同时间可用，并且洁净版不暴露成人内容。

### 验证入口

```text
https://tv.webhome.eu.org/config.json
https://tv.webhome.eu.org/config-clean.json
https://tv.webclound.eu.org/config.json
https://tv.webclound.eu.org/config-clean.json
```

### 执行命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
$env:TVBOX_BASE='https://tv.webhome.eu.org'
npm run validate:online
$env:TVBOX_BASE='https://tv.webclound.eu.org'
npm run validate:online
```

### 补充 curl 验证

```powershell
curl.exe -L -A "okhttp/4.10.0 TVBox" -H "Cache-Control: no-cache" -D - https://tv.webhome.eu.org/config.json
curl.exe -L -A "okhttp/4.10.0 TVBox" -H "Cache-Control: no-cache" -D - https://tv.webhome.eu.org/config-clean.json
curl.exe -L -A "okhttp/4.10.0 TVBox" -H "Cache-Control: no-cache" "https://tv.webhome.eu.org/agg?limit=8"
curl.exe -L -A "okhttp/4.10.0 TVBox" -H "Cache-Control: no-cache" "https://tv.webhome.eu.org/agg-clean?limit=8"
curl.exe -L -A "okhttp/4.10.0 TVBox" -H "Cache-Control: no-cache" https://tv.webhome.eu.org/status.json
curl.exe -L -A "okhttp/4.10.0 TVBox" -H "Cache-Control: no-cache" https://tv.webhome.eu.org/snapshot.json
```

### 通过标准

```text
/config.json HTTP 200
/config-clean.json HTTP 200
config Cache-Control 包含 no-store
全量入口名称 = 影视点播 · 12位倒序码
洁净入口名称 = 影视点播洁净 · 同一12位倒序码
/agg class 中 推荐分类显示同一12位倒序码
/agg-clean class 中 推荐分类显示同一12位倒序码
全量版 class 含 成人伦理
洁净版 class 不含 成人伦理
全量版与洁净版均保留 电影、剧集、综艺、动漫、纪录片、短剧、解说、文娱知识
```

### 失败回退

- 如果 config 时间码新而 `/agg` 推荐分类旧：查 Worker 内存缓存和 `fetchSnapshotJson`。
- 如果 `/agg` 新而 config 旧：查电视端配置缓存、Cloudflare 边缘和 `config()`。
- 如果洁净版暴露成人：回滚 Worker，优先修 `sanitizeAggResponseForPolicy`。
- 如果全量版丢成人：查 policy 默认值，不让洁净策略污染全量策略。

## 局部任务 D：真实电视端遥控器双入口抽样

### 目标

从真实用户视角验证：不是脚本通，而是电视端用遥控器看到的每一步都符合预期。

### App 范围

```text
TVBox
FongMi
影视仓
```

### 路径 1：全量版

```text
导入 https://tv.webhome.eu.org/config.json
进入 影视点播 · 时间码
确认分类含 成人伦理
进入 推荐 · 时间码
进入 电影
进入 剧集
搜索 天道
搜索 电影
打开一个电影详情
切换播放线路
返回重进
观察时间码是否仍一致
```

### 路径 2：洁净版

```text
导入 https://tv.webhome.eu.org/config-clean.json
进入 影视点播洁净 · 时间码
确认分类不含 成人伦理
进入 推荐 · 时间码
进入 电影
进入 剧集
搜索 天道
搜索 成人
打开一个电影详情
切换播放线路
返回重进
观察时间码是否仍一致
```

### 通过标准

```text
电视端入口时间码与 /status.json visibleUpdateText 一致，或入口旧但 推荐 分类时间码最新
没有“备用”字样
全量版成人伦理存在
洁净版成人伦理不存在
分类下有内容
搜索结果非空且语义合理
详情页可打开
播放线路存在
返回重进后不出现一空一非空
```

### 失败回退

- 如果电视端旧而 curl 新：归 `CACHE_STALE`，引导清缓存/删除旧配置/重新导入。
- 如果电视端空而 curl 非空：归 `APP_REQUEST_VARIANT`，抓实际 App 请求参数。
- 如果两者都空：归线上服务问题，回到 Worker / Pages / snapshot。
- 如果洁净版搜索成人仍有结果：归 `CLEAN_POLICY_LEAK`，阻断公开推广。

## 局部任务 E：30 分钟级更新时间 SLA 观测

### 目标

用户已经明确指出“14点到现在跨度太大，会投诉”。Stage 6 必须让更新时间从“偶尔刷新”变成“可观测 SLA”。

### 观测对象

```text
GitHub Actions hot-refresh.yml
GitHub Actions full-refresh.yml
dist/snapshot/latest/manifest.json generatedAt
/status.json snapshotGeneratedAt
/status.json visibleUpdateText
/config.json 入口名
/agg 推荐分类名
电视端实际显示时间码
```

### 观测窗口

```text
至少连续 3 个 hot-refresh 调度窗口
每个窗口目标：30 分钟级，允许 GitHub schedule 延迟，但必须记录延迟原因
```

### 执行方式

1. 每 15 分钟观察一次：

```powershell
curl.exe -L -s https://tv.webhome.eu.org/status.json
curl.exe -L -s https://tv.webhome.eu.org/config.json
curl.exe -L -s "https://tv.webhome.eu.org/agg?limit=1"
```

2. 记录字段：

```text
observed_at
status.visibleUpdateText
status.snapshotGeneratedAt
config.site.name
agg.class[0].type_name
http_status
cache_control
github_action_last_run
pages_deployment
worker_version
```

3. 判定：

```text
如果 status 前进但 config 不前进：config 缓存问题
如果 config 前进但 agg 不前进：Worker snapshot cache 或 agg stamp 问题
如果三者都不前进：Actions 或发布链路问题
如果三者前进但电视端不前进：App 缓存问题
```

### 通过标准

```text
连续 3 个窗口中至少 2 个窗口可见时间码自动前进
没有失败刷新污染可见时间码
失败时 status 或审计能说明 root_cause
电视端用户至少可在 推荐 分类看到最新码
```

### 失败回退

- 如果 GitHub Actions 延迟明显：保持免费优先，先优化手动触发/热点索引，不购买主机。
- 如果 Pages 构建延迟：Worker 优先读取 GitHub raw 或 KV 热指针。
- 如果 Worker 内存缓存滞后：降低 manifest 缓存 TTL 或对 config/agg 关键路径绕过旧缓存。
- 如果电视端缓存不可控：保留推荐分类更新时间码作为用户可见兜底，并在使用说明中加入清缓存路径。

## 局部任务 F：投诉种子闭环启动

### 目标

把用户已经提出的真实投诉风险变成机器可追踪种子，而不是停留在聊天记忆。

### 初始投诉种子

```json
[
  {
    "id": "complaint-20260709-update-code-stale",
    "priority": "P1",
    "app": "unknown-tv-app",
    "entry": "https://tv.webhome.eu.org/config.json",
    "path": "导入入口 > 影视点播入口名",
    "symptom": "电视端仍看到14点更新时间，跨度太大，商业用户会投诉",
    "expected": "入口名或推荐分类显示最新验证快照码",
    "root_cause_candidates": ["CACHE_STALE", "PUBLISH_STALE", "SNAPSHOT_STALE"],
    "retest_status": "PENDING"
  },
  {
    "id": "complaint-20260709-clean-policy-variant",
    "priority": "P1",
    "app": "TVBox/FongMi/影视仓",
    "entry": "https://tv.webhome.eu.org/config-clean.json",
    "path": "洁净版 > 分类 / 搜索 / 详情",
    "symptom": "洁净版必须不暴露成人内容",
    "expected": "成人分类、成人筛选、成人搜索结果、成人详情均不可见",
    "root_cause_candidates": ["CLEAN_POLICY_LEAK", "APP_REQUEST_VARIANT"],
    "retest_status": "PENDING"
  }
]
```

### 后续落地

- 若当前已有投诉种子文件，则追加；若没有，则创建：

```text
C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\data\user-complaint-seeds-v74.json
```

- 后续让以下脚本读取投诉种子：

```text
scripts/audit-tv-remote-full-v73.mjs
scripts/audit-source-coverage-v73.mjs
scripts/audit-zero-complaint-v74.mjs
```

### 通过标准

```text
投诉种子可被审计脚本读取
每个投诉有 priority、path、expected、actual、root_cause、retest_status
已修复投诉必须有复测证据
未修复投诉不能从报告中消失
```

## 节点任务清单

1. 发布前运行 `npm run check`。
2. 发布前运行 `npm run generate:snapshot`。
3. 检查 `manifest.ok=true`。
4. 检查 `validation.errors=[]`。
5. 检查 `dist/config.json` 和 `dist/config-clean.json` 时间码一致。
6. 提交并推送 `src`、`scripts`、`docs`、`dist`。
7. 部署 Worker。
8. 部署 Pages。
9. 主入口跑 `npm run validate:online`。
10. 同构入口跑 `npm run validate:online`。
11. curl 验证 `Cache-Control: no-store`。
12. curl 验证 `/agg` 推荐分类时间码。
13. curl 验证 `/agg-clean` 推荐分类时间码。
14. 电视端导入全量版。
15. 电视端导入洁净版。
16. 记录至少 3 个 hot-refresh 窗口。
17. 建立投诉种子。
18. 跑 `npm run audit:zero-complaint`。

## 末梢验证矩阵

| 末梢 | 正确标准 | 失败归因 |
|---|---|---|
| `/config.json` | 200、no-store、全量入口、12 位码 | API_ERROR / CACHE_STALE |
| `/config-clean.json` | 200、no-store、洁净入口、12 位码 | API_ERROR / CACHE_STALE |
| `/agg` 推荐分类 | `推荐 · 同一时间码` | SNAPSHOT_STALE / WORKER_CACHE_STALE |
| `/agg-clean` 推荐分类 | `推荐 · 同一时间码` 且不暴露成人 | CLEAN_POLICY_LEAK |
| 全量分类 | 10 类非空，含成人伦理 | CATEGORY_MISS |
| 洁净分类 | 不含成人伦理，其余主类非空 | CLEAN_POLICY_LEAK / CATEGORY_MISS |
| 搜索“天道” | 返回语义合理结果或明确覆盖根因 | SOURCE_UNIVERSE_GAP / RANKING_SUPPRESSION |
| 搜索“电影” | 返回电影/影视相关内容，非广告 | SEMANTIC_MISMATCH |
| 详情页 | `vod_play_from` 与 `vod_play_url` 成对 | DETAIL_FAIL |
| 播放线路 | 非解析页、非 iframe、非广告 | PLAYBACK_FAIL |
| 返回重进 | 不出现一空一非空 | CACHE_STALE / APP_REQUEST_VARIANT |
| 30 分钟窗口 | 时间码自动前进或有原因 | ACTIONS_DELAY / PUBLISH_STALE |

## 风险与免费额度

### 风险 1：GitHub Actions 调度延迟

处理：

- 继续使用免费 GitHub Actions。
- 接受小时间差，但必须在 status/audit 中记录。
- 不购买主机作为第一选择。

### 风险 2：Cloudflare Pages 构建传播延迟

处理：

- Worker 读取顺序继续保留 GitHub raw、Pages、自有域名镜像。
- 后续 Stage 7 评估 KV 热指针，减少 Pages 构建依赖。

### 风险 3：电视 App 缓存旧配置名

处理：

- config no-store。
- 推荐分类展示同一快照码。
- 使用说明加入“删除旧配置 / 清缓存 / 重新导入”。

### 风险 4：上游源瞬时为空

处理：

- 生成器使用 local-known-good。
- errors 非空即失败，不发布坏快照。
- 失败刷新不推进可见时间码。

### 风险 5：商业并发冲击 Worker 免费额度

处理：

- 不代理视频流。
- 用户请求优先读静态快照。
- 直播默认直连。
- Stage 7 再评估 KV 热索引和请求预算。

## 验收命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run check
$env:SNAPSHOT_SOURCE_BASE='https://tv.webhome.eu.org'
$env:PUBLIC_BASE='https://tv.webhome.eu.org'
npm run generate:snapshot
npm run triage:snapshot-warnings
npm run audit:snapshot-pack-gaps
$env:TVBOX_BASE='https://tv.webhome.eu.org'
npm run validate:online
$env:TVBOX_BASE='https://tv.webclound.eu.org'
npm run validate:online
npm run audit:zero-complaint
```

## 失败回退

```text
Worker 失败 -> wrangler rollback 到上一版本
Pages 失败 -> 保留上一版 Pages 快照，不切换宣传口径
GitHub 推送失败 -> 不宣称自动更新已上线
快照生成失败 -> 不提交 dist，不推进 visibleUpdateText
洁净版失败 -> 暂停推广 clean 入口，保留全量入口
全量版失败 -> 回滚 Worker/Pages，旧 v7.2 入口保留为回滚基线
电视端缓存失败 -> 归 CACHE_STALE，给用户清缓存/重导入路径，同时保留推荐分类码兜底
```

## 下一阶段入口

Stage 6 完成后进入 Stage 7：

```text
免费优先热索引 / KV 热指针 / 真实投诉种子自动接入 / 商业并发预算审计。
```

Stage 7 不再只围绕“更新时间是否显示”，而要推进到：

1. 热门连载剧集和新片的增量更新不依赖完整 Pages 构建。
2. TV 端搜索、分类、筛选优先读取热索引与最新快照融合结果。
3. 投诉种子自动加入遥控器审计和覆盖审计。
4. 免费额度下给出并发承载边界、降级策略和商业推广前门禁。

