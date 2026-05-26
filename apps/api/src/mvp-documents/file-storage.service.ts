/**
 * FileStorageService — feat-200.2 Week 2
 *
 * 本地文件存储抽象：把上传的二进制 buffer 落到磁盘，对外返回相对路径。
 *
 * 为什么不存 PG：
 *   - documents.raw_content 如果是 PDF base64 几十 MB，BLOB 拖慢所有 SELECT
 *   - 磁盘存储未来切到 S3 / OSS 只改本 service 一个文件
 *
 * 路径策略：{uploadRoot}/{projectId}/{docId}.{ext}
 *   - 按 projectId 分子目录便于 owner 直接 rsync / 删除整个项目
 *   - docId 用 uuid，避免文件名冲突
 *
 * 升级位：Week 6+ 切 S3 时只需要重写本 service 的 save/read 实现，
 * 上层 MvpDocumentsService 不变。
 */

import { Injectable } from "@nestjs/common";
import fs from "fs";
import path from "path";

@Injectable()
export class FileStorageService {
  /** 上传根目录。默认 apps/api/data/uploads，可 env 覆盖（部署时指向持久卷）。 */
  private readonly uploadRoot: string;

  constructor() {
    const fromEnv = process.env.UPLOAD_ROOT;
    if (fromEnv) {
      this.uploadRoot = path.isAbsolute(fromEnv)
        ? fromEnv
        : path.resolve(process.cwd(), fromEnv);
    } else {
      // apps/api 启动 cwd 通常是 apps/api 本身（ts-node-dev 模式）
      this.uploadRoot = path.resolve(process.cwd(), "data/uploads");
    }
  }

  /**
   * 保存 buffer 到 {projectId}/{docId}{ext}。
   * 返回相对路径（用于写到 DB.storage_ref）。
   *
   * ext 从 fileName 推断（含点号，如 ".pdf"），未带后缀的文本用 ".txt"。
   */
  save(projectId: string, docId: string, fileName: string, buf: Buffer): string {
    const ext = path.extname(fileName) || ".bin";
    const relPath = path.join(projectId, `${docId}${ext}`);
    const absPath = path.join(this.uploadRoot, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, buf);
    return relPath;
  }

  /** 读取 buffer。文件不存在抛 ENOENT，由调用方决定如何降级。 */
  read(relPath: string): Buffer {
    return fs.readFileSync(path.join(this.uploadRoot, relPath));
  }

  /** 删除文件（不存在静默成功，幂等）。 */
  delete(relPath: string): void {
    try {
      fs.unlinkSync(path.join(this.uploadRoot, relPath));
    } catch (err) {
      // ENOENT 表示文件已被删过 / 从未存在，按幂等接受
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  /** 暴露绝对路径给需要 read stream 的场景（preprocess pymupdf 可能要 stream）。 */
  absolutePath(relPath: string): string {
    return path.join(this.uploadRoot, relPath);
  }
}
