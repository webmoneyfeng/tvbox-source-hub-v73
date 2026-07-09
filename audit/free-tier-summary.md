# v7.3 免费部署审计

- 生成时间：2026-07-09T18:47:34.940Z
- GitHub 仓库：https://github.com/webmoneyfeng/tvbox-source-hub-v73；visibility=public；private=false
- 审计入口：https://tv.webhome.eu.org
- 定时工作流估算：480/month
- Worker Cron：*/2 * * * *；估算 KV writes=720/day
- dist：418 files；49662544 bytes
- PASS/WARN/FAIL：6/0/0

## 分项
- PASS；github_repo；public；公共仓库，GitHub Actions 标准 runner 按免费优先方案使用。
- PASS；github_actions_schedule；480/month；定时刷新频率按免费优先控制，保留人工发布余量。
- PASS；cloudflare_pages_files；418；dist 静态快照采用打包文件，不采用每个节目一个文件。
- PASS；cloudflare_pages_size；49662544 bytes；dist 总体积处于轻量级静态分发范围。
- PASS；cloudflare_worker_requests；0/95 proxied；live.txt groups=9 channels=95；直播直连=95，经 Worker 代理=0，代理占比=0%；抽样播放清单子链接 0/4 继续走 Worker
- PASS；cloudflare_kv_hot_probe_writes；720/1000 writes/day；热探针仅写入单个 hot:last-success KV key，2 分钟一次约 720 writes/day，低于 Workers KV 免费层 1000 writes/day。

## 结论
- 当前方案仍按完全免费优先设计：GitHub public repo + Actions 定时刷新 + Cloudflare Pages 静态快照 + Worker 轻量路由。
- 主要风险不是点播快照，而是直播代理请求量与过高刷新频率；当前审计观测到 0/95 条直播频道走 Worker 代理链路。
