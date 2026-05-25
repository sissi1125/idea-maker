import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * serverExternalPackages：告诉 Next.js/Turbopack 不要把这些包打包进 bundle，
   * 而是让 Node.js 在运行时通过原生 require() 加载。
   *
   * 必须在这里声明的包：
   *   - @node-rs/jieba：Rust native addon，包含 .node 二进制文件，无法被 Turbopack 处理。
   *     从 API route 直接 import 时 Turbopack 会自动跳过，但从 lib/ 共享模块 import 时
   *     会尝试打包并失败（"could not resolve @node-rs/jieba-darwin-arm64"）。
   */
  serverExternalPackages: ["@node-rs/jieba"],
};

export default nextConfig;
