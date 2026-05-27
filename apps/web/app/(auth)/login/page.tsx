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
  Brain,
  Search,
  DollarSign,
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

  const inputClass =
    "w-full h-[42px] px-3.5 rounded-lg border border-[var(--line-strong)] outline-none text-sm bg-white focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]/30 transition";

  return (
    <main className="fixed inset-0 flex">
      {/* ── Left brand panel ── */}
      <div
        className="hidden lg:flex flex-col relative overflow-hidden text-white"
        style={{
          flex: "1 1 56%",
          background: "linear-gradient(135deg, #3D8C7F 0%, #4FA89A 45%, #6BC0A8 100%)",
          padding: "42px 50px",
        }}
      >
        {/* Decorative circles */}
        <svg viewBox="0 0 600 600" className="absolute -right-30 -top-20 w-[740px] opacity-18">
          <defs>
            <radialGradient id="rg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFF1B8" stopOpacity=".7" />
              <stop offset="100%" stopColor="#FFF1B8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="300" cy="300" r="100" fill="url(#rg)" />
          {[140, 200, 260, 320, 380].map((r, i) => (
            <circle
              key={r} cx="300" cy="300" r={r}
              fill="none" stroke="#fff" strokeWidth=".8"
              strokeDasharray={i % 2 ? "6 4" : "0"} opacity=".55"
            />
          ))}
        </svg>

        {/* Brand */}
        <div className="flex items-center gap-3 relative z-10">
          <div
            className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-bold text-white text-lg"
            style={{
              background: "linear-gradient(135deg, #6BBFAF 0%, #3D8C7F 100%)",
              boxShadow: "0 0 0 1px rgba(255,255,255,.32) inset, 0 8px 18px rgba(0,0,0,.18)",
            }}
          >
            H
          </div>
          <span className="font-semibold text-[19px] tracking-tight">Harness</span>
        </div>

        {/* Tagline */}
        <div className="flex-1 flex flex-col justify-center relative z-10 mt-8">
          <h1 className="text-[42px] font-bold leading-[1.15] tracking-tight max-w-[520px] mb-5">
            透明的 AI，
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #FFF1B8, #FFFEE8)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              懂你的 Agent
            </span>
            。
          </h1>
          <p className="text-[15px] leading-relaxed opacity-80 max-w-[480px] mb-8">
            不再是黑盒。Harness 让你看到 Agent 的每一次思考、每一次检索、每一次工具调用，
            并通过你的反馈逐步学习偏好。
          </p>

          <div className="flex gap-2.5">
            {[
              { icon: <Brain size={16} strokeWidth={1.6} />, label: "4 阶段可视化", c: "#C2EAE0" },
              { icon: <Search size={16} strokeWidth={1.6} />, label: "来源可追溯", c: "#A8E0DF" },
              { icon: <DollarSign size={16} strokeWidth={1.6} />, label: "成本透明", c: "#FFF1B8" },
            ].map((d) => (
              <div
                key={d.label}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-[12.5px]"
                style={{
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.08)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <span style={{ color: d.c }}>{d.icon}</span>
                {d.label}
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-[11.5px] opacity-50">
          © 2025 Harness · 透明可观测 AI Agent 平台
        </div>
      </div>

      {/* ── Right form ── */}
      <div className="flex-1 flex items-center justify-center p-10" style={{ background: "var(--bg)" }}>
        <form onSubmit={handleSubmit} className="w-full max-w-[380px]">
          <h2 className="text-2xl font-semibold tracking-tight mb-1.5">
            {mode === "signin" ? "欢迎回来" : "创建账户"}
          </h2>
          <p className="text-[13px] mb-6" style={{ color: "var(--ink-3)" }}>
            {mode === "signin" ? "登录以继续使用 Harness" : "30 秒注册，免费试用"}
          </p>

          <div className="flex flex-col gap-3">
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink-2)" }}>
                  姓名
                </label>
                <input
                  className={inputClass}
                  placeholder="你的名字"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink-2)" }}>
                邮箱
              </label>
              <input
                className={inputClass}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink-2)" }}>
                密码
              </label>
              <input
                className={inputClass}
                type="password"
                placeholder="••••••••"
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
            className="btn btn-primary w-full h-[42px] mt-4.5 text-sm font-semibold justify-center rounded-[10px]"
            disabled={loading}
          >
            {loading ? "请稍候..." : mode === "signin" ? "登录" : "创建账户"}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-2.5 my-5 text-[11.5px]" style={{ color: "var(--ink-4)" }}>
            <div className="flex-1 h-px" style={{ background: "var(--line-2)" }} />
            或继续使用
            <div className="flex-1 h-px" style={{ background: "var(--line-2)" }} />
          </div>

          {/* OAuth placeholders */}
          <div className="flex gap-2">
            <button type="button" className="btn flex-1 justify-center h-[38px]">
              <span className="text-[13px] font-semibold">Google</span>
            </button>
            <button type="button" className="btn flex-1 justify-center h-[38px]">
              <span className="text-[13px] font-semibold">GitHub</span>
            </button>
          </div>

          <div className="mt-6 text-center text-[13px]" style={{ color: "var(--ink-3)" }}>
            {mode === "signin" ? (
              <>
                还没有账号？{" "}
                <button type="button" onClick={() => setMode("signup")}
                  className="font-semibold" style={{ color: "var(--brand)" }}>
                  注册
                </button>
              </>
            ) : (
              <>
                已有账号？{" "}
                <button type="button" onClick={() => setMode("signin")}
                  className="font-semibold" style={{ color: "var(--brand)" }}>
                  登录
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
