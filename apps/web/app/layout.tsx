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
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Harness — 透明可观测的 AI Agent",
  description: "透明的 AI，懂你的 Agent。看到每一次思考、每一次检索、每一次工具调用。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
