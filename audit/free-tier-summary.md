# v7.3 免费部署审计

- 生成时间：2026-07-06T08:53:00.571Z
- GitHub 仓库：https://github.com/webmoneyfeng/tvbox-source-hub-v73｜visibility=public｜private=false
- 定时工作流估算：270/month
- dist：364 files｜43242361 bytes
- PASS/WARN/FAIL：5/1/0

## 分项
- PASS｜github_repo｜public｜public repo
- PASS｜github_actions｜270/month｜调度频率按免费优先控制
- PASS｜cloudflare_pages_files｜364｜dist 文件数量估算
- PASS｜cloudflare_pages_size｜43242361 bytes｜dist 总大小估算
- WARN｜cloudflare_worker_requests｜unknown｜点播不代理视频；直播 /play/ 与 /p/ 会消耗 Worker 请求，本轮只审计不改现状
- PASS｜cloudflare_kv｜low｜当前主要读 channels/vod_catalog，未发现高频写入

## 结论
- 当前方案免费优先；主要风险是 Cloudflare Pages 构建次数与直播代理请求量。
- 本轮不改直播代理，只保留风险提示与后续降级空间。
