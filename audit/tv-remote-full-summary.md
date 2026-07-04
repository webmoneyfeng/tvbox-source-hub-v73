# TVBox/FongMi/影视仓 v7.3 遥控器全量元素语义审计

- 基准入口：https://tv.webhome.eu.org
- 生成时间：2026-07-04T14:05:58.686Z
- 可见元素路径数：340
- PASS/WARN/FAIL：338/2/0
- 根因分布：OK=338，SOURCE_COVERAGE_GAP=2
- 路径归因：COMBO_OVER_CONSTRAINED=2

## 验收指标

- category_fail=0
- single_filter_fail=0
- schema_regression=0
- api_error=0
- snapshot_miss=0
- filter_logic_bug=0
- min_semantic_hit_rate=0.9091
- max_duplicate_rate=0.0417
- avg_detail_ok_rate=1
- avg_playable_rate=1

## 需要电视端人工复核的路径

- WARN / SOURCE_COVERAGE_GAP / COMBO_OVER_CONSTRAINED：vod.category.5.combo.年份+类型:2026+自然；当前路径允许为空，但必须保留诊断记录。；https://tv.webhome.eu.org/agg?ac=videolist&t=5&pg=1&limit=24&f=%7B%22year%22%3A%222026%22%2C%22class%22%3A%22%E8%87%AA%E7%84%B6%22%7D
- WARN / SOURCE_COVERAGE_GAP / COMBO_OVER_CONSTRAINED：vod.category.5.combo.地区+类型:大陆+自然；当前路径允许为空，但必须保留诊断记录。；https://tv.webhome.eu.org/agg?ac=videolist&t=5&pg=1&limit=24&f=%7B%22area%22%3A%22%E5%A4%A7%E9%99%86%22%2C%22class%22%3A%22%E8%87%AA%E7%84%B6%22%7D

## 判定说明

- 单筛选项空结果默认判为需要修复；组合筛选空结果先归因为条件过窄并保留诊断。
- 如果电视端空而脚本不空，优先按 APP_REQUEST_VARIANT 或 CACHE_STALE 追踪实际请求与缓存。
