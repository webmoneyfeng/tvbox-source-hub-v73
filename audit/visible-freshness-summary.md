# v7.4 电视端可见更新时间表面审计

- 生成时间：2026-07-09T23:06:03.011Z
- 主入口：https://tv.webhome.eu.org
- 同构入口：https://tv.webclound.eu.org
- 商业守门线：6 分钟
- 电视端观测码：未提供
- visible_freshness_gate：PASS
- 诊断：SERVICE_FRESH
- 当前服务端码：407001706202
- 结论：服务端所有可见更新时间表面均在商业守门线内。

## 可见表面

- PASS；primary.config；surface=config.api；code=407001706202；age=2.1min；list=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK；evidence=影视点播 -> https://tv.webhome.eu.org/agg/u407001706202
- PASS；primary.config_clean；surface=config-clean.api；code=407001706202；age=2.1min；list=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK；evidence=影视点播洁净 -> https://tv.webhome.eu.org/agg-clean/u407001706202
- PASS；primary.agg_stale_path；surface=agg.class；code=407001706202；age=2.1min；list=8；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK；evidence=407001706202
- PASS；primary.agg_clean_stale_path；surface=agg-clean.class；code=407001706202；age=2.1min；list=8；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK；evidence=407001706202
- PASS；primary.status；surface=status.visibleUpdateText；code=407001706202；age=1.3min；list=n/a；cache=public, max-age=30；root=OK；evidence=407001706202
- PASS；secondary.config；surface=config.api；code=407001706202；age=2.1min；list=n/a；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK；evidence=影视点播 -> https://tv.webclound.eu.org/agg/u407001706202
- PASS；secondary.agg_stale_path；surface=agg.class；code=407001706202；age=2.1min；list=8；cache=no-store, no-cache, must-revalidate, max-age=0；root=OK；evidence=407001706202
- PASS；secondary.status；surface=status.visibleUpdateText；code=407001706202；age=1.3min；list=n/a；cache=public, max-age=30；root=OK；evidence=407001706202

## 需关注项

- 当前无服务端可见表面 FAIL。

## 客服/运营判定口径

- 若本报告 PASS，但用户站点列表仍显示旧码：优先判断为电视 App 本地站点名缓存；让用户进入“影视点播”后看分类栏 `推荐 · 当前码`。
- 若旧 `/agg/u旧码` 路径也返回当前码且列表非空：内容层已无感更新，站点列表旧不代表节目未更新。
- 若本报告 FAIL：不能让客户清缓存背锅，必须按 root_cause 修服务端。
