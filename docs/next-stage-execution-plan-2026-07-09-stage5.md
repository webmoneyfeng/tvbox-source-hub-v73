# TVBox v7.4 Stage 5 执行计划：双入口上线同步与更新时间投诉闭环

## 1. 上一阶段证据

- 已新增全量版入口：`/config.json` -> `/agg`，保留成人内容。
- 已新增洁净版入口：`/config-clean.json`、`/clean/config.json` -> `/agg-clean`，去掉成人内容。
- `dist/config-clean.json` 已由快照生成器同步生成。
- `status.json` 与 `manifest.json` 已记录 `entries.full`、`entries.clean` 与 `contentPolicies`。
- `hot-refresh.yml` 已从每 3 小时改为每小时第 7、37 分钟执行，免费热刷新目标变为 30 分钟级。
- `full-refresh.yml` 已从每天一次改为每 2 小时执行。
- `npm run check`：24/24 PASS。
- `npm run generate:snapshot`：成功，`visibleUpdateText=838190706202`，10 个主分类非空，`filterPackCount=374`。
- `npm run triage:snapshot-warnings`：`current_tv_blocking=0`。
- `npm run audit:snapshot-pack-gaps`：`visible_p2=0`。

## 2. 终局承接

终局仍是：用户喜欢的、0 投诉的、可商业化收费的 TVBox/FongMi/影视仓 点播 + 直播源。

本阶段不是宣称终局完成，而是补齐商业运营必需的两个能力：

1. 同一项目同时服务两类客户：
   - 全量版：内容全、保留成人。
   - 洁净版：适合家庭、企业、公开场景，不暴露成人。
2. 更新时间从小时级投诉风险收敛到免费条件下可承受的 30 分钟级热刷新。

## 3. 下一阶段目标

Stage 5 的目标：

```text
把双入口发布到线上，并用主入口、同构入口、电视端请求语义、缓存一致性和更新时间链路证明：
全量版与洁净版同时间更新、同时间可导入、同时间可搜索、同时间可播放。
```

## 4. 全局任务

1. 发布同步：
   - 推送代码与 `dist` 到 GitHub。
   - 等待 Cloudflare Worker / Pages 消费最新提交。
   - 验证主入口与同构入口都显示同一个更新时间码。

2. 双入口验证：
   - `https://tv.webhome.eu.org/config.json`
   - `https://tv.webhome.eu.org/config-clean.json`
   - `https://tv.webclound.eu.org/config.json`
   - `https://tv.webclound.eu.org/config-clean.json`

3. 语义验证：
   - 全量版必须仍能看到成人伦理分类。
   - 洁净版不得出现成人伦理分类、成人筛选、成人搜索结果、成人详情。
   - 两版都必须保留电影、剧集、综艺、动漫、纪录片、短剧、解说、文娱知识。

4. 更新时间验证：
   - `/config.json` 与 `/config-clean.json` 的入口名使用同一个倒序更新时间码。
   - `/status.json` 的 `visibleUpdateText` 与入口名一致。
   - GitHub Actions 下次 hot-refresh 后，入口码应自动前进。

## 5. 局部任务

- 修复任何 `validate:online` 对洁净版发现的问题。
- 如果电视端仍显示旧码，优先归因：
  1. TVBox/FongMi/影视仓 App 配置缓存。
  2. Cloudflare 边缘缓存。
  3. Worker 内存快照缓存。
  4. GitHub/Pages 部署传播延迟。
  5. GitHub Actions 调度延迟。

## 6. 末梢验收路径

每个入口都必须按以下路径验证：

```text
导入配置
进入影视点播 / 影视点播洁净
打开分类
打开电影第一页
搜索“电影”
搜索“天道”
打开详情
检查播放线路
返回重进
对比更新时间码
```

## 7. 失败回滚

- 如果洁净版失败，不回滚全量版，先隐藏或修复 `/config-clean.json`。
- 如果全量版失败，回滚到上一版 Worker / Pages 快照。
- 如果热刷新过密导致免费 Actions 排队或失败，把 hot-refresh 临时降到每小时一次，但保留全量/洁净同步发布逻辑。

## 8. 下一阶段入口

Stage 5 完成后进入 Stage 6：

```text
真实电视端遥控器双入口抽样 + 用户投诉种子闭环 + 30 分钟级更新时间 SLA 观测。
```
