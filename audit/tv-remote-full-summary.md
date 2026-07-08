# TVBox/FongMi/影视仓 v7.3 遥控器全量元素语义审计

- 基准入口：https://tv.webhome.eu.org
- 生成时间：2026-07-08T05:16:28.020Z
- 可见元素路径数：319
- PASS/WARN/FAIL：319/0/0
- 根因分布：OK=319
- 路径归因：无

## 验收指标

- category_fail=0
- single_filter_fail=0
- schema_regression=0
- api_error=0
- snapshot_miss=0
- filter_logic_bug=0
- min_semantic_hit_rate=0.913
- max_duplicate_rate=0
- avg_detail_ok_rate=1
- avg_playable_rate=1

## 需要电视端人工复核的路径

- 无

## 判定说明

- 单筛选项空结果默认判为需要修复；组合筛选空结果先归因为条件过窄并保留诊断。
- 如果电视端空而脚本不空，优先按 APP_REQUEST_VARIANT 或 CACHE_STALE 追踪实际请求与缓存。
