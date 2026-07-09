# v7.4 更新时间一致性 SLA 审计

- 生成时间：2026-07-09T22:49:54.572Z
- 主入口：https://tv.webhome.eu.org
- 同构入口：https://tv.webclound.eu.org
- PASS/WARN/FAIL：10/0/0
- update_sla_gate：PASS

## 端点抽取

- PASS；primary.config；status=200；code=846001706202；source=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK
- PASS；primary.config_clean；status=200；code=846001706202；source=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK
- PASS；primary.agg；status=200；code=846001706202；source=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK
- PASS；primary.agg_clean；status=200；code=846001706202；source=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK
- PASS；primary.status；status=200；code=846001706202；source=hot-probe；cache=public, max-age=30；root=OK
- PASS；primary.snapshot；status=200；code=055001706202；source=snapshot；cache=public, max-age=120；root=OK
- PASS；secondary.config；status=200；code=846001706202；source=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK
- PASS；secondary.config_clean；status=200；code=846001706202；source=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK

## 关系检查

- PASS；primary.config_vs_clean；root=OK；drift=0min；age=n/a；within expected drift
- PASS；secondary.config_vs_clean；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary_vs_secondary.config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary.agg_vs_config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary.agg_clean_vs_config_clean；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary.status_vs_config；root=OK；drift=0.6min；age=n/a；within expected drift
- PASS；status.visibleUpdateSource；root=OK；drift=n/a；age=n/a；accepted source
- PASS；primary.hot_probe_freshness；root=OK；drift=n/a；age=1.4min；fresh
- PASS；primary.snapshot_freshness；root=OK；drift=n/a；age=59.3min；fresh
- PASS；workflow.hot_refresh_schedule；root=OK；drift=n/a；age=n/a；hot refresh workflow within target cadence

## 需要关注

- 当前无 FAIL/WARN。

## 判定口径

- config 与 config-clean 必须同码。
- 主域名与同构域名 config 必须同码，或差异不超过 6 分钟热更新守护线时标记 WARN。
- agg 推荐分类与 config 允许 2 分钟以内差异；超过 2 分钟但不超过 1 个 Cron 周期记为 Worker isolate/cache WARN。
- status.visibleUpdateSource 必须是 hot-probe 或 snapshot。
- hot-probe 商业目标为 2 分钟内刷新；超过 6 分钟守护线即判定 FAIL；snapshot 超过 6 小时只 WARN，不阻断 hot-probe。
