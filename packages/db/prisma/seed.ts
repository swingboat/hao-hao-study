/**
 * 种子数据 — v0.1 MVP 启动时的最小冷启动数据。
 *
 * 已实现：
 *   - llm_provider × 2（Webex Gemini 3.1 Pro / Webex Gemini 3 Pro Image）
 *     来源：docs/PRD/Operator_Console_MVP_PRD.md §7
 *
 * 待补：
 *   - subject（math_senior 等）— 与 schema 学段后缀约定确定后由本 seed 写入
 *   - knowledge_point 冷启动包 — 待运营端 F4 真实教材解析后注入
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedLLMProviders() {
  // 与运营端 PRD §7 完全对齐；幂等 upsert，重复执行不报错
  await prisma.llm_provider.upsert({
    where: { id: 'webex-gemini-3.1-pro' },
    update: {},
    create: {
      id: 'webex-gemini-3.1-pro',
      protocol: 'openai_chat',
      endpoint:
        'https://llm-proxy.us-east-2.int.infra.intelligence.webex.com/openai/v1/chat/completions',
      model: 'google.gemini-3.1-pro-global',
      capabilities: { text: true, vision: true, pdf: true, structured_output: true },
      auth_env_var: 'WEBEX_LLM_TOKEN',
      default_params: { temperature: 0.2, max_tokens: 8192 },
      enabled: true,
    },
  });

  await prisma.llm_provider.upsert({
    where: { id: 'webex-gemini-3-pro-image' },
    update: {},
    create: {
      id: 'webex-gemini-3-pro-image',
      protocol: 'google_generate_content',
      endpoint:
        'https://llm-proxy.us-east-2.int.infra.intelligence.webex.com/google/v1/models/google.gemini-3-pro-image-preview:generateContent',
      model: 'google.gemini-3-pro-image-preview',
      capabilities: { text: true, vision: true, pdf: false, structured_output: true },
      auth_env_var: 'WEBEX_LLM_TOKEN',
      default_params: { temperature: 0.7, max_tokens: 1024 },
      enabled: true,
    },
  });

  console.log('🌱 llm_provider seeded: webex-gemini-3.1-pro / webex-gemini-3-pro-image');
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
