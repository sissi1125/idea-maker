import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] NestJS listening on http://localhost:${port}`);
}

bootstrap();
