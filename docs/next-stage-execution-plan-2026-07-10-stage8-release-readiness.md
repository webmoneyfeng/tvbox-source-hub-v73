# TVBox v7.4 Stage 8 执行计划：发布准备度、旧更新时间投诉消除、双入口同发闭环

## 阶段名称

Stage 8：Release Readiness + Visible Freshness + Dual Entry Publish Gate

本阶段不是新增影视源数量，而是把已经发现的客户投诉风险“电视端仍看到旧更新时间”收敛为可重复审计、可部署、可回滚、可复核的发布闭环。

## 上一阶段承接证据

上一阶段已经完成：

- Worker hot probe：Cloudflare Cron 目标 2 分钟级刷新 `hot:last-success`。
- `/status.json?fresh=1`：可输出 `visibleUpdateText`、`visibleUpdateSource=hot-probe`、`visibleUpdateAt`。
- `/agg` 与 `/agg-clean`：返回分类时会在 `推荐 · 时间码` 中盖上最新可见更新时间。
- 全量入口：`https://tv.webhome.eu.org/config.json`。
- 洁净入口：`https://tv.webhome.eu.org/config-clean.json`。
- 本地全量检查：`npm run check` 最近一次通过 46/46。
- 覆盖审计：最近一次 `PASS/WARN/FAIL = 10/0/0`。
- 0投诉总控：最近一次 `P0/P1/P2/P3 = 0/0/0/1`。

当前新增发现：

- Worker 热探针是新鲜的，线上 `visibleUpdateText` 可在 6 分钟守门内刷新。
- Cloudflare Pages 静态兜底仍是旧版本，`config-clean.json` 缺失，`config.json` 仍可能显示旧站点名时间码。
- 电视端站点名缓存会把“站点名中的旧时间码”放大成客户投诉，所以生产发布需要把更新时间从站点名迁移到 API 路径、分类栏和状态端点。

## 终局承接

终局目标仍是：

```text
用户喜欢的 0投诉 商业 TVBOX 源
= 点播 + 直播
= 全量版 + 洁净版
= 免费优先承载
= 可公开订阅、可收费运营
= 准实时更新、搜索精准、无重复、无广告、无空壳、可回滚
```

本阶段对终局的贡献：

1. 降低“明明后台更新了，但用户看到旧时间”的投诉。
2. 把全量版和洁净版纳入同一个发布闸门，避免只更新一个入口。
3. 把 Worker 与 Pages 双承载的差异显性化，避免静态兜底长期陈旧。
4. 把发布前、发布后、电视端复核都变成脚本和文档，而不是人工记忆。

## 全局影响

| 层级 | 本阶段改变 | 本阶段不改变 |
|---|---|---|
| 用户入口层 | 站点名稳定，更新时间转移到 API 路径和推荐分类 | 不新增混乱站点入口 |
| 双版本层 | 全量/洁净同步纳入发布准备度审计 | 洁净版不影响全量版成人保留策略 |
| 更新时间层 | 以 hot-probe 为商业可见更新时间主来源 | 不把失败刷新时间展示给用户 |
| Pages 兜底层 | 明确 Pages 旧配置必须部署刷新 | 不把 GitHub raw 当唯一入口 |
| 电视端缓存层 | 旧路径仍可返回新分类时间码 | 不要求普通用户理解源结构 |
| 商业门禁层 | NEEDS_WORKER_DEPLOY / NEEDS_PAGES_DEPLOY 进入门禁 | 不把工程可用误判为商业可收费 |

## 局部任务

### 1. 发布准备度审计脚本

新增：

```text
scripts/audit-release-readiness-v74.mjs
scripts/audit-release-readiness-v74.test.mjs
```

输出：

```text
audit/release-readiness-latest.json
audit/release-readiness-summary.md
```

检查面：

- Worker 状态端点更新时间是否在 6 分钟守门内。
- 线上全量 config 是否仍把时间码放在站点名里。
- 线上洁净 config 是否仍把时间码放在站点名里。
- 本地 dist 全量 config 是否已使用稳定站点名 + 版本化 API。
- 本地 dist 洁净 config 是否已使用稳定站点名 + 版本化 API。
- Pages 全量 config 是否陈旧。
- Pages 洁净 config 是否缺失。
- Pages manifest 是否落后于 Worker hot code。

### 2. 发布前命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run audit:release-readiness
npm run check
npx wrangler deploy --dry-run --outdir .wrangler\dry-run-v73
```

解释：

- `audit:release-readiness` 当前允许返回 FAIL，因为生产确实尚未部署 Worker/Pages 新包；这个 FAIL 是发布需求证据，不是代码语法错误。
- `npm run check` 必须为 0。
- `wrangler deploy --dry-run` 必须为 0。

### 3. 生产部署动作

必须等用户明确批准后执行：

```powershell
npx wrangler deploy
npx wrangler pages deploy dist --project-name tvbox-source-hub-v73 --branch main
```

部署顺序：

1. 先 Worker：让主域名入口即时使用稳定站点名和新路由。
2. 再 Pages：让静态兜底、备用镜像和旧缓存链路不再暴露旧配置。
3. 再在线验证：确认主入口、洁净入口、状态、分类、搜索、详情、播放都仍可用。

### 4. 发布后验收命令

```powershell
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run validate:online
$env:TVBOX_BASE='https://tv.webclound.eu.org'; npm run validate:online
npm run audit:release-readiness
npm run audit:visible-freshness
npm run audit:tv-cache-update
npm run audit:zero-complaint
```

发布后期望：

- `audit:release-readiness` gate 从 FAIL 降为 PASS 或最多 WARN（仅 GitHub push 未同步时）。
- 线上 `config.json` site name = `影视点播`。
- 线上 `config-clean.json` site name = `影视点播洁净`。
- 线上 API 路径包含 `/agg/u{12位倒序码}` 与 `/agg-clean/u{12位倒序码}`。
- `/agg` 分类第一项显示 `推荐 · {当前倒序码}`。
- Pages 静态 `config-clean.json` 返回 200。
- Pages 静态 `config.json` 不再显示旧站点名时间码。

## 节点任务

| 节点 | 验收证据 | 失败根因 |
|---|---|---|
| Worker hot freshness | `worker-status PASS` | `HOT_UPDATE_STALE` |
| Worker full config | stable site name + versioned API | `NEEDS_WORKER_DEPLOY` |
| Worker clean config | stable clean site name + versioned API | `NEEDS_WORKER_DEPLOY` |
| Local dist full | `local-dist-full-config PASS` | `SNAPSHOT_BUILD_GAP` |
| Local dist clean | `local-dist-clean-config PASS` | `SNAPSHOT_BUILD_GAP` |
| Pages full | `pages-full-config PASS` | `NEEDS_PAGES_DEPLOY` |
| Pages clean | `pages-clean-config PASS` | `NEEDS_PAGES_DEPLOY` |
| Pages manifest | code matches or acceptably fresh | `NEEDS_PAGES_DEPLOY` |
| GitHub source | push success | `GITHUB_SYNC_PENDING` |

## 末梢电视端复核

发布后电视端操作：

```text
1. 清 TVBox/FongMi/影视仓 当前配置缓存。
2. 重新导入 https://tv.webhome.eu.org/config.json。
3. 进入站点列表，看到 影视点播。
4. 进入影视点播，推荐分类应显示 推荐 · 最新倒序码。
5. 搜索 天道、王志文、演唱会、公开课、2026。
6. 打开任意详情，确认播放线路存在。
7. 重新导入 https://tv.webhome.eu.org/config-clean.json。
8. 看到 影视点播洁净。
9. 确认无 成人伦理 分类和成人相关筛选/标题暴露。
10. 退出重进，推荐分类时间码不应回退到14点旧码。
```

## 风险与免费承载

| 风险 | 控制方式 |
|---|---|
| 电视端缓存旧站点名 | 站点名固定，更新时间放 API 和推荐分类 |
| Pages 静态旧配置 | 发布准备度审计强制标记 `NEEDS_PAGES_DEPLOY` |
| GitHub push 失败 | 不制造第二真值；保留本地提交和 bundle，Cloudflare 可先部署，GitHub 后补同步 |
| 免费额度压力 | 不代理大规模视频流；热探针只写 KV；用户路径优先读快照/热索引 |
| 双入口不同步 | 全量/洁净纳入同一脚本、同一部署、同一验收 |
| 客户投诉“更新时间跨度大” | 6分钟可见守门 + 发布后电视端复核 + 状态端点审计 |

## 失败回滚

如果 Worker 部署后主入口异常：

```powershell
npx wrangler rollback
```

如果 Pages 部署后静态快照异常：

- 使用 Cloudflare Pages 历史 deployment 回滚。
- Worker 仍优先用 KV hot probe 和动态聚合兜底。
- 保留旧 v7.2 入口作为人工回滚基线。

## 下一阶段入口

Stage 8 发布完成后，进入 Stage 9：

```text
真实电视端遥控器复测 + 用户投诉种子闭环 + 商业化稳定性压测
```

Stage 9 不再只看接口 200，而要看：

- 用户端是否真的不再看到旧时间。
- 用户端搜索是否精准。
- 用户端是否无重复。
- 用户端分类/筛选是否全有语义结果。
- 1000/10000 用户访问场景是否仍满足免费架构边界。

## Stage 8 补充：受保护的一键发布编排

新增发布编排脚本：

```text
scripts/deploy-cloudflare-v74.mjs
scripts/deploy-cloudflare-v74.test.mjs
```

新增命令：

```powershell
npm run deploy:plan
npm run deploy:prod
```

安全闸门：

- `npm run deploy:plan`：只打印将要执行的步骤，不部署 Worker，不部署 Pages。
- `npm run deploy:prod`：必须同时满足：
  1. 用户已经在对话中明确批准部署 Worker 和 Pages。
  2. 当前 shell 设置：`$env:TVBOX_DEPLOY_APPROVED='WORKER_PAGES_PRODUCTION_APPROVED'`。
  3. 命令内部使用 `--execute`。

生产发布顺序由脚本固定：

1. `npm run check`
2. `npm run audit:release-readiness`（发布前允许失败，用作 NEEDS_* 证据）
3. `npx wrangler deploy --dry-run --outdir .wrangler\dry-run-v73`
4. `npx wrangler deploy`
5. `npx wrangler pages deploy dist --project-name tvbox-source-hub-v73 --branch main`
6. 主入口 `validate:online`
7. 同构入口 `validate:online`
8. `audit:release-readiness`
9. `audit:visible-freshness`
10. `audit:tv-cache-update`
11. `audit:zero-complaint`

这保证批准后不是手工单步发布，而是同一个脚本完成 Worker + Pages + 双入口后验收。
