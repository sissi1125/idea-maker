/**
 * AssetsService — feat-400.5
 *
 * 视觉资产（logo / 截图 / 参考海报 / 字体）的上传、审批、读取。
 * 后置补充：不阻塞文本与评测闭环；海报阶段只能用 status='approved' 的资产。
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID, createHash } from "crypto";
import { lookup } from "dns/promises";
import sharp from "sharp";
import { DbService } from "../db/db.service";
import { FileStorageService } from "../mvp-documents/file-storage.service";
import { isPrivateHost, isPrivateIpAddress } from "../sources/website-import";

export const ASSET_KINDS = ["logo", "product_screenshot", "reference_poster", "font"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

export interface AssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  file_ref: string;
  hash: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  label: string | null;
  status: "uploaded" | "approved" | "archived";
  created_at: Date;
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: FileStorageService,
  ) {}

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  /** 上传一个资产：算 hash、取图片尺寸、落盘、入库（status=uploaded） */
  async upload(
    userId: string,
    projectId: string,
    input: { kind: AssetKind; label?: string; fileName: string; mime: string; buffer: Buffer },
  ): Promise<AssetRow> {
    await this.assertOwner(userId, projectId);
    if (!input.buffer?.length) throw new BadRequestException("空文件");
    if (input.buffer.length > MAX_ASSET_BYTES) throw new BadRequestException("资产文件不能超过 5MB");

    const hash = createHash("sha256").update(input.buffer).digest("hex");
    let width: number | null = null;
    let height: number | null = null;
    if (input.kind !== "font") {
      try {
        const meta = await sharp(input.buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
        if (width && height && width * height > MAX_IMAGE_PIXELS) {
          throw new BadRequestException("图片像素不能超过 4000 万");
        }
      } catch {
        throw new BadRequestException("无法解析图片，请上传 PNG/JPG/SVG");
      }
    }

    const id = randomUUID();
    const fileRef = this.storage.save(projectId, id, input.fileName, input.buffer);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<AssetRow>(
        `INSERT INTO visual_assets (id, project_id, kind, file_ref, hash, mime, width, height, label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, project_id, kind, file_ref, hash, mime, width, height, label, status, created_at`,
        [id, projectId, input.kind, fileRef, hash, input.mime, width, height, input.label ?? null],
      );
      return rows[0];
    });
  }

  /**
   * 从 URL 导入一张图片（官网导入自动抓 logo/主图用）。
   * 安全：拒私网(SSRF)、只收 image/*、限大小；按 hash 去重（重复抓不重复入库）。
   * 存 status='uploaded'——仍需用户在工作台批准才能用于海报。返回 null 表示跳过（非图/超限/重复）。
   */
  async importFromUrl(
    projectId: string,
    kind: AssetKind,
    url: string,
    label?: string,
  ): Promise<AssetRow | null> {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let buf: Buffer;
    let mime: string;
    try {
      const res = await this.fetchPublicImage(u, {
        headers: { "User-Agent": "IdeaMakerBot", Accept: "image/*" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      mime = res.headers.get("content-type") ?? "";
      if (!mime.startsWith("image/")) return null;
      const ab = await res.arrayBuffer();
      if (ab.byteLength > 5_000_000 || ab.byteLength < 64) return null; // 5MB 上限 / 太小忽略
      buf = Buffer.from(ab);
    } catch {
      return null;
    }

    const hash = createHash("sha256").update(buf).digest("hex");
    return this.db.withClient(async (client) => {
      // 去重：同项目同 hash 已存在则跳过
      const { rows: dup } = await client.query<AssetRow>(
        `SELECT id, project_id, kind, file_ref, hash, mime, width, height, label, status, created_at
           FROM visual_assets WHERE project_id = $1 AND hash = $2 LIMIT 1`,
        [projectId, hash],
      );
      if (dup.length) return dup[0];

      let width: number | null = null;
      let height: number | null = null;
      try {
        const meta = await sharp(buf, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
        if (width && height && width * height > MAX_IMAGE_PIXELS) return null;
      } catch {
        return null; // 解析不了的当作非图跳过
      }

      const id = randomUUID();
      const ext = mime.includes("png") ? ".png" : mime.includes("svg") ? ".svg" : mime.includes("webp") ? ".webp" : ".jpg";
      const fileRef = this.storage.save(projectId, id, `asset${ext}`, buf);
      const { rows } = await client.query<AssetRow>(
        `INSERT INTO visual_assets (id, project_id, kind, file_ref, hash, mime, width, height, label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, project_id, kind, file_ref, hash, mime, width, height, label, status, created_at`,
        [id, projectId, kind, fileRef, hash, mime, width, height, label ?? "官网导入"],
      );
      return rows[0];
    });
  }

  /**
   * 官网图片可来自 CDN，因此不强制同域；但必须在每一跳重定向和 DNS 解析后保持公网。
   * 手动处理跳转避免 fetch 自动 follow 把已校验的 URL 换成内网目标。
   */
  private async fetchPublicImage(initial: URL, init: RequestInit): Promise<Response> {
    let current = initial;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("不支持的图片协议");
      if (process.env.ALLOW_PRIVATE_IMPORT_HOSTS !== "1") {
        if (isPrivateHost(current.hostname)) throw new Error("图片地址为内网地址");
        const addresses = await lookup(current.hostname, { all: true, verbatim: true });
        if (addresses.length === 0 || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
          throw new Error("图片域名解析到内网地址");
        }
      }
      const response = await fetch(current.toString(), { ...init, redirect: "manual" });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current);
    }
    throw new Error("图片重定向次数超过上限");
  }

  async approve(userId: string, projectId: string, assetId: string): Promise<AssetRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<AssetRow>(
        `UPDATE visual_assets SET status = 'approved'
          WHERE id = $1 AND project_id = $2
        RETURNING id, project_id, kind, file_ref, hash, mime, width, height, label, status, created_at`,
        [assetId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("资产不存在");
      return rows[0];
    });
  }

  async list(userId: string, projectId: string): Promise<AssetRow[]> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<AssetRow>(
        `SELECT id, project_id, kind, file_ref, hash, mime, width, height, label, status, created_at
           FROM visual_assets WHERE project_id = $1 ORDER BY created_at DESC`,
        [projectId],
      );
      return rows;
    });
  }

  /** 读某个资产的字节 + mime（带 owner 校验，供前端缩略图展示） */
  async getFile(userId: string, projectId: string, assetId: string): Promise<{ buffer: Buffer; mime: string }> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{ file_ref: string; mime: string | null }>(
        `SELECT file_ref, mime FROM visual_assets WHERE id = $1 AND project_id = $2`,
        [assetId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("资产不存在");
      return { buffer: this.storage.read(rows[0].file_ref), mime: rows[0].mime ?? "image/png" };
    });
  }

  /** 供 posters 用：读某个已批准资产的字节 + mime（未批准/不存在则 null） */
  async readApproved(projectId: string, assetId: string): Promise<{ buffer: Buffer; mime: string } | null> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{ file_ref: string; mime: string | null; status: string }>(
        `SELECT file_ref, mime, status FROM visual_assets WHERE id = $1 AND project_id = $2`,
        [assetId, projectId],
      );
      const row = rows[0];
      if (!row || row.status !== "approved") return null;
      try {
        return { buffer: this.storage.read(row.file_ref), mime: row.mime ?? "image/png" };
      } catch {
        return null;
      }
    });
  }

  /** 供 posters 校验用：项目已批准资产 id 集合 */
  async approvedAssetIds(projectId: string): Promise<Set<string>> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM visual_assets WHERE project_id = $1 AND status = 'approved'`,
        [projectId],
      );
      return new Set(rows.map((r) => r.id));
    });
  }
}
