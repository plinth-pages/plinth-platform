import { SLOTS, type SlotDefinition, type SlotName } from "@plinth-pages/core/slots";
import { addImport, removeImport } from "./imports";
import { renderElement, type PropValue } from "./props";
import { CodemodError } from "./source";
import { insertElement, insertProvider, removeBlock } from "./slots";

export const PORTFOLIO_FILES = ["app/layout.tsx", "app/page.tsx", "plinth.json"] as const;
export type PortfolioFile = (typeof PORTFOLIO_FILES)[number];
export type PortfolioFiles = Record<PortfolioFile, string>;

export interface Placement {
  id: string;
  package: string;
  version: string;
  slot: SlotName;
  /** The named export to render. */
  component: string;
  kind: "element" | "provider";
  props: Record<string, PropValue>;
}

export interface InstalledEntry {
  id: string;
  package: string;
  version: string;
  slot: SlotName;
  props: Record<string, PropValue>;
}

export type Outcome = "installed" | "already_installed" | "uninstalled" | "not_installed" | "moved" | "already_there";

export interface ProjectResult {
  files: PortfolioFiles;
  /** Files whose content differs from the input. */
  changed: PortfolioFile[];
  outcome: Outcome;
}

interface PlinthJson {
  integrations: InstalledEntry[];
  [key: string]: unknown;
}

function readPlinthJson(text: string): PlinthJson {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CodemodError("PARSE_ERROR", "plinth.json isn't valid JSON.");
  }
  if (!json || typeof json !== "object" || !Array.isArray((json as PlinthJson).integrations)) {
    throw new CodemodError("PARSE_ERROR", "plinth.json has no integrations list.");
  }
  return json as PlinthJson;
}

/** Integrations sorted by id, so plinth.json never depends on install order. */
function writePlinthJson(json: PlinthJson): string {
  const integrations = [...json.integrations].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ ...json, integrations }, null, 2)}\n`;
}

const fileOf = (slot: SlotName) => SLOTS[slot].file as "app/layout.tsx" | "app/page.tsx";

function assertSlotKind(slot: SlotName, kind: Placement["kind"]) {
  const wraps = Boolean((SLOTS[slot] as SlotDefinition).wraps);
  if (wraps !== (kind === "provider")) {
    throw new CodemodError("SLOT_KIND", kind === "provider" ? `Providers can only go in the providers slot, not "${slot}".` : `The "${slot}" slot only accepts providers.`);
  }
}

function place(files: PortfolioFiles, placement: Placement): PortfolioFiles {
  assertSlotKind(placement.slot, placement.kind);
  const file = fileOf(placement.slot);
  let source = addImport(files[file], { pkg: placement.package, named: placement.component }, file).source;
  source =
    placement.kind === "provider"
      ? insertProvider(source, { integrationId: placement.id, component: placement.component }, file).source
      : insertElement(source, { slot: placement.slot, integrationId: placement.id, element: renderElement(placement.component, placement.props) }, file).source;
  return { ...files, [file]: source };
}

function unplace(files: PortfolioFiles, entry: InstalledEntry, remaining: InstalledEntry[]): PortfolioFiles {
  const file = fileOf(entry.slot);
  let source = removeBlock(files[file], { slot: entry.slot, integrationId: entry.id }, file).source;
  // Keep the import while another integration in this file still uses the package.
  if (!remaining.some((other) => other.package === entry.package && fileOf(other.slot) === file)) {
    source = removeImport(source, { pkg: entry.package }, file).source;
  }
  return { ...files, [file]: source };
}

function result(before: PortfolioFiles, after: PortfolioFiles, outcome: Outcome): ProjectResult {
  return { files: after, changed: PORTFOLIO_FILES.filter((file) => before[file] !== after[file]), outcome };
}

/**
 * Installs an integration: its import, its marked block in the slot, and its plinth.json entry. Installing an id that
 * plinth.json already records is a no-op — changing an installed integration's props is a separate operation.
 */
export function installIntegration(files: PortfolioFiles, placement: Placement): ProjectResult {
  const json = readPlinthJson(files["plinth.json"]);
  if (json.integrations.some((entry) => entry.id === placement.id)) return result(files, files, "already_installed");

  const placed = place(files, placement);
  const entry: InstalledEntry = { id: placement.id, package: placement.package, version: placement.version, slot: placement.slot, props: sortedProps(placement.props) };
  return result(files, { ...placed, "plinth.json": writePlinthJson({ ...json, integrations: [...json.integrations, entry] }) }, "installed");
}

/** Removes every trace of an integration placed by `installIntegration`. Uninstalling something absent is a no-op. */
export function uninstallIntegration(files: PortfolioFiles, id: string): ProjectResult & { removed: InstalledEntry | null } {
  const json = readPlinthJson(files["plinth.json"]);
  const entry = json.integrations.find((candidate) => candidate.id === id);
  if (!entry) return { ...result(files, files, "not_installed"), removed: null };

  const remaining = json.integrations.filter((candidate) => candidate.id !== id);
  const unplaced = unplace(files, entry, remaining);
  return { ...result(files, { ...unplaced, "plinth.json": writePlinthJson({ ...json, integrations: remaining }) }, "uninstalled"), removed: entry };
}

/** Moves an installed integration to another slot, possibly in the other file. Props come from plinth.json. */
export function moveIntegration(files: PortfolioFiles, spec: { id: string; to: SlotName; component: string; kind: Placement["kind"] }): ProjectResult {
  const json = readPlinthJson(files["plinth.json"]);
  const entry = json.integrations.find((candidate) => candidate.id === spec.id);
  if (!entry) return result(files, files, "not_installed");
  if (entry.slot === spec.to) return result(files, files, "already_there");
  assertSlotKind(spec.to, spec.kind);

  const others = json.integrations.filter((candidate) => candidate.id !== spec.id);
  const moved = { ...entry, slot: spec.to };
  let next = unplace(files, entry, others);
  next = place(next, { ...moved, component: spec.component, kind: spec.kind });
  const integrations = json.integrations.map((candidate) => (candidate.id === spec.id ? moved : candidate));
  return result(files, { ...next, "plinth.json": writePlinthJson({ ...json, integrations }) }, "moved");
}

function sortedProps(props: Record<string, PropValue>): Record<string, PropValue> {
  return Object.fromEntries(Object.keys(props).sort().map((key) => [key, props[key]]));
}
