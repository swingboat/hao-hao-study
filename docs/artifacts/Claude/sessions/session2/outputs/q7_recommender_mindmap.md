# 出题引擎思维导图

> 把 Q3 / Q5 / Q6 / Q7 攒下来的所有决策装配成一个完整的"出题流水线"。一图看清：有几个池、每个池怎么读、每个池怎么产生。

## 1. 顶层结构（俯瞰）

```mermaid
mindmap
  root((出题引擎))
    输入信号层
      Mastery 向量
      错题本状态
      艾宾浩斯到期队列
      目标实例
      最近表现
      讲述题历史
      画像偏好
      今日时长
    池层 7 个池
      艾宾浩斯到期池
      错题本变种池
      新知识点池
      讲述题池
      综合题池 v1.5
      挑战题池
      灰度试用池
    配比与装配层
      表达式引擎
      阶段化配比
      Session 装配
    输出层
      最终题目列表
      展示顺序
      兜底策略
```

## 2. 输入信号层（推荐前要读什么）

```mermaid
flowchart LR
    S[学生触发 Start Session] --> R[Recommender 读取信号]

    R --> M[Mastery 向量<br/>200-400 维 0-1]
    R --> E[错题本 ERROR_LOG<br/>status=open]
    R --> EB[艾宾浩斯到期队列<br/>next_review_at <= today]
    R --> G[Goal Instance<br/>距高考天数 进度章节]
    R --> H[最近 N 次 session<br/>正确率 用时 根因分布]
    R --> F[讲述题历史<br/>feynman_verified KP 集合]
    R --> P[画像偏好<br/>抗拒题型 偏好难度]
    R --> T[今日时长设置<br/>默认 25 分钟]
```

**信号到决策的对应关系**：

| 信号 | 影响哪个池 / 决策 |
|---|---|
| Mastery 向量 | 决定推什么难度 / 哪些知识点已掌握不再推 / 综合题触发 |
| 错题本 | 错题本变种池的输入 |
| 艾宾浩斯队列 | 艾宾浩斯到期池的输入 |
| Goal Instance | 决定新知识点池推哪个章节 / 是否进入临考模式 |
| 最近表现 | 调节难度（连续失败降难度）+ 触发疲劳保护 |
| 讲述题历史 | 讲述题池触发条件 |
| 画像偏好 | 在召回内做二次筛选（如学生抗拒拍照题，降权） |
| 今日时长 | 决定总题量（25min ≈ 10-15 道，15min ≈ 6-8 道） |

## 3. 池层详细展开（7 个池）

### 3.1 池总览表

| # | 池名 | 内部 ID | 优先级 | 触发条件 | MVP 是否做 |
|---|---|---|---|---|---|
| 1 | 艾宾浩斯到期池 | `ebbinghaus_due` | 最高 | 总有 | 是 |
| 2 | 错题本变种池 | `error_book_variant` | 高 | open 错题 > 0 | 是 |
| 3 | 新知识点池 | `new_knowledge` | 中 | 还有未覆盖知识点 | 是 |
| 4 | 讲述题池 | `feynman` | 中（按触发条件） | 见 3.4 | 是 |
| 5 | 综合题池 | `comprehensive` | 中-低 | mastery 阈值 + 临考期 | **否（v1.5）** |
| 6 | 挑战题池 | `challenge` | 选用 | 学生提前做完 | 是 |
| 7 | 灰度试用池 | `gray_pool` | 横向叠加 | 新改写题 7 天观察期 | 是 |

---

### 3.2 池 1：艾宾浩斯到期池 `ebbinghaus_due`

```mermaid
flowchart TB
    subgraph 产生["如何产生（写入）"]
        A1[学生做错一道题] --> A2[ERROR_LOG 写入]
        A2 --> A3[计算 next_review_at<br/>= today + 1 day]
        A3 --> A4[写入 review_queue<br/>kp_id, due_at, interval_idx]
        B1[学生完成一次复习] --> B2{复习结果}
        B2 -->|做对| B3[interval_idx +1<br/>1→3→7→15→30 天]
        B2 -->|做错| B4[interval_idx 回退<br/>退到上一档或重置]
        B3 --> B5[更新 next_review_at]
        B4 --> B5
        B5 --> A4
        T1[临考期检测] --> T2{距高考 ≤ 30 天}
        T2 -->|是| T3[间隔 × 0.5<br/>变成 1/2/4/8/15 天]
        T2 -->|≤ 7 天| T4[只复习 mastered 题<br/>不推新知识点]
    end

    subgraph 读取["如何读取（召回）"]
        R1[Session 启动] --> R2[查 review_queue<br/>where due_at <= today]
        R2 --> R3[按知识点级调度去重<br/>一个 KP 取最久未复习的 1-2 道]
        R3 --> R4[排序<br/>1. 最久未复习<br/>2. 错次最多]
        R4 --> R5[采样上限<br/>占 session 配比的 N%]
        R5 --> R6[转化为变种题<br/>调用题库召回器]
    end
```

**关键规则**：

- **粒度**：知识点级调度（一个 KP 一个时间表），避免学生被同 KP 多道错题轰炸
- **错过处理**：
  - 错过 1 天：复习题顺延到次日，曲线不重置
  - 错过 ≥ 3 天：mastery 按曲线衰减，下次复习题难度降一档
  - 错过 ≥ 7 天：该 KP 状态降级（已掌握 → 熟悉），重进活跃复习池
- **临考压缩**：距高考 ≤ 30 天间隔 × 0.5；≤ 7 天只复习 mastered 题

---

### 3.3 池 2：错题本变种池 `error_book_variant`

```mermaid
flowchart TB
    subgraph 产生["如何产生（写入）"]
        E1[学生做错一道题] --> E2[AI 推断根因]
        E2 --> E3{root_cause}
        E3 -->|conceptual 概念错| EP1[标记<br/>需推前置题 + KP 学习材料]
        E3 -->|methodological 方法错| EP2[标记<br/>需推同 KP 变种题]
        E3 -->|comprehension 审题错| EP3[标记<br/>需推审题训练题]
        E3 -->|computational 计算粗心| EP4[不进错题本<br/>仅计数]
        E3 -->|time_pressure| EP5[标记<br/>需推限时模式重做]
        E3 -->|out_of_scope| EP6[暂不重做<br/>标记 archived]
        EP1 --> EW[ERROR_LOG 写入<br/>status=open]
        EP2 --> EW
        EP3 --> EW
        EP5 --> EW
    end

    subgraph 读取["如何读取（召回）"]
        RR1[Session 启动] --> RR2[查 ERROR_LOG<br/>where status=open]
        RR2 --> RR3[按根因分流]
        RR3 -->|conceptual| RC1[召回 KP 基础题 + 前置题]
        RR3 -->|methodological| RC2[召回同 scenario_tag 变种题]
        RR3 -->|comprehension| RC3[召回同题型审题专项题]
        RR3 -->|time_pressure| RC4[原题 + 限时标记]
        RC1 --> RX[去重<br/>避免与 ebbinghaus_due 重叠]
        RC2 --> RX
        RC3 --> RX
        RC4 --> RX
        RX --> RY[排序<br/>error_count DESC<br/>first_error_at ASC]
        RY --> RZ[采样上限<br/>占 session 配比的 N%]
    end

    subgraph 清退["如何 resolve"]
        D1{攻克条件}
        D1 -->|连续 N 道变种题做对| D2[status=resolved]
        D1 -->|讲述题达标| D2
        D1 -->|学生手动标记已掌握| D2
        D2 --> D3[resolved_at 写入]
    end
```

**关键规则**：

- 6 类根因按 Q5 决议，不同根因走不同召回链路
- `computational` 错误不进错题本，避免污染推荐
- 变种题不是原题重做（防背答案），是同 `scenario_tag` 的同类题

---

### 3.4 池 3：新知识点池 `new_knowledge`

```mermaid
flowchart TB
    subgraph 产生["如何产生（写入）"]
        N1[Goal Instance 内的知识点全集] --> N2[剔除 mastery >= 0.85 的 KP]
        N2 --> N3[剔除前置 KP 未达标的<br/>prereq_kp_ids mastery < 0.3 阻塞]
        N3 --> N4[剩下的 = 可学习 KP 池]
        N4 --> N5[按 Goal 章节顺序排序]
    end

    subgraph 读取["如何读取（召回）"]
        K1[Session 启动] --> K2[取可学习 KP 的 Top-K]
        K2 --> K3[每个 KP 召回 2-3 道题<br/>难度按 mastery 自适应]
        K3 --> K4{mastery 区间}
        K4 -->|< 0.2| K4A[难度 1-2 基础题]
        K4 -->|0.2-0.5| K4B[难度 2-3 标准题]
        K4 -->|0.5-0.85| K4C[难度 3-4 进阶 + 变种]
        K4A --> K5[场景覆盖检查<br/>避免同 scenario_tag 重复]
        K4B --> K5
        K4C --> K5
        K5 --> K6[采样上限<br/>占 session 配比的 N%]
    end
```

**关键规则**：

- **前置阻塞**：v1.5 字段 `prereq_kp_ids` 启用后才生效；MVP 简化为按章节顺序推
- **难度自适应**：mastery 越高，推越难的题，逐步把学生推过 0.85 阈值
- **场景覆盖**：同一 KP 内多种 scenario_tag 都要覆盖（如等差数列要覆盖"求通项""求和""综合应用"三种场景）

---

### 3.5 池 4：讲述题池 `feynman`

```mermaid
flowchart TB
    subgraph 触发["触发条件（三同时满足）"]
        F1[该 KP mastery 在 0.6-0.85]
        F2[距上次该 KP 讲述 >= M 天<br/>默认 7 天]
        F3[该 KP 未 feynman_verified]
        F1 --> FY[触发候选]
        F2 --> FY
        F3 --> FY
    end

    subgraph 读取["如何读取"]
        FR1[Session 启动] --> FR2[扫描候选 KP 集合]
        FR2 --> FR3{候选数量}
        FR3 -->|0| FR4[本次 session 不插讲述题]
        FR3 -->|>=1| FR5[选 mastery 最高的 1 个 KP]
        FR5 --> FR6[生成讲述题<br/>题面 请用自己的话讲解 XX]
        FR6 --> FR7[附加 rubric<br/>5-10 个关键点清单]
    end

    subgraph 判定["AI 三档判定"]
        J1[学生提交讲述文字] --> J2[LLM 对照 rubric 评判]
        J2 --> J3{覆盖率}
        J3 -->|<30 字 or 无关| J4[未达标<br/>mastery 不变 建议重讲]
        J3 -->|覆盖一半+| J5[达标<br/>mastery +0.15<br/>feynman_verified=true]
        J3 -->|准确完整| J6[优秀<br/>mastery +0.20<br/>feynman_verified=true]
    end

    subgraph 产生["如何产生（rubric 来源）"]
        P1[新 KP 入库] --> P2[AI 生成关键点草稿<br/>5-10 条]
        P2 --> P3[教研老师审核修订]
        P3 --> P4[写入 KP.feynman_rubric]
        P3 -.->|教研未到位时| PA[AI 草稿直接使用<br/>v1 风险方案]
    end
```

**关键规则**：

- **每 session 最多 1 道讲述题**（避免打扰）
- **学生可拒**：连续跳过 N 次后系统暂停对该学生触发讲述题
- **rubric MVP 兜底**：教研未到位时 AI 草稿直接用，列入风险（与 Q6 校验风险并列）

---

### 3.6 池 5：综合题池 `comprehensive`（v1.5）

```mermaid
flowchart TB
    subgraph 触发["触发条件（MVP 不开启）"]
        C1[本目标下相关 KP >= 3 个<br/>且 mastery 都 >= 0.75]
        C2[距高考 <= 60 天]
        C3[每 session 最多 1 道]
        C1 --> CY[触发]
        C2 --> CY
        C3 --> CY
    end

    subgraph 读取["如何读取"]
        CR1[Session 启动 v1.5+] --> CR2[查综合题库<br/>仅题库召回 不允许 LLM 改写]
        CR2 --> CR3[匹配涉及的 KP 集合<br/>与学生 mastery 高的 KP 取交集]
        CR3 --> CR4[难度匹配<br/>不超过学生最弱 KP 的 mastery + 0.1]
    end

    subgraph 诊断["错因诊断（小问级）"]
        D1[学生拍照上传] --> D2[AI 按小问 1 2 3 拆解]
        D2 --> D3[每个小问独立判对错]
        D3 --> D4[每个小问独立归因到 KP]
        D4 --> D5[ERROR_LOG 记录<br/>多 KP 关联 部分错状态]
    end

    subgraph 重做["重做策略"]
        R1[综合题答错] --> R2[不立即推变种]
        R2 --> R3[推错的小问对应单 KP 专项题]
        R3 --> R4[1-2 周后推同类压轴题<br/>不同年份相似结构]
    end
```

---

### 3.7 池 6：挑战题池 `challenge`

```mermaid
flowchart LR
    CH1[学生提前做完主线题] --> CH2[弹窗<br/>剩余 X 分钟<br/>可选挑战 / 直接提交]
    CH2 -->|选挑战| CH3[召回难度高于学生<br/>当前 avg_mastery 一档的题]
    CH3 --> CH4[标记 source=challenge]
    CH4 --> CH5[做完一起进入解析]
    CH5 --> CH6[挑战题统计独立<br/>不计入主线 mastery 演化<br/>计入挑战榜]
```

**关键规则**：

- 不计入 mastery 演化（保护主线数据纯净）
- 但答题数据 / 错题进独立的 `challenge_stats` 表，用于个性化推荐
- 用于满足学有余力学生的进阶需求

---

### 3.8 池 7：灰度试用池 `gray_pool`

```mermaid
flowchart TB
    subgraph 产生["如何进入灰度池"]
        G1[LLM 参数改写产生新题] --> G2[双 LLM 交叉验答]
        G2 --> G3{答案一致}
        G3 -->|是| G4[进入灰度池<br/>tag=gray, 入池时间戳]
        G3 -->|否| G5[弃用]
    end

    subgraph 读取["叠加召回方式"]
        GR1[其他池召回时] --> GR2{学生在灰度组 5-10%}
        GR2 -->|是| GR3[召回器优先取 gray_pool 候选]
        GR2 -->|否| GR4[只从主池召回]
        GR3 --> GR5[灰度题与主池题混合呈现<br/>学生无感知]
    end

    subgraph 毕业["如何毕业进主池"]
        E1[灰度期 7 天] --> E2{做过 >= 20 学生<br/>举报率 < 1%}
        E2 -->|是| E3[迁入主推荐池]
        E2 -->|否且 >= 2 举报| E4[下架<br/>进复审队列]
    end
```

**关键规则**：

- **横向叠加池**，不在主配比里占独立份额
- 灰度组学生比例可配置（默认 5-10%）
- MVP 阶段是质量校验的核心兜底

## 4. 配比与装配层

```mermaid
flowchart TB
    subgraph 配置["配比表达式（可热更新）"]
        CFG[recommendation_mix.yaml]
        CFG --> CFG_D[default 配比]
        CFG --> CFG_PE[pre_exam_30days 临考期]
        CFG --> CFG_PE2[pre_exam_7days 冲刺期]
        CFG --> CFG_NS[new_student 新生期]
    end

    subgraph 装配["Session 装配流程"]
        AS1[确定学生当前阶段] --> AS2[加载对应配比配置]
        AS2 --> AS3[计算今日总题量<br/>= 时长 / 平均单题 expected_time]
        AS3 --> AS4[按配比分配各池配额]
        AS4 --> AS5[各池召回填充]
        AS5 --> AS6[去重 跨池防重复]
        AS6 --> AS7[场景覆盖检查]
        AS7 --> AS8[难度梯度排序<br/>简单题在前 难题在后]
        AS8 --> AS9[最终题目列表]
    end

    CFG --> AS2
```

**表达式引擎示例**（CEL 风格）：

```yaml
recommendation_mix:
  default:
    - pool: ebbinghaus_due
      target_ratio: "min(0.4, due_count * 1.0 / total_quota)"
      max_items: 6
    - pool: error_book_variant
      target_ratio: "0.3"
      max_items: 5
    - pool: new_knowledge
      target_ratio: "0.3"
      min_items: 2
    - pool: feynman
      target_ratio: "if(feynman_candidates > 0, 1, 0)"
      max_items: 1

  pre_exam_30days:  # 距高考 <= 30 天
    - pool: ebbinghaus_due
      target_ratio: "0.6"
    - pool: error_book_variant
      target_ratio: "0.3"
    - pool: new_knowledge
      target_ratio: "0.1"

  pre_exam_7days:  # 冲刺
    - pool: ebbinghaus_due
      target_ratio: "1.0"
      filter: "mastery >= 0.85"  # 只复习已掌握
```

## 5. 输出层

```mermaid
flowchart LR
    O1[最终题目列表 10-15 道] --> O2[排序策略]
    O2 --> O2A[难度从低到高<br/>避免一上来挫败]
    O2 --> O2B[同 KP 题分散<br/>避免连续做同一 KP]
    O2 --> O2C[讲述题放最后]
    O2A --> O3[输出给前端]
    O2B --> O3
    O2C --> O3

    O3 --> OB[兜底策略]
    OB --> OB1[召回不足时<br/>放宽配比从其他池补]
    OB --> OB2[全池为空时<br/>推默认基础题或休息提示]
    OB --> OB3[学生明确拒绝某 KP<br/>临时跳过本 session]
```

## 6. 完整数据流（一次 session 的端到端）

```mermaid
sequenceDiagram
    participant U as 学生
    participant R as Recommender
    participant DB as 数据层<br/>Mastery/ErrorLog/ReviewQueue
    participant P as 各池召回器
    participant Q as 题库

    U->>R: 点击开始 25 分钟 session
    R->>DB: 读 8 类输入信号
    DB-->>R: mastery 向量 / 错题 / 到期队列 / ...
    R->>R: 判断学生阶段<br/>加载配比配置
    R->>R: 计算总题量 = 25min / avg_time
    R->>P: 按配比向各池下达召回任务
    P->>Q: 各池独立从题库召回候选
    Q-->>P: 返回候选题集
    P-->>R: 各池返回采样结果
    R->>R: 去重 + 场景覆盖 + 难度排序
    R-->>U: 输出最终题目列表

    U->>R: 25 分钟内完成答题
    U->>R: 提交（拍照 + OCR 确认）
    R->>R: 批量 LLM 分析
    R->>DB: 更新 mastery / 写错题 / 更新 review_queue
    DB-->>R: 持久化完成
    R-->>U: 解析页 + 推荐下一步
```

## 7. 决策矩阵速查

| 学生状态 | 主导池 | 配比示例 |
|---|---|---|
| 新生第一周 | 见 Q8（冷启动）| - |
| 正常学习期 | new_knowledge + error_book | 30/30/30/10 |
| 临考期 ≤ 30 天 | ebbinghaus + error_book | 60/30/10 |
| 冲刺期 ≤ 7 天 | ebbinghaus only（mastered） | 100/0/0 |
| 学生有 ≥ 5 道 open 错题 | error_book 提到 40% | 30/40/20/10 |
| 学生 avg_mastery ≥ 0.7 + 临考期 | 加 comprehensive（v1.5） | 40/30/20/10 |

## 8. 关键耦合点

| 引擎组件 | 依赖的其他 Q 决议 |
|---|---|
| 输入信号层 | Q3 mastery 模型 / Q5 错题字段 / Q4 番茄钟时长 |
| 艾宾浩斯池 | Q3 衰减规则 / Q5 错题归因 |
| 错题本变种池 | Q5 根因 6 类 / Q5 攻克条件 |
| 讲述题池 | Q3 三档判定 / Q3 触发条件 |
| 灰度池 | Q6 校验链路 / Q6 学生举报 |
| 综合题池 | Q6 不允许 LLM 改写 / Q5 ERROR_LOG 小问级支持 |
