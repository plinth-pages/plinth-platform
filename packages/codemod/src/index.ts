import type { Options } from "prettier";

export { CodemodError, type CodemodErrorCode } from "./source";
export { addImport, removeImport, type Changed } from "./imports";
export { insertElement, insertProvider, removeBlock, listBlocks, type Block } from "./slots";
export { renderElement, renderProps, type PropValue } from "./props";
export {
  PORTFOLIO_FILES,
  installIntegration,
  moveIntegration,
  uninstallIntegration,
  type InstalledEntry,
  type Outcome,
  type Placement,
  type PortfolioFile,
  type PortfolioFiles,
  type ProjectResult,
} from "./project";

/**
 * Formats a file the way the portfolio does. The safety net also formats every touched file with the repository's own
 * Prettier config; this is for tests and for callers that want formatted output directly. Prettier is loaded on first
 * use, so services that only plan edits (the worker) never load it.
 */
export async function formatSource(source: string, filepath: string, options: Options = {}): Promise<string> {
  const prettier = await import("prettier");
  return prettier.format(source, { ...options, filepath });
}
