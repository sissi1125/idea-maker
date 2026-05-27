/**
 * AuthStore — feat-200.5 Week 5
 *
 * 职责：
 *   - 持久化 JWT token（localStorage）
 *   - 维护 currentUser（login/register 后 decode 或 GET /me 获取）
 *   - 提供 logout（清 token + user）
 *
 * 设计：
 *   - zustand 选 persist middleware 自动存 token 到 localStorage
 *   - hydrate 后如有 token 则 GET /me 刷新 user（防 token 过期）
 *   - SSR 安全：persist 用 skipHydration，在 client 组件里手动 hydrate
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { authApi, type User } from "@/lib/api";

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;

  /** 登录 → 存 token → 拉 user profile */
  login: (email: string, password: string) => Promise<void>;
  /** 注册 → 存 token + user */
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  /** 清除本地状态 */
  logout: () => void;
  /** hydrate 后用 token 拉 user（首次加载 / 刷新页面） */
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      loading: false,

      login: async (email, password) => {
        set({ loading: true });
        try {
          const { token } = await authApi.login(email, password);
          set({ token });
          // 拉完整 user profile
          const { user } = await authApi.getMe();
          set({ user, loading: false });
        } catch (err) {
          set({ loading: false });
          throw err;
        }
      },

      register: async (email, password, displayName) => {
        set({ loading: true });
        try {
          const { user, token } = await authApi.register(email, password, displayName);
          set({ token, user, loading: false });
        } catch (err) {
          set({ loading: false });
          throw err;
        }
      },

      logout: () => {
        set({ token: null, user: null });
      },

      refreshUser: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const { user } = await authApi.getMe();
          set({ user });
        } catch {
          // token 过期 → 自动登出
          set({ token: null, user: null });
        }
      },
    }),
    {
      name: "harness-auth",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
      ),
      // 只持久化 token，user 在 hydrate 后通过 refreshUser 拉取
      partialize: (state) => ({ token: state.token }) as unknown as AuthState,
    },
  ),
);
