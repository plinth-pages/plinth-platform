import ts from "typescript";

export type CodemodErrorCode =
  | "SLOT_NOT_FOUND"
  | "SLOT_DUPLICATE"
  | "SLOT_KIND"
  | "IMPORT_REGION_MISSING"
  | "MARKERS_CORRUPT"
  | "INVALID_IDENTIFIER"
  | "INVALID_PROP"
  | "PARSE_ERROR";

/**
 * A codemod that can't be applied safely. These are template or engine problems, never user errors: the operation
 * is rejected and recorded as a codemod failure, and nothing is written.
 */
export class CodemodError extends Error {
  constructor(
    readonly code: CodemodErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodemodError";
  }
}

export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Applies non-overlapping edits from the end backwards, so earlier offsets stay valid. */
export function applyEdits(source: string, edits: Edit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}

export function parse(source: string, fileName: string): ts.SourceFile {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (file as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) {
    const first = diagnostics[0];
    const { line } = file.getLineAndCharacterOfPosition(first.start ?? 0);
    throw new CodemodError("PARSE_ERROR", `${fileName}:${line + 1} can't be parsed: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
  }
  return file;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

export type SlotNode = ts.JsxElement | ts.JsxSelfClosingElement;

/** Finds `<Slot name="…">` by its literal name — never by surrounding code, position or indentation. */
export function findSlot(file: ts.SourceFile, slot: string): SlotNode {
  const found: SlotNode[] = [];
  walk(file, (node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (!opening || opening.tagName.getText(file) !== "Slot") return;
    if (literalAttribute(opening, "name") === slot) found.push(node as SlotNode);
  });
  if (found.length === 0) throw new CodemodError("SLOT_NOT_FOUND", `The "${slot}" slot isn't in ${file.fileName}.`);
  if (found.length > 1) throw new CodemodError("SLOT_DUPLICATE", `The "${slot}" slot appears ${found.length} times in ${file.fileName}.`);
  return found[0];
}

export function openingOf(node: SlotNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function literalAttribute(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): string | undefined {
  for (const property of opening.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name) continue;
    const initializer = property.initializer;
    if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
  }
  return undefined;
}

export function attribute(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}

/** Start of the line containing `position`. */
export function lineStart(source: string, position: number): number {
  return source.lastIndexOf("\n", position - 1) + 1;
}

/** Index just past the newline ending the line containing `position` (or the end of the text). */
export function lineEnd(source: string, position: number): number {
  const newline = source.indexOf("\n", position);
  return newline === -1 ? source.length : newline + 1;
}
