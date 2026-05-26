/**
 * Auth 模块共享类型 — feat-200.1 Week 1
 */

/**
 * JWT payload 形状（最小化，仅含用户 id / email）。
 * 不存 displayName / roles 等可变信息：避免 token 内容随用户改名失效。
 */
export interface JwtPayload {
  sub: string; // user.id
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * 数据库行的 TypeScript 视图。
 * 不暴露 password_hash，避免日志/JSON 序列化意外泄漏。
 */
export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * RequestUser — JwtAuthGuard 通过后注入到 req.user 的类型。
 * 与 UserRow 区分：guard 不查 DB 全字段，只持 payload 解出来的 sub/email。
 */
export interface RequestUser {
  id: string;
  email: string;
}
