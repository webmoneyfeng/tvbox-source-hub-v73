# v7.4 发布准备度与更新时间可见面审计

- 生成时间：2026-07-10T00:20:24.574Z
- 主入口：https://tv.webhome.eu.org
- Pages：https://tvbox-source-hub-v73.pages.dev
- gate：PASS
- PASS/WARN/FAIL：8/0/0
- production_deploy_required：false

## 根因分布
- OK=8

## 检查项
- PASS；worker-status；OK；Worker hot update is within freshness guard；code=028001706202；age=0min
- PASS；online-worker-full-config；OK；stable site name with versioned API；code=028001706202
- PASS；online-worker-clean-config；OK；stable site name with versioned API；code=028001706202
- PASS；local-dist-full-config；OK；stable site name with versioned API；code=055001706202
- PASS；local-dist-clean-config；OK；stable site name with versioned API；code=055001706202
- PASS；pages-full-config；OK；stable site name with versioned API；code=055001706202
- PASS；pages-clean-config；OK；stable site name with versioned API；code=055001706202
- PASS；pages-manifest；OK；Pages snapshot code matches the local release artifact；code=055001706202

## 发布闸门
- 本审计不会自动部署。生产 Worker/Pages 发布仍需要用户明确批准。
- 若出现 NEEDS_WORKER_DEPLOY：说明线上 Worker 仍暴露旧站点名时间码方案，电视端缓存后容易显示旧时间。
- 若出现 NEEDS_PAGES_DEPLOY：说明 Pages 静态兜底仍旧，可能导致备用链路或静态镜像显示旧时间。
