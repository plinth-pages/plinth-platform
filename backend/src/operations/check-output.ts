import type { OperationFailure } from "@plinth-pages/shared";

const MAX_FAILURES = 50;

/**
 * Parses `tsc --pretty false` output: `app/page.tsx(12,5): error TS2322: Type 'number' is not assignable…`.
 * Indented continuation lines belong to the error above them. Errors without a location are kept too.
 */
export function parseTscOutput(output: string): OperationFailure[] {
  const failures: OperationFailure[] = [];
  for (const line of output.split(/\r?\n/)) {
    const located = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    const global = /^error (TS\d+): (.*)$/.exec(line);
    if (located) {
      failures.push({ source: "tsc", file: located[1], line: Number(located[2]), code: located[3], message: located[4] });
    } else if (global) {
      failures.push({ source: "tsc", code: global[1], message: global[2] });
    } else if (/^\s+\S/.test(line) && failures.length) {
      failures[failures.length - 1].message += `\n${line.trim()}`;
    }
  }
  return failures.slice(0, MAX_FAILURES);
}

/** Parses `plinth check --json`. Output that isn't a report is itself a failure: the check must not pass silently. */
export function parsePlinthCheck(stdout: string, stderr: string, exitCode: number): OperationFailure[] {
  try {
    const report = JSON.parse(stdout) as { ok: boolean; issues: { code: string; file?: string; line?: number; message: string }[] };
    if (report.ok && exitCode === 0) return [];
    const issues = report.issues.map((issue) => ({ source: "plinth" as const, ...issue }));
    return (issues.length ? issues : [{ source: "plinth" as const, message: "plinth check failed without listing an issue" }]).slice(0, MAX_FAILURES);
  } catch {
    return [{ source: "plinth", message: `plinth check did not produce a report: ${(stderr || stdout).trim().slice(-800) || `exit ${exitCode}`}` }];
  }
}

/** Splits the sections a multi-part sandbox script prints between `---PLINTH:<name>---` markers. */
export function sections(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /^---PLINTH:([a-z-]+)---$/gm;
  const marks = [...stdout.matchAll(pattern)];
  marks.forEach((mark, index) => {
    const start = mark.index! + mark[0].length + 1;
    const end = index + 1 < marks.length ? marks[index + 1].index! : stdout.length;
    out[mark[1]] = stdout.slice(start, end).replace(/\n$/, "");
  });
  return out;
}

/** `KEY=value` lines a script prints to report results. */
export function reported(stdout: string, key: string): string | null {
  const match = new RegExp(`^PLINTH_${key}=(.*)$`, "m").exec(stdout);
  return match ? match[1].trim() : null;
}

/**
 * Picks the useful lines out of a failed `next build`: compiler and lint errors with their locations, or the tail of
 * the log when nothing matches.
 */
export function parseBuildOutput(log: string): OperationFailure[] {
  const lines = log.split(/\r?\n/).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const failures: OperationFailure[] = [];

  // ESLint, as printed by next build:  ./app/page.tsx  then  12:7  Error: `'` can be escaped…  react/no-unescaped-entities
  let file: string | undefined;
  for (const line of lines) {
    const fileLine = /^\.\/(\S+\.(?:tsx?|jsx?|mjs|cjs))$/.exec(line.trim());
    if (fileLine) {
      file = fileLine[1];
      continue;
    }
    const lint = /^(\d+):\d+\s+Error:\s+(.*?)(?:\s{2,}(\S+))?$/.exec(line.trim());
    if (lint && file) failures.push({ source: "build", file, line: Number(lint[1]), code: lint[3], message: lint[2] });
  }

  // Type and compile errors:  ./app/page.tsx:12:7  then  Type error: …
  for (let i = 0; i < lines.length; i++) {
    const located = /^\.\/(\S+):(\d+):\d+$/.exec(lines[i].trim());
    const next = lines[i + 1]?.trim() ?? "";
    if (located && /(Type error|Error|error):/.test(next)) {
      failures.push({ source: "build", file: located[1], line: Number(located[2]), message: next });
    }
  }

  if (failures.length) return failures.slice(0, 50);
  const tail = lines.filter((line) => line.trim()).slice(-15).join("\n");
  return [{ source: "build", message: tail || "The production build failed without printing an error." }];
}
