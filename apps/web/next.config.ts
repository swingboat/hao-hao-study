import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hao/db', '@hao/shared', '@hao/llm', '@hao/ui'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
