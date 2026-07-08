# v7.4 0投诉商业体验总控审计

## 总结

- 生成时间：2026-07-08T12:19:57.877Z
- commercial_ready：false
- zero_complaint_gate：WARN
- user_love_score：99/100
- P0/P1/P2/P3：0/0/0/1
- 输入证据：audit/tv-remote-full-latest.json；audit/coverage-latest.json；audit/source-discovery-latest.json；audit/free-tier-latest.json；dist/snapshot/latest/validation.json；audit/snapshot-warning-triage-latest.json；audit/snapshot-pack-gap-latest.json；dist/snapshot/latest/manifest.json

## 终局判定

- 当前证据尚未满足“用户喜欢、0投诉、可商业化收费”的上线门禁，不能把工程可用误判为商业可收费。
- 本报告只聚合现有审计与轻量入口探测，不替代遥控器实测、源覆盖深测和播放抽样。

## 硬门槛

- PASS；P0=0；value=0
- PASS；P1=0；value=0
- PASS；remote_fail=0；value=0
- PASS；single_filter_fail=0；value=0
- PASS；schema_regression=0；value=0
- PASS；api_error=0；value=0
- PASS；snapshot_miss=0；value=0
- PASS；filter_logic_bug=0；value=0
- PASS；duplicate_rate<=5%；value=0
- PASS；detail_ok_rate>=95%；value=1
- PASS；playable_rate>=90%；value=1
- PASS；free_tier_fail=0；value=0
- PASS；snapshot_errors=0；value=0

## 当前核心指标

- 遥控器路径：visible=319；PASS/WARN/FAIL=319/0/0；max_duplicate_rate=0；detail=1；playable=1
- 覆盖审计：PASS/WARN/FAIL=10/0/0
- 源发现：candidate=29；ACTIVE/WATCH/REJECTED/BLOCKED=14/8/3/4
- 免费层：PASS/WARN/FAIL=6/0/0
- 直播承载：channels=95；proxied=0；direct=95；proxyRatio=0%
- 快照：errors=0；warnings=20；triage=20；blocking=0；visibleUpdateText=510280706202

## 快照 warning 分诊

- total=20；unclassified=0；user_visible=0；current_tv_blocking=0；by_type=UI_HIDE_CANDIDATE=20

## 快照包自愈审计

- 当前无 SNAPSHOT_PACK_GAP 自愈审计数据。

## 在线入口轻量探测

- https://tv.webhome.eu.org；config=200；status=200；sites=影视点播 · 219180706202；visible=219180706202
- https://tv.webclound.eu.org；config=200；status=200；sites=影视点播 · 219180706202；visible=219180706202

## 阻塞投诉

- 暂无 P0/P1 阻塞投诉。

## 下一修复队列

1. P3；snapshot；快照 warning 已分诊为观察项；证据：total=20；visible=0；by_type=UI_HIDE_CANDIDATE=20；建议：继续收敛 SNAPSHOT_PACK_GAP 与 UI_HIDE_CANDIDATE；当前不把它升级为用户可见投诉，但仍阻止宣称终局完成。

## 终局到下一阶段承接

- 终局：用户喜欢的、0投诉的、可商业化收费的 TVBox/FongMi/影视仓 点播+直播源。
- 全局：P0/P1 当前清零，但 P2 已暴露静态 filter-pack 缺失风险；继续用总控门禁统一遥控器、覆盖、源、免费层、快照和入口状态，避免动态兜底掩盖用户投诉。
- 局部：下一阶段优先修复 P2 静态快照包缺口，同时继续收敛 P3 不可见按钮候选、真实投诉种子、审计性能和准实时运营闭环。
- 节点：每个 warning、path_id、canary 条目、投诉种子都必须有请求 URL、根因、修复建议和复测证据。
- 末梢：电视端每个按钮、搜索词、详情页、播放线路都按语义返回且不重复；用户反馈路径能自动进入下一轮审计。

> 当前硬门槛均通过。
