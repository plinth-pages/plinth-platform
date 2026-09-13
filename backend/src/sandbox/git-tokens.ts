export const GIT_TOKENS = Symbol("GIT_TOKENS");

/** The GitHub App's credentials for git inside a sandbox: short-lived tokens, and the bot identity commits use. */
export interface GitTokenSource {
  installationToken(): Promise<string>;
  botIdentity(): Promise<{ name: string; email: string }>;
}
