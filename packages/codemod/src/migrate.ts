import { SLOTS, SLOTS_VERSION, SLOT_NAMES, findSlotFile, isSlotName, type SlotDefinition, type SlotName } from "@plinth-pages/core/slots";
import { CodemodError, applyEdits, findSlot, lineStart, parse } from "./source";

/**
 * Adding a slot to a portfolio that predates it.
 *
 * Generated repositories are never re-synced from the template, so a slot introduced after a portfolio was created
 * simply is not in its code. Until it is, an integration that needs that slot cannot be installed there at all — the
 * site works, and every new integration is quietly unavailable to it forever.
 *
 * A new slot is placed next to an existing one rather than at a position in the markup. A neighbouring slot survives
 * a redesign in a way that a `</main>` does not: a page rebuilt from scratch still has its other slots, wherever they
 * ended up, so the new one lands somewhere sensible in a layout this code has never seen.
 */

export interface SlotMigration {
  /** Files to write back, keyed by path. Empty when nothing needed doing. */
  files: Record<string, string>;
  added: SlotName[];
  /** Slots that should exist but could not be placed, with the reason. Never a failure: the rest still migrate. */
  skipped: { slot: SlotName; reason: string }[];
  from: number;
  to: number;
}

/** A slot that no file declares. Ordered as SLOTS is, so a slot's anchor is added before the slot that follows it. */
export function missingSlots(files: Record<string, string>): SlotName[] {
  return SLOT_NAMES.filter((name) => findSlotFile(files, name) === null);
}

function indentOf(source: string, position: number): string {
  return source.slice(lineStart(source, position), position).match(/^[ \t]*/)?.[0] ?? "      ";
}

/**
 * Inserts `<Slot name="…"></Slot>` on its own line directly after the anchor slot's element. Self-closing anchors and
 * anchors holding integrations are both fine: this never touches the anchor, only the text after it.
 */
export function insertSlotAfter(source: string, spec: { slot: string; after: string }, fileName = "file.tsx"): string {
  const file = parse(source, fileName);
  const anchor = findSlot(file, spec.after);
  const end = anchor.getEnd();
  const indent = indentOf(source, anchor.getStart(file));
  return applyEdits(source, [{ start: end, end, text: `\n${indent}<Slot name="${spec.slot}"></Slot>` }]);
}

function bumpVersion(plinthJson: string, to: number): string {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(plinthJson) as Record<string, unknown>;
  } catch {
    throw new CodemodError("PARSE_ERROR", "plinth.json isn't valid JSON.");
  }
  return `${JSON.stringify({ ...json, slotsVersion: to }, null, 2)}\n`;
}

export function readSlotsVersion(plinthJson: string): number {
  try {
    const value = (JSON.parse(plinthJson) as { slotsVersion?: unknown }).slotsVersion;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
  } catch {
    throw new CodemodError("PARSE_ERROR", "plinth.json isn't valid JSON.");
  }
}

/**
 * Brings a portfolio up to the current slot vocabulary. Only slots that are genuinely absent are added, so running
 * this twice changes nothing the second time, and a slot the owner moved is left exactly where they moved it.
 *
 * `plinth.json` records the new version only when every missing slot was placed. A portfolio that still lacks one has
 * not been migrated, and saying otherwise would stop us ever trying again.
 */
export function migrateSlots(files: Record<string, string>): SlotMigration {
  const plinthJson = files["plinth.json"];
  if (plinthJson === undefined) throw new CodemodError("PARSE_ERROR", "plinth.json is missing.");
  const from = readSlotsVersion(plinthJson);

  const next = { ...files };
  const added: SlotName[] = [];
  const skipped: SlotMigration["skipped"] = [];

  // Repeated passes, because a slot may anchor to one that is itself being added in this run, and the anchor is not
  // always declared first. Each pass places what it can; the loop ends when a pass places nothing new.
  const pending = new Set(missingSlots(files));
  const anchorless = (slot: SlotName, reason: string) => {
    pending.delete(slot);
    skipped.push({ slot, reason });
  };

  for (let placed = true; placed && pending.size > 0; ) {
    placed = false;
    for (const slot of SLOT_NAMES.filter((name) => pending.has(name))) {
      // Widened: SLOTS keeps literal types, so the optional fields are absent from the entries that do not set them.
      const definition: SlotDefinition = SLOTS[slot];
      if (definition.wraps) {
        // A wrapping slot has to enclose the page's children; where that is depends entirely on the layout, so this
        // is one for Plinth AI or the template, not for a blind insertion.
        anchorless(slot, "It wraps the page, so it has to be placed by hand.");
        continue;
      }
      const after = definition.after;
      if (!after || !isSlotName(after)) {
        anchorless(slot, "It has no neighbouring slot to be placed after.");
        continue;
      }
      // Look in `next`: the anchor may have been added by an earlier pass.
      const file = findSlotFile(next, after);
      if (!file) continue; // Maybe next time round, once its own anchor lands.
      try {
        next[file] = insertSlotAfter(next[file], { slot, after }, file);
        pending.delete(slot);
        added.push(slot);
        placed = true;
      } catch (error) {
        anchorless(slot, error instanceof CodemodError ? error.message : "It could not be placed.");
      }
    }
  }

  for (const slot of SLOT_NAMES.filter((name) => pending.has(name))) {
    const after = (SLOTS[slot] as SlotDefinition).after;
    skipped.push({ slot, reason: `The "${after}" slot it goes after is missing too.` });
  }

  const complete = skipped.length === 0;
  const to = complete ? SLOTS_VERSION : from;
  if (complete && from !== SLOTS_VERSION) next["plinth.json"] = bumpVersion(plinthJson, SLOTS_VERSION);

  const changed = Object.fromEntries(Object.keys(next).filter((path) => next[path] !== files[path]).map((path) => [path, next[path]]));
  return { files: changed, added, skipped, from, to };
}

/** True when this portfolio has slots to gain — cheap enough to call before queueing any work. */
export function needsSlotMigration(files: Record<string, string>): boolean {
  const version = files["plinth.json"] === undefined ? SLOTS_VERSION : readSlotsVersion(files["plinth.json"]);
  return version < SLOTS_VERSION || missingSlots(files).length > 0;
}

/** What to tell someone a slot is for, when reporting which ones a portfolio gained. */
export const slotDescription = (slot: SlotName): string => SLOTS[slot].description;

export { SLOTS_VERSION };
export type { SlotName };
