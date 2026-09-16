import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { existsSync } from "fs";
import { AppModule } from "./app.module";
import { validateEnv, type Env } from "./config/env";
import { describeRedis } from "./queue/redis-connection";
import { resolveRole } from "./config/role";

async function bootstrap() {
  const role = resolveRole();

  // Validate before Nest starts: ConfigModule validates asynchronously inside Nest's own error
  // handler, which buries the message under a framework stack trace.
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = validateEnv(process.env);
  // The api enqueues and the worker consumes: if these two lines differ between them, jobs are never picked up.
  Logger.log(`${role} using Redis ${describeRedis(env.REDIS_URL)}`, "Bootstrap");

  if (role === "worker") {
    const worker = await NestFactory.createApplicationContext(AppModule.forRole("worker"), {
      abortOnError: false,
    });
    worker.enableShutdownHooks();
    Logger.log(`Worker started (pid ${process.pid})`, "Bootstrap");
    return;
  }

  // rawBody: Stripe webhooks are verified against the exact bytes Stripe signed.
  const app = await NestFactory.create(AppModule.forRole("api"), { abortOnError: false, rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix("v1");
  app.use(cookieParser());
  app.enableCors({ origin: config.get("ADMIN_URL", { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  Logger.log(`API listening on :${port} (pid ${process.pid})`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  // Configuration errors are the common case here; print them plainly, without a Nest stack.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
