import ts from "typescript";
import type { Changed } from "./imports";
import { assertComponent } from "./props";
import { CodemodError, applyEdits, attribute, findSlot, openingOf, parse, walk, type Edit, type SlotNode } from "./source";

const MARKER = /\/\*\s*plinth:([a-z0-9]+(?:-[a-z0-9]+)*):(start|end)\b[^*]*\*\//g;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Block {
  id: string;
  /** From the start marker's first character… */
  start: number;
  /** …to just past the end marker. */
  end: number;
}

const startMarker = (id: string) => `/* plinth:${id}:start */`;
const endMarker = (id: string) => `/* plinth:${id}:end */`;

function assertId(id: string) {
  if (!ID.test(id) || id === "imports") throw new CodemodError("INVALID_IDENTIFIER", `"${id}" isn't a valid integration id.`);
}

/** Pairs markers found at `positions` into blocks, refusing anything unpaired or nested. */
function pair(markers: { id: string; kind: string; start: number; end: number }[], where: string): Block[] {
  const blocks: Block[] = [];
  let open: { id: string; start: number } | null = null;
  for (const marker of markers) {
    if (marker.kind === "start") {
      if (open) throw new CodemodError("MARKERS_CORRUPT", `In ${where}, "${marker.id}" starts inside "${open.id}".`);
      open = { id: marker.id, start: marker.start };
    } else {
      if (!open || open.id !== marker.id) throw new CodemodError("MARKERS_CORRUPT", `In ${where}, the end marker for "${marker.id}" has no start.`);
      blocks.push({ id: open.id, start: open.start, end: marker.end });
      open = null;
    }
  }
  if (open) throw new CodemodError("MARKERS_CORRUPT", `In ${where}, "${open.id}" is never closed.`);
  return blocks;
}

/** Integration blocks among a slot's JSX children: `{/* plinth:id:start *\/}` … `{/* plinth:id:end *\/}`. */
function childBlocks(file: ts.SourceFile, node: SlotNode, slot: string): Block[] {
  if (ts.isJsxSelfClosingElement(node)) return [];
  const markers: { id: string; kind: string; start: number; end: number }[] = [];
  for (const child of node.children) {
    if (!ts.isJsxExpression(child) || child.expression) continue;
    const text = child.getText(file);
    for (const match of text.matchAll(MARKER)) {
      markers.push({ id: match[1], kind: match[2], start: child.getStart(file), end: child.getEnd() });
    }
  }
  return pair(markers, `slot "${slot}"`);
}

function providerArray(file: ts.SourceFile, node: SlotNode): ts.ArrayLiteralExpression | null {
  const wrap = attribute(openingOf(node), "wrap");
  if (!wrap) return null;
  const expression = wrap.initializer && ts.isJsxExpression(wrap.initializer) ? wrap.initializer.expression : undefined;
  if (!expression || !ts.isArrayLiteralExpression(expression)) {
    throw new CodemodError("SLOT_KIND", `The providers slot's wrap prop in ${file.fileName} must be an array literal.`);
  }
  return expression;
}

/** Provider blocks inside `wrap={[ /* plinth:id:start *\/ Provider /* plinth:id:end *\/ ]}`. */
function providerBlocks(file: ts.SourceFile, array: ts.ArrayLiteralExpression): Block[] {
  const text = file.text.slice(array.getStart(file), array.getEnd());
  const offset = array.getStart(file);
  const markers = [...text.matchAll(MARKER)].map((match) => ({
    id: match[1],
    kind: match[2],
    start: offset + match.index!,
    end: offset + match.index! + match[0].length,
  }));
  return pair(markers, "the providers wrap list");
}

/**
 * Places an element inside a slot, between its integration markers. Blocks in a slot are kept sorted by integration
 * id, so the result doesn't depend on the order things were installed in. Placing an id that is already in the slot
 * is a no-op.
 */
export function insertElement(source: string, spec: { slot: string; integrationId: string; element: string }, fileName = "file.tsx"): Changed {
  assertId(spec.integrationId);
  const file = parse(source, fileName);
  const node = findSlot(file, spec.slot);
  const blocks = childBlocks(file, node, spec.slot);
  if (blocks.some((block) => block.id === spec.integrationId)) return { source, changed: false };

  const block = `{${startMarker(spec.integrationId)}}\n${spec.element}\n{${endMarker(spec.integrationId)}}`;
  let edit: Edit;
  if (ts.isJsxSelfClosingElement(node)) {
    const attributes = node.attributes.getText(file);
    edit = { start: node.getStart(file), end: node.getEnd(), text: `<Slot ${attributes}>\n${block}\n</Slot>` };
  } else {
    const next = blocks.find((existing) => existing.id > spec.integrationId);
    const childrenStart = node.openingElement.getEnd();
    const childrenEnd = node.closingElement.getStart(file);
    // Append right after the last real child, so no blank line is left between blocks.
    const lastContent = childrenStart + source.slice(childrenStart, childrenEnd).trimEnd().length;
    edit = next
      ? { start: next.start, end: next.start, text: `${block}\n` }
      : lastContent === childrenStart
        ? { start: childrenStart, end: childrenEnd, text: `\n${block}\n` }
        : { start: lastContent, end: lastContent, text: `\n${block}` };
  }
  return { source: applyEdits(source, [edit]), changed: true };
}

/** Adds a provider to the providers slot's `wrap` list, kept sorted by integration id. */
export function insertProvider(source: string, spec: { integrationId: string; component: string }, fileName = "file.tsx"): Changed {
  assertId(spec.integrationId);
  assertComponent(spec.component);
  const file = parse(source, fileName);
  const node = findSlot(file, "providers");
  const entry = `${startMarker(spec.integrationId)} ${spec.component} ${endMarker(spec.integrationId)}`;
  const array = providerArray(file, node);

  if (!array) {
    const opening = openingOf(node);
    const at = opening.attributes.getEnd();
    return { source: applyEdits(source, [{ start: at, end: at, text: ` wrap={[${entry}]}` }]), changed: true };
  }
  const blocks = providerBlocks(file, array);
  if (blocks.some((block) => block.id === spec.integrationId)) return { source, changed: false };

  const next = blocks.find((existing) => existing.id > spec.integrationId);
  if (next) return { source: applyEdits(source, [{ start: next.start, end: next.start, text: `${entry}, ` }]), changed: true };
  if (array.elements.length === 0) {
    const at = array.getStart(file) + 1;
    return { source: applyEdits(source, [{ start: at, end: at, text: entry }]), changed: true };
  }
  const last = Math.max(array.elements[array.elements.length - 1].getEnd(), ...blocks.map((block) => block.end));
  return { source: applyEdits(source, [{ start: last, end: last, text: `, ${entry}` }]), changed: true };
}

/**
 * Removes exactly one integration's marked block from a slot — nothing around it. A slot left with only whitespace is
 * emptied, so insert-then-remove returns the original source once formatted. Removing an absent id is a no-op.
 */
export function removeBlock(source: string, spec: { slot: string; integrationId: string }, fileName = "file.tsx"): Changed {
  const file = parse(source, fileName);
  const node = findSlot(file, spec.slot);

  if (spec.slot === "providers") {
    const array = providerArray(file, node);
    const block = array && providerBlocks(file, array).find((b) => b.id === spec.integrationId);
    if (!block) return { source, changed: false };
    let { start, end } = block;
    const after = /^\s*,\s*/.exec(source.slice(end));
    if (after) end += after[0].length;
    else {
      const before = /,\s*$/.exec(source.slice(array!.getStart(file), start));
      if (before) start -= before[0].length;
    }
    return { source: applyEdits(source, [{ start, end, text: "" }]), changed: true };
  }

  if (ts.isJsxSelfClosingElement(node)) return { source, changed: false };
  const block = childBlocks(file, node, spec.slot).find((b) => b.id === spec.integrationId);
  if (!block) return { source, changed: false };

  const childrenStart = node.openingElement.getEnd();
  const childrenEnd = node.closingElement.getStart(file);
  const remaining = source.slice(childrenStart, block.start) + source.slice(block.end, childrenEnd);
  if (/^\s*$/.test(remaining)) {
    return { source: applyEdits(source, [{ start: childrenStart, end: childrenEnd, text: "" }]), changed: true };
  }
  // Take the whitespace in front of the block with it, so no blank line is left behind.
  const leading = /\s*$/.exec(source.slice(childrenStart, block.start))![0].length;
  return { source: applyEdits(source, [{ start: block.start - leading, end: block.end, text: "" }]), changed: true };
}

/** Every integration block in a file, by slot. */
export function listBlocks(source: string, fileName = "file.tsx"): { slot: string; integrationId: string }[] {
  const file = parse(source, fileName);
  const found: { slot: string; integrationId: string }[] = [];
  walk(file, (node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (!opening || opening.tagName.getText(file) !== "Slot") return;
    const nameAttribute = attribute(opening, "name");
    const slot = nameAttribute?.initializer && ts.isStringLiteral(nameAttribute.initializer) ? nameAttribute.initializer.text : null;
    if (!slot) return;
    const blocks = slot === "providers" ? (() => {
      const array = providerArray(file, node as SlotNode);
      return array ? providerBlocks(file, array) : [];
    })() : childBlocks(file, node as SlotNode, slot);
    for (const block of blocks) found.push({ slot, integrationId: block.id });
  });
  return found;
}
