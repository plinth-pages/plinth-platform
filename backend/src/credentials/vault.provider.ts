import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { Vault } from "./vault";

/** The vault, or null when CREDENTIALS_KEYS isn't configured — secret-backed integrations are then unavailable. */
export const VAULT = Symbol("VAULT");

export const vaultProvider: Provider = {
  provide: VAULT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => Vault.fromConfig(config.get("CREDENTIALS_KEYS", { infer: true }), config.get("CREDENTIALS_ACTIVE_KEY", { infer: true })),
};
