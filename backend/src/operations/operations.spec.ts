import { parsePlinthCheck, parseTscOutput, reported, sections } from "./check-output";
import { commitSubject, defaultSummary, editInputSchema } from "./edit-input";
import { affectedRoutes } from "./git-scripts";
import { percentile, timings } from "./operations.service";

describe("parseTscOutput", () => {
  it("reads located errors, continuation lines and global errors", () => {
    const output = [
      "content/profile.ts(4,3): error TS2322: Type 'number' is not assignable to type 'string'.",
      "app/page.tsx(10,7): error TS2741: Property 'name' is missing in type '{}' but required in type 'Props'.",
      "  components/Hero.tsx(3,3): 'name' is declared here.",
      "error TS6053: File 'missing.ts' not found.",
      "",
    ].join("\n");

    expect(parseTscOutput(output)).toEqual([
      { source: "tsc", file: "content/profile.ts", line: 4, code: "TS2322", message: "Type 'number' is not assignable to type 'string'." },
      {
        source: "tsc",
        file: "app/page.tsx",
        line: 10,
        code: "TS2741",
        message: "Property 'name' is missing in type '{}' but required in type 'Props'.\ncomponents/Hero.tsx(3,3): 'name' is declared here.",
      },
      { source: "tsc", code: "TS6053", message: "File 'missing.ts' not found." },
    ]);
  });

  it("returns nothing for clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
  });
});

describe("parsePlinthCheck", () => {
  it("passes a clean report", () => {
    expect(parsePlinthCheck(JSON.stringify({ ok: true, issues: [] }), "", 0)).toEqual([]);
  });

  it("returns the issues of a failing report", () => {
    const report = { ok: false, issues: [{ code: "SLOT_MISSING", file: "app/page.tsx", message: 'The "sidebar" slot is missing.' }] };
    expect(parsePlinthCheck(JSON.stringify(report), "", 1)).toEqual([{ source: "plinth", ...report.issues[0] }]);
  });

  it("never lets unreadable output pass", () => {
    expect(parsePlinthCheck("", "Error: Cannot find module 'ts-morph'", 1)).toEqual([
      { source: "plinth", message: "plinth check did not produce a report: Error: Cannot find module 'ts-morph'" },
    ]);
    expect(parsePlinthCheck(JSON.stringify({ ok: true, issues: [] }), "", 1)).toHaveLength(1);
  });
});

describe("script output", () => {
  it("reads sections and reported values", () => {
    const stdout = "PLINTH_CHECK_MS=4123\nPLINTH_TSC_CODE=2\n---PLINTH:plinth---\n{\"ok\":true}\n---PLINTH:tsc---\na(1,1): error TS1: x\n";
    expect(reported(stdout, "CHECK_MS")).toBe("4123");
    expect(reported(stdout, "MISSING")).toBeNull();
    expect(sections(stdout)).toEqual({ plinth: '{"ok":true}', tsc: "a(1,1): error TS1: x" });
  });
});

describe("editInputSchema", () => {
  it("accepts writes and deletions and normalises paths", () => {
    const parsed = editInputSchema.parse({ files: [{ path: "content/./profile.ts", content: "x" }, { path: "old.ts", content: null }] });
    expect(parsed.files.map((f) => f.path)).toEqual(["content/profile.ts", "old.ts"]);
  });

  it.each([".env.local", ".git/config", "node_modules/x/index.js", "../outside.ts", "/etc/passwd"])("refuses to write %s", (path) => {
    expect(editInputSchema.safeParse({ files: [{ path, content: "x" }] }).success).toBe(false);
  });

  it("refuses empty edits, duplicates and oversized files", () => {
    expect(editInputSchema.safeParse({ files: [] }).success).toBe(false);
    expect(editInputSchema.safeParse({ files: [{ path: "a.ts", content: "1" }, { path: "./a.ts", content: "2" }] }).success).toBe(false);
    expect(editInputSchema.safeParse({ files: [{ path: "a.ts", content: "x".repeat(513 * 1024) }] }).success).toBe(false);
  });

  it("describes the edit for the commit subject", () => {
    expect(defaultSummary(editInputSchema.parse({ files: [{ path: "a.ts", content: "1" }] }))).toBe("Edit a.ts");
    expect(defaultSummary(editInputSchema.parse({ files: [{ path: "a.ts", content: null }] }))).toBe("Delete a.ts");
    expect(commitSubject("  Make the\nhero bolder  ")).toBe("Make the hero bolder");
    expect(commitSubject("x".repeat(100))).toHaveLength(72);
  });
});

describe("affectedRoutes", () => {
  it("always checks the home page and adds pages the change touched", () => {
    expect(affectedRoutes(["content/profile.ts"])).toEqual(["/"]);
    expect(affectedRoutes(["app/page.tsx", "app/blog/page.tsx", "app/(marketing)/about/page.tsx"])).toEqual(["/", "/blog", "/about"]);
    expect(affectedRoutes(["app/posts/[slug]/page.tsx"])).toEqual(["/"]);
  });
});

describe("timings", () => {
  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(timings([{ checkMs: 4000, totalMs: 9000 }, { checkMs: null, totalMs: 100 }])).toEqual({
      checkP50Ms: 4000,
      checkP95Ms: 4000,
      totalP50Ms: 100,
      totalP95Ms: 9000,
      sampleSize: 1,
    });
  });
});
