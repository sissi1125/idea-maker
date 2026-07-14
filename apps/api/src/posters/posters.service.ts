/**
 * PostersService — feat-400.5
 *
 * 出图流程：加载已批准 Claim/资产 → 硬规则检查（模板/溢出/对比度/只用已批准）
 * → 通过才用受限 SVG 模板渲染 → sharp 光栅化成真实 PNG → 落盘入库。
 * 不通过不出图，返回失败原因。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { DbService } from "../db/db.service";
import { FileStorageService } from "../mvp-documents/file-storage.service";
import { AssetsService } from "../assets/assets.service";
import {
  buildPosterSvg, validatePosterSpec, POSTER_TEMPLATES, DEFAULT_BG, DEFAULT_FG,
  type PosterSpecInput, type PosterFailure,
} from "./poster-render";

export interface RenderResult {
  posterId: string;
  passed: boolean;
  failures: PosterFailure[];
  ref?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

@Injectable()
export class PostersService {
  private readonly logger = new Logger(PostersService.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: FileStorageService,
    private readonly assets: AssetsService,
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

  async render(userId: string, projectId: string, input: PosterSpecInput): Promise<RenderResult> {
    await this.assertOwner(userId, projectId);

    // 1. 已批准 Claim（id→text）+ 已批准资产 id
    const { approvedClaims, approvedAssetIds } = await this.db.withClient(async (client) => {
      const { rows: cl } = await client.query<{ id: string; text: string }>(
        `SELECT id, text FROM claims WHERE project_id = $1 AND status = 'approved'`,
        [projectId],
      );
      const { rows: as } = await client.query<{ id: string }>(
        `SELECT id FROM visual_assets WHERE project_id = $1 AND status = 'approved'`,
        [projectId],
      );
      return {
        approvedClaims: new Map(cl.map((r) => [r.id, r.text])),
        approvedAssetIds: new Set(as.map((r) => r.id)),
      };
    });

    const claimText = input.claimId ? approvedClaims.get(input.claimId) : undefined;
    const v = validatePosterSpec(input, {
      approvedClaimIds: new Set(approvedClaims.keys()),
      approvedAssetIds,
      claimText,
    });

    const posterId = randomUUID();

    // 2. 不通过 → 记 failed，不出图
    if (!v.passed) {
      await this.db.withClient((client) =>
        client.query(
          `INSERT INTO posters (id, project_id, template_id, spec, status)
           VALUES ($1,$2,$3,$4::jsonb,'failed')`,
          [posterId, projectId, input.templateId, JSON.stringify(input)],
        ),
      );
      return { posterId, passed: false, failures: v.failures };
    }

    // 3. 解析 logo（只从已批准资产读，base64 内嵌，不引用外链）
    let logoDataUri: string | undefined;
    if (input.logoAssetId) {
      const a = await this.assets.readApproved(projectId, input.logoAssetId);
      if (a) logoDataUri = `data:${a.mime};base64,${a.buffer.toString("base64")}`;
    }

    // 4. 受限模板渲染 SVG → sharp 光栅化真实 PNG
    const template = POSTER_TEMPLATES[input.templateId];
    const svg = buildPosterSvg(input.templateId, {
      title: input.title,
      subtitle: input.subtitle,
      claimText,
      logoDataUri,
      bgColor: input.bgColor ?? DEFAULT_BG,
      fgColor: input.fgColor ?? DEFAULT_FG,
    });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const fileRef = this.storage.save(projectId, posterId, "poster.png", png);

    await this.db.withClient((client) =>
      client.query(
        `INSERT INTO posters (id, project_id, template_id, spec, file_ref, width, height, status)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'rendered')`,
        [posterId, projectId, input.templateId, JSON.stringify(input), fileRef, template.width, template.height],
      ),
    );
    this.logger.log(`[poster] rendered ${posterId} ${template.width}x${template.height} ${png.length}B`);
    return { posterId, passed: true, failures: [], ref: fileRef, width: template.width, height: template.height, bytes: png.length };
  }

  async list(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, template_id, width, height, status, created_at
           FROM posters WHERE project_id = $1 ORDER BY created_at DESC`,
        [projectId],
      );
      return { posters: rows };
    });
  }

  /** 取渲染好的 PNG 字节（下载/预览） */
  async getPng(userId: string, projectId: string, posterId: string): Promise<Buffer> {
    await this.assertOwner(userId, projectId);
    const ref = await this.db.withClient(async (client) => {
      const { rows } = await client.query<{ file_ref: string | null }>(
        `SELECT file_ref FROM posters WHERE id = $1 AND project_id = $2 AND status = 'rendered'`,
        [posterId, projectId],
      );
      return rows[0]?.file_ref ?? null;
    });
    if (!ref) throw new NotFoundException("海报不存在或未成功渲染");
    return this.storage.read(ref);
  }
}
