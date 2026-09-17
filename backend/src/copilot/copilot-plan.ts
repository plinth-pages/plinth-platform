import { posix } from "path";
import { z } from "zod";
import { MAX_FILE_BYTES } from "../operations/operations.constants";
import { viewablePath } from "../workspace/workspace-policy";

export const MAX_EDITS = 8;
export const MAX_INTEGRATION_ACTIONS = 3;

const propValue = z.union([z.string().max(500), z.number().finite(), z.boolean()]);

/** What the model must return. Anything else is treated as a failed answer, never partially applied. */
export const copilotOutputSchema = z.object({
  refused: z.boolean(),
  reply: z.string().trim().min(1).max(800),
  title: z.string().trim().max(120).default(""),
  edits: z
    .array(
      z.object({
        action: z.enum(["replace", "create"]),
        path: z.string().min(1).max(200),
        search: z.string().max(20_000).optional(),
        replace: z.string().max(40_000).optional(),
        content: z.string().max(MAX_FILE_BYTES).optional(),
      }),
    )
    .max(MAX_EDITS)
    .default([]),
  integrations: z
    .array(
      z.object({
        action: z.enum(["install", "move", "uninstall"]),
        integrationId: z.string().min(1).max(64),
        slot: z.string().max(64).optional(),
        props: z.record(propValue).optional(),
      }),
    )
    .max(MAX_INTEGRATION_ACTIONS)
    .default([]),
});

export type CopilotOutput = z.infer<typeof copilotOutputSchema>;
export type CopilotEdit = CopilotOutput["edits"][number];

/** Where the co-pilot may write. Everything else — config, dependencies, the slot manifest, server routes — is off limits. */
const WRITABLE_PREFIXES = ["app/", "components/", "content/", "lib/"];
const WRITABLE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const CREATABLE_PREFIXES = ["components/", "content/"];
const FORBIDDEN_PATHS = [/^app\/api\//, /^middleware\.ts$/, /(^|\/)route\.ts$/];

/** Code the co-pilot must never introduce. Checked on the text it adds, not on the existing file. */
const FORBIDDEN_CODE: { pattern: RegExp; reason: string }[] = [
  { pattern: /dangerouslySetInnerHTML/, reason: "raw HTML injection" },
  { pattern: /<script\b/i, reason: "script tags" },
  { pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, reason: "dynamic code execution" },
  { pattern: /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/, reason: "network requests" },
  { pattern: /process\.env/, reason: "environment variables" },
  { pattern: /["']use server["']/, reason: "server actions" },
  { pattern: /(src|href)\s*=\s*\{?\s*["'`]https?:\/\/[^"'`]*\.js\b/i, reason: "external scripts" },
  { pattern: /@import\s+(url\()?["']?https?:/i, reason: "external stylesheets" },
];

/** Lines the codemod engine owns. Their multiset must be identical before and after a co-pilot edit. */
const PROTECTED_LINE = /<Slot\b|<\/Slot>|plinth:[a-z0-9-]+:(start|end)|plinth:imports:(start|end)/;

export class CopilotEditError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "CopilotEditError";
  }
}

export function writablePath(input: string, action: CopilotEdit["action"]): string {
  let path: string;
  try {
    path = viewablePath(input);
  } catch {
    throw new CopilotEditError(input, "That file can't be changed.");
  }
  const allowedPrefixes = action === "create" ? CREATABLE_PREFIXES : WRITABLE_PREFIXES;
  if (!allowedPrefixes.some((prefix) => path.startsWith(prefix)) || !WRITABLE_EXTENSIONS.has(posix.extname(path)) || FORBIDDEN_PATHS.some((re) => re.test(path))) {
    throw new CopilotEditError(path, "That file is managed by Plinth and can't be changed by the co-pilot.");
  }
  return path;
}

function protectedLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => PROTECTED_LINE.test(line))
    .map((line) => line.trim())
    .sort()
    .join("\n");
}

function assertSafeAddition(path: string, added: string) {
  for (const { pattern, reason } of FORBIDDEN_CODE) {
    if (pattern.test(added)) throw new CopilotEditError(path, `The change used ${reason}, which isn't allowed.`);
  }
}

/**
 * Applies the model's edits to the current files. All or nothing: any edit that doesn't apply cleanly, touches a
 * protected file or line, or adds forbidden code rejects the whole answer.
 */
export function applyEdits(edits: CopilotEdit[], read: (path: string) => string | null): { path: string; content: string }[] {
  const next = new Map<string, string>();
  for (const edit of edits) {
    const path = writablePath(edit.path, edit.action);
    const current = next.get(path) ?? read(path);

    if (edit.action === "create") {
      if (current !== null) throw new CopilotEditError(path, `${path} already exists.`);
      if (edit.content === undefined) throw new CopilotEditError(path, "A new file needs content.");
      assertSafeAddition(path, edit.content);
      if (PROTECTED_LINE.test(edit.content)) throw new CopilotEditError(path, "Slots and Plinth markers can't be added by the co-pilot.");
      next.set(path, edit.content);
      continue;
    }

    if (current === null) throw new CopilotEditError(path, `${path} doesn't exist.`);
    if (!edit.search || edit.replace === undefined) throw new CopilotEditError(path, "An edit needs the text to find and its replacement.");
    const first = current.indexOf(edit.search);
    if (first === -1) throw new CopilotEditError(path, "The code to change wasn't found — the file may have changed.");
    if (current.indexOf(edit.search, first + 1) !== -1) throw new CopilotEditError(path, "The code to change appears more than once.");

    assertSafeAddition(path, edit.replace);
    const updated = current.slice(0, first) + edit.replace + current.slice(first + edit.search.length);
    if (protectedLines(updated) !== protectedLines(current)) {
      throw new CopilotEditError(path, "Slots and integrations are managed by Plinth and can't be edited directly.");
    }
    if (Buffer.byteLength(updated) > MAX_FILE_BYTES) throw new CopilotEditError(path, "The file would be too large.");
    next.set(path, updated);
  }
  return [...next].filter(([path, content]) => content !== read(path)).map(([path, content]) => ({ path, content }));
}

/** Context sent to the model: the files it may read and edit, bounded so a large repository can't run up the bill. */
export const CONTEXT_DIRECTORIES = ["app", "components", "content", "lib"];
export const MAX_CONTEXT_BYTES = 120_000;
