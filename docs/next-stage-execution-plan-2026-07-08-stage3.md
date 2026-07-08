# TVBox/FongMi/影视仓 v7.4 下一阶段执行计划（2026-07-08 第三阶段）

## 阶段名称

P3 收敛到可运营闭环：静态快照包自愈 + 投诉种子 + 审计性能 + 准实时运行证明。

## 上一阶段承接证据

上一阶段从“快照 warning 只是 51 个模糊数字”推进到“每条 warning 都有分诊、可见性和修复建议”：

- 新增脚本：`scripts/triage-snapshot-warnings-v74.mjs`
- 新增报告：`audit/snapshot-warning-triage-latest.json`
- 新增摘要：`audit/snapshot-warning-triage-summary.md`
- 接入总控：`scripts/audit-zero-complaint-v74.mjs`
- 新增命令：`npm run triage:snapshot-warnings`
- 本轮验证：
  - `npm run triage:snapshot-warnings`：`total=51`，`unclassified=0`，`current_tv_blocking=0`
  - `npm run audit:zero-complaint`：`P0/P1/P2/P3=0/0/0/1`，`user_love_score=99/100`
  - `npm run check`：`22/22 PASS`
  - `npm run validate:online`：线上入口通过，10 个主分类均非空

当前不是终局完成，只是把 P3 从“看不懂的 warning 数字”变成“可解释的观察队列”。

## 终局反推

终局仍然是：

```text
用户喜欢的、0投诉的、可商业化收费的顶级 TVBOX/FongMi/影视仓 点播 + 直播源。
```

因此第三阶段不能只追求 `P3=0` 的表面数字，而要证明：

1. 当前 P3 不会变成电视端空按钮、搜不到、播不了、重复或更新慢的用户投诉。
2. 如果真实用户投诉出现，能自动进入审计种子，下一轮自动复现、归因、修复、复测。
3. 审计体系本身不会过慢、过重、过贵，仍符合完全免费基础设施目标。
4. 更新链路能提供准实时运行证明，而不是只靠某次手动刷新。

## 全局架构位置

本阶段对应终局全景流程图中的 4 个层：

```text
更新服务层
  ↓
聚合索引层 / 去重排序层
  ↓
遥控器全链路审计
  ↓
0投诉商业体验总控门禁
  ↓
运营闭环
```

本阶段不重画终局图，只围绕既有图把“P3 观察项”推向“可运营闭环”。

## 局部任务 A：SNAPSHOT_PACK_GAP 自愈与复测

### 目标

当前 51 个 warning 中：

```text
SNAPSHOT_PACK_GAP = 26
```

这些不是当前电视端阻塞，但说明静态快照包、验证时点、动态兜底之间存在不一致。商业化后，如果动态兜底失败，这类问题可能变成“按钮突然没数据”。

### 执行

1. 新增或扩展脚本，读取 `audit/snapshot-warning-triage-latest.json`。
2. 对 `SNAPSHOT_PACK_GAP` 逐项执行：
   - 找到对应 `t/key/value/page`
   - 请求线上 `/agg?ac=videolist&t=...&f=...`
   - 对比本地 `dist/snapshot/latest/filter-packs/...`
   - 判断是：
     - 本地快照包缺失
     - 本地快照包为空
     - validation 使用旧结果
     - 线上动态兜底产生了新内容
3. 生成报告：
   - `audit/snapshot-pack-gap-latest.json`
   - `audit/snapshot-pack-gap-summary.md`
4. 如果线上有数据但本地包为空，优先修复 `generate-snapshot.mjs` 的 filter-pack 生成或回填逻辑。

### 验收

```text
snapshot_pack_gap_checked = 26
snapshot_pack_gap_unknown = 0
visible_gap_blocking = 0
```

## 局部任务 B：真实投诉种子闭环

### 目标

未来收费后，投诉不能靠聊天记录记忆，必须变成机器可审计的种子。

### 新增文件

```text
data/user-complaint-seeds-v74.json
```

### 字段

```json
{
  "id": "complaint-20260708-001",
  "status": "OPEN|FIXED|WATCH",
  "priority": "P0|P1|P2|P3",
  "app": "TVBox|FongMi|影视仓|unknown",
  "entry": "https://tv.webhome.eu.org/config.json",
  "path": "影视点播 > 电影 > 年份=2026",
  "button": "年份=2026",
  "search_term": "",
  "symptom": "按钮有但无数据",
  "observed_at": "2026-07-08T00:00:00+08:00",
  "network": "unknown",
  "expected": "返回符合按钮语义的非重复内容",
  "actual": "空列表",
  "root_cause": "",
  "fix_version": "",
  "retest_status": "PENDING"
}
```

### 接入点

1. `audit-tv-remote-full-v73.mjs` 读取投诉种子，把投诉路径加入 mandatory paths。
2. `audit-source-coverage-v73.mjs` 读取搜索类投诉，把搜索词加入 canary。
3. `audit-zero-complaint-v74.mjs` 展示：
   - 阻塞投诉
   - 观察投诉
   - 已修复投诉

### 验收

```text
complaint_seed_file_exists = true
complaint_seed_schema_ok = true
open_complaint_paths_join_remote_audit = true
fixed_complaints_have_retest_evidence = true
```

## 局部任务 C：遥控器审计性能与深度播放拆分

### 目标

当前遥控器审计质量较高，但商业化后要频繁跑，必须知道慢在哪里，不能让审计本身吞掉免费额度。

### 执行

1. 在 `audit-tv-remote-full-v73.mjs` 增加耗时统计：
   - config
   - live
   - ops
   - category
   - single_filter
   - combo_filter
   - search
   - detail
   - playback
2. 输出慢路径 Top 20：
   - `path_id`
   - `duration_ms`
   - `request_url`
   - `result`
3. 如播放探测过重，新增：
   - `audit:remote-full`：保留语义和轻播放抽样
   - `audit:playback-deep`：独立深度播放抽样

### 验收

```text
remote_audit_duration_breakdown_exists = true
slow_path_top_n_exists = true
remote_full_does_not_proxy_media = true
github_actions_runtime_under_free_budget = true
```

## 局部任务 D：准实时更新运行证明

### 目标

用户关心“新剧更新后电视端能无感看到”。免费方案接受小时间差，但必须可证明。

### 执行

1. 在 `status.json` 或审计报告中区分：
   - `sourceDiscoveryAt`
   - `hotRefreshAt`
   - `coverageAuditAt`
   - `snapshotGeneratedAt`
   - `publishedAt`
   - `visibleUpdateText`
2. 新增热点更新 canary：
   - 最近热播剧
   - 最近院线电影
   - 最近短剧
   - 最近动漫
3. 每轮热点刷新后验证：
   - 分类页是否出现
   - 搜索是否出现
   - 详情集数是否更新
   - 播放线路是否有效
4. 如果动态搜索发现新内容但静态快照未包含，归因：
   - `SNAPSHOT_STALE`
   - 下一轮热点刷新优先补入

### 验收

```text
hot_refresh_audit_exists = true
latest_episode_canary_exists = true
snapshot_stale_cases_have_next_refresh_plan = true
visible_update_code_only_updates_after_valid_publish = true
```

## 节点任务清单

1. 新增 `scripts/audit-snapshot-pack-gaps-v74.mjs`
2. 新增 `audit/snapshot-pack-gap-latest.json`
3. 新增 `audit/snapshot-pack-gap-summary.md`
4. 新增 `data/user-complaint-seeds-v74.json`
5. 修改 `scripts/audit-tv-remote-full-v73.mjs`，接入投诉种子与耗时统计
6. 修改 `scripts/audit-zero-complaint-v74.mjs`，展示投诉种子状态
7. 评估是否新增 `scripts/audit-playback-deep-v74.mjs`
8. 评估是否新增 `scripts/audit-hot-refresh-v74.mjs`
9. 更新 `package.json` scripts
10. 运行完整验证

## 末梢验证矩阵

每个末梢必须回答：

| 末梢 | 正确标准 |
|---|---|
| 快照 warning | 有根因、有可见性、有修复建议，不再是裸数字 |
| 可见筛选按钮 | 当前电视端不空、不错、不重复 |
| 不可见候选按钮 | 规则保留，但不暴露空壳给用户 |
| 投诉种子 | 能进入遥控器或覆盖审计，不靠人工记忆 |
| 搜索投诉 | 标题、别名、主演、年份至少一种路径可复现 |
| 更新投诉 | 能区分源未更新、快照未同步、搜索未召回、详情未刷新 |
| 审计性能 | 有耗时分解，慢路径可定位 |
| 免费承载 | 不代理大规模视频流，不把审计做成高成本任务 |

## 验收命令

```powershell
cd C:\Users\Ten\Documents\Codex\tvbox-source-hub-v73
npm run triage:snapshot-warnings
npm run audit:zero-complaint
npm run validate:online
npm run check
```

第三阶段新增后再补充：

```powershell
npm run audit:snapshot-pack-gaps
npm run audit:remote-full
npm run audit:free-tier
npm run audit:hot-refresh
```

## 失败回退

- 如果发现 `SNAPSHOT_PACK_GAP` 实际会导致用户可见空按钮，立即升级 P2，不再作为 P3 观察项。
- 如果投诉种子接入导致审计误报，先修路径解析，不删除投诉。
- 如果深度播放探测太慢，拆出独立命令，不降低遥控器语义审计标准。
- 如果准实时更新超过免费额度，优先调度热点索引和缓存，不购买主机、不代理视频流。

## 下一阶段完成口径

第三阶段完成时，不能只说“脚本通过”，必须证明：

```text
P0/P1/P2 = 0
P3 有分组、有责任、有下一动作
真实投诉可进入自动审计
静态快照和动态兜底差异可解释
审计运行成本可控
准实时更新状态可被 status/审计证明
```
