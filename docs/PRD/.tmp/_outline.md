# PRD 完整大纲（所有 subagent 共享）

最终输出：`/Users/huyin/Swingboat/github/hao-hao-study/docs/PRD/SmartLearningAssistant_PRD.md`

```
0. 文档说明
1. 产品定位与原则
   1.1 一句话定义
   1.2 核心原则（AI native / 数据合规 / 三层模型）
   1.3 用户角色
2. 顶层架构
   2.1 三域分层（运营/学生/行为）
   2.2 域间关系图
3. 数据模型
   3.1 ER 总图（mermaid）
   3.2 实体清单与分组
   3.3 每个实体的完整字段表
   3.4 关键约束（UNIQUE / 派生字段）
4. 三层学习生命周期模型
   4.1 Layer 1：KP 主状态机
   4.2 Layer 2：mistake_book_entry 状态机
   4.3 Layer 3：spaced_review 间隔复习引擎
   4.4 三层交互的原子事件包
   4.5 Case 1（全对）时间线
   4.6 Case 2（3 道 2 对 1 错）时间线
5. Mastery 演化规则
   5.1 数值表
   5.2 状态阈值（4 档）
   5.3 衰减规则（被动衰减已删）
   5.4 讲述题加成
   5.5 mastery=0 二义性消解
6. 推荐器（7 池设计）
   6.1 池总览
   6.2 池 1-7 详细规则
   6.3 多池合并规则
   6.4 池间配比表达式
   6.5 信号到决策对应表
7. 核心流程
   7.1 学生入驻流程
   7.2 学习 Session 流程
   7.3 答题 + 错题诊断流程
   7.4 错题修复流程
   7.5 间隔复习召回流程
   7.6 讲述题流程
   7.7 题目下架流程（v1.5+）
8. 决策记录（Audit Trail）
   8.1 已闭环决议（S1/S2/C1/C3/B1）
   8.2 延后决议（S3）
9. 待澄清问题（C2/C4/B2-B8）
10. v0.1 MVP 范围与启动条件
   10.1 必做模块
   10.2 砍掉的模块
   10.3 简化版数据模型（10 张表）
   10.4 启动确认事项
11. 附录
   11.1 术语表
   11.2 编号映射（PRD ← session 旧文档）
   11.3 改动历史
```

## 文件分配

| Subagent | 写入文件 | 章节范围 |
|---|---|---|
| Agent A | `01_intro.md` | §0, §1, §2 |
| Agent B | `02_data_model.md` | §3 (ER 图 + 全部实体字段表) |
| Agent C | `03_lifecycle_mastery.md` | §4, §5 |
| Agent D | `04_recommender.md` | §6 |
| Agent E | `05_flows.md` | §7 |
| Agent F | `06_decisions_open.md` | §8, §9 |
| Agent G | `07_mvp_appendix.md` | §10, §11 |

## 共享约束（所有 agent 必须遵守）

1. **Markdown 格式**
2. **mermaid** 表达 ER 图、状态机、流程图（不要 ASCII art）
3. 决议处加标签 `[决议 S1]` / `[决议 S2-衍生2]` / `[决议 C3-D2]` 等
4. 字段表用 markdown 表格：`| 字段 | 类型 | 必选 | 说明 | 备注 |`
5. 章节用 `## §X.Y` 编号
6. 状态明确：✅ 闭环 / ⏸ 延后 / ⏳ 待澄清
7. **不复述 session 原文**：应用决议后输出"已修正版本"
8. 中文为主，技术术语保留英文
9. 简洁高密度，决策语气，不水文
