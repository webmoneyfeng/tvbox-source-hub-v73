# TVBox Source Hub v7.3

免费零账单优先的 TVBox/FongMi/影视仓聚合服务。项目只维护配置、目录、搜索索引、分类、筛选和验证逻辑，不托管视频文件，也不代理默认直播或点播媒体流。

## 电视端入口

| 版本 | 主入口 | 同构入口 |
|---|---|---|
| 全量版 | `https://tv.webhome.eu.org/config.json` | `https://tv.webclound.eu.org/config.json` |
| 洁净版 | `https://tv.webhome.eu.org/config-clean.json` | `https://tv.webclound.eu.org/config-clean.json` |

旧 Worker `https://tvbox-source-hub.feng-yang.workers.dev/config.json` 只作为上线回滚基线。两个自定义域名共享同一 Worker，不属于独立故障域。

## 架构真值

- 代码真值：GitHub `main` 分支。
- 全量数据真值：GitHub `snapshot` 分支中的 `dist/`。
- 当前静态目录：`dist/snapshot/latest/`；前一有效目录：`dist/snapshot/previous/`。
- 动态热目录：Cloudflare KV 的 `catalog:hot:<revision>` 与原子指针 `catalog:active`。
- 电视端更新时间：仅在新内容或新集数完成分类、去重、抽样验证并成功切换 KV 指针后改变。
- 全量版和洁净版由同一 `content_revision` 生成；洁净版只在输出层移除成人分类、筛选和结果。

Worker 每 5 分钟拉取所有 ACTIVE 源最新页，并轮换深查一个主分类；GitHub Actions 每 6 小时生成一次完整增量快照。读取顺序为边缘缓存、KV 热包、Pages 当前快照、GitHub 当前快照、前一有效快照，最后才做有界动态回退。

## 分类与兼容

电视端展示 13 个互斥主类：推荐、院线电影、网络电影、其他电影、电视剧、网络剧、网络短剧、综艺、动漫、纪录片、解说、文娱知识、成人伦理。洁净版展示前 12 类。

旧分类 ID 保持兼容：`1` 返回三类电影并集，`2` 返回电视剧与网络剧并集，`6` 返回网络短剧。全局 `canonical_id` 不包含分类，同一节目多源合并为一条记录和多条播放线路。

## 维护与验证

```powershell
npm run check
npm run audit:sources
npm run generate:snapshot
npm run audit:free-tier
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run validate:online
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run audit:remote-full
```

`src/`、`scripts/`、`.github/workflows/` 和 `data/source-registry-v73.json` 是可维护源码；`dist/` 与 `audit/` 是可重建产物；`ops/baseline/` 保存受控回滚证据。上述机器契约目录不得改名。

## 免费边界

- Cloudflare Worker 不代理视频分片，避免媒体流量消耗请求额度。
- KV 只在内容变化时写热包和指针，健康心跳最多每 30 分钟一次。
- Pages 单文件必须小于 25 MiB，`latest + previous` 总文件数必须小于 20,000。
- 免费额度达到硬闸门时停止发布或降级使用旧版本，不自动升级付费方案。
- 商业正式标记要求上线后连续 48 小时无 P0/P1、GitHub 定时失败为 0；免费 Cloudflare 不承诺中国大陆付费 CDN 等级 SLA。

Cloudflare 资源：Worker `tvbox-source-hub-v73`、Pages `tvbox-source-hub-v73`、KV 绑定 `TVBOX_KV`、自定义域名 `tv.webhome.eu.org` 与 `tv.webclound.eu.org`。
