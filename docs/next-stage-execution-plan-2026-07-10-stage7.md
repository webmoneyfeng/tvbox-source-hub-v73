# TVBox v7.4 Stage 7 实施计划：免费商业实时层、快照性能治理与电视端一致性 SLA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不购买主机、不购买付费 CDN、不代理大规模视频流的前提下，把 v7.4 从“入口更新时间已可热更新”推进到“电视端可见更新时间一致、热点内容准实时、全量快照可按时完成、遥控器语义审计可持续闭环”的商业级运营阶段。

**Architecture:** 保持现有终局全局全景流程图不重画，只增量强化更新服务层、聚合索引层、发布承载层、电视端请求层和 0 投诉商业体验总控门禁。Cloudflare Cron 负责 15 分钟级热源有效性探测和可见更新时间；GitHub Actions 继续负责 30 分钟级热点快照与 2 小时级全量快照；Worker 负责 snapshot-first、hot overlay、KV last-good、双版本全量/洁净统一输出。

**Tech Stack:** Cloudflare Workers、Cloudflare KV、Wrangler、GitHub Actions、Node.js 20、TVBox/FongMi/影视仓 JSON/CMS API、PowerShell、现有 `scripts/*.mjs` 审计脚本。

---

## 阶段名称

Stage 7：免费商业实时层、快照性能治理与电视端一致性 SLA。

## 上一阶段证据

上一阶段已经完成并验证：

- Worker 已上线 Cloudflare Cron：`wrangler.toml` 中 `crons = ["*/15 * * * *"]`。
- Worker 已实现 `scheduled(event, env, ctx)`，定时执行热源探测并写入 `hot:last-success`。
- Worker 已实现 `/config.json` 与 `/config-clean.json` 的 `no-store` 响应头。
- Worker 已实现入口名与 `推荐` 分类名双位置更新时间码。
- Worker 已实现全量版 `/agg` 与洁净版 `/agg-clean` 同链路输出。
- 本地测试：`npm run check` 通过 25 项测试。
- GitHub 同步：本地 hotfix 已 rebase 到远端最新快照提交后，并成功推送到 `main`。
- 当前 GitHub 最新 hotfix 提交：`38593c5 fix: enforce hot update freshness for tvbox entries`。
- 当前线上入口已摆脱 14 点旧码，可见码进入 00:30/00:35 级别。

当前仍然观察到的商业风险：

- `config`、`status`、`agg` 在不同 Cloudflare 边缘 isolate 之间可能短时间显示不同热更新码，最长约 1 到 2 分钟，属于用户可见一致性风险。
- 本地 `npm run generate:snapshot` 曾超过 5 分钟被中断，说明全量快照性能不足，不能作为商业 SLA 的稳定证据。
- 现有全量遥控器审计覆盖基础路径，但还没有把“更新时间一致性、热点追更、快照生成耗时、Actions 延迟、Cron 成功率”纳入统一商业门禁。
- 直播和点播虽然同入口存在，但直播更新、直播频道有效性、直播免费并发风险还没有进入 Stage 7 同级审计。

## 终局承接

终局目标仍然是：

```text
用户喜欢的 0 投诉商业 TVBOX 源
= 可公开订阅 + 可收费运营 + 点播直播双可用 + 实时/准实时更新 + 免费优先承载 + 遥控器全链路无空壳无错配无重复
```

Stage 7 对终局的贡献：

1. 把“更新时间不旧”升级为“更新时间一致、有来源、有 SLA、有失败解释”。
2. 把“快照能生成”升级为“快照可按时生成、可裁剪、可恢复、可审计耗时”。
3. 把“接口验证通过”升级为“电视端遥控器、热点搜索、追更剧集、直播频道、双版本入口统一门禁”。
4. 把“免费可用”升级为“1000/10000 用户访问时仍不写放大、不代理流、不因免费额度失控”。

## 全局影响

| 层级 | Stage 7 改造方向 | 用户投诉点减少 |
|---|---|---|
| 用户入口层 | `config/status/agg` 更新时间一致性窗口收敛到 60 秒内 | “为什么这里一个时间那里一个时间” |
| 更新服务层 | Cron 热探测、热点快照、全量快照分层 SLA | “更新太慢”“追剧看不到下一集” |
| 源发现层 | 热点追更源优先级与失败源降权 | “某些剧别的地方有这里没有” |
| 聚合索引层 | hot overlay 覆盖推荐、搜索、剧集追更、直播频道 | “搜不到”“分类旧” |
| 去重排序层 | 热层与快照层合并去重 | “同一个节目重复出现” |
| 发布承载层 | KV 低频写、Worker 内存短 TTL、静态快照原子发布 | “时好时坏”“免费额度爆掉” |
| 电视端请求层 | TVBox/FongMi/影视仓请求变体纳入一致性审计 | “电脑测是好的，电视端没有” |
| 总控门禁 | 增加商业 SLA 指标 | “技术通了但客户仍投诉” |

## 文件结构与职责

### 需要修改的现有文件

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\src\worker.mjs`
  - 统一可见更新时间读取逻辑。
  - 收敛 `config/status/agg/snapshot` 的更新时间一致性窗口。
  - 增加 hot overlay 合并入口。
  - 增加 Cron 探测结果结构版本。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\generate-snapshot.mjs`
  - 拆分热点快照与全量快照生成路径。
  - 增加耗时日志与超时保护。
  - 保留原子发布 staging 机制。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\validate-online-v73.mjs`
  - 增加可见更新时间一致性检查。
  - 增加主入口/同构入口/洁净入口同时校验。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\audit-tv-remote-full-v73.mjs`
  - 增加更新时间路径审计、热点追更路径审计、直播路径审计。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\.github\workflows\hot-refresh.yml`
  - 把热点快照从全量 `generate:snapshot` 中拆出，避免每 30 分钟跑全量导致超时。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\.github\workflows\full-refresh.yml`
  - 保持 2 小时全量，但增加超时、失败不提交、耗时摘要。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\docs\terminal-global-flow.md`
  - 已增量更新为 15 分钟热源探测原则；Stage 7 结束时补充实际 SLA 证据。

### 建议新增文件

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\generate-hot-snapshot-v74.mjs`
  - 只生成热点包，不跑全量分类。
  - 输出 `dist/hot/latest/*.json` 或 KV 上传载荷。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\scripts\audit-update-sla-v74.mjs`
  - 审计更新时间一致性、Cron 新鲜度、快照新鲜度、主备入口差异。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\audit\update-sla-latest.json`
  - 机器可读 SLA 审计结果。

- `C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73\audit\update-sla-summary.md`
  - 用户可读 SLA 摘要。

## 局部任务

### Task 1：建立更新时间一致性审计

**Files:**

- Create: `scripts/audit-update-sla-v74.mjs`
- Modify: `package.json`
- Output: `audit/update-sla-latest.json`
- Output: `audit/update-sla-summary.md`

- [ ] **Step 1: 写入审计脚本骨架**

创建 `scripts/audit-update-sla-v74.mjs`，固定审计以下 URL：

```text
/config.json
/config-clean.json
/agg
/agg-clean
/status.json
/snapshot.json
https://tv.webclound.eu.org/config.json
https://tv.webclound.eu.org/config-clean.json
```

每个请求必须追加唯一 `probe` 参数，避免普通 CDN 缓存干扰。

- [ ] **Step 2: 定义更新时间抽取规则**

脚本需要从响应中抽取：

```text
config.sites[0].name 中的 12 位倒序码
agg.class[].type_name 中 推荐 分类的 12 位倒序码
status.visibleUpdateText
status.visibleUpdateSource
status.visibleUpdateAt
snapshot.manifest.visibleUpdateText
```

- [ ] **Step 3: 定义通过标准**

```text
config 与 config-clean 必须同码
主域名与同构域名 config 必须同码或差异不超过 1 个 Cron 周期
agg 与 config 允许短时差异，但差异不得超过 2 分钟
status.visibleUpdateSource 必须是 hot-probe 或 snapshot
status.visibleUpdateAt 距当前时间不得超过 45 分钟
snapshotGeneratedAt 距当前时间不得超过 6 小时；超过则 WARN，不阻断 hot-probe
```

- [ ] **Step 4: 输出根因分类**

```text
OK
CONFIG_CACHE_STALE
AGG_CACHE_STALE
STATUS_CACHE_STALE
HOT_PROBE_STALE
SNAPSHOT_STALE
MIRROR_DRIFT
WORKER_ISOLATE_DRIFT
API_ERROR
SCHEMA_REGRESSION
```

- [ ] **Step 5: 增加 npm 命令**

在 `package.json` 增加：

```json
"audit:update-sla": "node scripts/audit-update-sla-v74.mjs"
```

- [ ] **Step 6: 验证**

Run:

```powershell
npm run audit:update-sla
```

Expected:

```text
生成 audit/update-sla-latest.json
生成 audit/update-sla-summary.md
如果短时 isolate 差异存在，标记 WARN 而不是 FAIL
```

### Task 2：收敛 Worker 可见更新时间一致性窗口

**Files:**

- Modify: `src/worker.mjs`
- Test: `scripts/worker-clean-policy.test.mjs`

- [ ] **Step 1: 降低用户可见更新时间内存 TTL**

把 `HOT_UPDATE_MEMORY_TTL_MS` 从 60 秒收敛到 15 秒或 30 秒，避免不同边缘 isolate 长时间显示不同码。

- [ ] **Step 2: status 与 agg 增加 no-cache 可选诊断参数**

支持：

```text
/status.json?fresh=1
/agg?fresh=1
/agg-clean?fresh=1
```

当 `fresh=1` 时跳过 hot update 内存缓存，直接读取 KV，用于审计和问题定位。

- [ ] **Step 3: 保持普通用户请求免费友好**

普通 `/agg` 仍保留 120 秒响应缓存，不代理视频流，不增加用户路径 KV 写入。

- [ ] **Step 4: 回归测试**

增加测试：

```text
fresh=1 能读取最新 hot:last-success
config no-store 不变
clean config 不暴露成人内容
```

- [ ] **Step 5: 验证**

Run:

```powershell
npm run check
npx wrangler deploy --dry-run
```

Expected:

```text
25+ tests pass
wrangler dry-run 无配置警告
```

### Task 3：拆分热点快照生成，解决全量快照超时

**Files:**

- Create: `scripts/generate-hot-snapshot-v74.mjs`
- Modify: `.github/workflows/hot-refresh.yml`
- Modify: `package.json`

- [ ] **Step 1: 新增热点范围**

热点范围固定为：

```text
推荐第一页
电影第一页
剧集第一页
短剧第一页
解说第一页
文娱知识第一页
搜索：天道、遥远的救世主、王志文、2026、电影、解说、演唱会、公开课
直播频道清单
```

- [ ] **Step 2: 生成热点输出**

输出：

```text
dist/hot/latest/manifest.json
dist/hot/latest/catalog-hot.json
dist/hot/latest/search-hot.json
dist/hot/latest/live-hot.json
dist/hot/latest/validation.json
```

- [ ] **Step 3: 热点生成必须 3 分钟内完成**

脚本中记录：

```text
startedAt
finishedAt
durationMs
sourceCount
itemCount
searchCount
errors
warnings
```

若超过 180 秒，脚本退出非 0，不更新 manifest。

- [ ] **Step 4: 更新 hot-refresh.yml**

把当前：

```text
npm run generate:snapshot
```

替换为：

```text
npm run generate:hot-snapshot
npm run audit:update-sla
```

- [ ] **Step 5: 验证**

Run:

```powershell
npm run generate:hot-snapshot
npm run audit:update-sla
```

Expected:

```text
hot snapshot durationMs < 180000
validation.errors.length = 0
```

### Task 4：Worker 合并 hot overlay

**Files:**

- Modify: `src/worker.mjs`
- Test: `scripts/audit-tv-remote-full-v73.test.mjs`

- [ ] **Step 1: 读取 hot manifest**

Worker 在 `/agg`、`/agg-clean` 中读取：

```text
hot/latest/manifest.json
hot/latest/catalog-hot.json
hot/latest/search-hot.json
```

若 hot manifest 比 snapshot 新，进入 overlay。

- [ ] **Step 2: 合并策略**

```text
先取 hot rows
再取 snapshot rows
按 canonical title + year + macro 去重
播放有效、多线路、高清、更新时间优先
洁净版合并后再次过滤成人内容
```

- [ ] **Step 3: 搜索策略**

搜索请求：

```text
/agg?wd=xxx
```

先查 hot search；hot 没有再查 snapshot search；都没有再动态 fanout。

- [ ] **Step 4: 验证**

Run:

```powershell
$env:TVBOX_BASE='https://tv.webhome.eu.org'
npm run validate:online
```

Expected:

```text
pass = true
搜索热点词第一页结果不重复
洁净版不暴露成人内容
```

### Task 5：把更新时间 SLA 加入全量遥控器审计

**Files:**

- Modify: `scripts/audit-tv-remote-full-v73.mjs`
- Output: `audit/tv-remote-full-latest.json`
- Output: `audit/tv-remote-full-summary.md`

- [ ] **Step 1: 增加 L13 更新时间路径**

新增路径：

```text
L13 更新时间一致性
- config vs config-clean
- config vs agg 推荐分类
- primary vs secondary
- status vs config
- snapshot vs hot-probe
```

- [ ] **Step 2: 增加 root_cause**

```text
UPDATE_SLA_OK
HOT_PROBE_STALE
SNAPSHOT_STALE
MIRROR_DRIFT
CACHE_STALE
WORKER_ISOLATE_DRIFT
```

- [ ] **Step 3: 验收**

Run:

```powershell
$env:TVBOX_BASE='https://tv.webhome.eu.org'
$env:AUDIT_LIMIT='24'
$env:AUDIT_DETAIL_SAMPLE='5'
$env:AUDIT_PLAY_SAMPLE='2'
npm run audit:remote-full
```

Expected:

```text
schema_regression = 0
api_error = 0
update_sla_fail = 0
允许 update_sla_warn 记录 isolate 短时差异，但必须给出时间差和根因
```

### Task 6：直播免费商业风险纳入同级审计

**Files:**

- Modify: `scripts/audit-free-tier-v73.mjs`
- Modify: `scripts/audit-tv-remote-full-v73.mjs`
- Modify: `src/worker.mjs` only if audit reveals live path bug

- [ ] **Step 1: 验证直播默认直连**

审计必须确认：

```text
/live.txt 默认频道 URL 不以 /play/ 开头
用户主动 ?proxy=1 时才走 Worker 代理
```

- [ ] **Step 2: 抽样直播频道有效性**

抽样每组最多 2 个频道：

```text
HTTP 200/206 或 m3u8 包含 #EXTM3U = PASS
403/404/timeout = 记录 root_cause
```

- [ ] **Step 3: 免费额度评估**

输出：

```text
liveDefaultProxyAmplification = false
estimatedWorkerMediaAmplification = 0 for default live.txt
risk = OK/WARN/FAIL
```

## 节点任务

| 节点 | 必须证明 | 证据 |
|---|---|---|
| `/config.json` | no-store、全量入口、最新码 | curl header + body |
| `/config-clean.json` | no-store、洁净入口、无成人 | curl + schema |
| `/agg` | 推荐分类有码、分类非空 | validate online |
| `/agg-clean` | 推荐分类有码、成人过滤 | validate online |
| `/status.json` | 标明 source、at、hotUpdate | audit update sla |
| `/snapshot.json` | 快照可用且不陈旧 | audit update sla |
| Cron | 15 分钟 hot probe 成功写 KV | status.hotUpdate |
| hot snapshot | 3 分钟内生成 | generate-hot-snapshot 输出 |
| full snapshot | 2 小时级 Actions 可完成 | Actions 日志 + manifest |
| live.txt | 默认直连，不放大 Worker 流量 | audit free tier |

## 末梢验证

电视端遥控器必须按以下路径抽查：

```text
导入 config.json
进入影视点播
观察入口名更新时间
进入推荐分类，观察推荐分类更新时间
切换电影/剧集/短剧/解说/文娱知识
搜索热点剧名
搜索主演
进入详情
切换播放线路
返回首页
退出 App 后重进
导入 config-clean.json
确认洁净版没有成人分类
进入精选直播
播放 2 个直播频道
```

每个末梢路径记录：

```text
App 名称
入口 URL
路径
屏幕显示更新时间
脚本 request_url
返回 count
detail ok
play ok
root_cause
```

## 风险与免费额度

| 风险 | 处理 |
|---|---|
| GitHub Actions schedule 延迟 | 不作为唯一实时来源，Cloudflare Cron hot-probe 兜底 |
| Cloudflare KV 写入放大 | 只由 Cron/Actions 低频写，用户请求路径默认不写 |
| Worker 请求放大 | 点播返回 URL，不代理视频；直播默认直连 |
| 全量快照超时 | 拆热点快照与全量快照；全量失败不影响 hot-probe 可见时间 |
| 源短时不可用 | 热探测必须 >=2 个主源成功才更新可见时间 |
| 电视端缓存 | config no-store + 推荐分类更新时间 + fresh=1 诊断 |
| 成人洁净边界 | 双版本同链路生成，同链路审计，洁净版二次过滤 |
| 更新时间不一致 | audit-update-sla 量化差异，短时 WARN，超阈值 FAIL |

## 验收命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run check
npm run audit:update-sla
npm run generate:hot-snapshot
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run validate:online
$env:TVBOX_BASE='https://tv.webclound.eu.org'; npm run validate:online
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run audit:remote-full
npx wrangler deploy --dry-run
```

上线后：

```powershell
curl.exe -L -sS -D - "https://tv.webhome.eu.org/config.json?probe=$(Get-Random)"
curl.exe -L -sS "https://tv.webhome.eu.org/status.json?fresh=1"
curl.exe -L -sS "https://tv.webhome.eu.org/agg?fresh=1&limit=8"
```

## 失败回退

1. Worker 部署失败：不更新线上，继续使用当前版本 `59292132-679e-4eb1-b6cf-ed695ec588d5` 或后续 Cloudflare 当前版本。
2. hot snapshot 失败：不更新 hot manifest，继续用 KV hot-probe + last good snapshot。
3. full snapshot 失败：不提交 dist，保留上一版 `dist/snapshot/latest`。
4. audit-update-sla FAIL：不发布新阶段，先定位 root_cause。
5. 洁净版出现成人内容：立即回滚 Worker，标 P0。
6. 直播默认被代理导致 Worker 流量放大：立即回滚 live 策略，标 P1。

## 下一阶段入口

Stage 8 只在 Stage 7 满足以下条件后启动：

```text
update_sla_fail = 0
hot snapshot durationMs < 180000
full snapshot 能在 Actions 内完成或有明确拆分策略
remote-full api_error = 0
remote-full schema_regression = 0
clean adult exposure = 0
live default proxy amplification = false
```

Stage 8 预期主题：

```text
源宇宙扩展、覆盖率 canary 扩容、搜索召回精排、重复治理与用户投诉种子闭环
```
