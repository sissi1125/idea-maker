/**
 * PostersModule — feat-400.5
 * 依赖 AssetsModule（读已批准资产）。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AssetsModule } from "../assets/assets.module";
import { FileStorageService } from "../mvp-documents/file-storage.service";
import { PostersController } from "./posters.controller";
import { PostersService } from "./posters.service";

@Module({
  imports: [AuthModule, AssetsModule],
  controllers: [PostersController],
  providers: [PostersService, FileStorageService],
  exports: [PostersService],
})
export class PostersModule {}
