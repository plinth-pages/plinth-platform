import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SLOTS, SLOT_NAMES } from "@plinth-pages/core/slots";
import { migrateSlots, missingSlots, needsSlotMigration, readSlotsVersion } from "../src/migrate";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "template", name), "utf8");

const template: Record<string, string> = {
  "app/layout.tsx": fixture("layout.tsx"),
  "app/page.tsx": fixture("page.tsx"),
  "plinth.json": fixture("plinth.json"),
};

/** A portfolio generated before a slot existed: the slot is simply not in its code. */
function without(files: Record<string, string>, path: string, slot: string): Record<string, string> {
  const tag = `<Slot name="${slot}"></Slot>`;
  expect(files[path]).toContain(tag);
  return { ...files, [path]: files[path].split(tag).join("") };
}

const predating = (slot: string, files = template) => without(files, "app/page.tsx", slot);

describe("slot migration", () => {
  it("leaves a portfolio that already has every slot completely alone", () => {
    expect(missingSlots(template)).toEqual([]);
    expect(needsSlotMigration(template)).toBe(false);
    expect(migrateSlots(template).files).toEqual({});
    expect(migrateSlots(template).added).toEqual([]);
  });

  it("adds a slot the repository predates, next to the one it belongs after", () => {
    const before = predating("sidebar");
    expect(needsSlotMigration(before)).toBe(true);

    const result = migrateSlots(before);
    expect(result.added).toEqual(["sidebar"]);
    expect(result.skipped).toEqual([]);
    expect(Object.keys(result.files)).toEqual(["app/page.tsx"]);

    const page = result.files["app/page.tsx"];
    expect(page).toContain('<Slot name="sidebar"></Slot>');
    // Placed after its anchor, not appended somewhere arbitrary.
    expect(page.indexOf('name="afterProjects"')).toBeLessThan(page.indexOf('name="sidebar"'));
    expect(page.indexOf('name="sidebar"')).toBeLessThan(page.indexOf('name="beforeContact"'));
  });

  it("is safe to run twice", () => {
    const once = migrateSlots(predating("sidebar"));
    const after = { ...predating("sidebar"), ...once.files };
    const twice = migrateSlots(after);
    expect(twice.added).toEqual([]);
    expect(twice.files).toEqual({});
  });

  it("adds several missing slots, including one that anchors to another it just added", () => {
    const before = predating("beforeContact", predating("sidebar"));
    const result = migrateSlots(before);
    expect(result.added).toEqual(["sidebar", "beforeContact"]);
    const page = result.files["app/page.tsx"];
    expect(page.indexOf('name="sidebar"')).toBeLessThan(page.indexOf('name="beforeContact"'));
  });

  it("finds the anchor in a page Plinth AI rearranged, and adds the slot there", () => {
    // The whole point: a layout this code has never seen still gets the slot, because it anchors to a sibling.
    const redesigned = predating("sidebar")["app/page.tsx"]
      .replace('<Slot name="afterProjects"></Slot>', '<aside className="mt-24 rounded-3xl border p-8"><Slot name="afterProjects"></Slot></aside>');
    const result = migrateSlots({ ...predating("sidebar"), "app/page.tsx": redesigned });
    expect(result.added).toEqual(["sidebar"]);
    expect(result.files["app/page.tsx"]).toContain('</aside>');
    expect(result.files["app/page.tsx"]).toContain('<Slot name="sidebar"></Slot>');
  });

  it("records the new version only when nothing was left behind", () => {
    const old = { ...template, "plinth.json": JSON.stringify({ coreVersion: "0.1.0", slotsVersion: 1, integrations: [] }, null, 2) };
    const done = migrateSlots(predating("sidebar", old));
    expect(done.skipped).toEqual([]);
    // SLOTS_VERSION is still 1 here, so there is no bump to make; the contract is that it never claims more than it did.
    expect(done.to).toBe(done.from);

    // A slot with no anchor cannot be placed, and the portfolio must not be marked as migrated.
    const headless = without(template, "app/layout.tsx", "head");
    const partial = migrateSlots(headless);
    expect(partial.added).toEqual([]);
    expect(partial.skipped).toEqual([{ slot: "head", reason: "It has no neighbouring slot to be placed after." }]);
    expect(partial.to).toBe(partial.from);
  });

  it("reads a missing or malformed version as the oldest one, never as up to date", () => {
    expect(readSlotsVersion(JSON.stringify({}))).toBe(1);
    expect(readSlotsVersion(JSON.stringify({ slotsVersion: "2" }))).toBe(1);
    expect(readSlotsVersion(JSON.stringify({ slotsVersion: 3 }))).toBe(3);
  });

  it("every anchor names a real slot that comes before it", () => {
    for (const name of SLOT_NAMES) {
      const after = (SLOTS[name] as { after?: string }).after;
      if (!after) continue;
      expect(SLOT_NAMES).toContain(after);
      // An anchor in another file could never be found when the slot is added.
      expect(SLOTS[after as never]["file"]).toBe(SLOTS[name].file);
    }
  });
});
