import { STAGING_DIR, WORKSPACE_DIR } from "../sandbox/e2b.driver";

/**
 * Shell scripts the operation runner executes inside the sandbox. Each starts with a `# plinth:step=<name>` line
 * (tests match on it) and reports results as `PLINTH_<KEY>=value` lines or `---PLINTH:<section>---` blocks.
 *
 * Values that come from users (commit subjects, operation ids) are passed as environment variables, never
 * interpolated into the script text.
 */

const STATE = "/home/user/.plinth";
export const OPERATION_BRANCH_PREFIX = "plinth/op-";

/** Exit codes the runner maps to decisions. */
export const EXIT = {
  dirty: 20,
  ahead: 21,
  diverged: 22,
  noChanges: 30,
  installFailed: 31,
  formatFailed: 32,
} as const;

const header = (step: string) => `# plinth:step=${step}\nset -eo pipefail\n`;

const removeStaging = `git -C ${WORKSPACE_DIR} worktree remove --force ${STAGING_DIR} 2>/dev/null || rm -rf ${STAGING_DIR}
git -C ${WORKSPACE_DIR} worktree prune
git -C ${WORKSPACE_DIR} for-each-ref --format='%(refname:short)' refs/heads/${OPERATION_BRANCH_PREFIX} | xargs -r git -C ${WORKSPACE_DIR} branch -q -D`;

/**
 * 0–1. PRECONDITION and STAGE (live tree). The live tree must be clean and at origin/draft. A tree that is ahead has
 * an unpushed commit (reported so the runner can push it first); anything else means something outside Plinth
 * changed the workspace, and the operation stops rather than guess.
 */
export const stageScript = () => `${header("stage")}
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "PLINTH_DIRTY"; git status --porcelain --untracked-files=all | head -20; exit ${EXIT.dirty}
fi
head=$(git rev-parse HEAD)
remote=$(git rev-parse origin/draft)
if [ "$head" != "$remote" ]; then
  if git merge-base --is-ancestor "$remote" "$head"; then echo "PLINTH_AHEAD"; exit ${EXIT.ahead}; fi
  echo "PLINTH_DIVERGED"; exit ${EXIT.diverged}
fi
${removeStaging}
mkdir -p ${STATE}
git worktree add -q -B "$PLINTH_BRANCH" ${STAGING_DIR} HEAD
# Dependencies are shared with the live tree unless the operation changes them.
ln -s ${WORKSPACE_DIR}/node_modules ${STAGING_DIR}/node_modules
if [ -f next-env.d.ts ]; then cp next-env.d.ts ${STAGING_DIR}/next-env.d.ts; fi
echo "PLINTH_HEAD=$head"
`;

/**
 * Creates parent directories for files about to be written and deletes removed files (staging tree). Both lists
 * arrive NUL-separated and base64-encoded, so no path is ever parsed by the shell.
 */
export const prepareFilesScript = () => `${header("files")}
if [ -n "$PLINTH_DIRS" ]; then printf '%s' "$PLINTH_DIRS" | base64 -d | xargs -0 -r mkdir -p --; fi
if [ -n "$PLINTH_DELETE" ]; then printf '%s' "$PLINTH_DELETE" | base64 -d | xargs -0 -r rm -f --; fi
`;

export const nulList = (items: string[]) => Buffer.from(items.join("\0")).toString("base64");

/** Writes a vendored package tarball into the staging tree (binary, so it travels base64-encoded). */
export const vendorScript = () => `${header("vendor")}
mkdir -p "$(dirname "$PLINTH_PATH")"
printf '%s' "$PLINTH_B64" | base64 -d > "$PLINTH_PATH"
`;

/** 2 and 4. DEPENDENCIES and FORMAT (staging tree). */
export const prepareScript = () => `${header("prepare")}
git add -A
if git diff --cached --quiet; then echo "PLINTH_NO_CHANGES"; exit ${EXIT.noChanges}; fi
if git diff --cached --name-only | grep -qxE 'package\\.json|pnpm-lock\\.yaml'; then
  rm -f node_modules
  if ! CI=true pnpm install --prefer-offline --no-frozen-lockfile > ${STATE}/op-install.log 2>&1; then
    echo "---PLINTH:install---"; tail -n 40 ${STATE}/op-install.log; exit ${EXIT.installFailed}
  fi
  echo "PLINTH_DEPS=1"
fi
if ! git diff --cached --name-only -z --diff-filter=ACMR | grep -zvxE 'pnpm-lock\\.yaml' \\
    | xargs -0 -r pnpm exec prettier --write --ignore-unknown --log-level warn > ${STATE}/op-format.log 2>&1; then
  echo "---PLINTH:format---"; tail -n 60 ${STATE}/op-format.log; exit ${EXIT.formatFailed}
fi
git add -A
echo "---PLINTH:stat---"
git diff --cached --stat=120 | tail -n 30
`;

/**
 * 5–6. VALIDATE and TYPE-CHECK (staging tree), in parallel — the sandbox has two cores and each tool uses one.
 * Build info is kept outside the worktree, so each operation's type-check is incremental on the last one.
 */
export const checkScript = () => `# plinth:step=check
set -o pipefail
started=$(date +%s%3N)
( pnpm exec plinth check --json > ${STATE}/op-plinth.json 2> ${STATE}/op-plinth.err; echo $? > ${STATE}/op-plinth.code ) &
( pnpm exec tsc --noEmit --pretty false --incremental --tsBuildInfoFile ${STATE}/tsc.tsbuildinfo > ${STATE}/op-tsc.out 2>&1; echo $? > ${STATE}/op-tsc.code ) &
wait
echo "PLINTH_CHECK_MS=$(( $(date +%s%3N) - started ))"
echo "PLINTH_PLINTH_CODE=$(cat ${STATE}/op-plinth.code)"
echo "PLINTH_TSC_CODE=$(cat ${STATE}/op-tsc.code)"
echo "---PLINTH:plinth---"; head -c 60000 ${STATE}/op-plinth.json
echo
echo "---PLINTH:plinth-err---"; tail -c 4000 ${STATE}/op-plinth.err
echo "---PLINTH:tsc---"; head -c 60000 ${STATE}/op-tsc.out
`;

/**
 * Shell function: makes the live tree's node_modules match a revision's package.json and lockfile *before* that
 * revision's code reaches the dev server. Next compiles a file the moment it changes; if an import isn't linked yet
 * the page fails with "Module not found", and that error stays until the file changes again. The manifest, lockfile
 * and any vendored tarballs are borrowed from the revision for the install and put back afterwards, so the merge or
 * revert that follows starts from a clean tree.
 */
const linkDependencies = `link_dependencies() {
  rev="$1"
  git show "$rev:package.json" > package.json
  if git cat-file -e "$rev:pnpm-lock.yaml" 2>/dev/null; then git show "$rev:pnpm-lock.yaml" > pnpm-lock.yaml; fi
  vendored=$(git diff --name-only --diff-filter=A HEAD "$rev" -- vendor)
  for f in $vendored; do mkdir -p "$(dirname "$f")"; git show "$rev:$f" > "$f"; done
  linked=0
  CI=true pnpm install --frozen-lockfile --offline > ${STATE}/op-live-install.log 2>&1 \\
    || CI=true pnpm install --frozen-lockfile --prefer-offline >> ${STATE}/op-live-install.log 2>&1 \\
    || linked=1
  git checkout -q -- package.json
  git checkout -q -- pnpm-lock.yaml 2>/dev/null || true
  for f in $vendored; do rm -f "$f"; done
  return $linked
}`;

/**
 * 8. APPLY. Commit in the worktree with an Operation-Id trailer, link any new dependencies, then fast-forward the
 * live tree — the only moment the dev server sees the change. The sha is reported as soon as the live tree has it.
 */
export const applyScript = () => `${header("apply")}
${linkDependencies}
cd ${STAGING_DIR}
git add -A
git commit -q -m "$PLINTH_SUBJECT" -m "Operation-Id: $PLINTH_OPERATION_ID"
cd ${WORKSPACE_DIR}
if [ "$PLINTH_DEPS" = "1" ] && ! link_dependencies "$PLINTH_BRANCH"; then
  echo "---PLINTH:install---"; tail -n 40 ${STATE}/op-live-install.log
  exit ${EXIT.installFailed}
fi
git merge -q --ff-only "$PLINTH_BRANCH"
echo "PLINTH_SHA=$(git rev-parse HEAD)"
${removeStaging}
`;

/** 7. REJECT: throw the worktree away. The live tree was never touched. */
export const discardScript = () => `${header("discard")}
${removeStaging}
`;

/** Pushes the live tree's HEAD to draft. Git updates origin/draft on success. */
export const pushScript = () => `${header("push")}
git push -q origin HEAD:draft
echo "PLINTH_PUSHED=$(git rev-parse HEAD)"
`;

/**
 * 9. HEALTH CHECK (live tree). Requests each affected route twice, a moment apart, so the second request sees the
 * recompiled code. A 5xx or Next's error document means the change broke rendering.
 */
export const healthScript = () => `# plinth:step=health
set -o pipefail
sleep 1.5
for pass in 1 2; do
  for route in $PLINTH_ROUTES; do
    code=$(curl -s -o ${STATE}/op-health.html -w '%{http_code}' --max-time 90 "http://127.0.0.1:3000$route" || true)
    if [ "\${code:0:1}" = "5" ] || [ "$code" = "000" ] || grep -q 'id="__next_error__"' ${STATE}/op-health.html 2>/dev/null; then
      echo "PLINTH_UNHEALTHY=$route $code"
      echo "---PLINTH:log---"; tail -n 40 ${STATE}/dev.log | grep -v '^\\s*$' | tail -n 25
      exit 0
    fi
  done
  sleep 1.5
done
echo "PLINTH_HEALTHY=1"
`;

/** Undoes the last commit with a revert commit carrying the same Operation-Id trailer. */
export const revertScript = () => `${header("revert")}
${linkDependencies}
if git diff --name-only HEAD~1 HEAD | grep -qxE 'package\\.json|pnpm-lock\\.yaml'; then
  link_dependencies HEAD~1 || true
fi
git revert --no-commit HEAD
git commit -q -m "Revert: $PLINTH_SUBJECT" -m "The change broke rendering, so Plinth undid it." -m "Operation-Id: $PLINTH_OPERATION_ID"
echo "PLINTH_SHA=$(git rev-parse HEAD)"
`;

/**
 * PUBLISH 1. Fetches main and reports how draft relates to it. Publishing is always a fast-forward, because only
 * Publish writes main: if main has commits draft doesn't, something outside Plinth changed it and publishing stops.
 */
export const publishStatusScript = () => `${header("publish-status")}
git fetch -q origin +refs/heads/main:refs/remotes/origin/main
head=$(git rev-parse HEAD)
main=$(git rev-parse origin/main)
echo "PLINTH_HEAD=$head"
echo "PLINTH_MAIN=$main"
echo "PLINTH_AHEAD_BY=$(git rev-list --count origin/main..HEAD)"
if git merge-base --is-ancestor origin/main HEAD; then echo "PLINTH_FAST_FORWARD=1"; else echo "PLINTH_FAST_FORWARD=0"; fi
`;

/**
 * PUBLISH 2. Pre-flight in the staging worktree: the slot contract, then a production build — the same build the host
 * will run, so a failure is caught before anything is published.
 */
export const buildScript = () => `# plinth:step=build
set -o pipefail
started=$(date +%s%3N)
pnpm exec plinth check --json > ${STATE}/op-plinth.json 2> ${STATE}/op-plinth.err
echo "PLINTH_PLINTH_CODE=$?"
# The build sees the real secrets, as production will. .env* is git-ignored and removed right after.
if [ -n "$PLINTH_ENV_B64" ]; then (umask 077; printf '%s' "$PLINTH_ENV_B64" | base64 -d > .env.production.local); fi
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536 pnpm exec next build > ${STATE}/op-build.log 2>&1
echo "PLINTH_BUILD_CODE=$?"
rm -f .env.production.local
# Anything a visitor can download (the browser bundle and pre-rendered pages) must not contain a secret value.
leaked=""
if [ -n "$PLINTH_PROBES_B64" ] && [ -d .next ]; then
  while IFS= read -r -d '' probe; do
    name="\${probe%%=*}"; value="\${probe#*=}"
    if grep -rqF --include='*.js' --include='*.html' --include='*.rsc' --include='*.body' --include='*.json' --include='*.txt' -- "$value" .next/static .next/server/app 2>/dev/null; then
      leaked="$leaked $name"
    fi
  done < <(printf '%s' "$PLINTH_PROBES_B64" | base64 -d)
fi
echo "PLINTH_SECRET_LEAK=\${leaked# }"
echo "PLINTH_CHECK_MS=$(( $(date +%s%3N) - started ))"
echo "---PLINTH:plinth---"; head -c 60000 ${STATE}/op-plinth.json
echo
echo "---PLINTH:plinth-err---"; tail -c 4000 ${STATE}/op-plinth.err
echo "---PLINTH:build---"; tail -n 60 ${STATE}/op-build.log | tail -c 12000
`;

/** PUBLISH 3. Moves main to the checked commit. Never forced: GitHub refuses anything that isn't a fast-forward. */
export const publishPushScript = () => `${header("publish-push")}
git push -q origin "$PLINTH_SHA:refs/heads/main"
echo "PLINTH_PUBLISHED=$PLINTH_SHA"
`;

/** Finds the commit an interrupted operation made, if it got that far. */
export const findOperationCommitScript = () => `${header("find-commit")}
git log -n 50 --format='%H %s' --grep="Operation-Id: $PLINTH_OPERATION_ID" | head -n 1
`;

/** Routes whose rendering a change can affect: always the home page, plus any page file it touched. */
export function affectedRoutes(changedFiles: string[]): string[] {
  const routes = new Set(["/"]);
  for (const file of changedFiles) {
    const match = /^app\/(.*?)\/?page\.(tsx|ts|jsx|js|mdx)$/.exec(file);
    if (!match) continue;
    const segments = match[1].split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
    if (segments.some((segment) => segment.startsWith("["))) continue; // dynamic routes need real params
    routes.add(`/${segments.join("/")}`.replace(/\/$/, "") || "/");
  }
  return [...routes];
}

/**
 * Co-pilot context (staging tree): the tracked source files it may read, each in its own section, up to a byte budget.
 * Paths come from git, so ignored and generated files are never included.
 */
export const contextScript = () => `${header("context")}
budget=$PLINTH_MAX_BYTES
git ls-files -z -- $PLINTH_DIRS | while IFS= read -r -d '' f; do
  case "$f" in *.ts|*.tsx|*.css) ;; *) continue ;; esac
  size=$(wc -c < "$f")
  if [ "$size" -gt "$budget" ]; then echo "PLINTH_TRUNCATED=1"; break; fi
  budget=$((budget - size))
  echo "---PLINTH:file:$f---"
  cat "$f"
  echo
done
`;
