import { posix } from "path";

/** Paths the code viewer never lists or opens, whatever the request says. */
const REFUSED_SEGMENTS = new Set([".git", "node_modules", ".next", ".vercel", ".turbo"]);
const REFUSED_BASENAME = [/^\.env/i, /\.(pem|key|p12|pfx)$/i, /^\.npmrc$/i];

export class RefusedPathError extends Error {
  constructor(readonly path: string) {
    super(`This file can't be opened in the viewer: ${path}`);
    this.name = "RefusedPathError";
  }
}

/**
 * Normalises a workspace-relative path and refuses secrets and generated directories. Applied on the api before a
 * request is queued, and again on the worker against the file's real path — so a symlink in the repository pointing at
 * `.env.local` is refused too.
 */
export function viewablePath(input: string): string {
  if (typeof input !== "string" || !input || input.includes("\0") || input.includes("\\") || posix.isAbsolute(input)) {
    throw new RefusedPathError(String(input));
  }
  const normalized = posix.normalize(input);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) throw new RefusedPathError(input);

  const segments = normalized.split("/");
  if (segments.some((segment) => REFUSED_SEGMENTS.has(segment))) throw new RefusedPathError(input);
  if (REFUSED_BASENAME.some((pattern) => pattern.test(segments[segments.length - 1]))) throw new RefusedPathError(input);
  return normalized;
}

export function isViewable(path: string): boolean {
  try {
    viewablePath(path);
    return true;
  } catch {
    return false;
  }
}
