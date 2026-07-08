# v7.4 快照 Warning 分诊报告

## 总结

- 生成时间：2026-07-08T12:19:29.400Z
- 输入：dist/snapshot/latest/validation.json；audit/tv-remote-full-latest.json
- warning 总数：20
- 未分类：0
- 当前电视端可见：0
- 当前电视端阻塞：0
- P级分布：P3=20

## 根因分布

- UI_HIDE_CANDIDATE：20

## 分类分布 Top

- 无

## 当前用户可感知阻塞

- 暂无。当前 warnings 没有证据证明会造成电视端按钮空壳；多数属于静态快照包、验证时点或不可见规则观察项。

## 分诊明细

1. P3；UI_HIDE_CANDIDATE；搜索/category 0 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
2. P3；UI_HIDE_CANDIDATE；搜索/category 0 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
3. P3；UI_HIDE_CANDIDATE；搜索/category 1 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
4. P3；UI_HIDE_CANDIDATE；搜索/category 1 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
5. P3；UI_HIDE_CANDIDATE；搜索/category 2 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
6. P3；UI_HIDE_CANDIDATE；搜索/category 2 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
7. P3；UI_HIDE_CANDIDATE；搜索/category 3 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
8. P3；UI_HIDE_CANDIDATE；搜索/category 3 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
9. P3；UI_HIDE_CANDIDATE；搜索/category 4 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
10. P3；UI_HIDE_CANDIDATE；搜索/category 4 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
11. P3；UI_HIDE_CANDIDATE；搜索/category 5 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
12. P3；UI_HIDE_CANDIDATE；搜索/category 5 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
13. P3；UI_HIDE_CANDIDATE；搜索/category 6 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
14. P3；UI_HIDE_CANDIDATE；搜索/category 6 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
15. P3；UI_HIDE_CANDIDATE；搜索/category 7 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
16. P3；UI_HIDE_CANDIDATE；搜索/category 7 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
17. P3；UI_HIDE_CANDIDATE；搜索/category 8 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
18. P3；UI_HIDE_CANDIDATE；搜索/category 8 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
19. P3；UI_HIDE_CANDIDATE；搜索/category 9 page 1 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。
20. P3；UI_HIDE_CANDIDATE；搜索/category 9 page 2 used static-snapshot；可见=否；阻塞=否；建议：补充分诊解析规则，并确认该 warning 是否会映射到电视端可见路径。

## 终局承接

- 终局：用户喜欢、0投诉、可商业化收费的 TVBox/FongMi/影视仓 点播 + 直播源。
- 全局：快照 warning 不能再只是一个数字，必须转成可解释、可治理、可复测的投诉风险。
- 局部：本报告区分静态包缺口、标签解析缺口、源标签缺口、不可见按钮候选和物理限制。
- 节点：每条 warning 都保留分类、筛选项、当前遥控器证据和修复建议。
- 末梢：只有当前电视端可见且会导致空结果或错结果的按钮，才升级为 P2/P1 修复；不可见或已由动态兜底修复的保留观察。
