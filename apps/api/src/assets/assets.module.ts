/**
 * AssetsModule — feat-400.5
 * 导出 AssetsService 供 PostersModule 读已批准资产。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FileStorageService } from "../mvp-documents/file-storage.service";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

@Module({
  imports: [AuthModule],
  controllers: [AssetsController],
  providers: [AssetsService, FileStorageService],
  exports: [AssetsService],
})
export class AssetsModule {}
