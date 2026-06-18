import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['sharp'],
  transpilePackages: ['@hao/db', '@hao/shared', '@hao/storage', '@hao/llm', '@hao/ui'],
  typedRoutes: true,
};

export default nextConfig;
