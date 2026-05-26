/**
 * PipelineModule — RAG pipeline 算法端点的 NestJS 模块。
 *
 * Wave 3 迁入 4 个端点：chunk / embedding / retrieval / generation。
 * 剩余 14 个端点在 Wave 4 迁入。
 */

import { Module } from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { ChunkController } from "./chunk.controller";
import { EmbeddingController } from "./embedding.controller";
import { RetrievalController } from "./retrieval.controller";
import { GenerationController } from "./generation.controller";

@Module({
  providers: [ProvidersService],
  controllers: [
    ChunkController,
    EmbeddingController,
    RetrievalController,
    GenerationController,
  ],
})
export class PipelineModule {}
