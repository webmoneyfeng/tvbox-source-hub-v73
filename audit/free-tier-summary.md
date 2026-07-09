# v7.3 免费部署审计

- 生成时间：2026-07-09T08:09:01.599Z
- GitHub 仓库：https://github.com/webmoneyfeng/tvbox-source-hub-v73；visibility=public；private=false
- 审计入口：https://tv.webhome.eu.org
- 定时工作流估算：330/month
- dist：404 files；48303026 bytes
- PASS/WARN/FAIL：6/0/0

## 分项
- PASS；github_repo；public；公共仓库，GitHub Actions 标准 runner 按免费优先方案使用。
- PASS；github_actions_schedule；330/month；定时刷新频率按免费优先控制，保留人工发布余量。
- PASS；cloudflare_pages_files；404；dist 静态快照采用打包文件，不采用每个节目一个文件。
- PASS；cloudflare_pages_size；48303026 bytes；dist 总体积处于轻量级静态分发范围。
- PASS；cloudflare_worker_requests；0/95 proxied；live.txt groups=9 channels=95；直播直连=95，经 Worker 代理=0，代理占比=0%；抽样播放清单子链接 0/4 继续走 Worker
- PASS；cloudflare_kv；low；当前主要读取 channels/vod_catalog，未发现高频写入设计。

## 结论
- 当前方案仍按完全免费优先设计：GitHub public repo + Actions 定时刷新 + Cloudflare Pages 静态快照 + Worker 轻量路由。
- 主要风险不是点播快照，而是直播代理请求量与过高刷新频率；当前审计观测到 0/95 条直播频道走 Worker 代理链路。
