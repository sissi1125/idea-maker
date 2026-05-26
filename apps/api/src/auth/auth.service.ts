/**
 * AuthService — feat-200.1 Week 1
 *
 * 职责：
 *   - register：邮箱去重 + bcrypt 哈希入库 + 签发 JWT
 *   - login：取用户行 + bcrypt.compare + 签发 JWT
 *   - findById：JwtAuthGuard 通过后用 sub 取用户（GET /auth/me 用）
 *   - signToken / verifyToken：JWT 签发/验签
 *
 * 设计：
 *   - 密码 bcrypt 哈希（saltRounds=10，2026 推荐起点）；不要明文存
 *   - JWT 用 HS256 + JWT_SECRET env；过期默认 7 天（MVP 不做 refresh）
 *   - 错误：邮箱已注册抛 ConflictException(409)；密码错抛 UnauthorizedException(401)
 *   - 不抛 DbException 那种细粒度类型，让 NestJS 自动翻译；与 pipeline 域不混用 PipelineError
 */

import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import type { JwtPayload, UserRow } from "./auth.types";

const BCRYPT_ROUNDS = 10;
const JWT_EXPIRES_IN = "7d";

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  /**
   * 取 JWT 签名 secret：JWT_SECRET env 必填；缺失时抛 500 而非默认值，避免上线意外
   * 走 dev secret。
   */
  private getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
      throw new InternalServerErrorException(
        "JWT_SECRET 未配置或长度小于 16，请在环境变量中设置 (生产请用 KMS)",
      );
    }
    return secret;
  }

  /**
   * 签发 JWT：HS256 + 7 天过期。
   * payload 只放 sub/email，避免随用户资料变化失效。
   */
  signToken(user: { id: string; email: string }): string {
    return jwt.sign({ sub: user.id, email: user.email }, this.getSecret(), {
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  /**
   * 校验 token，返回 payload。失败抛 UnauthorizedException(401)。
   * 同时处理 jwt.JsonWebTokenError / TokenExpiredError 两种常见异常。
   */
  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.getSecret()) as JwtPayload;
    } catch (err) {
      const message =
        err instanceof jwt.TokenExpiredError
          ? "token 已过期"
          : "无效的 token";
      throw new UnauthorizedException(message);
    }
  }

  /**
   * 注册：邮箱小写归一化 + 唯一性检查 + bcrypt 哈希 + INSERT。
   * 失败语义：邮箱已存在抛 409，区别于"DB 连不上"等 503。
   */
  async register(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<UserRow> {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = randomUUID();

    return this.db.withClient(async (client) => {
      // 唯一索引保险：先查再插，且依赖 UNIQUE 约束兜底
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1 LIMIT 1",
        [normalizedEmail],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException("邮箱已注册");
      }

      const insertRes = await client.query<{
        id: string;
        email: string;
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO users (id, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, display_name, created_at, updated_at`,
        [id, normalizedEmail, passwordHash, displayName ?? null],
      );
      const row = insertRes.rows[0];
      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  /**
   * 登录：取 password_hash + bcrypt.compare。
   * 安全细节：用户不存在 / 密码不对都统一返回 "邮箱或密码错误"，
   * 避免账户枚举攻击 (account enumeration)。
   */
  async login(email: string, password: string): Promise<UserRow> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.db.withClient(async (client) => {
      const res = await client.query<{
        id: string;
        email: string;
        password_hash: string;
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, email, password_hash, display_name, created_at, updated_at
         FROM users WHERE email = $1 LIMIT 1`,
        [normalizedEmail],
      );
      if (res.rows.length === 0) {
        throw new UnauthorizedException("邮箱或密码错误");
      }
      const row = res.rows[0];
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        throw new UnauthorizedException("邮箱或密码错误");
      }
      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  /**
   * 通过 user.id 取 UserRow（不含 password_hash）。
   * 给 GET /auth/me 用：guard 通过后只有 payload，需要回 DB 取完整用户行。
   */
  async findById(id: string): Promise<UserRow | null> {
    return this.db.withClient(async (client) => {
      const res = await client.query<{
        id: string;
        email: string;
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, email, display_name, created_at, updated_at
         FROM users WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }
}
