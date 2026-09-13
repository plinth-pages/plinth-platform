import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Roles, RolesGuard } from "../auth/roles";
import { SessionGuard } from "../auth/session.guard";
import { DevOnlyGuard } from "../common/dev-only.guard";
import type { Env } from "../config/env";

const STATE_COOKIE = "plinth_gh_app_state";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:620px;margin:64px auto;padding:0 24px;color:#18181b}
h1{font-size:24px;margin:0 0 12px}code{background:#f4f4f5;padding:1px 5px;border-radius:4px}
button,a.button{display:inline-block;background:#18181b;color:#fff;border:0;border-radius:6px;padding:10px 16px;font:inherit;text-decoration:none;cursor:pointer}
ol li{margin:6px 0}.muted{color:#71717a;font-size:14px}</style></head><body>${body}</body></html>`;

/**
 * Development helper that creates the provisioning GitHub App through GitHub's manifest flow, then
 * writes its ID and private key into backend/.env. The key never passes through a browser clipboard,
 * a chat window, or a screenshot.
 */
@Controller("dev/github-app")
@UseGuards(DevOnlyGuard, SessionGuard, RolesGuard)
@Roles("admin")
export class GitHubAppSetupController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get("new")
  start(@Res() res: Response) {
    const org = this.config.get("GITHUB_ORG", { infer: true });
    const apiUrl = this.config.get("API_URL", { infer: true });
    const state = randomBytes(24).toString("base64url");

    const manifest = {
      name: "Plinth Pages Provisioner",
      url: `https://github.com/${org}`,
      redirect_url: `${apiUrl}/v1/dev/github-app/callback`,
      description: "Creates and manages private portfolio repositories for Plinth.",
      public: false,
      default_permissions: { administration: "write", contents: "write", metadata: "read" },
      default_events: [],
    };

    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 15 * 60_000, path: "/" });
    res.type("html").send(
      page(
        "Create the Plinth GitHub App",
        `<h1>Create the provisioning GitHub App</h1>
        <p>This creates a <strong>private</strong> GitHub App owned by <code>${escapeHtml(org)}</code> that can
        create, branch and delete portfolio repositories. GitHub will show the permissions and ask you to confirm.</p>
        <ul><li>Repository administration — write <span class="muted">(create and delete repositories)</span></li>
        <li>Contents — write <span class="muted">(create the draft branch)</span></li>
        <li>Metadata — read</li></ul>
        <form action="https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}" method="post">
          <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
          <button type="submit">Continue to GitHub</button>
        </form>
        <p class="muted">If GitHub says the name is taken, change it on GitHub's page before creating.</p>`,
      ),
    );
  }

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const expected: string | undefined = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: "/" });
    if (!code || !state || !expected || !safeEqual(state, expected)) {
      throw new BadRequestException("This setup link expired. Start again at /v1/dev/github-app/new.");
    }

    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "plinth-pages" },
    });
    const app = (await response.json()) as { id?: number; slug?: string; pem?: string; message?: string };
    if (!response.ok || !app.id || !app.pem || !app.slug) {
      throw new BadRequestException(`GitHub did not return the App credentials: ${app.message ?? response.status}`);
    }

    const envPath = resolve(process.cwd(), ".env");
    upsertEnv(envPath, {
      GITHUB_APP_ID: String(app.id),
      GITHUB_APP_PRIVATE_KEY: Buffer.from(app.pem).toString("base64"),
    });

    const org = this.config.get("GITHUB_ORG", { infer: true });
    res.type("html").send(
      page(
        "GitHub App created",
        `<h1>✓ GitHub App created</h1>
        <p><code>${escapeHtml(app.slug)}</code> (App ID ${app.id}). Its ID and private key were written to
        <code>${escapeHtml(envPath)}</code>.</p>
        <p><strong>Two steps left:</strong></p>
        <ol>
          <li><a href="https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new">Install the App on
            <code>${escapeHtml(org)}</code></a> and choose <strong>All repositories</strong>.</li>
          <li>Restart the worker (<code>pnpm dev:worker</code>). It reads the new credentials at boot.</li>
        </ol>`,
      ),
    );
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function upsertEnv(path: string, values: Record<string, string>) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(path, text);
}
