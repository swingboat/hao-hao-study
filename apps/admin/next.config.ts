import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // monorepo 内 workspace 包默认就被 Next.js 视作本地源码并 transpile，
  // 这里显式列出便于将来引入预编译产物时快速切换。
  transpilePackages: ['@hao/db', '@hao/shared', '@hao/llm', '@hao/ui'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
