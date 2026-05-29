/**
 * MvpDocumentsService — feat-200.2 Week 2
 *
 * 业务规则：
 *   - 上传文档必须归属某个 project（路径参数携带）
 *   - owner 权限校验：所有方法都 JOIN projects 强制按 owner_id 过滤
 *   - 同一 project 下同 hash 文档允许多次上传，version 递增（与 idempotency stage 语义一致）
 *   - 上传文件落本地磁盘，PG 只存元数据；删除时 DB + 磁盘同步清理
 *
 * 与 ingestion 解耦：
 *   - create() 只负责把 record 落 PG + 文件落盘 + 立即返回 documentId/jobId
 *   - IngestionService 在 controller 层接力（按 docId 创建 ingestion_jobs 行 + 触发 runner）
 *   - 这样删除文档时不会被 ingestion 阻塞；ingestion 失败也不影响 document record
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID, createHash } from "crypto";
import { DbService } from "../db/db.service";
import { FileStorageService } from "./file-storage.service";
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type DocumentRow,
  type DocumentProcessingStatus,
} from "./mvp-documents.types";

interface DbDocumentRow {
  id: string;
  project_id: string;
  category: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  hash: string;
  version: number;
  processing_status: string;
  storage_ref: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DbDocumentRow): DocumentRow {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category as DocumentCategory,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    hash: row.hash,
    version: row.version,
    processingStatus: row.processing_status as DocumentProcessingStatus,
    storageRef: row.storage_ref,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class MvpDocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly storage: FileStorageService,
  ) {}

  /**
   * 上传新文档。
   * 步骤：
   *   1. 校验 category
   *   2. 校验 project owner（防跨用户上传）
   *   3. 计算 hash + 决定 version（同 hash 已存在则 +1）
   *   4. 文件落盘 + INSERT PG
   * 返回完整 DocumentRow 给上层（Controller 接着触发 ingestion job）。
   */
  async create(
    ownerId: string,
    projectId: string,
    input: {
      category: DocumentCategory;
      fileName: string;
      mimeType: string;
      buffer: Buffer;
    },
  ): Promise<DocumentRow> {
    if (!DOCUMENT_CATEGORIES.includes(input.category)) {
      throw new BadRequestException(
        `category 必须是 ${DOCUMENT_CATEGORIES.join(" / ")} 之一`,
      );
    }
    if (input.buffer.length === 0) {
      throw new BadRequestException("文件内容不能为空");
    }

    const docId = randomUUID();
    // 与 rag-core idempotency 的 sha256-content 同一算法
    const hash = createHash("sha256")
      .update(`${input.fileName}::${input.mimeType}::`)
      .update(input.buffer)
      .digest("hex");

    return this.db.withClient(async (client) => {
      // 1. owner 校验：先查项目存在且属于 owner，否则 404
      const projectCheck = await client.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1`,
        [projectId, ownerId],
      );
      if (projectCheck.rows.length === 0) {
        throw new NotFoundException("项目不存在");
      }

      // 2. version 决策：同 project + 同 hash → 取 max(version)+1（保留历史）
      const versionRes = await client.query<{ max: number | null }>(
        `SELECT MAX(version) AS max FROM documents
         WHERE project_id = $1 AND hash = $2`,
        [projectId, hash],
      );
      const nextVersion = (versionRes.rows[0].max ?? 0) + 1;

      // 3. 落盘（在 DB INSERT 前做：DB 写失败时 fs 文件成孤儿，cron 可清；反过来 DB 有
      //    record 但文件不存在会让 ingestion 失败，更难恢复）
      const storageRef = this.storage.save(
        projectId,
        docId,
        input.fileName,
        input.buffer,
      );

      // 4. INSERT
      const insertRes = await client.query<DbDocumentRow>(
        `INSERT INTO documents
           (id, project_id, category, file_name, mime_type, file_size, hash,
            version, processing_status, storage_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)
         RETURNING id, project_id, category, file_name, mime_type, file_size, hash,
                   version, processing_status, storage_ref, created_at, updated_at`,
        [
          docId,
          projectId,
          input.category,
          input.fileName,
          input.mimeType,
          input.buffer.length,
          hash,
          nextVersion,
          storageRef,
        ],
      );

      // 5. 维护 projects.docs_count（冗余字段，便于列表页快速展示）
      await client.query(
        `UPDATE projects SET docs_count = docs_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [projectId],
      );

      return mapRow(insertRes.rows[0]);
    });
  }

  /** 列表：按 project + 可选 category 过滤。owner 校验通过 JOIN 防越权。 */
  async list(
    ownerId: string,
    projectId: string,
    category?: DocumentCategory,
  ): Promise<DocumentRow[]> {
    return this.db.withClient(async (client) => {
      // 先确认 owner（list 空时也要区分"项目不存在"vs"项目存在但无文档"）
      const projectCheck = await client.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1`,
        [projectId, ownerId],
      );
      if (projectCheck.rows.length === 0) {
        throw new NotFoundException("项目不存在");
      }
      const params: unknown[] = [projectId];
      let sql = `SELECT id, project_id, category, file_name, mime_type, file_size, hash,
                        version, processing_status, storage_ref, created_at, updated_at
                 FROM documents WHERE project_id = $1`;
      if (category) {
        params.push(category);
        sql += ` AND category = $2`;
      }
      sql += ` ORDER BY created_at DESC`;
      const res = await client.query<DbDocumentRow>(sql, params);
      return res.rows.map(mapRow);
    });
  }

  /** 取单个文档（owner 校验通过 JOIN）。 */
  async get(
    ownerId: string,
    projectId: string,
    docId: string,
  ): Promise<DocumentRow> {
    return this.db.withClient(async (client) => {
      const res = await client.query<DbDocumentRow>(
        `SELECT d.id, d.project_id, d.category, d.file_name, d.mime_type, d.file_size,
                d.hash, d.version, d.processing_status, d.storage_ref, d.created_at, d.updated_at
         FROM documents d
         INNER JOIN projects p ON p.id = d.project_id
         WHERE d.id = $1 AND d.project_id = $2 AND p.owner_id = $3
         LIMIT 1`,
        [docId, projectId, ownerId],
      );
      if (res.rows.length === 0) throw new NotFoundException("文档不存在");
      return mapRow(res.rows[0]);
    });
  }

  /**
   * 删除：rag_chunks → documents → 磁盘文件。
   *
   * 历史 bug（feat-200.8.x P0 修）：rag_chunks 无 FK 到 documents，文档删除
   * 后 chunks 残留 → retrieval 仍能命中"幽灵内容"。原注释说"Week 3 再处理"
   * 但一直没补；现在显式 DELETE FROM rag_chunks。
   *
   * 不加 FK 的原因：rag_chunks 还服务 eval-matrix（用 16-char hash documentId，
   * documents 表无记录）和 legacy-playground 路径，加 FK 会让这些写入失败。
   * 应用层显式删 + ingestion 走 project_id 隔离 = 用户删除流程闭环。
   *
   * ingestion_jobs 走 FK ON DELETE CASCADE 自动清理。
   */
  async delete(
    ownerId: string,
    projectId: string,
    docId: string,
  ): Promise<void> {
    // 先取 storage_ref，再删 DB，最后删文件（顺序：能放手让 DB 兜底）
    const doc = await this.get(ownerId, projectId, docId);
    await this.db.withClient(async (client) => {
      // 1. 先删 rag_chunks——retrieval 立即不再命中本文档（防"幽灵召回"）
      const chunksRes = await client.query(
        `DELETE FROM rag_chunks WHERE document_id = $1`,
        [docId],
      );
      // 2. 删 documents（ingestion_jobs 通过 FK ON DELETE CASCADE 自动清掉）
      const res = await client.query(
        `DELETE FROM documents WHERE id = $1 AND project_id = $2`,
        [docId, projectId],
      );
      if (res.rowCount === 0) throw new NotFoundException("文档不存在");
      await client.query(
        `UPDATE projects SET docs_count = GREATEST(docs_count - 1, 0), updated_at = NOW()
         WHERE id = $1`,
        [projectId],
      );
      // 删除的 chunks 数量打日志，便于诊断
      if ((chunksRes.rowCount ?? 0) > 0) {
        console.log(`[mvp-documents] doc=${docId} 删除时连带清理 ${chunksRes.rowCount} 个 chunks`);
      }
    });
    // 文件删除：失败也不回滚 DB（已删的 record 留着比文件孤儿好处理）
    this.storage.delete(doc.storageRef);
  }

  /**
   * 内部 API：JobRunner 完成后回填 processing_status。
   * 不做 owner 校验，因为是后台任务调用。
   */
  async updateStatus(
    docId: string,
    status: DocumentProcessingStatus,
  ): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE documents SET processing_status = $1, updated_at = NOW()
         WHERE id = $2`,
        [status, docId],
      );
    });
  }
}
