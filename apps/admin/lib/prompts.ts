/**
 * F4.3 — KP vision 抽取 prompt 模板。
 *
 * 版本号会落到 llm_parse_job.prompt_version，方便审计后追踪某次 staging 是哪个
 * 版本的 prompt 跑出来的；以后 prompt 调优时只增不改。
 *
 * vision-v3：补 chapter_title（章节文字标题），跟 chapter_no 配对存在 staging.llm_payload。
 */
import type { subject } from '@hao/db';

/**
 * KP 颗粒度规范，供 vision chunk prompt 复用。
 */
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

/**
 * vision-v2：chapter_no 改用「纯数字点分隔」（6 / 6.1 / 6.1.1），不带「第」「章」「节」「§」。
 * vision-v3：补 chapter_title（章节文字标题），跟 chapter_no 配对存在 staging.llm_payload。
 */
export const KP_VISION_PROMPT_VERSION = 'kp/2026-06-09-vision-v3';

/**
 * chunk 阶段（vision 路径）：LLM 看的是教材页的 PNG 图像。
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

# chapter_no 输出规范（v2，强约束）

chapter_no 必须是「纯数字 + 点」的层级编号，**不要**带「第」「章」「节」「§」「、」等任何文字或符号。

✓ 正确：
  - "6.2.1"   ← 能识别到子节
  - "6.2"     ← 只能识别到节
  - "6"       ← 只能识别到章
  - null      ← 完全无法判断

✗ 禁止：
  - "第六章"  ← 改写成 "6"
  - "§6.1"    ← 去掉 § 改写成 "6.1"
  - "6.2 平面向量的运算"  ← 标题文字去掉，改写成 "6.2"
  - ""        ← 用 null，不要空字符串

# chapter_title 输出规范（v3，新增）

chapter_title 是 chapter_no 对应的**章节文字标题**，从页眉、章首大标题或目录里抓——**不**包含编号本身。

✓ 正确：
  - chapter_no="6"     chapter_title="平面向量及其应用"
  - chapter_no="6.2"   chapter_title="平面向量的运算"
  - chapter_no="6.2.1" chapter_title="向量的加法运算"
  - chapter_no=null    chapter_title=null（没编号也别瞎填名字）

✗ 禁止：
  - chapter_title="第六章 平面向量及其应用"  ← 去掉编号前缀
  - chapter_title="6.2 平面向量的运算"       ← 去掉编号前缀
  - chapter_title=""                         ← 拿不到就 null

读不到清晰的章节标题（页面没有页眉、不是章首页）就填 null；merge 阶段会跨分片择优补全。
chapter_title 是辅助显示用的，**不要影响 chapter_no 的判断**——chapter_no 是主键。

# 输出格式（仅 chunk 阶段）

严格输出 JSON 对象 { "items": [...] }，不要任何解释、不要 markdown 代码块标记。
items 每项：{ "name": string, "chapter_no": string | null, "chapter_title": string | null, "brief": string }。

仅返回知识点本身；学科目标、能力要求、教学建议、配图与例题题干等非考点内容请忽略。
如果这几页确实没有可抽的知识点（封面 / 目录 / 索引页等），返回 { "items": [] }。`;
}
