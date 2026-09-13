// Builds the E2B template every portfolio preview sandbox boots from.
//
//   node scripts/build-e2b-template.js [path-to-plinth-template]
//
// Re-run when plinth-template's dependencies change: the pnpm store is pre-warmed from its lockfile, so
// `pnpm install` inside a new sandbox links from disk instead of downloading.
//
// Why a custom template at all: E2B's default `base` template has 512 MiB of RAM, Node 20.9 and no pnpm —
// too small to run `next dev` alongside the type-checks the safety net needs.
process.loadEnvFile(".env");
const path = require("path");
const { Template } = require("e2b");

const templateDir = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "..", "..", "plinth-template"));
const name = process.env.E2B_TEMPLATE || "plinth-portfolio";

const template = Template({ fileContextPath: templateDir })
  .fromNodeImage("24")
  .aptInstall(["git", "curl", "procps"])
  .runCmd("npm install --global pnpm@9.15.9", { user: "root" })
  .copy(["package.json", "pnpm-lock.yaml"], "/home/user/.plinth-warm/")
  // COPY copies a directory's contents, so the tarballs need an explicit destination to keep their
  // `file:vendor/...` lockfile paths valid.
  .copy("vendor", "/home/user/.plinth-warm/vendor/")
  // COPY leaves the directories owned by root; pnpm needs to write temp files next to the lockfile.
  .runCmd("chown -R user:user /home/user/.plinth-warm", { user: "root" })
  .runCmd("cd /home/user/.plinth-warm && pnpm fetch --frozen-lockfile && pnpm store path", { user: "user" })
  .setWorkdir("/home/user");

const started = Date.now();
console.log(`Building E2B template "${name}" from ${templateDir}`);

Template.build(template, name, {
  apiKey: process.env.E2B_API_KEY,
  cpuCount: 2,
  memoryMB: 2048,
  onBuildLogs: (entry) => console.log(`  ${entry.message ?? JSON.stringify(entry)}`.slice(0, 220)),
})
  .then((info) => {
    console.log(`\nBuilt in ${Math.round((Date.now() - started) / 1000)} s:`, JSON.stringify(info));
  })
  .catch((error) => {
    console.error("\nTemplate build failed:", error.message);
    process.exit(1);
  });
