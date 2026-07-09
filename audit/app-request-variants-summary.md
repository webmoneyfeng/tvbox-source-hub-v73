# v7.4 App 请求变体与缓存路径审计

- 生成时间：2026-07-09T23:31:52.363Z
- 主入口：https://tv.webhome.eu.org
- 同构入口：https://tv.webclound.eu.org
- 模拟旧更新时间码：111111111111
- PASS/WARN/FAIL：52/0/0
- app_variant_gate：PASS

## 覆盖范围

- TVBox：`ac=videolist&t`、`wd`、`f` JSON、旧 `/agg/u旧码`。
- FongMi：`ac=detail&t` 无 `ids` 时按分类列表处理、`search` 参数。
- 影视仓：`page`、`type_id`、`category`、`q` 参数。
- 双版本：全量 `/agg` 与洁净 `/agg-clean` 同步验证。

## 结果明细

- PASS；primary.full.full.tvbox.videolist.t；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?ac=videolist&t=1&pg=1&limit=8
- PASS；primary.full.full.fongmi.detail_without_ids；profile=FongMi；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?ac=detail&t=1&pg=1&limit=8
- PASS；primary.full.full.warehouse.page_alias；profile=影视仓；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?t=1&page=1&limit=8
- PASS；primary.full.full.tvbox.tid_alias；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?tid=1&pg=1&limit=8
- PASS；primary.full.full.fongmi.type_id_alias；profile=FongMi；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?type_id=1&pg=1&limit=8
- PASS；primary.full.full.warehouse.category_key；profile=影视仓；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?category=movie&pg=1&limit=8
- PASS；primary.full.full.tvbox.search_wd；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?wd=%E5%A4%A9%E9%81%93&limit=8
- PASS；primary.full.full.fongmi.search_param；profile=FongMi；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?search=%E5%A4%A9%E9%81%93&limit=8
- PASS；primary.full.full.warehouse.q_param；profile=影视仓；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?q=%E5%A4%A9%E9%81%93&limit=8
- PASS；primary.full.full.tvbox.search_alias；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?wd=%E9%81%A5%E8%BF%9C%E7%9A%84%E6%95%91%E4%B8%96%E4%B8%BB&limit=8
- PASS；primary.full.full.tvbox.search_actor；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?wd=%E7%8E%8B%E5%BF%97%E6%96%87&limit=8
- PASS；primary.full.full.tvbox.filter_json；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?t=1&f=%7B%22year%22%3A%222026%22%7D&pg=1&limit=8
- PASS；primary.full.full.tvbox.old_versioned_path；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1
- PASS；primary.clean.clean.tvbox.videolist.t；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?ac=videolist&t=1&pg=1&limit=8
- PASS；primary.clean.clean.fongmi.detail_without_ids；profile=FongMi；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?ac=detail&t=1&pg=1&limit=8
- PASS；primary.clean.clean.warehouse.page_alias；profile=影视仓；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?t=1&page=1&limit=8
- PASS；primary.clean.clean.tvbox.tid_alias；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?tid=1&pg=1&limit=8
- PASS；primary.clean.clean.fongmi.type_id_alias；profile=FongMi；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?type_id=1&pg=1&limit=8
- PASS；primary.clean.clean.warehouse.category_key；profile=影视仓；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?category=movie&pg=1&limit=8
- PASS；primary.clean.clean.tvbox.search_wd；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?wd=%E5%A4%A9%E9%81%93&limit=8
- PASS；primary.clean.clean.fongmi.search_param；profile=FongMi；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?search=%E5%A4%A9%E9%81%93&limit=8
- PASS；primary.clean.clean.warehouse.q_param；profile=影视仓；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?q=%E5%A4%A9%E9%81%93&limit=8
- PASS；primary.clean.clean.tvbox.search_alias；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?wd=%E9%81%A5%E8%BF%9C%E7%9A%84%E6%95%91%E4%B8%96%E4%B8%BB&limit=8
- PASS；primary.clean.clean.tvbox.search_actor；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?wd=%E7%8E%8B%E5%BF%97%E6%96%87&limit=8
- PASS；primary.clean.clean.tvbox.filter_json；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?t=1&f=%7B%22year%22%3A%222026%22%7D&pg=1&limit=8
- PASS；primary.clean.clean.tvbox.old_versioned_path；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1
- PASS；secondary.full.full.tvbox.videolist.t；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?ac=videolist&t=1&pg=1&limit=8
- PASS；secondary.full.full.fongmi.detail_without_ids；profile=FongMi；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?ac=detail&t=1&pg=1&limit=8
- PASS；secondary.full.full.warehouse.page_alias；profile=影视仓；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?t=1&page=1&limit=8
- PASS；secondary.full.full.tvbox.tid_alias；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?tid=1&pg=1&limit=8
- PASS；secondary.full.full.fongmi.type_id_alias；profile=FongMi；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?type_id=1&pg=1&limit=8
- PASS；secondary.full.full.warehouse.category_key；profile=影视仓；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?category=movie&pg=1&limit=8
- PASS；secondary.full.full.tvbox.search_wd；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?wd=%E5%A4%A9%E9%81%93&limit=8
- PASS；secondary.full.full.fongmi.search_param；profile=FongMi；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?search=%E5%A4%A9%E9%81%93&limit=8
- PASS；secondary.full.full.warehouse.q_param；profile=影视仓；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?q=%E5%A4%A9%E9%81%93&limit=8
- PASS；secondary.full.full.tvbox.search_alias；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?wd=%E9%81%A5%E8%BF%9C%E7%9A%84%E6%95%91%E4%B8%96%E4%B8%BB&limit=8
- PASS；secondary.full.full.tvbox.search_actor；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?wd=%E7%8E%8B%E5%BF%97%E6%96%87&limit=8
- PASS；secondary.full.full.tvbox.filter_json；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg?t=1&f=%7B%22year%22%3A%222026%22%7D&pg=1&limit=8
- PASS；secondary.full.full.tvbox.old_versioned_path；profile=TVBox；status=200；list=8；class=10；code=037001706202；policy=full；root=OK；path=/agg/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1
- PASS；secondary.clean.clean.tvbox.videolist.t；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?ac=videolist&t=1&pg=1&limit=8
- PASS；secondary.clean.clean.fongmi.detail_without_ids；profile=FongMi；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?ac=detail&t=1&pg=1&limit=8
- PASS；secondary.clean.clean.warehouse.page_alias；profile=影视仓；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?t=1&page=1&limit=8
- PASS；secondary.clean.clean.tvbox.tid_alias；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?tid=1&pg=1&limit=8
- PASS；secondary.clean.clean.fongmi.type_id_alias；profile=FongMi；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?type_id=1&pg=1&limit=8
- PASS；secondary.clean.clean.warehouse.category_key；profile=影视仓；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?category=movie&pg=1&limit=8
- PASS；secondary.clean.clean.tvbox.search_wd；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?wd=%E5%A4%A9%E9%81%93&limit=8
- PASS；secondary.clean.clean.fongmi.search_param；profile=FongMi；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?search=%E5%A4%A9%E9%81%93&limit=8
- PASS；secondary.clean.clean.warehouse.q_param；profile=影视仓；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?q=%E5%A4%A9%E9%81%93&limit=8
- PASS；secondary.clean.clean.tvbox.search_alias；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?wd=%E9%81%A5%E8%BF%9C%E7%9A%84%E6%95%91%E4%B8%96%E4%B8%BB&limit=8
- PASS；secondary.clean.clean.tvbox.search_actor；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?wd=%E7%8E%8B%E5%BF%97%E6%96%87&limit=8
- PASS；secondary.clean.clean.tvbox.filter_json；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean?t=1&f=%7B%22year%22%3A%222026%22%7D&pg=1&limit=8
- PASS；secondary.clean.clean.tvbox.old_versioned_path；profile=TVBox；status=200；list=8；class=9；code=037001706202；policy=clean-no-adult；root=OK；path=/agg-clean/u111111111111?ac=videolist&t=0&pg=1&limit=8&fresh=1

## 需关注项

- 当前无 FAIL/WARN。

## 商业更新时间投诉判断

- 如果本报告旧 `/agg/u旧码` 路径 PASS，但电视端站点列表仍显示旧码，根因优先归为电视 App 本地配置名缓存。
- 用户实际进入分类后，应以分类名 `推荐 · 当前码` 与 `/status.json.visibleUpdateText` 判断内容层是否更新。
- 若旧码路径、搜索变体或分类变体失败，则归为服务端兼容问题，不能推给电视端缓存。
