import path from "path";
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

  /**
   * transpilePackages：workspace 内 TS 源码包必须列出。pnpm symlink 也算 node_modules，
   * Next.js 默认不编译 node_modules 内的 TS，Turbopack 遇到未编译的 .ts 反复尝试解析，
   * 可能触发子进程风暴 / 内存暴涨 / 机器假死（feat-100.2 首次启动遇到过）。
   * 每加一个 workspace 包都要登记。
   */
  transpilePackages: ["@harness/rag-core", "@harness/shared-types"],

  /**
   * outputFileTracingRoot：monorepo 下让 Next.js 正确追踪依赖到 repo 根，
   * 避免 build 时 missing files 警告，也避免 dev 期反复扫整个 workspace。
   */
  outputFileTracingRoot: path.join(__dirname, "../.."),

  /**
   * standalone 输出：feat-200.8 Dockerfile 需要。
   * Next.js 会把所有 server-side 依赖打包进 .next/standalone/，
   * 镜像里只复制 standalone + static + public，体积更小，不需要装 node_modules。
   */
  output: "standalone",
};

export default nextConfig;
