import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Module, type DynamicModule } from "@nestjs/common";
import { generateKeyPairSync } from "crypto";
import { AppModule } from "../app.module";
import { PingProcessor } from "../jobs/ping.processor";
import { ProvisioningProcessor } from "../provisioning/provisioning.processor";
import { findProcessors } from "./topology";

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://127.0.0.1:6379",
  API_URL: "http://localhost:4000",
  ADMIN_URL: "http://localhost:3000",
  SESSION_SECRET: "x".repeat(32),
  GITHUB_CLIENT_ID: "test",
  GITHUB_CLIENT_SECRET: "test",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: Buffer.from(
    generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }),
  ).toString("base64"),
};

function graphFor(role: "api" | "worker") {
  Object.assign(process.env, baseEnv, { ORCHESTRATOR_ROLE: role });
  return AppModule.forRole(role);
}

@Processor("leaky")
class LeakyProcessor extends WorkerHost {
  async process() {}
}

@Module({ providers: [LeakyProcessor] })
class LeakyFeatureModule {}

describe("process role topology", () => {
  it("registers no queue processor in the api role", async () => {
    expect(await findProcessors(graphFor("api"))).toEqual([]);
  });

  it("registers the ping and provisioning processors in the worker role", async () => {
    expect(await findProcessors(graphFor("worker"))).toEqual(
      expect.arrayContaining([PingProcessor, ProvisioningProcessor]),
    );
  });

  it("detects a processor that leaks into an api-shaped graph", async () => {
    const api = graphFor("api");
    const leaky = { ...api, imports: [...(api.imports ?? []), LeakyFeatureModule] };
    expect(await findProcessors(leaky)).toEqual([LeakyProcessor]);
  });

  it("detects a processor hidden inside an async module", async () => {
    const api = graphFor("api");
    const asyncModule: Promise<DynamicModule> = Promise.resolve({
      module: class AsyncFeatureModule {},
      providers: [LeakyProcessor],
    });
    const leaky = { ...api, imports: [...(api.imports ?? []), asyncModule] };
    expect(await findProcessors(leaky)).toEqual([LeakyProcessor]);
  });
});
