# §10 v0.1 MVP 范围与启动条件

## §10.1 上下文

v0.1 定位为**自家亲友内测**，人数规模数人至数十人，重点验证核心学习闭环。

| 维度 | v0.1 定位 |
|---|---|
| 用户规模 | 自家亲友（数 - 数十人） |
| 平台 | Web 网页（移动友好） |
| 产品策略 | AI native 优先，AI 辅助解析、推荐、掌握度计算 |
| 题型约束 | **不收解答题**（Q2=a），仅选择题 + 填空题 |
| 题库规模 | 30-50 个 KP，每 KP 至少 5 道题 |
| UI 风格 | 现代审美，符合大众学生审美 |

---

## §10.2 必做模块（核心闭环）

> 以下 9 个模块共同构成 v0.1 最小可用产品。缺少任何一个将无法形成完整的"学 → 练 → 评 → 推荐"闭环。

| 模块 | 必做内容 | 简化版（vs 完整设计） |
|---|---|---|
| 题库 | KP 标注 + 难度 1-5 档 + 答案 + 解析 | 不做 EP/真题分析/灰度池/6 态状态机 |
| 学生入驻 | 姓名 + 年级 + 目标考试 + 监护人同意 | 不做章节进度自动同步 / 超前解锁（⏸ B6） |
| Session | 25 min 番茄钟 + 8-15 题 + 一次提交 + 解析 | 不做次级训练 / 讲述题 / 综合题 |
| 判对错 | 选择填空自动判对错 | 不收解答题（决议 Q2=a） |
| Mastery | (Student × KP) 单值 0-1 + 4 档展示 | 决议 S1 简化版；不做 GoalInstance 持有进度 |
| 推荐器 | **3 个池**：错题重做池 + 新题池 + Layer 3 复习池 | 不做 7 池完整版；3 池均加 `kp_id ∈ unlocked_kp_ids` 过滤（决议 S2-A） |
| 错题本 | 错题列表 + 重做入口 + 连续 2 次对即 resolve | 不分根因类型 / 不做变种召回 / 不做两阶段 conceptual open |
| 数据合规 | 监护人同意记录 + 不用于训练 AI + 支持删除/导出 | 合规必做，不可砍 |
| UI | 现代审美 + 移动友好 + mastery 4 档可视化 | 简洁实现，不做复杂动效 |

### Mastery 4 档展示（决议 Q1=c）

| mastery 分值 | 展示文案 |
|---|---|
| [0, 0.2) | 未开始 |
| [0.2, 0.5) | 需要加强 |
| [0.5, 0.85) | 学习中 / 熟悉 |
| [0.85, 1] | 已掌握 |

> 文案区分"从未掌握"与"曾掌握后回落"两种语境（决议 Q1=c）。

### Mastery 增减规则（v0.1 保留）

| 难度 | 答对 | 答错 |
|---|---|---|
| 基础（1-2） | +0.05 | −0.15 |
| 中等（3） | +0.10 | −0.08 |
| 难（4-5） | +0.15 | −0.03 |

---

## §10.3 砍掉的模块（v1.5+ 再做）

以下功能**不进入 v0.1**，列出以便后续版本规划参考：

- 讲述题（Feynman 题型）/ 综合题
- 拍照上传 / OCR
- 题目下架回滚事务模型（⏸ S3）
- 灰度池 / 6 态题目状态机
- 临考期切换（间隔 × 0.5 压缩逻辑）（⏸ B2）
- 画像抗拒识别（⏸ B5）
- 专项训练目标（specialized_drill）
- 阶段化配比（sprint / consolidation / exploration 相位切换）
- 章节进度自动同步 / 超前解锁（⏸ B6）
- 考点权重统计（EXAM_POINT 完整权重体系）（决议 C1）
- 课标条目映射（TEXTBOOK_VERSION / CHAPTER 多对多）
- mistake_book_entry 根因两阶段流转（D1=A，延后）
- Layer 3 讲述题触发器 C（触发器 A/B 保留，C 随讲述题一起延后）
- Goal Template 完整版（C3-D1 决议中 mastery_threshold 分档派生逻辑）

---

## §10.4 v0.1 简化版数据模型（10 张表）

> 完整数据模型见 §3（ER 图）与 q10_ops_entities_and_workflow.md。此处仅列 v0.1 最小实现所需字段。

### 表 1：student

```
student
  id                   uuid PK
  name                 text
  grade                text            -- 高一/高二/高三
  target_exam          text            -- 如 "高考数学 2027"
  parent_consent_at    timestamptz     -- 监护人同意时间（合规必填）
  cold_start_mode      boolean         -- 冷启动期标记
  unlocked_kp_ids      uuid[]          -- 已解锁 KP 集合（决议 S2-A）
  created_at           timestamptz
```

### 表 2：subject

```
subject
  id    text PK    -- 如 "math"
  name  text       -- 如 "高中数学"
```

### 表 3：knowledge_point

```
knowledge_point
  id          uuid PK
  name        text
  subject_id  text FK → subject.id
  chapter_no  text    -- 简化版章节号，不做完整 CHAPTER 实体
```

### 表 4：practice_item

```
practice_item
  id          uuid PK
  content     text
  answer      text
  solution_text text
  kp_ids      uuid[]    -- 支持一题多 KP（N:M，决议 C1）
  difficulty  int       -- 1-5
  item_type   text      -- "choice" | "fill_in"（v0.1 不收 "essay"）
```

### 表 5：learning_session

```
learning_session
  id          uuid PK
  student_id  uuid FK → student.id
  started_at  timestamptz
  ended_at    timestamptz
  status      text    -- "in_progress" | "completed" | "abandoned"
  item_ids    uuid[]  -- 本次 session 分配的题目列表
```

### 表 6：practice_attempt

```
practice_attempt
  id              uuid PK
  session_id      uuid FK → learning_session.id
  student_id      uuid FK → student.id
  item_id         uuid FK → practice_item.id
  student_answer  text
  is_correct      boolean
  answered_at     timestamptz
```

### 表 7：knowledge_point_mastery

> 决议 S1 简化版：持有者为 (student_id, knowledge_point_id)，UNIQUE 约束。

```
knowledge_point_mastery
  student_id       uuid FK → student.id
  subject_id       text FK → subject.id
  kp_id            uuid FK → knowledge_point.id
  mastery_score    float    -- [0, 1]，clamp 到边界
  last_attempted_at timestamptz
  PRIMARY KEY (student_id, kp_id)
```

### 表 8：mistake_book_entry

> v0.1 简化版：不分根因类型，仅记录 open/resolved 状态。

```
mistake_book_entry
  id           uuid PK
  student_id   uuid FK → student.id
  item_id      uuid FK → practice_item.id
  status       text    -- "open" | "resolved"
  error_count  int     -- 累计答错次数
  created_at   timestamptz
  resolved_at  timestamptz
  UNIQUE (student_id, item_id)
```

### 表 9：spaced_review

> 决议 S2 简化版：每个 (Student, KP) 仅一条记录（决议 S2-衍生3）。

```
spaced_review
  student_id    uuid FK → student.id
  kp_id         uuid FK → knowledge_point.id
  next_review_at timestamptz
  idx           int     -- 艾宾浩斯间隔索引，intervals=[1,3,7,15,30,60] 天
  PRIMARY KEY (student_id, kp_id)
```

### 表 10：audit_log

> 合规必备，记录用户数据操作（删除/导出/同意撤回）。

```
audit_log
  id          uuid PK
  actor_id    uuid
  action      text    -- "delete_student" | "export_data" | "consent_withdraw" 等
  target_type text
  target_id   uuid
  payload     jsonb
  created_at  timestamptz
```

---

## §10.5 启动确认事项

在 v0.1 开发启动前，需就以下事项达成确认：

| 类别 | 确认项 | 状态 |
|---|---|---|
| 题库 | 实际覆盖 KP 范围已定（30-50 个 KP） | 待确认 |
| 题库 | KP 表结构已定稿，可导入 | 待确认 |
| 题库 | 难度至少 3 档以上，选择+填空占比 ≥ 70% | 待确认 |
| 部署 | Web 部署平台（建议 Vercel / Cloudflare Pages） | 待确认 |
| 后端 | 后端框架选型 | 待确认 |
| 数据库 | 建议 PostgreSQL + Redis（Redis 用于 Session 状态缓存） | 待确认 |
| AI 服务 | LLM 服务选型（建议 Claude API） | 待确认 |
| 合规 | 监护人同意页面文案与法律审阅 | 待确认 |

---

## §10.6 v0.1 → v1.0 迭代节奏建议

```
v0.1  (~2-3 个月)
      核心闭环 + 自家亲友内测
      [3 池推荐 + 选填自判 + Mastery 单值 + 错题本简版]

v0.2  (+1 个月)
      错题本根因分流（conceptual/methodological/comprehension/time_pressure）
      Layer 3 完整版（触发器 A/B/D + long_term 长间隔）
      mistake_book_entry 两阶段 conceptual 流转（D1=A）

v0.5  (+2 个月)
      讲述题（Feynman 题型）+ Layer 3 触发器 C
      Goal Template 完整版（mastery_threshold 按 target_score 分档）
      EP 体系（EXAM_POINT + 权重统计）

v1.0  (+3 个月)
      开放注册
      综合题 / 解答题
      临考期模式（间隔压缩）
      画像抗拒识别
      章节进度自动同步
      运营后台完整版（7 模块）
```

---

# §11 附录

## §11.1 术语表

| 术语 | 定义 |
|---|---|
| **mastery** | 学生对某知识点的掌握度，0-1 浮点数，按 4 档展示：未开始 / 需要加强 / 熟悉 / 已掌握 |
| **KP（Knowledge Point）** | 知识点，是 mastery 追踪的最小单元，对应 knowledge_point 表 |
| **EP（Exam Point / 考点）** | 知识点在特定场景/能力下的应用考查单元，v0.1 不做，v0.5+ 用于真题权重统计 |
| **Goal Template** | 考试要求模板，语义为"这场考试对各 KP 的掌握要求"，每场考试 1 份（决议 C3-D1=②） |
| **Goal Instance** | 学生选择目标后由 Goal Template 创建的个人实例，持有 `target_score / daily_budget_minutes` 等个性化字段 |
| **Layer 1** | KP 状态机层，维护 KP 的 LOCKED → UNLOCKED_UNSEEN → LEARNING → FAMILIAR → MASTERED 生命周期 |
| **Layer 2** | 错题追踪层，维护 mistake_book_entry（per Student × practice_item），记录错误历史与 resolve 状态 |
| **Layer 3** | 间隔复习引擎层，维护 spaced_review（per Student × KP），基于艾宾浩斯曲线安排复习时机 |
| **艾宾浩斯间隔** | Layer 3 使用的遗忘曲线间隔系数，默认 `[1, 3, 7, 15, 30, 60]` 天；v0.5+ 临考期压缩为 `[1, 2, 4, 8, 15]` 天 |
| **间隔复习** | Layer 3 的核心策略：根据 idx 和 next_review_at 主动召回需复习的 KP，替代被动 mastery 衰减（决议 S2-衍生4） |
| **讲述题（Feynman）** | 要求学生用自己语言解释知识点的主观题型，触发 Layer 3 idx +1，v0.5+ 实现 |
| **unlocked_kp_ids** | student 表字段，记录学生已解锁（可出题）的 KP 集合；推荐器 3 个池均须过滤此字段（决议 S2-A） |
| **cold_start_mode** | student 表布尔字段，标记学生是否处于冷启动期（首次使用，历史数据为空），影响初始 KP 解锁策略 |
| **Session（学习单元）** | 25 分钟番茄钟为一个 Session，分配 8-15 道题，一次性提交，结束后统一展示解析 |
| **错题本** | 基于 mistake_book_entry 的错题列表，支持重做入口；连续 2 次做对同题自动 resolve（决议 N=2） |
| **根因分类** | 错题归因类型：conceptual（概念理解）/ methodological（方法论）/ comprehension（题意理解）/ time_pressure（时间压力）；v0.1 不分根因 |
| **mastery_threshold** | GoalInstance 字段，某 KP 被判为"达标"所需的 mastery 最低值；按 target_score 分档默认：600+→0.90, 500-600→0.85, <500→0.80（决议 C3-D2） |
| **practice_item.kp_ids[]** | 题目可关联多个 KP（N:M），答错时主 KP 入错题本，副 KP 按权重扣 mastery（决议 D5=a） |

---

## §11.2 编号映射（PRD ← session 旧文档）

| PRD 章节 | 来源文档 | 备注 |
|---|---|---|
| §3 ER 图 | entity_relationship_design.md §1-§5 | C1 决议：删除 EXAM_POINT_MASTERY 表；S1 决议：knowledge_point_mastery 外键改为 student_id+subject_id |
| §4 三层模型 | q3 §3 + q5 §2 + q7 §3.2 + review 新增 | S2 决议：Layer 3 升级为间隔复习引擎，删 q3 §3.4 被动衰减 |
| §5 Mastery 演化 | q3 §3 | S1 决议：GoalInstance 不持有 mastery，进度运行时派生 |
| §6 推荐器 | q7 | S2 决议：unlocked_kp_ids 过滤；v0.1 简化为 3 池 |
| §7.1 学生入驻 | q8 | B6 ⏸：章节进度自动同步延后 |
| §7.2-7.4 Session / 答题 / 错题 | q3 + q5 | Q2=a：v0.1 不收解答题 |
| §8 决策记录 | memory/smart-learning-assistant-open-issues.md | S1/S2/C1/C3 已闭环；S3/C2/C4/B2-B8 待澄清 |
| §10 MVP | Claude 对话 2026-06-02 | 本文件首次制定 |

---

## §11.3 改动历史

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-02 | 基于 session1 + session2 产出 + Q1-Q10 review 闭环（S1/S2/C1/C3）整合首版；新增 §10 MVP 范围与 §11 附录 |
