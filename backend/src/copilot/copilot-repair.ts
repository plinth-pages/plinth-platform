import type { OperationFailure } from "@plinth-pages/shared";
import type { ContextFile } from "./copilot-prompt";

/**
 * The second pass, when the safety net refuses the first one.
 *
 * Almost every rejection we see is a small slip rather than a bad idea: a section removed but its import left behind, a
 * renamed prop used in one place and not the other. The change is thrown away and the user is told it failed, which
 * reads as Plinth AI being unable to do the thing it just described doing. So the checks' own output goes back to the
 * model once, with the files as they now stand in the staging worktree.
 *
 * This runs only for honest mistakes: type and slot-contract failures. A rejection from the policy guards is the model
 * trying something it may not do, and asking it again just spends the user's tokens on the same refusal.
 */
export const REPAIR_SYSTEM_PROMPT = `You are Plinth AI, fixing your own change to a Next.js 15 + TypeScript + Tailwind portfolio before it reaches the user's site.

Your previous edits were applied to a scratch copy and did not compile. You are seeing the exact errors and the files as they now stand — already containing your edits.

- Fix ONLY what the errors report. Do not improve, restyle or refactor anything else, and do not undo the change you were asked to make.
- Most of these are loose ends: an import left behind after something was removed, a name that no longer exists, a prop that changed on one side only, a missing type. Read the error, find the loose end, tie it off.
- If a section or component was deliberately removed, remove everything that referenced it — the import, the JSX, and any now-unused helper.
- Respond ONLY by calling submit_changes, with edits and nothing else. Set refused=false.
- "search" must be copied exactly from the file content you were given and must appear exactly once in that file.
- If you cannot fix an error from what you were given, return no edits rather than guessing. A wrong guess is worse than an honest failure.
- "reply" is one short sentence naming what you tied off. The user never sees it unless the fix also fails.`;

/** Files worth sending: the ones the checks named, then the ones the first pass wrote. */
export function repairContext(files: ContextFile[], failures: OperationFailure[], edited: string[], budgetChars: number): ContextFile[] {
  const wanted = [...new Set([...failures.map((failure) => failure.file).filter((path): path is string => Boolean(path)), ...edited])];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included: ContextFile[] = [];
  let used = 0;
  for (const path of wanted) {
    const file = byPath.get(path);
    if (!file || used + file.content.length > budgetChars) continue;
    included.push(file);
    used += file.content.length;
  }
  return included;
}

export function describeFailures(failures: OperationFailure[]): string {
  return failures
    .map((failure) => {
      const where = failure.file ? `${failure.file}${failure.line ? `:${failure.line}` : ""}` : failure.source;
      return `- ${where} — ${failure.message}`;
    })
    .join("\n");
}

export function buildRepairTurn(request: string, failures: OperationFailure[], files: ContextFile[]): string {
  const blocks = files.map((file) => `<file path="${file.path}">\n${file.content}\n</file>`).join("\n");
  return `<original_request>
${request}
</original_request>

<errors>
${describeFailures(failures)}
</errors>

<files_as_they_stand>
${blocks}
</files_as_they_stand>

Fix the errors. Call submit_changes now.`;
}
