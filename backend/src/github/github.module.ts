import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { GitHubAppAuth } from "./github-app.auth";
import { GITHUB_REPOS, GitHubClient } from "./github.client";

/** The App's installation credentials. Also used to mint clone tokens for preview sandboxes. */
export const GITHUB_APP_AUTH = Symbol("GITHUB_APP_AUTH");

/** Worker only: the api never talks to GitHub as the App. */
@Module({
  providers: [
    {
      provide: GITHUB_APP_AUTH,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const pem = Buffer.from(config.get("GITHUB_APP_PRIVATE_KEY", { infer: true })!, "base64").toString("utf8");
        return new GitHubAppAuth(config.get("GITHUB_APP_ID", { infer: true })!, pem, config.get("GITHUB_ORG", { infer: true }));
      },
    },
    {
      provide: GITHUB_REPOS,
      inject: [GITHUB_APP_AUTH, ConfigService],
      useFactory: (auth: GitHubAppAuth, config: ConfigService<Env, true>) =>
        new GitHubClient(auth, config.get("GITHUB_ORG", { infer: true }), config.get("GITHUB_TEMPLATE_REPO", { infer: true })),
    },
  ],
  exports: [GITHUB_REPOS, GITHUB_APP_AUTH],
})
export class GitHubModule {}
