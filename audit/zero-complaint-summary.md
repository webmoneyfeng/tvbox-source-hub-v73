# v7.4 0投诉商业体验总控审计

## 总结

- 生成时间：2026-07-08T00:58:11.893Z
- commercial_ready：false
- zero_complaint_gate：FAIL
- user_love_score：7/100
- P0/P1/P2/P3：0/1/12/1
- 输入证据：audit/tv-remote-full-latest.json；audit/coverage-latest.json；audit/source-discovery-latest.json；audit/free-tier-latest.json；dist/snapshot/latest/validation.json；dist/snapshot/latest/manifest.json

## 终局判定

- 当前证据尚未满足“用户喜欢、0投诉、可商业化收费”的上线门禁，不能把工程可用误判为商业可收费。
- 本报告只聚合现有审计与轻量入口探测，不替代遥控器实测、源覆盖深测和播放抽样。

## 硬门槛

- PASS；P0=0；value=0
- FAIL；P1=0；value=1
- FAIL；remote_fail=0；value=2
- FAIL；single_filter_fail=0；value=2
- PASS；schema_regression=0；value=0
- PASS；api_error=0；value=0
- PASS；snapshot_miss=0；value=0
- PASS；filter_logic_bug=0；value=0
- FAIL；duplicate_rate<=5%；value=0.0833
- PASS；detail_ok_rate>=95%；value=1
- PASS；playable_rate>=90%；value=1
- PASS；free_tier_fail=0；value=0
- PASS；snapshot_errors=0；value=0

## 当前核心指标

- 遥控器路径：visible=315；PASS/WARN/FAIL=310/3/2；max_duplicate_rate=0.0833；detail=1；playable=1
- 覆盖审计：PASS/WARN/FAIL=6/4/0
- 源发现：candidate=29；ACTIVE/WATCH/REJECTED/BLOCKED=16/9/2/2
- 免费层：PASS/WARN/FAIL=5/1/0
- 快照：errors=0；warnings=41；visibleUpdateText=647080706202

## 在线入口轻量探测

- https://tv.webhome.eu.org；config=200；status=200；sites=影视点播 · 647080706202；visible=647080706202
- https://tv.webclound.eu.org；config=200；status=200；sites=影视点播 · 647080706202；visible=647080706202

## 阻塞投诉

- P1；coverage；核心搜索不稳定：天道；证据：SOURCE_PHYSICAL_LIMIT；源命中=9；重复搜索结果不稳定，可能由源超时或反爬导致。；建议：把该节目加入核心投诉种子，修复精确片名召回、别名/主演召回、排序压制和动态/快照一致性。

## 下一修复队列

1. P1；coverage；核心搜索不稳定：天道；证据：SOURCE_PHYSICAL_LIMIT；源命中=9；重复搜索结果不稳定，可能由源超时或反爬导致。；建议：把该节目加入核心投诉种子，修复精确片名召回、别名/主演召回、排序压制和动态/快照一致性。
2. P2；coverage；覆盖审计 WARN：演唱会；证据：RANKING_SUPPRESSION；源命中=9；已召回但精确结果未稳定进入第一页。；建议：继续扩源、增强排序与标签召回，确保能稳定进入搜索第一页。
3. P2；coverage；覆盖审计 WARN：电影解说；证据：RANKING_SUPPRESSION；源命中=2；已召回但精确结果未稳定进入第一页。；建议：继续扩源、增强排序与标签召回，确保能稳定进入搜索第一页。
4. P2；coverage；覆盖审计 WARN：短剧；证据：RANKING_SUPPRESSION；源命中=13；已召回但精确结果未稳定进入第一页。；建议：继续扩源、增强排序与标签召回，确保能稳定进入搜索第一页。
5. P2；dedupe；重复率超过 0投诉商业门槛；证据：max_duplicate_rate=0.0833；建议：修 canonical identity、跨源合并键、排序前去重与分类/筛选内去重。
6. P2；filter_semantics；单筛选按钮仍有 FAIL；证据：single_filter_fail=2；建议：逐个修复 FAIL 路径，不能用隐藏按钮代替根因修复。
7. P2；free_tier；免费方案存在风险：cloudflare_worker_requests；证据：unknown；点播不代理视频流；直播 /play/ 与 /p/ 可能消耗 Worker 请求，本轮只审计不扩大代理。；建议：形成限流、缓存、降频、直连播放和不代理视频流的运营策略。
8. P2；remote_path；遥控器路径未达到预期：vod.category.8.filter.sort.quality；证据：SEMANTIC_MISMATCH；list=12；semantic=1；duplicate=0.0833；重复率超过 5%，需修去重键或排序前去重。；建议：重复率超过 5%，需修去重键或排序前去重。
9. P2；remote_path；遥控器路径未达到预期：vod.category.8.filter.sort.name；证据：SEMANTIC_MISMATCH；list=12；semantic=1；duplicate=0.0833；重复率超过 5%，需修去重键或排序前去重。；建议：重复率超过 5%，需修去重键或排序前去重。
10. P2；remote_warn；遥控器路径存在 WARN：vod.category.4.combo.年份+类型:2026+欧美动漫；证据：TAG_PARSE_GAP；部分内容语义证据不足，需补关键词或映射。；建议：部分内容语义证据不足，需补关键词或映射。
11. P2；remote_warn；遥控器路径存在 WARN：vod.category.5.combo.年份+类型:2026+自然；证据：SOURCE_COVERAGE_GAP / COMBO_OVER_CONSTRAINED；当前路径允许为空，但必须保留诊断记录。；建议：当前路径允许为空，但必须保留诊断记录。
12. P2；remote_warn；遥控器路径存在 WARN：vod.category.7.filter.sort.quality；证据：TAG_PARSE_GAP；部分内容语义证据不足，需补关键词或映射。；建议：部分内容语义证据不足，需补关键词或映射。
13. P2；semantic；最低语义命中率低于商业门槛；证据：min_semantic_hit_rate=0.8；建议：补充标签解析、标题/备注证据、内容形态映射与源标签追踪。
14. P3；snapshot；快照验证仍有 WARN；证据：41 warnings；建议：逐步把仍可见的空筛选、低证据筛选与源质量问题纳入 P2/P3 修复队列。

## 终局到下一阶段承接

- 终局：用户喜欢的、0投诉的、可商业化收费的 TVBox/FongMi/影视仓 点播+直播源。
- 全局：先用总控门禁统一遥控器、覆盖、源、免费层、快照和入口状态，避免局部通过掩盖用户投诉。
- 局部：下一阶段优先修复 P1/P2：核心搜索稳定性、文娱知识重复率、排序压制、标签解析和免费层请求风险。
- 节点：每个失败 path_id、canary 条目、WARN 端点都必须有请求 URL、根因、修复建议和复测证据。
- 末梢：电视端每个按钮、搜索词、详情页、播放线路都按语义返回且不重复。

> 当前未过门槛：P1=0，remote_fail=0，single_filter_fail=0，duplicate_rate<=5%
