import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hao/db', '@hao/shared', '@hao/llm', '@hao/ui'],
  // sharp 在 packages/llm/src/vision/crop-figures.ts 里被 import；@hao/llm 走
  // transpilePackages 后 webpack 会顺着把 sharp 也打进 server bundle，但 sharp 的
  // .node 原生二进制（@img/sharp-darwin-arm64）走不了 webpack —— 运行时报
  // "Could not load the sharp module using the darwin-arm64 runtime"。
  //
  // 注意：serverExternalPackages 对 transpilePackages 里的依赖**不生效**（Next 会先
  // 让 transpilePackages 把链上所有 import 都走 webpack 编译，外部化指令被绕过）。
  // 必须用 webpack hook 把 sharp 显式外部化，让 server 端走原生 require()。
  serverExternalPackages: ['sharp'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = config.externals;
      const sharpExternal = (
        { request }: { request?: string },
        callback: (err?: unknown, result?: string) => void,
      ) => {
        if (request === 'sharp') return callback(null, 'commonjs sharp');
        callback();
      };
      config.externals = Array.isArray(existing)
        ? [sharpExternal, ...existing]
        : [sharpExternal, existing].filter(Boolean);
    }
    return config;
  },
  experimental: {
    typedRoutes: true,
    // F4.3：教材 PDF 直接走 server action 上传（multipart）。
    // Next 15.5 有两道独立的 body 闸：
    //   1. middleware 这层（默认 10MB）—— middlewareClientMaxBodySize
    //   2. server action 这层（默认 1MB）—— serverActions.bodySizeLimit
    // 任一道没放开都会把大 PDF 截成残缺 multipart → "Unexpected end of form" 500。
    middlewareClientMaxBodySize: '500mb',
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
};

export default nextConfig;
