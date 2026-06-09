/**
 * F4.3 — KP 抽取 prompt 模板（PRD §3.5：prompt 由代码常量维护）。
 *
 * 版本号会落到 llm_parse_job.prompt_version，方便审计后追踪某次 staging 是哪个
 * 版本的 prompt 跑出来的——以后 prompt 调优时只增不删。
 *
 * 版本历史：
 *   - v1 (kp/2026-06-04-v1)：F4.3 首版，颗粒度只描述"独立可考"原则，无示例。
 *     实测 Gemini 3.1 Pro 抽必修一只产 31 条 KP（每节 1 条，太粗）。
 *   - v3 (kp/2026-06-05-v3)：补 ✓/✗ 颗粒度示例 + 数量底限 + 字段约束。
 *     2026-06-05 用 Claude Opus 4.7 实测必修一抽 113-118 条 / 全 5 章 / schema 全过。
 *     （v2 仅在探针阶段使用，未进生产。）
 *   - converse-v1 (kp/2026-06-07-converse-v1)：F4.3 二代，原生 PDF 分片管线。
 *     chunk 阶段让 LLM 看 PDF 切片直接吐 KP 列表（JSON）；终审阶段去重 + 章节归并；
 *     颗粒度规范与 v3 完全一致，区别仅在产出形态（分片 → 合并）。
 */
import type { subject } from '@hao/db';
import type { ChunkPromptCtx, FinalPromptCtx } from '@hao/llm';

/** v3：纯文本路径（pdf-parse → 整段 prompt）。 */
export const KP_PROMPT_VERSION = 'kp/2026-06-05-v3';

/**
 * converse-v2：原生 PDF 分片路径（admin/lib/kp-pipeline.ts）。
 * v1 → v2 的差别在**流水线**（chunk LLM + 手工合并 + chunk 缓存复用），chunk
 * prompt 文本本身没变；改版本号是为了在审计 staging 时能区分"哪些 staging
 * 是被 LLM 终审过的（v1）/ 哪些是 admin 手工去重的（v2）"。
 *
 * v1 终审已废弃 —— webex-claude-opus-4.7-converse 实测把输出截在 ~4096 token，
 * 整本必修一 200+ KP 的 JSON 必然撞 "Unterminated string in JSON" 而失败。
 */
export const KP_CONVERSE_PROMPT_VERSION = 'kp/2026-06-08-converse-v2';

/**
 * vision-v1：视觉路径（admin/lib/kp-pipeline-vision.ts）。
 * pdftoppm → 每 N 张图喂 webex-gemini-3.1-pro vision，颗粒度规范与 v3 / converse-v2
 * 完全一致；区别仅在「附件是 PDF 切片」改为「附件是教材第 X-Y 页图像」。
 */
export const KP_VISION_PROMPT_VERSION = 'kp/2026-06-09-vision-v1';

/** v3 颗粒度规范，chunk / 终审两阶段公用，避免说两遍漂走。 */
const KP_GRANULARITY_RULES = `# 颗粒度（最重要）

抽取颗粒度应对应"课程标准最小考点"——能独立命题、独立测评的最小单位。
**绝对不要把一节的标题原样抄成一个 KP**——节是教学单元，不是考点。
一节通常会拆成 3-8 个最小考点。

✓ 正确示例（细到独立可考）：
  - 一节"§1.3 集合的基本运算"应拆成：集合的并集 / 集合的交集 / 全集与补集 / 集合元素个数公式
  - 一节"§3.2 函数的单调性与最值"应拆成：函数单调性的定义 / 单调性的判定（定义法）/ 单调性的判定（图像法）/ 函数的最大值 / 函数的最小值
  - 一节"§4.2 指数函数"应拆成：指数函数的定义 / 指数函数的图像 / 指数函数的单调性 / 指数函数的值域 / 指数函数的应用

✗ 反例（过粗，禁止）：
  - "集合的基本运算"——把并集/交集/补集三个独立考点揉一起 ❌
  - "指数函数的概念、图象与性质"——名字里有顿号几乎都是合并条 ❌

✗ 反例（过细，禁止）：
  - 单个公式如 "sin²α+cos²α=1"（这属于"同角三角函数关系"的一部分）❌
  - 单个例题里的特殊技巧 ❌

# KP 字段规范

- name: 2-50 字符；不允许出现"、"或"，"——含这两个标点几乎是合并条，请拆开
- chapter_no: 教材章节编号文本（如 "§3.2"、"第二章 第3节"），无法判断填 null
- brief: **不超过 15 字**的极简提要（动词+宾语，例如"判断奇偶性"），仅供运营审核区分同名 KP；不要写完整定义`;

export function buildKpPrompt(subjectRow: subject, textbookText: string): string {
  return `你是${subjectRow.name}的资深教研专家。请从下方教材正文中抽取知识点（KP）候选清单，每个 KP 需包含：

- name: 知识点名称（2-50 字符），如"函数的单调性"、"等差数列求和公式"
- chapter_no: 教材章节编号文本（如 "§3.2"、"第二章 第3节"），无法从正文判断填 null
- brief: **不超过 15 字**的极简提要（动词+宾语，例如"判断奇偶性"、"求和公式"），仅供运营审核区分同名 KP 用，绝对不要写完整定义

# 颗粒度（最重要）

抽取颗粒度应对应"课程标准最小考点"——能独立命题、独立测评的最小单位。
**绝对不要把一节的标题原样抄成一个 KP**——节是教学单元，不是考点。
一节通常会拆成 3-8 个最小考点。

✓ 正确示例（细到独立可考）：
  - 一节"§1.3 集合的基本运算"应拆成：集合的并集 / 集合的交集 / 全集与补集 / 集合元素个数公式
  - 一节"§3.2 函数的单调性与最值"应拆成：函数单调性的定义 / 单调性的判定（定义法）/ 单调性的判定（图像法）/ 函数的最大值 / 函数的最小值
  - 一节"§4.2 指数函数"应拆成：指数函数的定义 / 指数函数的图像 / 指数函数的单调性 / 指数函数的值域 / 指数函数的应用
  - 一节"§5.4 三角函数的图像与性质"应拆成：正弦函数图像 / 正弦函数性质（周期/奇偶/单调/最值各算一条或合一条均可）/ 余弦函数图像 / 余弦函数性质 / 正切函数图像 / 正切函数性质

✗ 反例（过粗，禁止）：
  - "集合的基本运算"——把并集/交集/补集三个独立考点揉一起 ❌
  - "集合间的基本关系"——子集/真子集/相等/空集应分开 ❌
  - "指数函数的概念、图象与性质"——名字里有顿号几乎都是合并条 ❌
  - "等差数列"——隐含通项/求和/性质多个考点 ❌

✗ 反例（过细，禁止）：
  - 单个公式如 "sin²α+cos²α=1"（这属于"同角三角函数关系"的一部分）❌
  - 单个例题里的特殊技巧 ❌

# 数量底限

宁可多不要少。一本必修教材一般 80-150 条 KP；如果你抽不到 80 条，说明颗粒度漂粗了，请重审。
单次硬上限 500 条仅为安全余量，**不要把它当目标范围**。

# 输出格式

1. 严格输出 JSON 对象 { items: [...] }，不要任何解释、不要 markdown 代码块标记
2. 同一 KP 在多处出现合并为一条
3. name 字段不允许出现"、"或"，"——含这两个标点几乎都是合并条，请拆开
4. 仅返回知识点本身；学科目标、能力要求、教学建议、章节标题等非考点内容请忽略

教材正文（学科：${subjectRow.name}，学段：${subjectRow.stage}）：
<<<
${textbookText}
>>>`;
}

/**
 * chunk 阶段：LLM 直接读 PDF 切片（attachment），吐该切片内的 KP JSON 数组。
 * chunk 多、单次失败成本低，不在这里走 schema 强校验；终审会合并 + 校验。
 */
export function buildKpChunkPrompt(subjectRow: subject, ctx: ChunkPromptCtx): string {
  return `你是${subjectRow.name}（学段：${subjectRow.stage}）的资深教研专家。

附件是教材 PDF 的第 ${ctx.chunkIndex}/${ctx.totalChunks} 个分片（原 PDF 第 ${ctx.startPage}-${ctx.endPage} 页）。
请把这一段里出现的**知识点（KP）候选**逐条抽出来。

${KP_GRANULARITY_RULES}

# 输出格式（仅 chunk 阶段）

严格输出 JSON 对象 { "items": [...] }，不要任何解释、不要 markdown 代码块标记。
items 每项：{ "name": string, "chapter_no": string | null, "brief": string }。

仅返回知识点本身；学科目标、能力要求、教学建议、章节标题、配图与例题题干等非考点内容请忽略。
如果本分片确实没有可抽的知识点（封面 / 目录 / 索引页等），返回 { "items": [] }。`;
}

/**
 * chunk 阶段（vision 路径）：LLM 看的是教材页的 PNG 图像，不是 PDF 切片。
 * 颗粒度规范与 buildKpChunkPrompt 完全一致；唯一差异是附件描述。
 */
export function buildKpVisionChunkPrompt(
  subjectRow: subject,
  ctx: {
    chunkIndex: number;
    totalChunks: number;
    startPage: number;
    endPage: number;
    pageImageCount: number;
  },
): string {
  return `你是${subjectRow.name}（学段：${subjectRow.stage}）的资深教研专家。

附件是教材第 ${ctx.startPage}-${ctx.endPage} 页的页面图像（共 ${ctx.pageImageCount} 张），是整本 PDF 的第 ${ctx.chunkIndex}/${ctx.totalChunks} 个分片。
请把这几页里出现的**知识点（KP）候选**逐条抽出来。

${KP_GRANULARITY_RULES}

# 输出格式（仅 chunk 阶段）

严格输出 JSON 对象 { "items": [...] }，不要任何解释、不要 markdown 代码块标记。
items 每项：{ "name": string, "chapter_no": string | null, "brief": string }。

仅返回知识点本身；学科目标、能力要求、教学建议、章节标题、配图与例题题干等非考点内容请忽略。
如果这几页确实没有可抽的知识点（封面 / 目录 / 索引页等），返回 { "items": [] }。`;
}

/**
 * @deprecated converse-v2 以后改在 admin/lib/kp-pipeline.ts 用 TS 手工合并 chunk
 *   items（webex proxy 把 max_tokens 实际卡在 4096，整本 KP JSON 必然截）。
 *   保留此函数仅为兼容旧 import；新代码不要调用。
 */
export function buildKpFinalPrompt(subjectRow: subject, ctx: FinalPromptCtx): string {
  const chunkBlocks = ctx.chunkSummaries
    .map((s) => `# 分片 ${s.chunkIndex}（第 ${s.startPage}-${s.endPage} 页）\n${s.text}`)
    .join('\n\n---\n\n');

  return `你是${subjectRow.name}（学段：${subjectRow.stage}）的资深教研专家。

下面是同一本教材 PDF（共 ${ctx.pageCount} 页）按页分片后由 LLM 抽出的 KP 候选清单。
请合并成**一份去重后的全本 KP 清单**：

1. 同名 / 同义 KP 合并为一条；保留信息最完整的 brief，chapter_no 选最早出现的那个。
2. 不要丢失任何独立可考的知识点；宁可多不要少。
3. 一本必修教材一般 80-150 条 KP；如果合并后不足 80 条，说明分片漂粗了，请根据下面分片正文补抽。
4. 单次硬上限 500 条；超过即视为重复未清，请合并。

${KP_GRANULARITY_RULES}

# 输出格式（严格）

严格输出 JSON 对象 { "items": [...] }，不要任何解释、不要 markdown 代码块标记。
items 每项：{ "name": string, "chapter_no": string | null, "brief": string }。

---

${chunkBlocks}`;
}
