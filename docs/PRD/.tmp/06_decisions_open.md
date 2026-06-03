# §8 决策记录（Audit Trail）+ §9 待澄清问题

---

## §8 决策记录

### §8.1 已闭环决议

---

#### §8.1.1 决议 S1 — Mastery 持有者改为 (Student × KP × Subject) [✅ 闭环]

| 字段 | 内容 |
|------|------|
| 闭环日期 | 2026-06-01 |
| 原冲突 | 旧设计将 `knowledge_point_mastery` 绑定到 `goal_instance_id`，导致同一学生学同一 KP 时多个 GoalInstance 各自持有独立 mastery，互不相认，数据重复且语义混乱 |

**决议要点：**

- **外键变更**：`knowledge_point_mastery` 主键改为 `(student_id, knowledge_point_id)`，移除 `goal_instance_id` 外键
- **唯一约束**：`UNIQUE(student_id, knowledge_point_id)`，每个学生对每个 KP 仅一条 mastery 记录
- **进度派生**：GoalInstance 不持有 mastery 字段；进度在运行时派生：
  ```
  progress = Σ(mastery × weight) / Σ(weight)   for kp ∈ goal_instance.kp_scope
  ```
- **衍生 1 — 专项不降权**：专项 GoalInstance 产生的 practice_attempt 不降权，仅打 `source=specialized` 标签，与普通 practice_attempt 同等参与 mastery 演化
- **衍生 2 — 删除全局衰减**：paused 期间 mastery 不再被动衰减（原设计中的 §3.4 被动衰减规则删除）；mastery 维持全靠 Layer 3 间隔复习主动召回（详见 §8.1.2）

**改动文件位置：**

- ER 图：删除 `knowledge_point_mastery.goal_instance_id`，更新 PK/FK 定义
- `§4 数据模型` knowledge_point_mastery 表结构
- `§5 算法` 进度计算公式由"字段读取"改为"运行时派生"
- `§3.4` 删除被动衰减规则段落

**顺带闭环 B1**：见 §8.1.5。

---

#### §8.1.2 决议 S2 — 已学范围 + Layer 3 升级 + 三层生命周期 + mistake_book_entry 生命周期 [✅ 闭环]

| 字段 | 内容 |
|------|------|
| 闭环日期 | 2026-06-02 |
| 原冲突 | "已学范围"概念未字段化；Layer 3 仅是简单的艾宾浩斯定时器；三层（KP 状态/mistake_book_entry/spaced_review）生命周期彼此耦合；mistake_book_entry resolve 规则分散不一致 |

**主决议 — 已学范围字段化（方案 A）：**

- `student.unlocked_kp_ids[]` 字段，显式记录学生已解锁的 KP 集合
- Q7 七池中受约束的 5 个池统一在查询层加过滤条件：`kp_id ∈ student.unlocked_kp_ids`

**4 个衍生决议：**

| 编号 | 结论 | 说明 |
|------|------|------|
| 衍生 1=A | knowledge_point_mastery 首次创建即触发 Layer 3 | 触发器 B（新学保鲜），即使此时 mastery=0 也立即注册间隔复习 |
| 衍生 2=X | 同 KP 多池合并去重 | 同一天同一 KP 不从多个池各出一题，合并后只取一题 |
| 衍生 3=P | 每个 (Student, KP) 仅一条 spaced_review | 避免同 KP 多条调度记录冲突 |
| 衍生 4=N | 删除被动衰减规则 | 与 S1-衍生2 联动，q3 §3.4 被动衰减段落整体删除 |

**Layer 3 升级为"间隔复习引擎"— 4 类触发器：**

| 触发器 | 条件 | 动作 |
|--------|------|------|
| A（答错触发） | 学生答错某 KP 题，且根因非 computational / out_of_scope | 创建或重置 spaced_review，idx=0 |
| B（新学保鲜） | knowledge_point_mastery 首次创建 | 创建 spaced_review，idx=0 |
| C（讲述达标） | 讲述题评分达标 | idx +1（advance 一档） |
| D（长期保鲜） | mastery ≥ 0.85 且已到长间隔档 | 进入 long_term 模式，使用最长间隔保鲜 |

间隔系数：`intervals[idx] = [1, 3, 7, 15, 30, 60]` 天；临考期（≤30 天）× 0.5 → `[1, 2, 4, 8, 15]` 天。

**三层独立生命周期：**

| 层 | 实体 | 粒度 | 职责 |
|----|------|------|------|
| Layer 1 | KP 状态机 | Student × KP | LOCKED → UNLOCKED_UNSEEN → LEARNING → FAMILIAR → MASTERED |
| Layer 2 | mistake_book_entry | Student × practice_item | 单题错误追踪，独立于 KP 状态 |
| Layer 3 | spaced_review | Student × KP | 间隔复习调度，独立于 KP 状态机 |

**UI/产品决策（Q1-Q3）：**

| 问题 | 结论 |
|------|------|
| Q1 mastery=0 文案 | 显示"需要加强"；区分"从未掌握"vs"曾掌握后回落"两种文案 |
| Q2 长间隔难度（MVP vs 长期） | MVP=b：低半档保稳；长期=a：匹配当前 mastery 档位，答错仅回退 1 档 |
| Q3 讲述题与 Layer 3 关系 | 讲述题通过触发器 C 消耗 Layer 3 一档 idx（advance） |

**mistake_book_entry 生命周期决策（D1-D5 + N）：**

| 决策点 | 结论 | 说明 |
|--------|------|------|
| D1 conceptual 流程 | 两阶段：`open_pending_material` → 学完材料 → `open` | conceptual 错题先推学习材料，完成后才进入可复习池 |
| D2 resolve 是否可 reopen | 永久 resolve（不 reopen） | 同一题下次答错开新条 |
| D3 长期 open 归档 | 永远保留，不自动归档 | 由学生或运营手动清理 |
| D4 同 KP 多条 open 召回顺序 | 根因优先级：conceptual > methodological > comprehension > time_pressure；同根因内按 error_count 倒序 | |
| D5 一题多 KP 入错题本 | 仅主 KP 入错题本；副 KP 按权重扣 mastery | `practice_item.primary_kp_id` 决定归属 |
| N | N=2 连续变种做对自动 resolve | "变种"指同 KP 不同题号 |

---

#### §8.1.3 决议 C1 — EXAM_POINT vs KP 关系定为 1:N [✅ 闭环]

| 字段 | 内容 |
|------|------|
| 闭环日期 | 2026-06-02 |
| 原冲突 | 旧设计中 EP 与 KP 为 M:N（含 EXAM_POINT_MASTERY 派生表），与 q10 §3.1 的 1:N 描述矛盾，且维护两层 mastery 代价过高 |

**决议要点：**

| 决策点 | 结论 |
|--------|------|
| D1 EP-KP 关系 | 1:N；EP 持有单值外键 `kp_id` |
| D2 两层 mastery | 删除"两层 mastery"提法，仅维护 KP 粒度 mastery |
| D3 EXAM_POINT_MASTERY 表 | 删除，含派生视图一并移除 |
| 跨 KP 题目 | 通过 `practice_item.kp_ids[]`（N:M）解决，不靠 EP 层 |
| EP 在 MVP 的价值 | 唯一保留理由：真题权重统计单元（`KP_weight = Σ EPs.weight`） |
| ER 符号 | KP-EP 关系从 `}o--o{` 改为 `\|\|--o{` |

---

#### §8.1.4 决议 C3 — Goal Template 单层重量级 + Instance override [✅ 闭环]

| 字段 | 内容 |
|------|------|
| 闭环日期 | 2026-06-02 |
| 原冲突 | GOAL_TEMPLATE 同时承担"考试要求基准"和"个性化参数载体"两种语义，且存在"多套 Template 按目标分数切换"的过度设计 |

**决议要点：**

- **D1=② 单层语义**：GOAL_TEMPLATE = ExamRequirements 重量级语义，**1 份/考试**，名称范例："2027 新课标 I 卷数学考试要求"（废弃"2026 冲刺 600 分"命名）
- **D2=(b) mastery_threshold 派生**：按 `target_score` 分档自动派生，不在 Template 显式存储：
  - target_score ≥ 600 → mastery_threshold = 0.90
  - 500 ≤ target_score < 600 → mastery_threshold = 0.85
  - target_score < 500 → mastery_threshold = 0.80
- **D3=(a) recommendation_mix_override**：MVP 仅运营可改，学生端不开放
- **"多套 Template 并行按分数切换"提法废弃**

**字段变更：**

| 实体 | 操作 | 字段 |
|------|------|------|
| GOAL_TEMPLATE | 删除 | `mastery_threshold`, `recommendation_mix_override` |
| GoalInstance | 新增 | `target_score`, `mastery_threshold?`, `recommendation_mix_override?`, `daily_budget_minutes` |

---

#### §8.1.5 顺带闭环 B1 — 专项 mastery 归属 [✅ 闭环]

| 字段 | 内容 |
|------|------|
| 闭环日期 | 2026-06-01（随 S1 一并闭环） |
| 原冲突 | 专项 GoalInstance 的 practice_attempt 产生的 mastery 变化应归属哪个 GoalInstance 不明确 |

**结论**：因 S1 将 mastery 提升到 Student × KP 粒度，专项 GoalInstance 的 practice_attempt 与普通 practice_attempt 共享同一条 knowledge_point_mastery，归属问题自然消解。practice_attempt 打 `source=specialized` 标签用于日志追溯，不影响 mastery 计算权重。

---

### §8.2 延后决议

---

#### §8.2.1 决议 S3 — 题目下架回滚事务模型 [⏸ 延后]

| 字段 | 内容 |
|------|------|
| 延后日期 | 2026-06-02 |
| 延后原因 | MVP 阶段题库规模小（30-50 个 KP），题目下架场景极少，过早设计回滚引擎会增加不必要复杂度 |

**已完成分析（留存以备后续）：**

5 种下架原因及分级处理思路：

| 原因类型 | 影响 mastery | 影响 mistake_book_entry | 建议处理 |
|---------|-------------|---------------|---------|
| 答案错误 | 回滚相关 practice_attempt | 相关错题 reopen | 重放演算 |
| 题干歧义 | 视严重程度 | 可选 reopen | 人工审核后决定 |
| 解析错误 | 不影响 mastery | 不影响 | 仅更新解析 |
| 超纲题目 | 相关 practice_attempt 作废 | 关闭错题 | 批量作废 |
| 其他 | 不处理历史数据 | 不处理 | 软下架 |

已设计重放引擎方案要点：

- `INVALIDATION_JOB`：批量标记受影响 practice_attempt
- `REPLAY_TASK`：按时间序重放剩余有效 practice_attempt，重新演算 mastery

5 个待决策点（D1-D5）：事务边界 / 并发锁 / 重放性能 / 部分回滚 / 用户通知时机

**MVP 结论：不实现题目下架功能**。待错题率数据积累后（预计 v0.2 后）重新评估方案。

---

## §9 待澄清问题

### §9.1 概念跨越类

---

#### §9.1.1 C2 — Item 实体的"用户上传题"归属 [⏳ 待澄清]

**原冲突描述：**

- q10 practice_item 实体设计为有 6 态审核工作流（`draft → under_review → approved → published → deprecated → archived`），适配运营管控的题库题目
- q5 拍照上传场景产生的"题"无 `kp_ids`、无 `difficulty`，直接塞进 practice_item 会破坏 6 态流程的前置约束

**影响范围：**

- practice_item 表结构与约束
- 出题池查询逻辑（需过滤 `source=user_upload` 的条目）
- 错题本归属（用户上传题能否入 mistake_book_entry）
- 内容安全/审核流程

**候选方案：**

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| (a) 独立 USER_UPLOADED_ITEM 表 | 拍照题单独建表，与 practice_item 完全隔离 | 不污染题库主表，约束清晰 | 复用逻辑需双查询，维护两套 |
| (b) practice_item.source=user_upload 强制 status=draft | 复用 practice_item 表，source 字段区分，draft 状态跳过审核约束 | 结构统一，查询简单 | draft 语义污染（运营草稿 vs 用户上传混在一起） |

**建议优先级：暂搁置**（MVP 不实现拍照上传，问题不触发；v0.2 规划拍照功能时再决策）

---

#### §9.1.2 C4 — 错题根因信号丢失 [⏳ 待澄清]

**原冲突描述：**

当前 mastery 演化规则（Q3）仅将 `root_cause=computational` 作为特例（答错不扣 KP mastery），其余四类根因（`comprehension / methodological / time_pressure / conceptual`）均按同等系数扣分。这意味着：

- `time_pressure`（不是不会，是来不及）和 `comprehension`（审题失误）与真正的概念不懂 `conceptual` 扣分相同
- 信号噪声导致 mastery 被低估，触发不必要的复习任务

**影响范围：**

- mastery 演化公式（`§5 算法`）
- Layer 3 触发器 A 的触发条件（当前排除 computational，是否也排除 time_pressure）
- 复习调度频率（误扣导致 Layer 3 过早触发）

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) 按根因拆系数 | comprehension/time_pressure 扣分系数 × 0.3；methodological × 0.6；conceptual 全扣；computational 不扣 |
| (b) 仅排除 time_pressure | time_pressure 不扣 mastery 且不触发 Layer 3；其余保持现状 |
| (c) 维持现状 | 等实测数据验证 mastery 低估是否显著 |

**建议优先级：P2**（设计上明确系数表，MVP 可先用简化版（c），有数据后按（a）调整）

---

### §9.2 边界不清类

---

#### §9.2.1 B2 — 临考期触发主语 [⏳ 待澄清]

**原冲突描述：**

临考期（≤30 天 / ≤7 天）的判断主语未统一。两种候选：

- `GOAL_INSTANCE.deadline`：基于考试截止日期判断
- `PHASE_STATE.phase = sprint`：基于算法识别的冲刺阶段判断

**影响范围：**

- Layer 3 间隔系数缩短逻辑的触发入口
- 多目标场景（学生同时有数学/英语两个 GoalInstance）时：两个 deadline 不同，冲刺期叠加如何处理
- 推荐算法的 session 组题权重

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) 绑定主目标 deadline | 每个 GoalInstance 独立判断临考期；专项 GoalInstance 不触发主线临考模式 |
| (b) 绑定 PHASE_STATE.phase | 由算法综合所有目标判断，统一进入冲刺期 |

**建议优先级：P1**（影响核心调度逻辑，需在 §5 算法定稿前明确）

---

#### §9.2.2 B3 — specialized_drill 数据归属 [⏳ 待澄清]

**原冲突描述：**

Q3 §4.4 定义了次级专项练习（`specialized_drill`，每次 5 题穿插在主 session 中）。该模式在以下两个规则上存在空白：

1. specialized_drill 中答错的题，是否进入 mistake_book_entry（错题本）？
2. 是否触发 Layer 3（艾宾浩斯间隔复习）？
3. Q7 七池定义未包含 specialized_drill 来源题目

**影响范围：**

- mistake_book_entry 写入逻辑
- spaced_review 触发条件
- 七池定义完整性

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) 与普通题同等对待 | specialized_drill 答错同样进错题本 + 触发 Layer 3 |
| (b) 仅统计，不触发 | specialized_drill 结果仅记录 practice_attempt，不写 mistake_book_entry，不触发 Layer 3 |

**建议优先级：P2**（MVP specialized_drill 量少，影响可控；但需在数据模型中明确 practice_attempt.source 字段的处理分支）

---

#### §9.2.3 B4 — OCR 防作弊锁定后路径 [⏳ 待澄清]

**原冲突描述：**

Q4/Q5 设计了 OCR 拍照防作弊机制，但锁定触发后的后续状态未定义：

- 锁定后当前 practice_attempt 的最终状态（`abandoned` / `invalid` / 保留 `in_progress`）
- 当前 session 的完成判定（锁定 1 题是否终止整个 session）
- 锁定是否影响 mastery 演化（视为答错 / 不计入 / 特殊标记）

**影响范围：**

- practice_attempt 状态机定义
- SESSION 完成判定逻辑
- mastery 演化触发条件
- 用户端体验（是否给申诉入口）

**候选方案：**

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| practice_attempt 状态 | → `invalid`，不计 mastery | → `suspected_cheat`，人工复审 |
| session 判定 | 跳过该题，session 正常完成 | 终止 session |
| mastery 影响 | 不影响 | 视同答错 |

**建议优先级：P1**（影响核心状态机，防作弊上线前必须明确）

---

#### §9.2.4 B5 — 冷启动期抗拒识别误识别 [⏳ 待澄清]

**原冲突描述：**

Q9 抗拒识别算法在第 1 周（冷启动期）即可触发，但此时：

- 样本量少（题型偏好、正确率基线均未稳定）
- 系统尚未适配学生节奏
- 误识别为"抗拒"可能适得其反（提前推材料或换题型，影响信任感）

**影响范围：**

- Q9 抗拒识别触发条件
- Layer 1 KP 状态机的推进速度
- 学生冷启动期体验

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) 累计阈值 | 同题型累计 N≥10 道后才启用抗拒识别 |
| (b) 冷启动结束前禁用 | 前 N 天（如 7 天）内完全不运行 Q9 逻辑 |
| (c) 降低置信度阈值 | 冷启动期识别阈值提高（更保守），减少误触 |

**建议优先级：P2**（MVP 用户少，误识别影响可接受；但应在上线前写入算法说明文档，防止被遗忘）

---

#### §9.2.5 B6 — 章节自动软推断与跳章约束矛盾 [⏳ 待澄清]

**原冲突描述：**

- q8 §3.4 描述"自动软推断章节进度"：系统可根据答题表现自动推断学生实际所在章节
- MVP 设计原则明确"不能跳章"：学生必须按顺序解锁 KP

二者逻辑自相矛盾：若软推断结果指向"学生实际已在第 5 章"，但系统不允许跳章，推断结论无法被应用。

**影响范围：**

- `student.unlocked_kp_ids` 的更新策略
- 章节解锁触发逻辑
- 入驻流程（是否有诊断测试决定起点）

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) 入驻诊断一次性推断 | 仅在入驻时做诊断测试，确定起始章节；之后严格顺序解锁 |
| (b) 保留软推断仅作提示 | 系统推断结果只做 UI 提示（"你可能已掌握 X"），不自动解锁 |
| (c) 放开跳章限制 | 取消"不能跳章"约束，允许软推断直接解锁 |

**建议优先级：P1**（直接影响 `student.unlocked_kp_ids` 写入逻辑与入驻流程设计）

---

#### §9.2.6 B7 — student.textbook_version_id 字段缺失 [⏳ 待澄清]

**原冲突描述：**

入驻流程要求学生填写省份 + 教材版本（如"人教 A 版""北师大版"），但当前 ER 图中 student 表无对应字段，`textbook_version_id` 外键缺失。

**影响范围：**

- student 表结构
- KP 与教材版本的关联（不同版本 KP 范围可能不同）
- 七池出题过滤（需按教材版本过滤 KP）

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) student 新增 textbook_version_id | 外键指向 TEXTBOOK_VERSION 表；出题时 JOIN 过滤 |
| (b) 入驻时写入 GOAL_INSTANCE | 版本信息存在 GoalInstance 层，不在 student 全局 |

**建议优先级：P1**（字段缺失导致入驻流程无法落库，必须在 ER 定稿前补全）

---

#### §9.2.7 B8 — KP 自身无版本管理 [⏳ 待澄清]

**原冲突描述：**

课标（如 2022 年新课标）改版后：

- 旧 KP 可能被拆分、合并或删除
- 已有 `knowledge_point_mastery.feynman_verified = true` 的记录如何处理
- 历史 GOAL_INSTANCE 的 `kp_scope` 指向已变更的 KP 如何迁移

当前数据模型无 KP 版本字段，无迁移策略。

**影响范围：**

- KP 表结构（是否新增 `curriculum_version` / `deprecated_at`）
- 历史 knowledge_point_mastery 数据有效性
- 历史 GOAL_INSTANCE 的 kp_scope 完整性
- 运营迁移工具

**候选方案：**

| 方案 | 描述 |
|------|------|
| (a) KP 软删除 + 新建替代 | 旧 KP 标 `deprecated`，新建新 KP；旧 mastery 不迁移，学生重新学习 |
| (b) KP 版本链 | KP 新增 `superseded_by_id`；mastery 从旧 KP 按比例迁移到新 KP |
| (c) 不处理，运营手动迁移 | MVP 阶段课标不会改，问题不紧迫；留人工处理 |

**建议优先级：P2**（MVP 题库小且课标短期不变；但 KP 表结构应预留 `deprecated_at` 字段，成本低）
