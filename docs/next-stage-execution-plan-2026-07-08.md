# TVBox/FongMi/影视仓 v7.4 下一阶段执行计划（2026-07-08 第二阶段）

## 阶段名称

P3 快照 warning 收敛 + 商业发布前运营闭环阶段

## 上一阶段证据

本阶段承接“免费层商业承载收敛 + 直播直连优先”阶段，当前证据如下：

- Worker 已部署：`tvbox-source-hub-v73`，当前线上版本 ID：`06e3928f-99c3-48dc-a55d-e89202748b9e`。
- 直播默认直连：`https://tv.webhome.eu.org/live.txt` 当前 `channels=95 direct=95 proxied=0`。
- 显式兜底仍保留：`https://tv.webhome.eu.org/live.txt?proxy=1` 仍输出 `/play/...` 代理清单，用于兼容特殊电视端。
- 免费层审计：`audit/free-tier-summary.md`，PASS/WARN/FAIL=`6/0/0`。
- 遥控器全量元素审计：`audit/tv-remote-full-summary.md`，visible=`319`，PASS/WARN/FAIL=`319/0/0`。
- 0投诉商业体验总控：`audit/zero-complaint-summary.md`，P0/P1/P2/P3=`0/0/0/1`，user_love_score=`99/100`，hard gates 全部通过。
- 在线基础验证：`npm run validate:online` 通过，10 个主分类全部非空，核心端点与详情抽样正常。

## 终局承接

终局仍然不是“脚本绿”或“接口通”，而是：

```text
用户喜欢的、0投诉的、可商业化收费的顶级 TVBOX/FongMi/影视仓 点播 + 直播源。
```

上一阶段已经把一个真实商业承载风险从 P2 消除：直播观看不再默认穿透 Worker，避免 1000/10000 用户观看直播时把免费 Worker 请求量打爆。

下一阶段要继续从终局反推：当前硬门槛通过，但 `commercial_ready=false` 仍然成立，因为还有 51 个 snapshot warnings 未分类闭环，且商业发布前还缺少持续运营闭环的稳定证据。

## 全局影响

当前全局态势：

1. 用户入口层：主入口和同构入口可导入，入口名称仍包含直观更新时间编码。
2. 点播体验层：遥控器全量元素审计已经达到 `319/0/0`，当前无 FAIL/WARN。
3. 直播体验层：直播默认 95 条直连，代理比例 0%，显式代理兜底保留。
4. 免费承载层：GitHub public + Actions + Pages + Worker 轻路由仍为完全免费优先方案。
5. 商业门禁层：P0/P1/P2 已清零；剩余 P3 为快照 warning 分类与持续运营闭环，不阻断基础体验但阻断“终局完成”声明。

## 局部任务

### 局部任务 A：快照 warnings 分类入队

目标：

- 把 `dist/snapshot/latest/validation.json` 中 51 个 warnings 从“杂项提示”变成可执行修复队列。

执行：

1. 解析每条 warning 的路径、分类、筛选项、命中量、根因线索。
2. 分类为：
   - `UI_HIDE_CANDIDATE`：当前源能力不足，电视端不应暴露为空按钮。
   - `SOURCE_TAG_GAP`：源缺标签，但内容可用，需要标题/备注推断。
   - `TAG_PARSE_GAP`：源有语义，但解析规则未覆盖。
   - `SNAPSHOT_PACK_GAP`：动态有数据，快照包缺失或过期。
   - `SOURCE_PHYSICAL_LIMIT`：源不可访问、反爬、地区限制或播放失效。
3. 输出 `audit/snapshot-warning-triage-latest.json` 与 `audit/snapshot-warning-triage-summary.md`。

### 局部任务 B：把快照 warning 接入 0投诉总控

目标：

- 不再只显示 `snapshot warnings=51`，而是显示每类 warning 的数量、用户可见程度、是否阻断商业发布。

执行：

1. 修改 `scripts/audit-zero-complaint-v74.mjs`。
2. 总控区分：
   - 已隐藏且不可见 warning：P3 观察。
   - 可见按钮或可见筛选 warning：P2 修复。
   - 影响搜索、详情、播放、入口：P1/P0。
3. 总控输出下一修复队列时使用分类后的根因，而不是笼统 warning。

### 局部任务 C：遥控器审计性能优化

目标：

- 全量遥控器审计应在稳定时间内完成，不能因为详情自愈或播放探测过慢导致 CI/人工审计不可用。

执行：

1. 保留当前 `319/0/0` 审计口径。
2. 增加审计耗时统计：总耗时、分类耗时、筛选耗时、详情耗时、播放耗时。
3. 对详情自愈扩源设置触发条件与缓存，避免所有单源条目都扩源。
4. 如有必要，把“全量语义审计”和“深度播放抽样”拆成两个命令：
   - `audit:remote-full`：遥控器全元素语义。
   - `audit:playback-deep`：深度播放抽样。

### 局部任务 D：商业运营闭环骨架

目标：

- 为未来收费项目准备“用户投诉进入审计种子”的闭环，而不是靠人工记忆。

执行：

1. 新增 `data/user-complaint-seeds-v74.json`。
2. 每条投诉记录字段：App、入口、路径、按钮、搜索词、现象、时间、用户网络、复现状态、根因、修复版本。
3. 审计脚本读取投诉种子，把真实投诉路径强制加入审计。
4. 总控报告展示“阻塞投诉 / 观察投诉 / 已修复投诉”。

## 节点任务

1. 新增 `scripts/triage-snapshot-warnings-v74.mjs`。
2. 新增 `audit/snapshot-warning-triage-latest.json`。
3. 新增 `audit/snapshot-warning-triage-summary.md`。
4. 修改 `scripts/audit-zero-complaint-v74.mjs`，读取 warning triage。
5. 修改 `scripts/audit-tv-remote-full-v73.mjs`，输出耗时分解与慢路径 Top N。
6. 新增 `data/user-complaint-seeds-v74.json`。
7. 修改遥控器审计，把投诉种子纳入 mandatory paths。
8. 跑完整验证并部署/同步 GitHub。

## 末梢验证

下一阶段每一个末梢都必须可证明：

- 每个 snapshot warning 都有分类，不再只是数字。
- 任何用户可见 warning 都有 path_id、请求 URL、根因和修复建议。
- 遥控器审计不只 PASS，还要知道慢在哪里。
- 用户投诉样例能自动进入下一轮审计，不靠人工临时想起。
- 总控的 P0/P1/P2/P3 不再只聚合脚本结果，而能反映真实用户体验风险。

## 风险与免费额度

- 不能为了“0 warning”粗暴删除按钮；必须先判定是否用户可见、是否有源语义、是否可解析。
- 不能为了提升播放有效率在 Worker 内实时代理或逐集探测所有视频；播放深测必须抽样、缓存、离线化。
- 不能把遥控器审计做得过重，导致 GitHub Actions 免费额度或人工执行成本失控。
- 不能把商业投诉闭环做成隐私收集系统；只记录路径、现象、根因，不收集用户隐私。

## 验收命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run check
npm run validate:online
npm run audit:free-tier
npm run audit:remote-full
npm run audit:zero-complaint
node scripts/triage-snapshot-warnings-v74.mjs
```

阶段目标验收：

```text
snapshot_warning_triage_count = 51
unclassified_snapshot_warning = 0
remote_fail = 0
free_tier_fail = 0
P0 = 0
P1 = 0
P2 = 0
commercial_ready 仍需由“真实投诉闭环 + 稳定运行窗口”共同证明
```

## 失败回退

如果下一阶段 triage 后发现某些 warning 实际影响用户可见按钮：

1. 不删除规则。
2. 先把对应按钮动态隐藏为不可见。
3. 保留规则与诊断记录。
4. 补解析或扩源后自动恢复。
5. 重新跑遥控器全量审计与总控。

## 下一阶段入口

下一阶段从这里开始：

```text
先解析 dist/snapshot/latest/validation.json 的 51 个 warnings，生成可执行分类报告。
```

## 防跑偏回执

本阶段已经解决的终局问题：

1. 商业并发风险：直播默认代理 100% → 0%。
2. 真实播放投诉风险：单源失效首线 → 多源扩展且稳定源优先。
3. 审计误报风险：标题历史年份影响“最新”排序 → 改为排序看字段年份。
4. 总控门禁风险：P2 清零，剩余 P3 进入下一阶段。

下一阶段只允许围绕“快照 warning 分类、审计性能、投诉闭环、商业发布稳定窗口”推进，不回到盲目堆源或局部修补。
