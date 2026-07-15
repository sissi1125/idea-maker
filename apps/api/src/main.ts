/**
 * dotenv 必须在 reflect-metadata 之前显式 require：
 *
 * 历史问题：package.json 里写的是 `ts-node-dev -r dotenv/config -r tsconfig-paths/register src/main.ts`，
 * 但 ts-node-dev 的 wrap 脚本只把 `tsconfig-paths/register` 传给 worker，`dotenv/config` 丢了。
 * 表现：apps/api/.env 里写的 LLM_API_KEY / EMBEDDING_API_KEY 在 process.env 里全是空，
 * 走 createEmbeddingClient 时 throw → 降级到 mock。
 *
 * 这里硬 require 一次（用 try/catch 防生产构建无 dotenv 依赖），保证 dev/prod 都能拿到 env。
 */
try {
  // 无论从仓库根目录还是 apps/api 启动，都固定读取 API 自己的 .env。
  require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
} catch { /* 生产环境无 dotenv 依赖时安静跳过 */ }

import "reflect-metadata";

/**
 * NestJS 入口 — feat-100.3 Wave 3
 *
 * 启动顺序：
 *   1. 创建 Nest 应用
 *   2. 注册全局 ValidationPipe（class-validator + class-transformer）
 *   3. 注册全局异常过滤器（PipelineError → HTTP envelope）
 *   4. CORS：允许 apps/web (http://localhost:3000) 跨域调用
 *   5. Swagger UI：/docs
 *   6. 监听 API_PORT (默认 3001)
 */

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { PipelineExceptionFilter } from "./common/pipeline-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 调大 body limit：默认 100kb 对 RAG pipeline 上游产物（cleanText / chunks /
  // embedding 向量）不够用。BODY_LIMIT 可通过 env 覆盖（默认 50mb）。
  const bodyLimit = process.env.BODY_LIMIT ?? "50mb";
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // CORS：开发期允许 Playground (3000) / NestJS dev (3001) / 任意预览口
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
    credentials: true,
  });

  // 全局 ValidationPipe — 自动验证 DTO（class-validator 装饰器）
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // upstreamOutput 字段太多，先不严格
    }),
  );

  // 全局异常过滤器 — 翻译 PipelineError
  app.useGlobalFilters(new PipelineExceptionFilter());

  // Swagger
  const config = new DocumentBuilder()
    .setTitle("Idea-Maker API")
    .setDescription(
      "NestJS 后端：feat-100.x RAG pipeline + feat-200.x MVP 业务（auth / projects / settings / ...）",
    )
    .setVersion("0.2.0")
    .addBearerAuth() // feat-200.1：JWT，UI 上加 Authorize 按钮
    .addTag("pipeline", "RAG pipeline 算法端点（feat-100.x）")
    .addTag("documents", "文档上传 / 列表 / 删除")
    .addTag("snapshots", "Stage snapshots + Pipeline run history")
    .addTag("auth", "登录 / 注册 / me（feat-200.1）")
    .addTag("projects", "项目 CRUD + settings（feat-200.1）")
    .addTag("health", "健康检查")
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, doc);

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] NestJS listening on http://localhost:${port}`);
  console.log(`[api] Swagger UI on http://localhost:${port}/docs`);
}

bootstrap();

// auto-deploy smoke test 20260629-2254
