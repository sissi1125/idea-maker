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

    // 3. 解析 logo + 背景图（只从已批准资产读，base64 内嵌，不引用外链）
    const toDataUri = async (assetId?: string): Promise<string | undefined> => {
      if (!assetId) return undefined;
      const a = await this.assets.readApproved(projectId, assetId);
      return a ? `data:${a.mime};base64,${a.buffer.toString("base64")}` : undefined;
    };
    const logoDataUri = await toDataUri(input.logoAssetId);
    const bgImageDataUri = await toDataUri(input.bgImageAssetId);

    // 4. 受限模板渲染 SVG → sharp 光栅化真实 PNG
    const template = POSTER_TEMPLATES[input.templateId];
    const svg = buildPosterSvg(input.templateId, {
      title: input.title,
      subtitle: input.subtitle,
      claimText,
      logoDataUri,
      bgImageDataUri,
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

  /**
   * 自动出海报（3.7）：给一个已批准卖点，自动填 产品名(标题) + 卖点(文案) + 官网图。
   * 有官网主图 → 用 hero-image 模板(图打底)；否则 simple-quote + logo。仍走同一套硬规则检查。
   */
  async autoRender(userId: string, projectId: string, claimId: string): Promise<RenderResult> {
    await this.assertOwner(userId, projectId);
    const picked = await this.db.withClient(async (client) => {
      // 产品名：已确认的 identity/name
      const { rows: nameRows } = await client.query<{ value: unknown }>(
        `SELECT f.value FROM product_brief_fields f
           JOIN product_briefs b ON b.id = f.brief_id
          WHERE b.project_id = $1 AND f.field_group = 'identity' AND f.field_key = 'name'
            AND f.status = 'confirmed' LIMIT 1`,
        [projectId],
      );
      // 已批准资产：logo + 主图
      const { rows: logo } = await client.query<{ id: string }>(
        `SELECT id FROM visual_assets WHERE project_id = $1 AND status = 'approved' AND kind = 'logo'
          ORDER BY CASE origin WHEN 'user' THEN 0 WHEN 'website' THEN 1 ELSE 2 END, created_at DESC LIMIT 1`,
        [projectId],
      );
      const { rows: hero } = await client.query<{ id: string }>(
        `SELECT id FROM visual_assets
          WHERE project_id = $1 AND status = 'approved' AND kind IN ('hero_image', 'product_screenshot')
          ORDER BY CASE origin WHEN 'user' THEN 0 WHEN 'website' THEN 1 ELSE 2 END,
                   CASE WHEN kind = 'hero_image' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
        [projectId],
      );
      let name = "";
      const v = nameRows[0]?.value;
      if (typeof v === "string") name = v;
      return { name, logoId: logo[0]?.id, heroId: hero[0]?.id };
    });

    return this.render(userId, projectId, {
      templateId: picked.heroId ? "hero-image" : "simple-quote",
      title: picked.name || "产品海报",
      claimId,
      logoAssetId: picked.logoId,
      bgImageAssetId: picked.heroId,
    });
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
