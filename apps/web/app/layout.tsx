/**
 * Root Layout — feat-200.5 Week 5
 *
 * 全局 layout：字体 + CSS + Providers（token hydration）。
 * 路由分组：
 *   (auth)/  → 登录 / 注册（无 Sidebar）
 *   (workspace)/  → 主界面（有 Sidebar）
 *   /playground   → 旧 Playground（保留）
 */

import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "IDEA-MAKER — 可信营销内容伙伴",
  description: "从产品资料中确认事实与卖点，生成有来源、可核查的多平台营销内容。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
