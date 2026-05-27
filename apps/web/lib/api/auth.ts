/**
 * Auth API — feat-200.5 Week 5
 *
 * 端点（Week 1 后端）：
 *   POST /auth/register  → { user, token }
 *   POST /auth/login     → { token }
 *   GET  /auth/me        → { user }
 */

import { apiFetch } from "./client";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface LoginResponse {
  token: string;
}

export interface RegisterResponse {
  user: User;
  token: string;
}

export interface MeResponse {
  user: User;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    noAuth: true,
  });
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>("/auth/register", {
    method: "POST",
    body: { email, password, displayName },
    noAuth: true,
  });
}

export async function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me");
}
