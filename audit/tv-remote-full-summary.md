# TVBox/FongMi/影视仓 v7.3 遥控器全量元素语义审计

- 基准入口：https://tv.webhome.eu.org
- 生成时间：2026-07-07T22:12:32.748Z
- 可见元素路径数：315
- PASS/WARN/FAIL：310/3/2
- 根因分布：OK=310，TAG_PARSE_GAP=2，SOURCE_COVERAGE_GAP=1，SEMANTIC_MISMATCH=2
- 路径归因：COMBO_OVER_CONSTRAINED=1

## 验收指标

- category_fail=0
- single_filter_fail=2
- schema_regression=0
- api_error=0
- snapshot_miss=0
- filter_logic_bug=0
- min_semantic_hit_rate=0.8
- max_duplicate_rate=0.0833
- avg_detail_ok_rate=1
- avg_playable_rate=1

## 需要电视端人工复核的路径

- WARN / TAG_PARSE_GAP：vod.category.4.combo.年份+类型:2026+欧美动漫；部分内容语义证据不足，需补关键词或映射。；https://tv.webhome.eu.org/agg?ac=videolist&t=4&pg=1&limit=12&f=%7B%22year%22%3A%222026%22%2C%22class%22%3A%22%E6%AC%A7%E7%BE%8E%E5%8A%A8%E6%BC%AB%22%7D
- WARN / SOURCE_COVERAGE_GAP / COMBO_OVER_CONSTRAINED：vod.category.5.combo.年份+类型:2026+自然；当前路径允许为空，但必须保留诊断记录。；https://tv.webhome.eu.org/agg?ac=videolist&t=5&pg=1&limit=12&f=%7B%22year%22%3A%222026%22%2C%22class%22%3A%22%E8%87%AA%E7%84%B6%22%7D
- WARN / TAG_PARSE_GAP：vod.category.7.filter.sort.quality；部分内容语义证据不足，需补关键词或映射。；https://tv.webhome.eu.org/agg?ac=videolist&t=7&pg=1&limit=12&f=%7B%22sort%22%3A%22quality%22%7D
- FAIL / SEMANTIC_MISMATCH：vod.category.8.filter.sort.quality；重复率超过 5%，需修去重键或排序前去重。；https://tv.webhome.eu.org/agg?ac=videolist&t=8&pg=1&limit=12&f=%7B%22sort%22%3A%22quality%22%7D
- FAIL / SEMANTIC_MISMATCH：vod.category.8.filter.sort.name；重复率超过 5%，需修去重键或排序前去重。；https://tv.webhome.eu.org/agg?ac=videolist&t=8&pg=1&limit=12&f=%7B%22sort%22%3A%22name%22%7D

## 判定说明

- 单筛选项空结果默认判为需要修复；组合筛选空结果先归因为条件过窄并保留诊断。
- 如果电视端空而脚本不空，优先按 APP_REQUEST_VARIANT 或 CACHE_STALE 追踪实际请求与缓存。
