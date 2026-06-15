/**
 * 种子数据 — v0.1 MVP 启动时的最小冷启动数据。
 *
 * 已实现：
 *   - llm_provider × 5（Webex 代理上的 Gemini 3.1 Pro / Gemini 3.5 Flash /
 *     Claude Opus 4.7 / GPT-5.4 / Gemini 3 Pro Image）
 *     来源：docs/PRD/Operator_Console_MVP_PRD.md §7 + 2026-06-05 KP 探针实测结果
 *   - subject × 3（math_primary / math_junior / math_senior）—— v0.1 学生注册仅 senior，
 *     另外两条预留 v0.2+；命名遵循 "<discipline>_<stage>" 约定，与 packages/shared/labels
 *     的 STAGE_LABEL 字典对齐
 *
 * 模型族行为差异由 packages/llm 的 adapter/provider-target.ts 映射到 how-to-use
 * 同步层 llmTarget；业务层调用方仍然只用 analyzeKnowledgePoints/analyzeQuestions，
 * 看不到 Gemini / Claude / GPT 的协议差别。
 *
 * 待补：
 *   - knowledge_point 冷启动包 — 待运营端 F4 真实教材解析后注入
 */
import { type Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Webex LLM Proxy host —— 代理转发 OpenAI / Google / Anthropic 三种协议。
 * 鉴权统一走 `Authorization: Bearer $WEBEX_LLM_TOKEN`。
 */
const WEBEX_HOST = 'https://llm-proxy.us-east-2.int.infra.intelligence.webex.com';
const WEBEX_OPENAI_CHAT = `${WEBEX_HOST}/openai/v1/chat/completions`;

type ProviderSeed = Omit<Prisma.llm_providerCreateInput, 'created_at'>;

const PROVIDERS: ProviderSeed[] = [
  // ── Gemini 3.1 Pro：thinking 模型，max_tokens 留给上游 ──────────────────
  {
    id: 'webex-gemini-3.1-pro',
    protocol: 'openai_chat',
    endpoint: WEBEX_OPENAI_CHAT,
    model: 'google.gemini-3.1-pro-global',
    capabilities: { text: true, vision: true, pdf: true, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    // 不要写 max_tokens：详见 AGENTS.md §通用规则·5。
    // Gemini 3.x 是 thinking 模型，max_tokens 是 reasoning_tokens + visible 共享预算；
    // 探针 results/probe-questions-extract/...mtnone/ 实测：F3 抽题 reasoning 烧 3.5k-5.4k，
    // visible 1.8k-2.1k，总和 5.3k-7.2k；旧值 8192 已贴边，不安全。
    default_params: { temperature: 0.2 },
    // 旧值 2000 是历史误读：当时探针把"reasoning + visible 共享预算被烧光"
    // 现象当作"proxy cap visible 在 2k"，导致 F3 抽题 100% finish_reason=length
    // (rawText ~125 字符截断)。改 null 后 3/3 chunk 成功。
    max_output_tokens: null,
    quirks: {},
    output_normalizers: [],
    enabled: true,
  },

  // ── Gemini 3.5 Flash：thinking 模型，同 3.1-pro 处理 ───────────────────
  {
    id: 'webex-gemini-3.5-flash',
    protocol: 'openai_chat',
    endpoint: WEBEX_OPENAI_CHAT,
    model: 'google.gemini-3.5-flash-global',
    capabilities: { text: true, vision: false, pdf: false, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    // 同 webex-gemini-3.1-pro，不设 max_tokens（Flash 同样是 thinking 模型，
    // 探针实测 reasoning_tokens=1920 / max_tokens=2000 → visible 被完全吞掉）
    default_params: { temperature: 0.2 },
    max_output_tokens: null,
    quirks: {},
    output_normalizers: [],
    enabled: false, // 探针实测只产 1 KP，不进生产；保留 entry 方便 A/B
  },

  // ── Claude Opus 4.7：F4 KP 解析生产首选；Q3 + Q4 两个 quirks ────────────
  {
    id: 'webex-claude-opus-4.7',
    protocol: 'openai_chat',
    endpoint: WEBEX_OPENAI_CHAT,
    model: 'anthropic.claude-opus-4-7',
    capabilities: { text: true, vision: true, pdf: false, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    // 不放 temperature：Claude 4.7 拒收 temperature 字段，发了 400
    default_params: { max_tokens: 16384 },
    max_output_tokens: null, // 未实测真上限；探针 113 条全本 KP 输出未触顶
    quirks: {
      // Q3：Claude 4.7 deprecated temperature
      supports_temperature: false,
      // Q4：Webex proxy 见 response_format 会注入 temperature → 同上 400；
      // how-to-use 同步层不直接暴露 response_format；结构化约束由公共 prompt/schema 演进。
      // 探针实测 Claude Opus 4.7 对 prompt-引导 JSON 输出服从性极高（113/113 schema 通过）。
      supports_response_format: false,
    },
    output_normalizers: [], // Claude 输出已规范，无需后处理
    enabled: true,
  },

  // ── GPT-5.4：max_completion_tokens + 全角点号 normalize ────────────────
  {
    id: 'webex-gpt-5.4',
    protocol: 'openai_chat',
    endpoint: WEBEX_OPENAI_CHAT,
    model: 'gpt-5.4',
    capabilities: { text: true, vision: true, pdf: false, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    default_params: { temperature: 0.2, max_tokens: 16384 },
    max_output_tokens: null,
    quirks: {
      // Q5：GPT-5 系全家 / o1 / o3 / o4 系大概率同样
      max_tokens_param_name: 'max_completion_tokens',
    },
    output_normalizers: [
      'zh_punct_to_ascii', // Q6 之 1：1．1 → 1.1
      'prefix_chapter_with_section_sign', // Q6 之 2：1.1 → §1.1
    ],
    enabled: true,
  },

  // ── Gemini 3 Pro Image（已有，保留；Google 协议） ──────────────────────
  {
    id: 'webex-gemini-3-pro-image',
    protocol: 'google_generate_content',
    endpoint: `${WEBEX_HOST}/google/v1/models/google.gemini-3-pro-image-preview:generateContent`,
    model: 'google.gemini-3-pro-image-preview',
    capabilities: { text: true, vision: true, pdf: false, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    default_params: { temperature: 0.7, max_tokens: 1024 },
    max_output_tokens: null,
    quirks: {},
    output_normalizers: [],
    enabled: true,
  },
];

async function seedLLMProviders() {
  for (const p of PROVIDERS) {
    // upsert 时 update 全部字段，保证后续修 quirks / max_output_tokens 时重跑 seed 能落库
    await prisma.llm_provider.upsert({
      where: { id: p.id },
      update: {
        protocol: p.protocol,
        endpoint: p.endpoint,
        model: p.model,
        capabilities: p.capabilities,
        auth_env_var: p.auth_env_var,
        default_params: p.default_params,
        max_output_tokens: p.max_output_tokens ?? null,
        quirks: p.quirks ?? {},
        output_normalizers: p.output_normalizers ?? [],
        enabled: p.enabled,
      },
      create: p,
    });
  }
  console.info(`🌱 llm_provider seeded: ${PROVIDERS.map((p) => p.id).join(' / ')}`);
}

async function seedSubjects() {
  // 命名约定：<discipline>_<stage>。stage 与 packages/shared/labels/grade 的 STAGE_LABEL
  // 字典对齐（primary=小学 / junior=初中 / senior=高中）。v0.1 学生注册仅允许 senior，
  // 另外两条预留 v0.2+ 扩展；提前 seed 让 knowledge_point.subject_id 外键不卡。
  const SUBJECTS = [
    { id: 'math_senior', name: '高中数学', stage: 'senior' as const },
    { id: 'math_junior', name: '初中数学', stage: 'junior' as const },
    { id: 'math_primary', name: '小学数学', stage: 'primary' as const },
  ];
  for (const s of SUBJECTS) {
    await prisma.subject.upsert({
      where: { id: s.id },
      update: { name: s.name, stage: s.stage },
      create: s,
    });
  }
  console.info(`🌱 subject seeded: ${SUBJECTS.map((s) => s.id).join(' / ')}`);
}

async function main() {
  await seedSubjects();
  await seedLLMProviders();
  // TODO: knowledge_point 冷启动包待运营端 F4 上线后由真实数据填充
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
