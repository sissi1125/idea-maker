/**
 * Login Page — feat-200.5 Week 5
 *
 * 从原型 Login.jsx 迁移为 TSX + 对接真实 API。
 * 支持 登录 / 注册 切换；成功后 router.push("/projects")。
 *
 * 设计：
 *   - 双栏布局：左品牌 + 右表单（与原型一致）
 *   - 错误展示：表单下方红色提示条
 *   - Google / GitHub 按钮保留占位（Phase 4 接 OAuth）
 */

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/stores/auth-store";
import { ApiError } from "@/lib/api";
import {
  ArrowRight,
  Check,
  FileCheck2,
  Link2,
  ShieldCheck,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { login, register, loading } = useAuthStore();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "signin") {
        await login(email, password);
      } else {
        await register(email, password, displayName || undefined);
      }
      router.push("/projects");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("网络错误，请稍后重试");
      }
    }
  };

  return (
    <main className="min-h-dvh grid lg:grid-cols-[minmax(420px,46%)_1fr]" style={{ background: "#fff" }}>
      {/* 登录主体保持安静克制，让用户优先完成任务。 */}
      <section className="flex flex-col min-h-dvh px-6 py-6 sm:px-10 lg:px-14">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[6px] grid place-items-center text-white font-semibold" style={{ background: "var(--ink)" }}>I</div>
          <span className="text-[15px] font-semibold">IDEA-MAKER</span>
        </div>

        <div className="flex-1 grid place-items-center py-10">
          <form onSubmit={handleSubmit} className="w-full max-w-[400px]" noValidate>
          <p className="mono text-[11px] mb-4" style={{ color: "var(--ink-3)" }}>可信营销内容伙伴</p>
          <h1 className="text-[36px] leading-tight font-semibold mb-2">
            {mode === "signin" ? "欢迎回来" : "创建账户"}
          </h1>
          <p className="text-sm mb-8" style={{ color: "var(--ink-3)" }}>
            {mode === "signin" ? "登录以继续管理你的产品内容。" : "创建账户，开始整理你的第一份产品资料。"}
          </p>

          <div className="flex flex-col gap-4">
            {mode === "signup" && (
              <div>
                <label htmlFor="display-name" className="block text-[13px] font-medium mb-1.5">
                  姓名
                </label>
                <input
                  id="display-name"
                  className="field w-full"
                  placeholder="你的名字"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-[13px] font-medium mb-1.5">
                邮箱
              </label>
              <input
                id="email"
                className="field w-full"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="text-[13px] font-medium">密码</label>
                {mode === "signin" ? <span className="text-xs" style={{ color: "var(--ink-4)" }}>至少 6 位</span> : null}
              </div>
              <input
                id="password"
                className="field w-full"
                type="password"
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </div>

          {error && (
            <div
              className="mt-3 px-3 py-2 rounded-lg text-[12.5px]"
              style={{ background: "rgba(201,117,107,.1)", color: "var(--err)", border: "1px solid rgba(201,117,107,.2)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full mt-5"
            disabled={loading}
          >
            {loading ? "请稍候..." : mode === "signin" ? "登录" : "创建账户"}
            {!loading ? <ArrowRight size={15} /> : null}
          </button>

          <div className="mt-6 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {mode === "signin" ? (
              <>
                还没有账号？{" "}
                <button type="button" onClick={() => setMode("signup")}
                  className="font-semibold underline underline-offset-4" style={{ color: "var(--ink)" }}>
                  注册
                </button>
              </>
            ) : (
              <>
                已有账号？{" "}
                <button type="button" onClick={() => setMode("signin")}
                  className="font-semibold underline underline-offset-4" style={{ color: "var(--ink)" }}>
                  登录
                </button>
              </>
            )}
          </div>
        </form>
        </div>
        <div className="text-[11px]" style={{ color: "var(--ink-4)" }}>隐私保护 · 产品资料仅用于你的项目</div>
      </section>

      {/* 右侧使用真实产品流程预览承载品牌感，不使用装饰性插画。 */}
      <section className="hidden lg:flex flex-col justify-between p-10 xl:p-14" style={{ background: "var(--brand-2)" }}>
        <div className="max-w-[640px]">
          <p className="mono text-[11px] text-white/75 mb-5">FROM PRODUCT TRUTH TO MARKETING CONTENT</p>
          <h2 className="text-white text-[38px] xl:text-[48px] leading-[1.08] font-semibold max-w-[620px]">
            让 AI 真正了解你的产品，再开始写内容。
          </h2>
        </div>

        <div className="bg-white border border-black p-5 xl:p-6 max-w-[680px]" style={{ borderRadius: 8 }}>
          <div className="flex items-center justify-between pb-4 mb-4" style={{ borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="font-semibold text-sm">Bloomnote 产品信息</div>
              <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>12 条信息 · 9 条已确认</div>
            </div>
            <span className="chip" style={{ background: "#FFF2DD", color: "var(--warn)" }}>3 条待处理</span>
          </div>
          <div className="grid gap-3">
            {[
              { icon: FileCheck2, title: "产品功能", body: "智能关联相关笔记", status: "已确认" },
              { icon: Link2, title: "原始依据", body: "产品手册 v2 · 第 8 页", status: "可追溯" },
              { icon: ShieldCheck, title: "发布检查", body: "事实、数字与平台规则", status: "自动执行" },
            ].map(({ icon: Icon, title, body, status }) => (
              <div key={title} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 py-2">
                <span className="w-8 h-8 rounded-[6px] grid place-items-center" style={{ background: "var(--line-2)" }}><Icon size={16} /></span>
                <div><div className="text-xs font-medium">{title}</div><div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{body}</div></div>
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--ok)" }}><Check size={12} />{status}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/75 text-xs">有来源、不过度承诺、支持多平台扩展</p>
      </section>
    </main>
  );
}
