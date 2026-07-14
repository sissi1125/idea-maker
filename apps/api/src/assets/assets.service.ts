/**
 * AssetsService — feat-400.5
 *
 * 视觉资产（logo / 截图 / 参考海报 / 字体）的上传、审批、读取。
 * 后置补充：不阻塞文本与评测闭环；海报阶段只能用 status='approved' 的资产。
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID, createHash } from "crypto";
import sharp from "sharp";
import { DbService } from "../db/db.service";
import { FileStorageService } from "../mvp-documents/file-storage.service";

export const ASSET_KINDS = ["logo", "product_screenshot", "reference_poster", "font"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

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

    const hash = createHash("sha256").update(input.buffer).digest("hex");
    let width: number | null = null;
    let height: number | null = null;
    if (input.kind !== "font") {
      try {
        const meta = await sharp(input.buffer).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
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
