import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { GitHubAppAuth } from "./github-app.auth";
import { GITHUB_REPOS, GitHubClient } from "./github.client";

/** Worker only: the api never talks to GitHub as the App. */
@Module({
  providers: [
    {
      provide: GITHUB_REPOS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const org = config.get("GITHUB_ORG", { infer: true });
        const pem = Buffer.from(config.get("GITHUB_APP_PRIVATE_KEY", { infer: true })!, "base64").toString("utf8");
        const auth = new GitHubAppAuth(config.get("GITHUB_APP_ID", { infer: true })!, pem, org);
        return new GitHubClient(auth, org, config.get("GITHUB_TEMPLATE_REPO", { infer: true }));
      },
    },
  ],
  exports: [GITHUB_REPOS],
})
export class GitHubModule {}
