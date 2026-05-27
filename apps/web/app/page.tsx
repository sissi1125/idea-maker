/**
 * Root page — feat-200.5 Week 5
 *
 * 根路径 / 重定向到 /projects（主工作区入口）。
 * 旧 Playground 移到 /playground 路由保留访问。
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/projects");
}
