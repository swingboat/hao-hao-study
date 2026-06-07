/**
 * 种子数据 — v0.1 MVP 启动时的最小冷启动数据。
 *
 * 已实现：
 *   - llm_provider × 6（Webex 代理上的 Gemini 3.1 Pro / Gemini 3.5 Flash /
 *     Claude Opus 4.7 / GPT-5.4 / Gemini 3 Pro Image / Claude Opus 4.7 Converse）
 *     来源：docs/PRD/Operator_Console_MVP_PRD.md §7 + 2026-06-05 KP 探针实测结果 +
 *     2026-06-07 PDF Converse 接入
 *
 * 模型族行为差异（quirks / max_output_tokens / output_normalizers）由 adapter 按字段值
 * 处理，业务层调用方仍然只用 callLLM(providerId, prompt, schema?)，看不到 Gemini /
 * Claude / GPT 的差别。
 *
 * 待补：
 *   - subject（math_senior 等）— 与 schema 学段后缀约定确定后由本 seed 写入
 *   - knowledge_point 冷启动包 — 待运营端 F4 真实教材解析后注入
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Webex LLM Proxy host —— 代理转发 OpenAI / Google / Anthropic 三种协议。
 * 鉴权统一走 `Authorization: Bearer $WEBEX_LLM_TOKEN`。
 */
const WEBEX_HOST = 'https://llm-proxy.us-east-2.int.infra.intelligence.webex.com';
const WEBEX_OPENAI_CHAT = `${WEBEX_HOST}/openai/v1/chat/completions`;
const WEBEX_BEDROCK_CONVERSE = (model: string) => `${WEBEX_HOST}/bedrock/v1/model/${model}/converse`;

type ProviderSeed = Omit<Prisma.llm_providerCreateInput, 'created_at'>;

const PROVIDERS: ProviderSeed[] = [
  // ── Gemini 3.1 Pro：默认行为 + Webex proxy 实测输出 cap ─────────────────
  {
    id: 'webex-gemini-3.1-pro',
    protocol: 'openai_chat',
    endpoint: WEBEX_OPENAI_CHAT,
    model: 'google.gemini-3.1-pro-global',
    capabilities: { text: true, vision: true, pdf: true, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    default_params: { temperature: 0.2, max_tokens: 8192 },
    // 探针实测：v3 prompt 整本输入时 Gemini 输出被 proxy cap 在 ~2k token；
    // 文档值 8192 是骗调用方的，写真值让 callLLM 能正确切片。
    max_output_tokens: 2000,
    quirks: {},
    output_normalizers: [],
    enabled: true,
  },

  // ── Gemini 3.5 Flash：能力不足，先 disabled，仅留 entry ────────────────
  {
    id: 'webex-gemini-3.5-flash',
    protocol: 'openai_chat',
    endpoint: WEBEX_OPENAI_CHAT,
    model: 'google.gemini-3.5-flash-global',
    capabilities: { text: true, vision: false, pdf: false, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    default_params: { temperature: 0.2, max_tokens: 4096 },
    max_output_tokens: 2000,
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
      // 改为把 schema JSON shape 注入 prompt 末尾，靠 callLLM 后置 zod 校验兜底。
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

  // ── Claude Opus 4.7 Converse：原生 PDF 解析路径（packages/llm analyzePdf）─────
  // 与 webex-claude-opus-4.7（openai_chat 协议、纯文本 KP 抽取）并存：KP 文本路径走老 provider，
  // 教材 / 讲义 / 试卷 PDF 整本分析走本 provider。Converse body 形态：
  //   {messages:[{role,content:[{text}, {document:{format:'pdf',name,source:{bytes:base64}}}]}],
  //    inferenceConfig:{maxTokens, temperature?}}
  // 复用 supports_temperature=false quirk（Claude 4.7 拒收 temperature）；schema 走 prompt
  // 注入路径（Converse 没有原生 response_format）。
  {
    id: 'webex-claude-opus-4.7-converse',
    protocol: 'bedrock_converse',
    endpoint: WEBEX_BEDROCK_CONVERSE('anthropic.claude-opus-4-7'),
    model: 'anthropic.claude-opus-4-7',
    capabilities: { text: true, vision: true, pdf: true, structured_output: true },
    auth_env_var: 'WEBEX_LLM_TOKEN',
    default_params: { max_tokens: 16384 },
    max_output_tokens: null,
    quirks: { supports_temperature: false },
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
  console.log(`🌱 llm_provider seeded: ${PROVIDERS.map((p) => p.id).join(' / ')}`);
}

async function main() {
  await seedLLMProviders();
  // TODO: subject / knowledge_point 冷启动包待运营端 F4 上线后由真实数据填充
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
