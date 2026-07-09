# TVBox v7.4 Stage 9 执行计划：生产新鲜度发布、真实电视端复测、商业SLA投诉闭环

## 阶段名称

Stage 9：Production Freshness Release + Real TV Client Verification + Commercial SLA Complaint Loop

本阶段不是重新设计终局流程图，也不是继续局部修脚本；本阶段承接 Stage 8 的发布准备度修复，把“用户电视端仍看到 14 点旧更新时间”这个真实投诉风险，推进到生产发布、真实电视端复测、缓存分流解释、商业 SLA 监控和投诉闭环。

## 上一阶段证据

上一阶段已完成的可验证证据：

- 本地项目：`C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73`
- GitHub 当前主线已同步到：`4083acd fix: align pages readiness with static snapshot code`
- 远端快照刷新基线：`fa19ab2 chore(snapshot): refresh v7.3 snapshot`
- 发布准备度脚本已修复：Pages 静态快照只和本地待发布静态快照码比较，不再错误地和 Worker hot probe 码比较。
- 发布准备度专项测试已覆盖：
  - Pages manifest 等于本地静态码时，即使 Worker hot code 更新，也 PASS。
  - Pages manifest 不等于本地静态码时，归因 `NEEDS_PAGES_DEPLOY`。
- `node --test scripts/audit-release-readiness-v74.test.mjs`：6/6 PASS。
- `npm run check`：56/56 PASS。
- `npm run deploy:plan`：`execute=false`、`riskyCommandCount=0`。
- `npx wrangler deploy --dry-run --outdir .wrangler\dry-run-v73`：Worker 打包 dry-run 成功，未生产发布。

当前最新发布准备度审计结果：

```text
gate = FAIL
production_deploy_required = true
OK = 3
NEEDS_WORKER_DEPLOY = 2
NEEDS_PAGES_DEPLOY = 3
```

当前根因分布：

```text
worker-status = PASS，Worker hot update 在 6 分钟守门内。
online-worker-full-config = WARN，线上站点名仍含更新时间码。
online-worker-clean-config = WARN，线上洁净站点名仍含更新时间码。
local-dist-full-config = PASS，本地待发布全量入口已是稳定站点名 + versioned API。
local-dist-clean-config = PASS，本地待发布洁净入口已是稳定站点名 + versioned API。
pages-full-config = FAIL，Pages 静态全量入口仍旧。
pages-clean-config = FAIL，Pages 静态洁净入口缺失。
pages-manifest = WARN，Pages manifest 仍是旧 14 点码，未对齐本地静态快照码。
```

## 终局承接

终局仍然是：

```text
用户喜欢的 0 投诉商业 TVBOX 源
= 点播 + 直播
= 全量版 + 洁净版
= 免费优先承载
= 可公开订阅、可收费运营
= 准实时更新、搜索精准、无重复、无广告、无空壳、可回滚
```

Stage 9 对终局的贡献：

1. 把“后台更新了但电视端仍显示旧时间”从解释型问题变成可验证、可发布、可复测的生产闭环。
2. 把全量入口和洁净入口纳入同一生产发布动作，避免后续只更新其中一个。
3. 把 Cloudflare Worker、Cloudflare Pages、GitHub raw、电视端缓存四个显示面统一纳入新鲜度审计。
4. 把“14 点旧码”这类用户可见投诉转化成 `CACHE_STALE / NEEDS_WORKER_DEPLOY / NEEDS_PAGES_DEPLOY / APP_REQUEST_VARIANT` 等根因分类。
5. 把生产部署后的验收从“接口 200”提升为“电视端真实路径、遥控器选择、缓存重进、搜索详情播放、商业 SLA”一致。

## 终局流程图优化结论

已有 `docs/terminal-global-flow.md` 已覆盖：

- 用户入口层
- 双版本入口层
- 更新服务层
- 发布承载层
- 电视端请求层
- 遥控器全链路审计
- 0 投诉商业体验总控门禁
- 投诉根因归类与修复策略

所以本阶段不重画终局流程图，只把 Stage 9 放入现有流程的这一段：

```text
发布承载层
→ 电视端请求层
→ 遥控器全链路审计
→ 0投诉商业体验总控门禁
→ 投诉根因归类
→ 修复策略
→ 更新服务层
```

## 全局影响

| 层级 | Stage 9 要改变什么 | Stage 9 不改变什么 |
|---|---|---|
| 用户入口 | 生产入口站点名固定，更新时间不再放站点名 | 不改变主域名 `tv.webhome.eu.org` |
| 双版本 | 全量版和洁净版同发同测 | 不改变全量保留成人、洁净过滤成人的策略 |
| 更新服务 | 生产可见更新时间守门继续 <= 6 分钟 | 不承诺全互联网秒级全量同步 |
| 发布承载 | Worker + Pages 同步发布 | 不代理大规模视频流 |
| 电视端 | 真实 TVBox/FongMi/影视仓路径复测 | 不把接口 200 误认为用户体验通过 |
| 缓存 | 旧站点名缓存要归因并给出用户侧处理办法 | 不强行控制电视端本地缓存 |
| 商业化 | 建立可对客户解释的 SLA 与故障处理口径 | 不在免费层之外购买主机或付费 CDN |

## 局部任务拆解

### 任务 1：生产发布审批闸门

目标：确保生产发布不是自动误触发，而是在用户明确批准后执行。

检查项：

```text
用户必须明确回复：批准部署 Worker 和 Pages
shell 必须设置：TVBOX_DEPLOY_APPROVED=WORKER_PAGES_PRODUCTION_APPROVED
命令必须是：npm run deploy:prod
```

执行前命令：

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
git status --short --branch
npm run check
npm run audit:release-readiness
npm run deploy:plan
```

预期：

```text
npm run check = PASS
npm run audit:release-readiness = FAIL，但只允许是 NEEDS_WORKER_DEPLOY / NEEDS_PAGES_DEPLOY
npm run deploy:plan = execute=false, riskyCommandCount=0
```

禁止：

```text
未获批准时不执行 npm run deploy:prod
不强推 GitHub
不手工只部署 Worker 或只部署 Pages
不跳过 post deploy 审计
```

### 任务 2：生产发布执行

目标：一次性发布 Worker + Pages + 双入口，消除 14 点旧码投诉根因。

审批后执行：

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
$env:TVBOX_DEPLOY_APPROVED='WORKER_PAGES_PRODUCTION_APPROVED'
npm run deploy:prod
```

脚本必须执行的顺序：

```text
1. npm run check
2. npm run audit:release-readiness
3. npx wrangler deploy --dry-run --outdir .wrangler\dry-run-v73
4. npx wrangler deploy
5. npx wrangler pages deploy dist --project-name tvbox-source-hub-v73 --branch main
6. primary validate:online
7. secondary validate:online
8. audit:release-readiness
9. audit:visible-freshness
10. audit:tv-cache-update
11. audit:zero-complaint
```

成功标准：

```text
/config.json = 200
/config-clean.json = 200
/config.json sites[0].name = 影视点播
/config-clean.json sites[0].name = 影视点播洁净
/config.json sites[0].api includes /agg/u{12位倒序时间码}
/config-clean.json sites[0].api includes /agg-clean/u{12位倒序时间码}
/status.json visibleUpdateText 在 6 分钟守门内
Pages config.json 对齐本地 dist/config.json
Pages config-clean.json 对齐本地 dist/config-clean.json
Pages manifest visibleUpdateText 对齐本地 dist/snapshot/latest/manifest.json
release readiness 不再出现 NEEDS_WORKER_DEPLOY / NEEDS_PAGES_DEPLOY
```

### 任务 3：真实电视端更新时间复测

目标：验证用户看到的不是旧 14 点站点名，而是稳定站点名与内容层新鲜码。

真实电视端路径：

```text
TVBox/FongMi/影视仓
→ 删除旧配置或刷新配置
→ 导入 https://tv.webhome.eu.org/config.json
→ 站点列表只看见 影视点播
→ 进入影视点播
→ 分类中看到 推荐 · {最新倒序时间码}
→ 返回退出
→ 重新进入
→ 分类时间码仍在 6 分钟守门或最新可验证范围内
```

洁净版路径：

```text
TVBox/FongMi/影视仓
→ 导入 https://tv.webhome.eu.org/config-clean.json
→ 站点列表只看见 影视点播洁净
→ 不出现成人伦理主分类
→ 搜索成人相关关键词不得暴露成人内容
→ 推荐分类有最新倒序时间码
```

同构入口路径：

```text
https://tv.webclound.eu.org/config.json
https://tv.webclound.eu.org/config-clean.json
```

验收：

```text
主入口可导入
洁净入口可导入
同构入口可导入
站点名不再出现旧时间码
分类层可见最新码
旧 /agg/u{旧码} 路径仍能返回当前最新分类码
```

### 任务 4：缓存投诉分流与用户侧解释

目标：区分服务端已更新、电视端本地缓存未刷新、请求变体不一致三类情况。

根因分类：

| 现象 | 根因 | 处理 |
|---|---|---|
| `/status.json?fresh=1` 新，但电视站点名旧 | `CACHE_STALE` | 指导刷新配置或重新导入 |
| `/config.json` 仍显示旧站点名码 | `NEEDS_WORKER_DEPLOY` | 生产发布 Worker |
| Pages 入口旧或洁净入口 404 | `NEEDS_PAGES_DEPLOY` | 生产发布 Pages |
| App 和脚本请求结果不同 | `APP_REQUEST_VARIANT` | 抓取 App 实际请求参数 |
| 分类时间码新但内容不新 | `SNAPSHOT_STALE` 或 `HOT_INDEX_GAP` | 查热点索引和快照更新 |

客户解释口径：

```text
入口名称固定后，更新时间不会再通过站点名显示，以避免电视端缓存旧名称。
实际更新时间会显示在分类层和状态端点中。
如果旧用户仍看到旧站点名，需要刷新配置或重新导入；新用户不会再产生该缓存问题。
```

### 任务 5：遥控器全链路复测

目标：部署后不是只看更新时间，而是确认真实电视端每个可见元素按语义返回。

命令：

```powershell
$env:TVBOX_BASE='https://tv.webhome.eu.org'
$env:AUDIT_LIMIT='24'
$env:AUDIT_DETAIL_SAMPLE='5'
$env:AUDIT_PLAY_SAMPLE='2'
npm run audit:remote-full
```

洁净版补充：

```powershell
$env:TVBOX_BASE='https://tv.webhome.eu.org'
$env:TVBOX_CLEAN='1'
npm run audit:app-variants
```

最低标准：

```text
category_fail = 0
single_filter_fail = 0
schema_regression = 0
api_error = 0
snapshot_miss = 0
filter_logic_bug = 0
semantic_hit_rate >= 0.85
duplicate_rate <= 0.05
detail_ok_rate >= 0.90
playable_rate >= 0.80
```

如果有 FAIL：

```text
不删除按钮
先归因：API_ERROR / SNAPSHOT_MISS / FILTER_LOGIC_BUG / TAG_PARSE_GAP / SOURCE_TAG_GAP / SOURCE_COVERAGE_GAP / SEMANTIC_MISMATCH / PLAYBACK_FAIL / CACHE_STALE / APP_REQUEST_VARIANT
再决定修接口、补解析、补快照、增强源、隐藏不可证按钮或进入源覆盖审计
```

### 任务 6：商业 SLA 监控基线

目标：把“客户会投诉”转化成持续监控指标。

SLA 指标：

```text
可见更新时间 age <= 6 分钟
热点快照 <= 15 分钟
全量快照 <= 2 小时
/config.json 200
/config-clean.json 200
/agg 首页非空
/agg-clean 首页非空
/live.txt 分组非空
release readiness 无 NEEDS_* after deploy
zero complaint gate P0=0 P1=0
```

命令：

```powershell
npm run audit:update-sla
npm run audit:visible-freshness
npm run audit:tv-cache-update
npm run audit:zero-complaint
npm run audit:free-tier
```

输出文件：

```text
audit/update-sla-latest.json
audit/visible-freshness-latest.json
audit/tv-cache-update-latest.json
audit/zero-complaint-latest.json
audit/free-tier-summary.md
```

### 任务 7：免费承载复核

目标：确保商业化前仍符合免费优先承载边界。

复核项：

```text
不代理大规模视频流
直播默认直连上游，不走 Worker 中转
Worker 只处理配置、索引、聚合、审计和少量兼容代理
Pages 文件数不超过免费层风险线
GitHub Actions 频率不超免费可承载边界
KV 写入由 hot probe 控制，不因用户访问放大写入
```

命令：

```powershell
npm run audit:free-tier
```

如果出现 WARN：

```text
优先降频、切快照、减少用户路径动态聚合、减少直播代理，而不是购买主机或付费 CDN。
```

## 节点级执行清单

### 节点 A：部署前

- [ ] 确认用户已回复 `批准部署 Worker 和 Pages`。
- [ ] 确认 `git status --short --branch` 没有未提交的生产相关改动。
- [ ] 执行 `npm run check`。
- [ ] 执行 `npm run audit:release-readiness`。
- [ ] 确认失败只来自 `NEEDS_WORKER_DEPLOY / NEEDS_PAGES_DEPLOY`。
- [ ] 执行 `npm run deploy:plan`。
- [ ] 确认 dry-run 计划没有生产写动作。

### 节点 B：部署中

- [ ] 设置 `$env:TVBOX_DEPLOY_APPROVED='WORKER_PAGES_PRODUCTION_APPROVED'`。
- [ ] 执行 `npm run deploy:prod`。
- [ ] 记录 Worker deploy 输出。
- [ ] 记录 Pages deploy 输出。
- [ ] 若任一步失败，停止后续验证并进入回滚或修复分支。

### 节点 C：部署后接口验收

- [ ] `/config.json` 返回 200。
- [ ] `/config-clean.json` 返回 200。
- [ ] `/status.json?fresh=1` 返回 200 且 `age <= 6min`。
- [ ] `/agg` 推荐非空。
- [ ] `/agg-clean` 推荐非空。
- [ ] `/live.txt` 分组非空。
- [ ] `/snapshot.json` 可用。
- [ ] `/mirrors.json` 可用。
- [ ] `/sources.json` 可用。

### 节点 D：部署后电视端验收

- [ ] 主入口导入。
- [ ] 洁净入口导入。
- [ ] 同构入口导入。
- [ ] 站点名稳定。
- [ ] 分类层显示最新码。
- [ ] 搜索 `天道`、`遥远的救世主`、`王志文` 有语义结果或明确根因。
- [ ] 电影、剧集、动漫、解说、文娱知识等分类非空。
- [ ] 单筛选项无空壳。
- [ ] 组合筛选空结果有根因解释。
- [ ] 详情可打开。
- [ ] 播放线路有效率达标。

### 节点 E：投诉闭环

- [ ] 如果用户仍看到旧站点名，归 `CACHE_STALE` 并复测清缓存路径。
- [ ] 如果脚本新、电视旧，归 `APP_REQUEST_VARIANT` 并抓实际请求。
- [ ] 如果电视端分类旧但 API 新，检查 App 缓存和旧 `/agg/u{旧码}` 路径。
- [ ] 如果 API 本身旧，回到 `NEEDS_WORKER_DEPLOY / HOT_UPDATE_STALE / SNAPSHOT_STALE`。

## 末梢验收矩阵

| 末梢动作 | 正确结果 | 根因入口 |
|---|---|---|
| 导入全量配置 | 只显示 `影视点播` | CONFIG_MISMATCH / CACHE_STALE |
| 导入洁净配置 | 只显示 `影视点播洁净` | CLEAN_CONFIG_MISSING / CACHE_STALE |
| 打开推荐 | 非空，分类名含最新码 | HOT_UPDATE_STALE / SNAPSHOT_MISS |
| 打开电影 | 非空且语义为电影 | SEMANTIC_MISMATCH |
| 筛选年份 | 返回年份匹配或 unknown 有解释 | TAG_PARSE_GAP / SOURCE_TAG_GAP |
| 搜索片名 | 正片优先、无重复 | RANKING_SUPPRESSION / DEDUP_COLLISION |
| 搜索主演 | 有演员证据或根因 | ALIAS_GAP / SOURCE_SEARCH_GAP |
| 打开详情 | `vod_play_from` 和 `vod_play_url` 成对 | SCHEMA_REGRESSION |
| 播放线路 | 直连媒体或 m3u8 有效 | PLAYBACK_FAIL |
| 重进 App | 不出现一空一非空 | CACHE_STALE / APP_REQUEST_VARIANT |
| 打开直播 | 分组非空，频道格式正确 | LIVE_SOURCE_GAP / PLAYBACK_FAIL |

## 风险与免费额度

| 风险 | 控制方式 |
|---|---|
| 生产发布失败 | `deploy:prod` 内置 dry-run、Worker 部署、Pages 部署、后验收顺序 |
| Pages 仍旧 | release readiness 对 Pages config、clean config、manifest 三项同时审计 |
| 电视端缓存旧站点名 | 站点名固定，旧用户给清缓存/重新导入路径 |
| 用户并发放大 | 配置和快照走静态/缓存，视频流不走 Worker 代理 |
| GitHub Actions 延迟 | Worker hot probe 和 KV 指针兜底，静态快照异步追平 |
| 直播流量过大 | 默认直播直连上游，不通过 Worker 中转 |
| 洁净版漏成人 | `/agg-clean`、`config-clean`、app variants、zero complaint 一起审计 |
| 商业收费投诉 | 建立 SLA、投诉根因、复测报告和回滚口径 |

## 验收命令

部署前：

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
git status --short --branch
npm run check
npm run audit:release-readiness
npm run deploy:plan
```

部署后：

```powershell
npm run validate:online
npm run audit:release-readiness
npm run audit:visible-freshness
npm run audit:tv-cache-update
npm run audit:zero-complaint
npm run audit:remote-full
npm run audit:free-tier
```

关键线上抽查：

```powershell
curl.exe -L https://tv.webhome.eu.org/config.json
curl.exe -L https://tv.webhome.eu.org/config-clean.json
curl.exe -L https://tv.webhome.eu.org/status.json?fresh=1
curl.exe -L https://tvbox-source-hub-v73.pages.dev/config.json
curl.exe -L https://tvbox-source-hub-v73.pages.dev/config-clean.json
curl.exe -L https://tvbox-source-hub-v73.pages.dev/snapshot/latest/manifest.json
```

## 失败回退

Worker 回退：

```powershell
npx wrangler rollback
```

Pages 回退：

```text
Cloudflare Dashboard → Pages → tvbox-source-hub-v73 → Deployments → 选择上一稳定版本 → Rollback
```

用户侧临时回退：

```text
继续使用旧 v7.2 入口作为人工回滚说明。
如果只是电视端缓存旧站点名，优先刷新配置或重新导入，而不是回滚服务端。
```

## 下一阶段入口

Stage 9 完成后进入 Stage 10：

```text
商业试运营压测 + 投诉种子库 + 覆盖率扩源 + 搜索召回持续增强
```

Stage 10 的前置条件：

```text
Stage 9 生产发布通过
release readiness = PASS 或仅有已解释 WARN
visible freshness age <= 6min
zero complaint P0=0 P1=0
主入口、洁净入口、同构入口均可导入
真实电视端不再显示 14 点旧站点名
遥控器全链路 FAIL 已归因并进入修复队列
免费层审计无硬失败
```

Stage 10 的核心目标：

```text
从“服务可用”推进到“收费用户愿意持续订阅”：
覆盖率更全、搜索更准、重复更少、播放更稳、投诉有闭环、免费架构能承载公开订阅流量。
```
