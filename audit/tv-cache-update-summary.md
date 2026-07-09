# v7.4 电视端缓存更新时间审计

- 生成时间：2026-07-09T19:19:49.051Z
- 主入口：https://tv.webhome.eu.org
- 同构入口：https://tv.webclound.eu.org
- 模拟旧码：111111111111
- PASS/WARN/FAIL：18/0/0
- cache_update_gate：PASS

## 端点证据

- PASS；primary.config；status=200；code=813001706202；apiCode=813001706202；cache=no-store, no-cache, must-revalidate, max-age=0；class0=n/a；list=0
- PASS；primary.config_clean；status=200；code=813001706202；apiCode=813001706202；cache=no-store, no-cache, must-revalidate, max-age=0；class0=n/a；list=0
- PASS；primary.status；status=200；code=813001706202；apiCode=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；class0=n/a；list=0
- PASS；primary.cached_full_agg；status=200；code=813001706202；apiCode=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；class0=推荐 · 813001706202；list=8
- PASS；primary.cached_clean_agg；status=200；code=813001706202；apiCode=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；class0=推荐 · 813001706202；list=7
- PASS；secondary.config；status=200；code=813001706202；apiCode=813001706202；cache=no-store, no-cache, must-revalidate, max-age=0；class0=n/a；list=0
- PASS；secondary.config_clean；status=200；code=813001706202；apiCode=813001706202；cache=no-store, no-cache, must-revalidate, max-age=0；class0=n/a；list=0
- PASS；secondary.status；status=200；code=813001706202；apiCode=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；class0=n/a；list=0
- PASS；secondary.cached_full_agg；status=200；code=813001706202；apiCode=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；class0=推荐 · 813001706202；list=8
- PASS；secondary.cached_clean_agg；status=200；code=813001706202；apiCode=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；class0=推荐 · 813001706202；list=7

## 缓存路径关系检查

- PASS；primary.config.cache_header；root=OK；drift=n/a；age=n/a；cache policy acceptable
- PASS；primary.config_clean.cache_header；root=OK；drift=n/a；age=n/a；cache policy acceptable
- PASS；primary.cached_full_agg.cache_header；root=OK；drift=n/a；age=n/a；cache policy acceptable
- PASS；primary.cached_clean_agg.cache_header；root=OK；drift=n/a；age=n/a；cache policy acceptable
- PASS；primary.cached_full_agg.content_visible；root=OK；drift=n/a；age=n/a；cached aggregate path returns non-empty list and visible current code
- PASS；primary.cached_clean_agg.content_visible；root=OK；drift=n/a；age=n/a；cached aggregate path returns non-empty list and visible current code
- PASS；secondary.cached_full_agg.content_visible；root=OK；drift=n/a；age=n/a；cached aggregate path returns non-empty list and visible current code
- PASS；secondary.cached_clean_agg.content_visible；root=OK；drift=n/a；age=n/a；cached aggregate path returns non-empty list and visible current code
- PASS；primary.config_vs_clean；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary.status_vs_config；root=OK；drift=0.6min；age=n/a；within expected drift
- PASS；primary.cached_full_vs_config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary.cached_clean_vs_clean_config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；secondary.config_vs_clean；root=OK；drift=0min；age=n/a；within expected drift
- PASS；secondary.status_vs_config；root=OK；drift=0.6min；age=n/a；within expected drift
- PASS；secondary.cached_full_vs_config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；secondary.cached_clean_vs_clean_config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；primary_vs_secondary.config；root=OK；drift=0min；age=n/a；within expected drift
- PASS；status.hot_freshness；root=OK；drift=n/a；age=1.3min；hot probe fresh

## 需要关注

- 当前无 FAIL/WARN。

## 判定口径

- config、config-clean、status、旧 /agg/u旧码、旧 /agg-clean/u旧码 必须同码或在 2 分钟内。
- 2-6 分钟漂移视为 WARN，超过 6 分钟视为 FAIL。
- config 与 agg 类端点必须 no-store，避免电视端继续使用旧配置。
- 旧码路径必须返回列表并在分类名中展示当前更新时间码。
