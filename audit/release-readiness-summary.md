# v7.4 发布准备度与更新时间可见面审计

- 生成时间：2026-07-09T21:39:42.464Z
- 主入口：https://tv.webhome.eu.org
- Pages：https://tvbox-source-hub-v73.pages.dev
- gate：FAIL
- PASS/WARN/FAIL：3/3/2
- production_deploy_required：true

## 根因分布
- OK=3
- NEEDS_WORKER_DEPLOY=2
- NEEDS_PAGES_DEPLOY=3

## 检查项
- PASS；worker-status；OK；Worker hot update is within freshness guard；code=835001706202；age=2min
- WARN；online-worker-full-config；NEEDS_WORKER_DEPLOY；visible update code still lives in site name, TV apps can cache it and show stale time；code=835001706202
- WARN；online-worker-clean-config；NEEDS_WORKER_DEPLOY；visible update code still lives in site name, TV apps can cache it and show stale time；code=835001706202
- PASS；local-dist-full-config；OK；stable site name with versioned API；code=904001706202
- PASS；local-dist-clean-config；OK；stable site name with versioned API；code=904001706202
- FAIL；pages-full-config；NEEDS_PAGES_DEPLOY；config does not match expected TVBox entry contract
- FAIL；pages-clean-config；NEEDS_PAGES_DEPLOY；Pages static clean entry is missing or not JSON
- WARN；pages-manifest；NEEDS_PAGES_DEPLOY；Pages static snapshot is older than current Worker hot update；code=012270706202

## 发布闸门
- 本审计不会自动部署。生产 Worker/Pages 发布仍需要用户明确批准。
- 若出现 NEEDS_WORKER_DEPLOY：说明线上 Worker 仍暴露旧站点名时间码方案，电视端缓存后容易显示旧时间。
- 若出现 NEEDS_PAGES_DEPLOY：说明 Pages 静态兜底仍旧，可能导致备用链路或静态镜像显示旧时间。
