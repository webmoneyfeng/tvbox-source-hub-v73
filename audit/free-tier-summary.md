# v7.3 免费部署审计

- 生成时间：2026-07-08T00:07:23.240Z
- GitHub 仓库：https://github.com/webmoneyfeng/tvbox-source-hub-v73；visibility=public；private=false
- 定时工作流估算：330/month
- dist：318 files；36300361 bytes
- PASS/WARN/FAIL：5/1/0

## 分项
- PASS；github_repo；public；公共仓库，GitHub Actions 标准 runner 按免费优先方案使用。
- PASS；github_actions_schedule；330/month；定时刷新频率按免费优先控制，保留人工发布余量。
- PASS；cloudflare_pages_files；318；dist 静态快照采用打包文件，不采用每个节目一个文件。
- PASS；cloudflare_pages_size；36300361 bytes；dist 总体积处于轻量级静态分发范围。
- WARN；cloudflare_worker_requests；unknown；点播不代理视频流；直播 /play/ 与 /p/ 可能消耗 Worker 请求，本轮只审计不扩大代理。
- PASS；cloudflare_kv；low；当前主要读取 channels/vod_catalog，未发现高频写入设计。

## 结论
- 当前方案仍按完全免费优先设计：GitHub public repo + Actions 定时刷新 + Cloudflare Pages 静态快照 + Worker 轻量路由。
- 主要风险不是点播快照，而是直播代理请求量与过高刷新频率；本轮已把热点刷新控制在约 3 小时一次，并保留降频空间。
