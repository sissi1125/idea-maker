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
import { AppModule } from "./app.module";
import { PipelineExceptionFilter } from "./common/pipeline-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    .setTitle("Harness RAG API")
    .setDescription(
      "NestJS 承接的 RAG pipeline 端点（feat-100.3 Wave 3，与 Next.js routes 双跑）",
    )
    .setVersion("0.1.0")
    .addTag("pipeline", "RAG pipeline 算法端点")
    .addTag("documents", "文档上传 / 列表 / 删除")
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
