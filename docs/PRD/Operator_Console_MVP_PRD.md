# 运营端 MVP PRD — AI Native Operator Console v0.1

> 本文件为运营端独立 PRD，与 `SmartLearningAssistant_PRD.md` v1.0 并列。学生端能力请参见主 PRD。
>
> | 版本 | 日期 | 说明 |
> |---|---|---|
> | v0.1 | 2026-06-02 | 首次发布；范围对齐主 PRD §10 v0.1 MVP |
> | v0.1.1 | 2026-06-16 | 明确第一轮 MVP 范围：F5.2/F5.3/F5.4/F6/F7 延后；F5.1 仅做只读学生列表 |

---

## §1 一句话定位

> **运营端是一个 AI 优先的内容工厂控制台：让单个运营人员在不写 SQL 的前提下，通过"上传文件 → LLM 抽取 → 人工 diff 确认"的工作流，30 分钟内将一份教材或题集转化为可被学生端消费的 KP 与题目，并完成学生开户与合规工单处理。**

| 维度 | 定义 |
|---|---|
| 核心解决目标 | 把运营冷启动从"手敲 200 题 + 手填 50 KP"的 2 周工作量，压缩到"上传 + 审核"的 1–2 天 |
| 核心用户 | 内部运营 / 教研人员（v0.1 阶段单一管理员账号，无角色划分） |
| 核心价值主张 | LLM 干脏活，人只做"接受 / 拒绝 / 微调"判断 |
| 部署形态 | Web 后台（与学生端同域不同路径，如 `/admin`） |

---

## §2 原子化 MVP 功能列表（TAV 格式）

> 共 **18 个原子功能**，分 7 组。每条独立可测，LLM 拿到任意一条即可开工。
>
> **第一轮 MVP 范围**：交付 F1、F2、F3、F4、F5.1。F5.2/F5.3/F5.4/F6/F7 保留为后续任务，不作为第一轮验收项。

### F1 组：认证与会话

**F1.1 管理员登录**
- **当** 运营访问 `/admin` 任意页面但未持有有效 session **时**，
- **系统执行** 重定向到 `/admin/login`，要求账号密码登录（v0.1 仅支持单一管理员账号，凭据由 env var 配置），
- **界面显示** 居中登录卡片，含"账号 / 密码 / 登录"三元素，错误时红字提示"账号或密码错误"。

**F1.2 会话保持与登出**
- **当** 管理员登录成功**时**，
- **系统执行** 写入 HTTP-only cookie，session 有效期 12 小时；并在右上角持续显示"管理员 / 登出"入口，
- **界面显示** 点击"登出"清除 cookie 并跳转登录页。

---

### F2 组：LLM Provider 配置

**F2.1 Provider 列表查看**
- **当** 管理员进入 `/admin/settings/llm` **时**,
- **系统执行** 读取 `llm_provider` 表全部记录,
- **界面显示** 表格列：`id / protocol / model / capabilities (text/vision/pdf/structured) / enabled`，每行末尾有"启用 / 停用"切换开关。

**F2.2 默认 Provider 绑定**
- **当** 管理员在 `/admin/settings/llm` 为某个 `task_kind`（`question` / `kp` / `goal_template`）选择默认 Provider **时**，
- **系统执行** 持久化默认绑定（每个 task_kind 仅 1 个默认 Provider），后续上传文件若不显式指定，自动使用该 Provider，
- **界面显示** 顶部三行下拉："题目解析默认 / 知识点解析默认 / Goal Template 解析默认"，保存时 toast "已更新"。

> v0.1 内置 Provider 至少 4 条：`openai-chat-gemini-3.1-pro`、`openai-chat-claude-opus-4.7`、`google-generate-content-gemini-3-pro-image`、`bedrock-converse-claude-opus-4.7`。Provider id 使用 `<protocol-slug>-<model-slug>` 命名；Token 仅从 `LLM_PROXY_API_KEY` env var 读取，不入库、不出现在前端。

---

### F3 组：题库导入（核心 — LLM 解析管线）

**F3.1 文件上传**
- **当** 管理员在 `/admin/questions/import` 选择本地文件（PDF / Word / 图片，单文件 ≤ 20MB）**时**，
- **系统执行** 上传到对象存储，写一条 `content_upload`（status=`uploaded`），并展示 Provider 选择器，
- **界面显示** 上传进度条；完成后显示文件缩略图 + "解析模型 [下拉]" + "Prompt 版本 [下拉]" + "开始解析"按钮。

**F3.2 触发 LLM 解析**
- **当** 管理员点击"开始解析"**时**，
- **系统执行** 创建 `llm_parse_job`（task_kind=`question`，provider_id=所选，status=`queued`），异步调用 LLM；调用结果按 schema 校验后写入 `llm_parse_staging`（每抽出一题一条），
- **界面显示** 解析中转圈，完成后跳转到该 upload 的"待审核题目"列表页。

**F3.3 staging 题目列表**
- **当** 管理员进入某 upload 的待审核页 **时**，
- **系统执行** 列出该 upload 下所有 `review_status='pending'` 的 staging 题目，
- **界面显示** 表格列：`#序号 / content 摘要前 60 字 / 答案 / LLM 估难度 / kp_hints / 操作（查看 / 接受 / 丢弃）`；顶部有"全选 + 批量接受 / 批量丢弃"。

**F3.4 单题 diff 抽屉**
- **当** 管理员点击某条 staging 题目的"查看"**时**，
- **系统执行** 打开右侧抽屉，左栏展示 LLM 抽取原始 JSON + 原文片段截图，右栏展示可编辑表单（content / answer / solution_text / question_type / difficulty / kp_ids[] / primary_kp_id），
- **界面显示** 必填红星标注的字段：`kp_ids[]`、`primary_kp_id`、`difficulty`；下方"接受并发布 / 保存草稿 / 丢弃"三按钮。

**F3.5 KP 候选名映射到正式 KP**
- **当** 管理员在 diff 抽屉的 `kp_ids[]` 字段输入或选择候选 KP **时**，
- **系统执行** 从 `knowledge_point` 表搜索同名/相近 KP（前缀匹配 + 简体繁体不敏感），若无匹配提供"+ 新建 KP"快捷入口，
- **界面显示** 自动补全下拉 + 已选 KP 标签列表（可移除），其中一个用蓝色高亮标识为 `primary_kp_id`。

**F3.6 单条重跑（L3 切换 Provider）**
- **当** 管理员对置信度低或抽取错误的 staging 题目点击"换模型重跑"**时**，
- **系统执行** 复用同一 `upload_id` + `raw_image_uri`，用管理员选择的另一个 Provider 重新创建 `llm_parse_job`，结果覆盖该条 staging 的 `llm_payload`，
- **界面显示** 抽屉内多一个"已用模型：xxx [换模型 ▾]"行，切换后转圈，刷新左栏 LLM 抽取结果。

**F3.7 接受并发布**
- **当** 管理员在 diff 抽屉点击"接受并发布"且必填字段齐全 **时**，
- **系统执行** 写入 `question` 表（`question_type` ∈ `{choice, fill_in}`，否则拒绝）、写 `audit_log`、更新 staging.review_status=`accepted` + `published_id`，
- **界面显示** toast "已发布"，抽屉关闭，列表中该行消失。

> v0.1 题型边界：仅接受 `choice` / `fill_in`；任何带有 `essay` 标记的 staging 题被强制丢弃（对应主 PRD 决议 Q2=a）。

---

### F4 组：知识点（KP）维护

**F4.1 KP 列表**
- **当** 管理员进入 `/admin/kps` **时**，
- **系统执行** 读取 `knowledge_point` 全表，
- **界面显示** 表格列：`name / subject_id / chapter_no / 关联题数 / 关联学生数（持有 mastery 的）`，顶部"+ 新建 KP"按钮 + 按 subject 过滤下拉。

**F4.2 手动新建 / 编辑 KP**
- **当** 管理员点击"+ 新建 KP"或某行的"编辑"**时**，
- **系统执行** 弹模态框，提交时校验 `name + subject_id` 在该学科内唯一，
- **界面显示** 表单字段：`name (必填) / subject_id (下拉必填) / chapter_no (选填)`；保存后 toast 并刷新列表。

**F4.3 KP 文件解析（v0.1 选做）**
- **当** 管理员在 `/admin/kps/import` 上传教材 PDF 并触发解析 **时**，
- **系统执行** 流程同 F3.1–F3.7，但 task_kind=`kp`，输出 schema 为 KP 候选列表，
- **界面显示** 待审核 KP 列表 + 单条 diff（字段：name / chapter_no / 定义片段），接受后写入 `knowledge_point` 表。

> 若 v0.1 时间紧张，F4.3 可降级为"手动新建 + 批量 CSV 导入"，但 F4.1/F4.2 必做。

---

### F5 组：学生开户与合规

**F5.1 学生列表**
- **当** 管理员进入 `/admin/students` **时**，
- **系统执行** 读取 `student` 全表；第一轮 MVP 通过 seed 初始化 1 个学生（username=`niki`，name=`Niki`，grade=`g11`，target_exam=`高考 2027`），
- **界面显示** 只读表格列：`username / name / grade / target_exam / parent_consent_at / unlocked_kp_ids 数量 / created_at`；第一轮 MVP 不显示"+ 开新账户"按钮。

**F5.2 开新学生账户（第一轮 MVP 延后）**
- **当** 管理员点击"+ 开新账户"并填写表单 **时**，
- **系统执行** 写入 `student`（必填：name / grade / target_exam / parent_consent_at；`unlocked_kp_ids[]` 通过多选 KP 获得），生成初始登录凭据，
- **界面显示** 表单含 KP 多选器（按 chapter_no 树形分组）；保存后弹窗显示该学生的初始登录账号 + 一次性密码，提示"请告知用户后关闭"。

**F5.3 学生数据导出（第一轮 MVP 延后）**
- **当** 管理员在某学生详情页点击"导出数据"**时**，
- **系统执行** 打包该学生的 student / question_attempt / knowledge_point_mastery / mistake_book_entry / spaced_review / learning_session 为 JSON ZIP，写一条 `audit_log`（action=`export_data`），
- **界面显示** 浏览器下载文件 + toast "导出已记录"。

**F5.4 学生账户注销（第一轮 MVP 延后）**
- **当** 管理员在某学生详情页点击"注销账户"且二次确认 **时**，
- **系统执行** 删除该学生的所有学习数据（student 软删 + 上述 5 张表硬删），写 `audit_log`（action=`delete_student`），
- **界面显示** 红色确认对话框（输入学生姓名才可继续）；完成后跳回列表 + toast "已注销"。

---

### F6 组：基础数据看板

**F6.1 概览页（第一轮 MVP 延后）**
- **当** 管理员进入 `/admin` 首页 **时**，
- **系统执行** 计算并返回 4 个核心数字：`在册学生数 / 今日 Session 数 / 7 日整体答题正确率 / 错题热度 Top 10 KP`，
- **界面显示** 4 张卡片 + Top 10 KP 横向条形图（标题：错题数、关联学生数）。

> 看板只读，刷新页面即重算，不做实时推送、不做时间范围筛选。

---

### F7 组：审计追溯

**F7.1 LLM 解析任务日志查询（第一轮 MVP 延后）**
- **当** 管理员进入 `/admin/audit/parse-jobs` **时**，
- **系统执行** 读取 `llm_parse_job` 表（默认按 created_at 倒序，前 100 条），
- **界面显示** 表格列：`created_at / task_kind / provider_id / prompt_version / status / latency_ms / token_usage.total / 错误摘要`，每行可点击查看完整 `request_payload + raw_response`（JSON 格式化展示，敏感字段已脱敏）。

---

## §3 技术排他边界（Out of Scope）

> 以下功能 **v0.1 绝对不构建**。LLM 实现时遇到这些需求，应直接拒绝或留 TODO，不得自行扩展。

### §3.1 角色与权限
- ❌ 多角色权限模型（教研 / 内容审核 / 客服分离）。v0.1 仅单一管理员账号。
- ❌ 操作审批流（双人复核、四眼原则）。
- ❌ 管理员账号自助注册 / 找回密码。凭据通过 env var 静态配置。

### §3.2 题库治理
- ❌ question 6 态状态机审核（`draft / pending / approved / rejected / archived / deprecated`）。v0.1 publish 即 `published`，无中间态。
- ❌ 题目下架与回滚事务（对应主 PRD 决议 S3 延后）。
- ❌ 题目变体族（同根题不同变种串起来）。
- ❌ 题目质量打分 / 学生侧反馈回流。
- ❌ 真题来源标注 / 版权追踪 / DOI。

### §3.3 KP / 课标治理
- ❌ KP 前置依赖图（`KP_PREREQ` 边表，DAG）。LLM 抽出的 `prereq_hints` 直接丢弃，不入库。
- ❌ KP 版本管理（课标改版迁移，对应主 PRD ⏳ B8）。
- ❌ 教材版本（`TEXTBOOK_VERSION`）与章节实体（`CHAPTER`）多对多。`KP.chapter_no` 仅为字符串，不外键。
- ❌ 核心素养 / 评价维度（`COMPETENCY` / `EVAL_DIMENSION`）映射。

### §3.4 Goal Template
- ❌ Goal Template 解析 UI（v0.2 再做）。v0.1 系统初始化时通过 SQL 硬塞 1 条 GOAL_TEMPLATE。
- ❌ 多套 GOAL_TEMPLATE 并行（决议 C3 已废弃此提法）。
- ❌ EXAM_POINT 录入 / 真题权重统计（决议 C1，留到 v0.5）。

### §3.5 LLM 解析管线
- ❌ A/B 并行跑（同一上传同时调多个 Provider 对比）。v0.1 仅支持 L2 上传时单选 + L3 单条重跑。
- ❌ Provider 增删改 UI。v0.1 通过 YAML 文件 / SQL 维护 `llm_provider` 表。
- ❌ 自定义 prompt 编辑器。Prompt 由代码内常量维护，运营仅可在下拉中选 `prompt_version`。
- ❌ 批量重跑（一次重跑整个 upload）。仅单条重跑（F3.6）。
- ❌ 解析任务队列优先级、跨任务并发调度。v0.1 in-process 队列，固定并发 ≤ 2。
- ❌ 成本配额管理 / 月度预算告警。

### §3.6 学生管理
- ❌ 批量学生导入（CSV / 表格）。
- ❌ 学生群组 / 班级概念。
- ❌ 学生学习报告导出（家长端）。
- ❌ 学生密码自助修改。v0.1 由管理员重置。

### §3.7 看板与运营分析
- ❌ 时间范围筛选 / 漏斗分析 / 留存分析。
- ❌ 自定义报表 / 数据下载 CSV。
- ❌ 实时推送（WebSocket / SSE）。
- ❌ 多维度交叉透视。

### §3.8 通用
- ❌ 多语言 i18n。v0.1 仅简体中文。
- ❌ 移动端适配。运营端仅保证桌面 Chrome ≥ 120 可用。
- ❌ 暗色模式。
- ❌ 操作撤销 / 历史版本回滚。

---

## §4 编号用户旅程（User Flow）

### §4.1 主旅程 U1 — 冷启动：从空库到学生可上线（最小价值闭环）

> 总耗时目标：**单一运营人员 ≤ 4 小时**完成。

1. 管理员通过 F1.1 登录后台。
2. 在 `/admin/settings/llm` 通过 F2.1 / F2.2 确认所需 LLM Provider 已启用，将"题目解析默认"绑定为 `openai-chat-gemini-3.1-pro`，"知识点解析默认"绑定为 `openai-chat-gemini-3.1-pro` 或 `bedrock-converse-claude-opus-4.7`。
3. 在 `/admin/kps` 通过 F4.2 手动建立 1 条 subject（如 `math`）和 30–50 条 KP（或走 F4.3 上传教材 PDF 解析后批量接受）。
4. 在 `/admin/questions/import` 通过 F3.1 上传题集 PDF，通过 F3.2 触发 LLM 解析。
5. 在 staging 列表（F3.3）逐题打开 diff 抽屉（F3.4），通过 F3.5 把 LLM 给出的 `kp_hints` 映射到第 3 步建好的正式 KP。对置信度低的题用 F3.6 换模型重跑。
6. 通过 F3.7 逐题"接受并发布"，直到该 upload 下所有题目处理完毕（目标：每 KP ≥ 5 题）。
7. 在 `/admin/students` 通过 F5.1 确认 seed 学生 `niki / Niki` 可见。第一轮 MVP 到此完成运营端内容冷启动和学生列表展示闭环；学生开户、学生登录首个 Session 与看板展示进入后续轮次。

### §4.2 辅助旅程 U2 — 日常题库扩充

1. 管理员登录（F1.1）。
2. 上传新题集（F3.1 → F3.2）。
3. 批量过审（F3.3 全选 → F3.7 批量接受），仅对 staging 标"必填字段缺失"的题进入 diff 抽屉单独处理（F3.4 / F3.5）。
4. 第一轮 MVP 暂不提供 `/admin/audit/parse-jobs`；异常排查先通过 DB / 日志完成，F7.1 后续补齐。

### §4.3 辅助旅程 U3 — 合规工单处理（第一轮 MVP 延后）

1. 管理员登录（F1.1）。
2. 在 `/admin/students` 找到目标学生，进入详情页。
3. 根据工单类型执行 F5.3（导出）或 F5.4（注销）。
4. 提交工单回执时附上 `audit_log.id` 作为凭据。

---

## §5 成功标准（可被自动化测试验证）

> 所有指标分两类：**功能正确性**（必须 100% 通过，CI 拦截）与 **质量水位**（验收阈值，灰度后达标）。

### §5.1 功能正确性（端到端测试，CI 必过）

| 编号 | 指标 | 验证方式 |
|---|---|---|
| T1 | 未登录访问 `/admin/*` 任意路径必跳 `/admin/login` | E2E：清空 cookie 访问 5 个随机路径，全部 302 |
| T2 | LLM Provider token 不出现在任何 API 响应或前端 bundle | 静态扫描：grep token 字符串 = 0 命中；E2E：抓所有 `/admin/api/*` 响应体扫描 |
| T3 | F3.7 发布的 question 必满足 `question_type ∈ {choice, fill_in}` 且 `kp_ids[].length ≥ 1` 且 `primary_kp_id ∈ kp_ids` | DB 约束 + 后端校验单元测试 |
| T4 | F3.7 写入 question 时同步写 audit_log，二者 `question_id` 一致 | 集成测试：发布 1 题后查两表 |
| T5 | F5.1 学生列表能展示 seed 学生 `niki / Niki / g11 / 高考 2027`，且不展示开户、导出、注销操作入口 | E2E：访问 `/admin/students`，断言表格内容与操作入口 |
| T6 | F5.4 注销学生后，该 student_id 在 student 软删，而 question_attempt/knowledge_point_mastery/mistake_book_entry/spaced_review/learning_session 全部硬删 | 后续轮次集成测试：开户→产生数据→注销→断言 6 张表状态 |
| T7 | F3.6 单条重跑后，staging 行 `llm_payload` 已更新且 `parse_job_id` 指向新 llm_parse_job | 集成测试 |
| T8 | F2.2 修改默认 Provider 后，下一次 F3.2 触发的 llm_parse_job.provider_id 与新默认一致 | 集成测试 |
| T9 | F7.1 列表页的 `request_payload` JSON 中不含 `Authorization` header / Bearer token 字符串 | 后续轮次单元测试：脱敏函数；E2E：抓接口返回扫描 |
| T10 | F3.2 解析失败（LLM 5xx）时 llm_parse_job.status=`failed` 且 staging 不写入 | 集成测试：mock LLM 返回 500 |

### §5.2 质量水位（灰度后达标）

| 编号 | 指标 | 阈值 | 测量方式 |
|---|---|---|---|
| Q1 | 题目解析运营接受率（未做任何字段修改即通过的比例） | ≥ 70% | 统计 staging.review_status=`accepted` 且 `review_payload == llm_payload` 的占比 |
| Q2 | 题目解析端到端延迟（上传完成 → staging 列表可见，单文件 ≤ 50 题） | P95 ≤ 60s | llm_parse_job.latency_ms 分布 |
| Q3 | 单题 diff 平均处理时长（打开抽屉 → 接受/丢弃） | ≤ 30s | 前端埋点 |
| Q4 | F2.2 切换 Provider 重跑后，运营改判率（"重跑后被采纳" 而 "原结果被丢弃" 的比例） | ≥ 30% 视为该 Provider 切换有效 | llm_parse_job 配对统计 |
| Q5 | 主旅程 U1 总耗时（从登录到学生完成首 Session） | ≤ 4 小时 | 主旅程演练计时 |
| Q6 | 看板首页加载耗时 | P95 ≤ 1.5s | 前端 RUM |
| Q7 | LLM 调用失败率（5xx + 超时 + schema 校验失败） | ≤ 5% | llm_parse_job.status=`failed` 占比 |

---

## §6 数据模型摘要（仅运营端新增）

> 完整字段表见主 PRD §3 / §10.4。本节仅列出运营端新增 4 张表。

| 表 | 关键字段 | 用途 |
|---|---|---|
| `llm_provider`（表 13） | id, protocol, endpoint, model, capabilities jsonb, auth_env_var, default_params jsonb, enabled | F2 组：可配置的 LLM 接入清单 |
| `content_upload`（表 11，复用合规域） | id, uploader_id, file_uri, file_type, purpose, status | F3.1 / F4.3 文件存档 |
| `llm_parse_job`（表 14） | id, upload_id, task_kind, provider_id, prompt_version, status, request_payload jsonb, raw_response jsonb, parsed_output jsonb, token_usage jsonb, latency_ms, error_message | F3.2 / F4.3 / F7.1 LLM 调用追溯 |
| `llm_parse_staging`（表 12） | id, parse_job_id, entity_kind, llm_payload jsonb, review_status, review_payload jsonb, reviewed_by, published_id | F3.3–F3.7 / F4.3 待审核中间层 |

约束：

- `llm_provider.auth_env_var` 仅记录 env var **名字**，不记录值；token 仅运行时从环境读取。
- `llm_parse_job.request_payload` 如记录请求摘要，必须保证不含明文 token；token 只允许从 `llm_provider.auth_env_var` 指向的环境变量读取。
- `llm_parse_staging.review_status='accepted'` 时 `published_id` 必须非空且指向正式表（question / knowledge_point）。

---

## §7 LLM Provider 初始注册（v0.1 内置）

> v0.1 通过启动脚本写入 `llm_provider` 表的内置记录。真实 endpoint 只从环境变量读取，不写入代码仓库。

```yaml
- id: openai-chat-gemini-3.1-pro
  protocol: openai_chat
  endpoint_env: LLM_PROXY_OPENAI_CHAT_ENDPOINT
  model: google.gemini-3.1-pro-global
  capabilities: { text: true, vision: true, pdf: true, structured_output: true }
  auth_env_var: LLM_PROXY_API_KEY
  default_params: { temperature: 0.2 }
  enabled: true

- id: google-generate-content-gemini-3-pro-image
  protocol: google_generate_content
  endpoint_env: LLM_PROXY_GOOGLE_GENERATE_CONTENT_GEMINI_3_PRO_IMAGE_ENDPOINT
  model: google.gemini-3-pro-image-preview
  capabilities: { text: true, vision: true, pdf: false, structured_output: true }
  auth_env_var: LLM_PROXY_API_KEY
  default_params: { temperature: 0.7, max_tokens: 1024 }
  enabled: true

- id: bedrock-converse-claude-opus-4.7
  protocol: bedrock_converse
  endpoint_env: LLM_PROXY_BEDROCK_CONVERSE_CLAUDE_OPUS_4_7_ENDPOINT
  model: anthropic.claude-opus-4-7
  capabilities: { text: true, vision: true, pdf: false, structured_output: true }
  auth_env_var: LLM_PROXY_API_KEY
  default_params: { max_tokens: 16384 }
  enabled: true
```

调用层契约（实现细节由公共层决定，但**业务侧对外接口形态固定**）：

```
analyzeKnowledgePoints({ providerId, file }) -> knowledge_points result
analyzeQuestions({ providerId, file, knowledge }) -> questions result
  - providerId 由 @hao/llm adapter 映射为 how-to-use-llm-proxy 同步层需要的 llmTarget/apiKey
  - prompt、schema、PDF/Word 渲染和 LLM 循环先在 how-to-use-llm-proxy 验证，再同步到 @hao/llm
  - 失败按 §5.1 T10 落 llm_parse_job.status=failed
```

---

## §8 验收清单（开发交付前自检）

- [ ] 第一轮 MVP 功能（F1.1–F4.3、F5.1）逐条可演示
- [ ] F5.2/F5.3/F5.4/F6/F7 未出现在第一轮可点击入口中
- [ ] §5.1 第一轮适用 CI 测试通过
- [ ] 主旅程 U1 第一轮范围一次性走通，耗时 ≤ 4 小时
- [ ] LLM token 不在前端 bundle / API 响应 / DB 任意位置出现
- [ ] §3 排他边界中标 ❌ 的功能在代码里不存在路由 / 不存在表字段
- [ ] `llm_provider` 初始 2 条记录已通过启动脚本写入
- [ ] `llm_parse_job.request_payload` 脱敏函数有单元测试覆盖

---

## §9 与主 PRD 的对应关系

| 本文件章节 | 对应主 PRD（`SmartLearningAssistant_PRD.md`） |
|---|---|
| §1 一句话定位 | §1.1 / §1.2 原则 1 AI 优先 |
| §2 F3 / F4 | §10.2 题库 + 学生入驻模块；§3.3 question / KP 字段表 |
| §2 F5 | §10.2 数据合规模块；§3.3 student |
| §2 F2 / F3.6 / F7 | 本文件新增（主 PRD 无运营端 LLM 解析章节） |
| §3 排他边界 | §10.3 砍掉的模块清单 + §8.2 延后决议 + §9 待澄清 |
| §6 数据模型 | §3.3 + §10.4（本文件表 11–14 为运营端扩展） |

---

> **本 PRD 自洽完备，LLM 工程师可基于本文件直接进入开发，无需进一步澄清。**
> **任何超出 §3 排他边界的"贴心补充"应被视为 bug。**
