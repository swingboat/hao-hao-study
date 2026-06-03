# Review 闭环决议简报（PRD 必须应用，覆盖 session 原文档冲突）

本文件汇总智能学习助手 Q1-Q10 设计 review 后的所有最终决议。生成 PRD 时所有内容**必须以本简报为准**，原 session 文档与本简报冲突的部分**以本简报为准**。

## A. 已闭环决议

### S1 Mastery 持有者（已闭环 2026-06-01）
- **knowledge_point_mastery 外键改为 `student_id + subject_id`**（不再是 goal_instance_id）
- UNIQUE(student_id, knowledge_point_id)
- GoalInstance **不持有 mastery**；进度运行时派生：`progress = Σ(mastery × weight) / Σ(weight) for kp ∈ kp_scope`
- 衍生 1：专项 GoalInstance practice_attempt 不降权，仅打 `source=specialized` 标签
- 衍生 2：paused 期间 mastery 正常衰减（被 S2-衍生4 取消，最终改为：删全局衰减，仅靠 Layer 3 主动召回）
- 顺带闭环 B1（专项 mastery 归属）

### S2 已学范围 + Layer 3 升级 + 三层生命周期 + mistake_book_entry 生命周期（已闭环 2026-06-02）

**主决议**：方案 A — `student.unlocked_kp_ids[]` 字段化，q7 七池中受约束的 5 个池统一加 `kp_id ∈ unlocked_kp_ids` 过滤。

**衍生**：
- 衍生1=A：knowledge_point_mastery 首次创建（即使 mastery=0 clamp）即触发 Layer 3
- 衍生2=X：同 KP 多池合并出题（避免一天两道同 KP）
- 衍生3=P：每个 (Student, KP) 仅一条 spaced_review
- 衍生4=N：删 q3 §3.4 被动衰减规则，全靠 Layer 3 主动召回

**Layer 3 升级为"间隔复习引擎"（4 类触发器）**：
- 触发器 A：学生答错某 KP 题（非 computational/out_of_scope）→ 创建/重置 idx=0
- 触发器 B：knowledge_point_mastery 首次创建（新学保鲜）→ 创建 idx=0
- 触发器 C：讲述题达标 → idx +1（advance）
- 触发器 D：mastery≥0.85 + 长 idx → 进入 long_term 长间隔保鲜
- 间隔系数 `intervals[idx] = [1, 3, 7, 15, 30, 60]` 天

**三层独立生命周期**：
- Layer 1：KP 主状态机（LOCKED → UNLOCKED_UNSEEN → LEARNING → FAMILIAR → MASTERED）
- Layer 2：mistake_book_entry（per Student × practice_item）
- Layer 3：spaced_review（per Student × KP）

**UI/产品决策**：
- Q1=c：mastery=0 显示"需要加强"；文案区分"从未掌握"vs"曾掌握后回落"
- Q2=b（MVP 起步）→ a（长期）：长间隔难度 MVP 选低半档保稳；长期可 A/B 切到匹配档位 + 答错只回退 1 档
- Q3=a：讲述题消耗 Layer 3 一档 idx

**mistake_book_entry 生命周期决策**：
- D1=A：conceptual 是两阶段（`open_pending_material` → 学完材料 → `open`）
- D2=a：永久 resolve（不 reopen）
- D3=a：长期 open 永远保留（不自动归档）
- D4=b+c：同 KP 多条 open 召回顺序：根因优先级 conceptual > methodological > comprehension > time_pressure，同根因内按 error_count 倒序
- D5=a：一题多 KP 时仅主 KP 入错题本，副 KP 按权重扣 mastery
- N=2 连续：变种连续做对 2 次自动 resolve

### C1 EXAM_POINT vs KP 关系（已闭环 2026-06-02）
- D1=B：EP-KP 关系定为 **1:N**（EP 单值外键 `kp_id`，与 q10 §3.1 对齐）
- D2=a：删除 q3 "两层 mastery" 提法，仅维护 KP 粒度
- D3=a：删除 EXAM_POINT_MASTERY 表（含派生视图也不留）
- 跨 KP 的题目通过 `practice_item.kp_ids[] N:M` 解决
- EP 在 MVP 唯一价值：真题权重统计单元（KP_weight = Σ EPs.weight）
- ER mermaid 中 KP-EP 关系从 `}o--o{` 改为 `||--o{`

### C3 Goal Template 双重定义（已闭环 2026-06-02）
- D1=②：单层 GOAL_TEMPLATE = ExamRequirements 重量级语义（**1 份/考试**），个性化 override 进 GoalInstance
- D2=(b)：mastery_threshold 默认值按 target_score 分档派生（600+→0.90, 500-600→0.85, <500→0.80）
- D3=(a)：recommendation_mix_override MVP 仅运营可改，学生不开放
- GOAL_TEMPLATE **删除 mastery_threshold / recommendation_mix_override**
- GoalInstance **新增字段**：`target_score / mastery_threshold? / recommendation_mix_override? / daily_budget_minutes`
- "Template 可多套并行 按目标分数切" 提法**废弃**
- name 范例从"2026 冲刺 600 分"改为"2027 新课标 I 卷数学考试要求"

## B. 延后决议

### S3 题目下架回滚事务模型（延后到 MVP 之后）
- 已分析 5 种下架原因应分级处理（答案错/题干歧义/解析错/超纲/其他）
- 已设计重放引擎方案（INVALIDATION_JOB + REPLAY_TASK）
- 5 个待决策点 D1-D5
- **MVP 阶段不实现题目下架功能**，待错题率数据出来后再回头定方案

## C. 待澄清问题（PRD 仅列出，不下结论）

### 概念跨越类
- **C2 Item 实体**：q10 practice_item 需 6 态审核 vs q5 拍照上传产生无 kp_ids/difficulty 的"题"直接进 practice_item。是否独立 USER_UPLOADED_ITEM 还是 practice_item.source=user_upload 强制 status=draft？
- **C4 错题根因信号丢失**：Q3 mastery 演化仅区分 computational，conceptual/methodological/comprehension/time_pressure 四类同等扣分。是否按 root_cause 拆系数（comprehension/time_pressure 弱扣或不扣 KP mastery）？

### 边界不清类
- **B2** 临考期 ≤30/≤7 天的触发主语（GOAL_INSTANCE.deadline vs PHASE_STATE.phase=sprint）
- **B3** specialized_drill（Q3 §4.4 次级 5 题）错答是否进错题本+艾宾浩斯，且未列入 Q7 七池
- **B4** OCR 防作弊锁定后 practice_attempt 状态 / session 完成判定 / mastery 影响空白
- **B5** 冷启动期 Q9 抗拒识别可在第 1 周触发误识别会被放大；需累计阈值（如 N≥10）或冷启动结束前不启用
- **B6** Q8 "自动软推断章节进度"与"MVP 不能跳章"自相矛盾
- **B7** student.textbook_version_id 字段缺失（入驻要填但 ER 无字段）
- **B8** KP 自身无版本管理，课标改版时旧 GOAL_INSTANCE 的 feynman_verified/mastery 迁移未定义

## D. v0.1 MVP 上下文
- 题库满足最低要求（30-50 个 KP，每 KP 5+ 道题）
- v0.1 不收解答题
- 自家亲友试用（数 - 数十人）
- Web 网页
- 不考虑人力约束
- 核心价值：用 AI 辅助学生学习达到理想目标（**AI native** 优先）
- UI 符合现代大众学生审美

## E. 关键数值参数（review 中明确的）
- mastery 增量：基础题 ±0.05/-0.15，中等 +0.10/-0.08，难 +0.15/-0.03
- 讲述达标加成：+0.18
- mastery 阈值 4 档：[0,0.2)未开始 / [0.2,0.5)学习中 / [0.5,0.85)熟悉 / [0.85,1]已掌握
- 艾宾浩斯间隔：1/3/7/15/30/60 天
- 临考期 ≤30 天：间隔 × 0.5 → 1/2/4/8/15 天
- 错题 resolve 阈值：N=2 连续变种做对
- 讲述题触发：mastery∈[0.6, 0.85] + 距上次讲述≥7天 + 未 feynman_verified
- session 时长：25 分钟番茄钟，硬截止
- 单 session 题量：8-15 道
