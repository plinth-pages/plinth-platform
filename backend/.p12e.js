const fs = require("fs");
const edit = (f, pairs) => { let s = fs.readFileSync(f, "utf8"); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(f + ": " + a.slice(0, 70)); s = s.replace(a, b); } fs.writeFileSync(f, s); };
edit("src/operations/git-scripts.ts", [[`export const buildScript = () => \`# plinth:step=build
set -o pipefail
started=$(date +%s%3N)
pnpm exec plinth check --json > \${STATE}/op-plinth.json 2> \${STATE}/op-plinth.err
echo "PLINTH_PLINTH_CODE=$?"
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536 pnpm exec next build > \${STATE}/op-build.log 2>&1
echo "PLINTH_BUILD_CODE=$?"`, `export const buildScript = () => \`# plinth:step=build
set -o pipefail
started=$(date +%s%3N)
pnpm exec plinth check --json > \${STATE}/op-plinth.json 2> \${STATE}/op-plinth.err
echo "PLINTH_PLINTH_CODE=$?"
# The build sees the real secrets, as production will. .env* is git-ignored and removed right after.
if [ -n "$PLINTH_ENV_B64" ]; then (umask 077; printf '%s' "$PLINTH_ENV_B64" | base64 -d > .env.production.local); fi
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536 pnpm exec next build > \${STATE}/op-build.log 2>&1
echo "PLINTH_BUILD_CODE=$?"
rm -f .env.production.local
# Anything a visitor can download — the browser bundle and pre-rendered pages — must not contain a secret value.
leaked=""
if [ -n "$PLINTH_PROBES_B64" ] && [ -d .next ]; then
  while IFS= read -r -d '' probe; do
    name="\\${probe%%=*}"; value="\\${probe#*=}"
    if grep -rqF --include='*.js' --include='*.html' --include='*.rsc' --include='*.body' --include='*.json' --include='*.txt' -- "$value" .next/static .next/server/app 2>/dev/null; then
      leaked="$leaked $name"
    fi
  done < <(printf '%s' "$PLINTH_PROBES_B64" | base64 -d)
fi
echo "PLINTH_SECRET_LEAK=\\${leaked# }"`]]);
edit("src/operations/operation-runner.ts", [
  [`    @Inject(FOLLOW_UPS) private readonly followUps: FollowUpQueue,
  ) {}`, `    @Inject(FOLLOW_UPS) private readonly followUps: FollowUpQueue,
    @Optional() @Inject(SECRET_ENVIRONMENT) private readonly secrets: SecretEnvironment | null = null,
  ) {}`],
  [`      const built = await this.exec(externalId, "staging", buildScript(), {}, STEP_TIMEOUT.build);`, `      const built = await this.exec(externalId, "staging", buildScript(), await this.buildSecrets(operation.portfolioId), STEP_TIMEOUT.build);`],
  [`        ...(buildCode === 0 ? [] : parseBuildOutput(parts.build ?? built.stderr)),
      ];`, `        ...(buildCode === 0 ? [] : parseBuildOutput(parts.build ?? built.stderr)),
        ...(reported(built.stdout, "SECRET_LEAK")
          ? [{ source: "build" as const, message: \`A secret (\${reported(built.stdout, "SECRET_LEAK")}) appeared in the files visitors download, so nothing was published. Make sure it's only read in server code.\` }]
          : []),
      ];`],
  [`  private async queueFollowUps(`, `  /** The secrets for a production build, and the values to look for in its public output. Values never enter a log. */
  private async buildSecrets(portfolioId: string): Promise<Record<string, string>> {
    const env = (await this.secrets?.forPortfolio(portfolioId)) ?? {};
    const entries = Object.entries(env);
    if (entries.length === 0) return {};
    // Short values and email addresses can legitimately appear on a page (an inbox shown on the contact section).
    const probes = entries.filter(([, value]) => value.length >= 12 && !value.includes("@")).map(([key, value]) => \`\${key}=\${value}\`);
    return {
      PLINTH_ENV_B64: Buffer.from(renderEnvFile(env)).toString("base64"),
      ...(probes.length ? { PLINTH_PROBES_B64: Buffer.from(probes.join("\0") + "\0").toString("base64") } : {}),
    };
  }

  private async queueFollowUps(`],
]);
let s = fs.readFileSync("src/operations/operation-runner.ts", "utf8");
s = s.replace(/import \{([^}]*)\} from "@nestjs\/common";/, (m, g) => (g.includes("Optional") ? m : `import {${g.trimEnd()}, Optional } from "@nestjs/common";`));
s = s.replace(`import { OperationAborted } from "./operation-errors";`, `import { OperationAborted } from "./operation-errors";\nimport { SECRET_ENVIRONMENT, type SecretEnvironment } from "../credentials/credential-sync";\nimport { renderEnvFile } from "../sandbox/e2b.driver";`);
fs.writeFileSync("src/operations/operation-runner.ts", s);

edit("src/operations/integrations.service.ts", [
  [`    private readonly operations: OperationsService,
  ) {}`, `    private readonly operations: OperationsService,
    private readonly credentials: CredentialsService,
  ) {}`],
  [`    if (installed) throw new ConflictException(\`\${manifest.name} is already installed. Move or remove it instead.\`);`, `    if (installed) throw new ConflictException(\`\${manifest.name} is already installed. Move or remove it instead.\`);
    const missing = await this.credentials.missingFor(portfolioId, manifest.id);
    if (missing.length) throw new ConflictException({ statusCode: 409, code: "CREDENTIALS_REQUIRED", message: \`Connect your \${missing.join(" and ")} first.\` });`],
]);
s = fs.readFileSync("src/operations/integrations.service.ts", "utf8");
s = s.replace(`import { CatalogueService } from "../catalogue/catalogue.service";`, `import { CatalogueService } from "../catalogue/catalogue.service";\nimport { CredentialsService } from "../credentials/credentials.service";`);
fs.writeFileSync("src/operations/integrations.service.ts", s);
console.log("ok");
