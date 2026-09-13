import { z } from "zod";
import { viewablePath } from "../workspace/workspace-policy";
import { MAX_FILE_BYTES, MAX_FILES_PER_EDIT } from "./operations.constants";

/**
 * An `edit` operation's input: whole-file writes and deletions. Paths follow the code viewer's policy — an operation
 * can never write secrets, git internals or installed packages.
 */
export const editInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(120).optional(),
    files: z
      .array(
        z.object({
          path: z.string().transform((path, ctx) => {
            try {
              return viewablePath(path);
            } catch (error) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Invalid path" });
              return z.NEVER;
            }
          }),
          content: z
            .string()
            .refine((content) => Buffer.byteLength(content) <= MAX_FILE_BYTES, `Files are limited to ${MAX_FILE_BYTES / 1024} KB`)
            .nullable(),
        }),
      )
      .min(1)
      .max(MAX_FILES_PER_EDIT),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const file of input.files) {
      if (seen.has(file.path)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${file.path} appears more than once` });
      seen.add(file.path);
    }
  });

export type EditInput = z.infer<typeof editInputSchema>;

/** A single-line commit subject. */
export function commitSubject(summary: string): string {
  const line = summary.replace(/\s+/g, " ").trim();
  return line.length > 72 ? `${line.slice(0, 71)}…` : line || "Edit";
}

export function defaultSummary(input: EditInput): string {
  if (input.summary) return input.summary;
  if (input.files.length === 1) return `${input.files[0].content === null ? "Delete" : "Edit"} ${input.files[0].path}`;
  return `Edit ${input.files.length} files`;
}
