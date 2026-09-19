import { checkSources } from "@plinth-pages/check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  CodemodError,
  addImport,
  formatSource,
  installIntegration,
  listBlocks,
  moveIntegration,
  removeBlock,
  removeImport,
  uninstallIntegration,
  type Placement,
  type PortfolioFiles,
} from "../src";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "template", name), "utf8");
const prettierOptions = JSON.parse(fixture(".prettierrc"));

/** plinth-template at 722bf92. */
const template: PortfolioFiles = {
  "app/layout.tsx": fixture("layout.tsx"),
  "app/page.tsx": fixture("page.tsx"),
  "plinth.json": fixture("plinth.json"),
};

const githubStats: Placement = {
  id: "github-stats",
  package: "@plinth-pages/github-stats",
  version: "0.1.0",
  slot: "afterProjects",
  component: "GitHubStats",
  kind: "element",
  props: { username: "sumitverma77", showTopRepos: true },
};

const leetcodeStats: Placement = {
  id: "leetcode-stats",
  package: "@plinth-pages/leetcode-stats",
  version: "0.1.0",
  slot: "afterProjects",
  component: "LeetCodeStats",
  kind: "element",
  props: { username: "lee215" },
};

const themeProvider: Placement = {
  id: "theme-provider",
  package: "@plinth-pages/theme-provider",
  version: "1.0.0",
  slot: "providers",
  component: "ThemeProvider",
  kind: "provider",
  props: {},
};

async function format(files: PortfolioFiles): Promise<PortfolioFiles> {
  return {
    "app/layout.tsx": await formatSource(files["app/layout.tsx"], "app/layout.tsx", prettierOptions),
    "app/page.tsx": await formatSource(files["app/page.tsx"], "app/page.tsx", prettierOptions),
    "plinth.json": await formatSource(files["plinth.json"], "plinth.json", prettierOptions),
  };
}

function contract(files: PortfolioFiles) {
  return checkSources({ files: { "app/layout.tsx": files["app/layout.tsx"], "app/page.tsx": files["app/page.tsx"] }, plinthJson: files["plinth.json"] });
}

function syntaxErrors(source: string, fileName: string): string[] {
  const output = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } });
  return (output.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

describe("golden: the pristine template", () => {
  it("is already formatted, so round trips are meaningful", async () => {
    expect(await format(template)).toEqual(template);
  });

  it("installs an element with its import, marked block and plinth.json entry, and passes plinth check", async () => {
    const { files, changed, outcome } = installIntegration(template, githubStats);
    expect(outcome).toBe("installed");
    expect(changed).toEqual(["app/page.tsx", "plinth.json"]);

    const formatted = await format(files);
    expect(formatted["app/page.tsx"]).toContain('// plinth:imports:start\nimport { GitHubStats } from "@plinth-pages/github-stats";\n// plinth:imports:end');
    expect(formatted["app/page.tsx"]).toMatch(
      /<Slot name="afterProjects">\s*\{\/\* plinth:github-stats:start \*\/\}\s*<GitHubStats showTopRepos=\{true\} username=\{"sumitverma77"\} \/>\s*\{\/\* plinth:github-stats:end \*\/\}\s*<\/Slot>/,
    );
    expect(JSON.parse(formatted["plinth.json"]).integrations).toEqual([
      { id: "github-stats", package: "@plinth-pages/github-stats", version: "0.1.0", slot: "afterProjects", props: { showTopRepos: true, username: "sumitverma77" } },
    ]);
    expect(contract(files).issues).toEqual([]);
    expect(contract(formatted).issues).toEqual([]);
    expect(syntaxErrors(files["app/page.tsx"], "page.tsx")).toEqual([]);
  });

  it("follows a slot Plinth AI moved into a component it wrote", async () => {
    // The redesign case: the sidebar slot now lives in a new component, wrapped in the new layout's styling.
    const aside = [
      'import { Slot } from "@plinth-pages/core";',
      "// plinth:imports:start",
      "// plinth:imports:end",
      "",
      "export function Aside() {",
      "  return (",
      '    <aside className="rounded-2xl border border-line bg-card p-6">',
      '      <Slot name="sidebar"></Slot>',
      "    </aside>",
      "  );",
      "}",
      "",
    ].join(String.fromCharCode(10));
    const redesigned: PortfolioFiles = {
      ...template,
      "app/page.tsx": template["app/page.tsx"].replace('<Slot name="sidebar"></Slot>', "<Aside />"),
      "components/Aside.tsx": aside,
    };

    const { files, changed, outcome } = installIntegration(redesigned, { ...githubStats, slot: "sidebar" });
    expect(outcome).toBe("installed");
    // The integration lands in the component, not in the file the template first kept the slot in.
    expect(changed).toEqual(["components/Aside.tsx", "plinth.json"]);
    expect(files["components/Aside.tsx"]).toContain('import { GitHubStats } from "@plinth-pages/github-stats";');
    expect(files["components/Aside.tsx"]).toContain("plinth:github-stats:start");
    expect(files["app/page.tsx"]).toBe(redesigned["app/page.tsx"]);

    // And it comes back out of wherever it went.
    const removed = uninstallIntegration(files, "github-stats");
    expect(removed.files["components/Aside.tsx"]).toBe(aside);
  });
  it("installs a provider into the wrap list of the layout", async () => {
    const { files, changed } = installIntegration(template, themeProvider);
    expect(changed).toEqual(["app/layout.tsx", "plinth.json"]);
    const formatted = await format(files);
    expect(formatted["app/layout.tsx"]).toContain('wrap={[/* plinth:theme-provider:start */ ThemeProvider /* plinth:theme-provider:end */]}');
    expect(contract(formatted).issues).toEqual([]);
  });

  it("does nothing when the integration is already installed", () => {
    const once = installIntegration(template, githubStats).files;
    const twice = installIntegration(once, { ...githubStats, props: { username: "someone-else" } });
    expect(twice.outcome).toBe("already_installed");
    expect(twice.changed).toEqual([]);
    expect(twice.files).toBe(once);
  });

  it.each(["heroAfter", "beforeProjects", "afterProjects", "sidebar", "beforeContact", "contact", "footer", "head", "bodyEnd"] as const)(
    "installs into %s and passes plinth check",
    async (slot) => {
      const { files } = installIntegration(template, { ...githubStats, slot });
      expect(contract(await format(files)).issues).toEqual([]);
    },
  );
});

describe("round trip", () => {
  it.each([
    ["an element", [githubStats]],
    ["a provider", [themeProvider]],
    ["two integrations in one slot", [githubStats, leetcodeStats]],
    ["integrations in both files", [githubStats, themeProvider, { ...leetcodeStats, slot: "footer" as const }]],
  ])("install then uninstall %s is byte-identical once formatted", async (_label, placements) => {
    let files = template;
    for (const placement of placements) files = (await format(installIntegration(files, placement).files));
    for (const placement of [...placements].reverse()) {
      const removed = uninstallIntegration(files, placement.id);
      expect(removed.outcome).toBe("uninstalled");
      files = await format(removed.files);
      expect(contract(files).issues).toEqual([]);
    }
    expect(files).toEqual(template);
  });

  it("uninstalling one of two integrations leaves the other exactly as installed on its own", async () => {
    const both = await format(installIntegration(installIntegration(template, githubStats).files, leetcodeStats).files);
    const onlyLeetcode = await format(installIntegration(template, leetcodeStats).files);
    expect(await format(uninstallIntegration(both, "github-stats").files)).toEqual(onlyLeetcode);
  });

  it("uninstalling something that isn't installed is a no-op", () => {
    const result = uninstallIntegration(template, "github-stats");
    expect(result).toMatchObject({ outcome: "not_installed", changed: [], removed: null });
  });
});

describe("determinism", () => {
  it("two integrations in one slot end in the same order whichever is installed first", async () => {
    const ab = await format(installIntegration(installIntegration(template, githubStats).files, leetcodeStats).files);
    const ba = await format(installIntegration(installIntegration(template, leetcodeStats).files, githubStats).files);
    expect(ab).toEqual(ba);
    expect(listBlocks(ab["app/page.tsx"]).map((b) => b.integrationId)).toEqual(["github-stats", "leetcode-stats"]);
  });

  it("orders providers the same way", async () => {
    const other: Placement = { ...themeProvider, id: "analytics-provider", package: "@plinth-pages/analytics", component: "AnalyticsProvider" };
    const ab = await format(installIntegration(installIntegration(template, themeProvider).files, other).files);
    const ba = await format(installIntegration(installIntegration(template, other).files, themeProvider).files);
    expect(ab).toEqual(ba);
    expect(contract(ab).issues).toEqual([]);
  });
});

describe("move", () => {
  it("moves within a file and across files, keeping props from plinth.json", async () => {
    const installed = await format(installIntegration(template, githubStats).files);

    const toHero = moveIntegration(installed, { id: "github-stats", to: "heroAfter", component: "GitHubStats", kind: "element" });
    expect(toHero.outcome).toBe("moved");
    const hero = await format(toHero.files);
    expect(listBlocks(hero["app/page.tsx"])).toEqual([{ slot: "heroAfter", integrationId: "github-stats" }]);
    expect(hero["app/page.tsx"]).toContain('username={"sumitverma77"}');
    expect(contract(hero).issues).toEqual([]);

    const toHead = await format(moveIntegration(hero, { id: "github-stats", to: "bodyEnd", component: "GitHubStats", kind: "element" }).files);
    expect(toHead["app/page.tsx"]).toBe(template["app/page.tsx"]);
    expect(listBlocks(toHead["app/layout.tsx"])).toEqual([{ slot: "bodyEnd", integrationId: "github-stats" }]);
    expect(contract(toHead).issues).toEqual([]);
  });

  it("refuses to move an element into the providers slot, and is a no-op into the same slot", () => {
    const installed = installIntegration(template, githubStats).files;
    expect(() => moveIntegration(installed, { id: "github-stats", to: "providers", component: "GitHubStats", kind: "element" })).toThrow(CodemodError);
    expect(moveIntegration(installed, { id: "github-stats", to: "afterProjects", component: "GitHubStats", kind: "element" }).outcome).toBe("already_there");
  });
});

describe("escaping: props are data, never code", () => {
  const hostile = [
    '"} /><script>alert(1)</script><x a="',
    "{alert(1)}",
    "</Slot>{/* plinth:evil:end */}",
    "*/ } <img src=x onerror=alert(1) /> {/*",
    "back\\slash \"quote\" 'single' `tick` ${template}",
    "line\nbreak sep nul",
    "💥 ünïcödé",
  ];

  it.each(hostile)("keeps %j an inert string literal", async (value) => {
    const { files } = installIntegration(template, { ...githubStats, props: { username: value } });
    for (const source of [files["app/page.tsx"], await formatSource(files["app/page.tsx"], "app/page.tsx", prettierOptions)]) {
      expect(syntaxErrors(source, "page.tsx")).toEqual([]);
      const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const elements: string[] = [];
      let attribute: ts.JsxAttribute | undefined;
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) elements.push(node.tagName.getText(parsed));
        if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "username") attribute = node;
        node.forEachChild(visit);
      };
      visit(parsed);

      // The value is exactly one string literal on exactly one GitHubStats element, and adds no elements.
      const initializer = attribute!.initializer!;
      const literal = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
      expect(literal && (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))).toBe(true);
      expect((literal as ts.StringLiteral).text).toBe(value);
      expect(elements.filter((tag) => tag === "GitHubStats")).toHaveLength(1);
      expect(elements.filter((tag) => !["main", "Slot", "footer", "p", "a", "Hero", "About", "Stats", "Skills", "Projects", "Experience", "Education", "Milestones", "SocialLinks", "Contact", "GitHubStats"].includes(tag))).toEqual([]);
    }
    expect(contract(await format(files)).issues).toEqual([]);
  });

  it.each([
    [{ dangerouslySetInnerHTML: "x" }, /can't be used/],
    [{ onClick: "x" }, /can't be used/],
    [{ "bad name": "x" }, /can't be used/],
    [{ count: Number.NaN }, /finite/],
    [{ count: Infinity }, /finite/],
    [{ nested: {} as unknown as string }, /must be a string/],
  ])("refuses %j", (props, message) => {
    expect(() => installIntegration(template, { ...githubStats, props })).toThrow(message);
  });

  it("refuses component and package names that aren't identifiers", () => {
    expect(() => installIntegration(template, { ...githubStats, component: "x onerror=alert" })).toThrow(CodemodError);
    expect(() => installIntegration(template, { ...githubStats, package: '"; process.exit(); "' })).toThrow(CodemodError);
    expect(() => installIntegration(template, { ...githubStats, id: "Bad Id" })).toThrow(CodemodError);
  });
});

describe("adversarial: code a co-pilot has reshaped", () => {
  const adversarialPage = `import { Slot } from "@plinth-pages/core";
// something the co-pilot wrote
import { Hero } from "@/components/sections/Hero";
// plinth:imports:start
// plinth:imports:end
import { Projects } from "@/components/sections/Projects";

// Rewritten layout: sections reordered, slots nested in wrappers, conditional rendering right next to slots.
export default function Page({ searchParams }: { searchParams?: { preview?: string } }) {
  const showBanner = Boolean(searchParams?.preview);

  return (
    <div className="grid gap-y-24 bg-gradient-to-b from-slate-50 to-white px-4 lg:grid-cols-[1fr_20rem]">
      <main>
        <section className="rounded-3xl border border-dashed p-8">
          {showBanner && <p className="text-sm">Preview</p>}
          <Slot name="beforeProjects"></Slot>
          {/* the projects section moved up */}
          <Projects />


          <div className="contents">
            <div>
              <Slot name="afterProjects">
                {/* a plain comment left by someone */}
              </Slot>
            </div>
          </div>
        </section>
        <Hero />
        {showBanner ? <Slot name="heroAfter" /> : null}
      </main>
      <aside className="sticky top-8">
        <Slot   name="sidebar"   ></Slot>
      </aside>
      <Slot name="beforeContact"></Slot>
      <Slot name="contact"></Slot>
      <footer>
        <Slot name="footer"></Slot>
      </footer>
    </div>
  );
}
`;
  const files: PortfolioFiles = { ...template, "app/page.tsx": adversarialPage };

  it.each(["beforeProjects", "afterProjects", "heroAfter", "sidebar"] as const)("installs into %s wherever it has been moved to", async (slot) => {
    const { files: out, outcome } = installIntegration(files, { ...githubStats, slot });
    expect(outcome).toBe("installed");
    expect(syntaxErrors(out["app/page.tsx"], "page.tsx")).toEqual([]);
    expect(contract(out).issues).toEqual([]);
    expect(contract(await format(out)).issues).toEqual([]);
    // Everything outside the slot and the imports region survives untouched.
    for (const untouched of ["{showBanner && <p className=\"text-sm\">Preview</p>}", "{/* the projects section moved up */}", "// something the co-pilot wrote", "sticky top-8"]) {
      expect(out["app/page.tsx"]).toContain(untouched);
    }
  });

  it("keeps a plain comment inside a slot when an integration is added and removed", async () => {
    const installed = installIntegration(files, githubStats).files;
    expect(contract(installed).issues).toEqual([]);
    const removed = uninstallIntegration(installed, "github-stats").files;
    expect(removed["app/page.tsx"]).toContain("{/* a plain comment left by someone */}");
    expect(await formatSource(removed["app/page.tsx"], "page.tsx", prettierOptions)).toBe(await formatSource(adversarialPage, "page.tsx", prettierOptions));
  });

  it("round-trips a self-closing slot to an equivalent, check-passing slot", async () => {
    const out = uninstallIntegration(installIntegration(files, { ...githubStats, slot: "heroAfter" }).files, "github-stats").files;
    expect(contract(out).issues).toEqual([]);
    expect(listBlocks(out["app/page.tsx"])).toEqual([]);
  });

  it("works on CRLF files and on unformatted imports", () => {
    const crlf = { ...template, "app/page.tsx": template["app/page.tsx"].replace(/\n/g, "\r\n") };
    const out = installIntegration(crlf, githubStats).files;
    expect(syntaxErrors(out["app/page.tsx"], "page.tsx")).toEqual([]);
    expect(contract(out).issues).toEqual([]);
  });
});

describe("failures are explicit", () => {
  it("names a missing slot", () => {
    const noSlot = { ...template, "app/page.tsx": template["app/page.tsx"].replace('<Slot name="afterProjects"></Slot>', "") };
    expect(() => installIntegration(noSlot, githubStats)).toThrow(expect.objectContaining({ code: "SLOT_NOT_FOUND" }));
  });

  it("names a duplicated slot", () => {
    const twice = { ...template, "app/page.tsx": template["app/page.tsx"].replace('<Slot name="footer"></Slot>', '<Slot name="afterProjects"></Slot>') };
    expect(() => installIntegration(twice, githubStats)).toThrow(expect.objectContaining({ code: "SLOT_DUPLICATE" }));
  });

  it("names a missing imports region", () => {
    const noRegion = { ...template, "app/page.tsx": template["app/page.tsx"].replace("// plinth:imports:start\n// plinth:imports:end\n", "") };
    expect(() => installIntegration(noRegion, githubStats)).toThrow(expect.objectContaining({ code: "IMPORT_REGION_MISSING" }));
  });

  it("refuses corrupted markers rather than guessing", () => {
    const installed = installIntegration(template, githubStats).files;
    const corrupt = { ...installed, "app/page.tsx": installed["app/page.tsx"].replace("{/* plinth:github-stats:end */}", "") };
    expect(() => installIntegration(corrupt, leetcodeStats)).toThrow(expect.objectContaining({ code: "MARKERS_CORRUPT" }));
  });

  it("refuses source that doesn't parse", () => {
    const broken = "// plinth:imports:start\n// plinth:imports:end\nexport default function Page() { return <main>; }";
    expect(() => installIntegration({ ...template, "app/page.tsx": broken }, githubStats)).toThrow(
      expect.objectContaining({ code: "PARSE_ERROR" }),
    );
  });
});

describe("primitives", () => {
  const region = '// plinth:imports:start\nimport { B } from "@plinth-pages/b";\n// plinth:imports:end\n';

  it("keeps imports sorted by package and merges names", () => {
    let source = addImport(region, { pkg: "@plinth-pages/c", named: "C" }).source;
    source = addImport(source, { pkg: "@plinth-pages/a", named: "A" }).source;
    source = addImport(source, { pkg: "@plinth-pages/b", named: "Extra" }).source;
    expect(source).toBe(
      '// plinth:imports:start\nimport { A } from "@plinth-pages/a";\nimport { B, Extra } from "@plinth-pages/b";\nimport { C } from "@plinth-pages/c";\n// plinth:imports:end\n',
    );
    expect(addImport(source, { pkg: "@plinth-pages/a", named: "A" }).changed).toBe(false);
  });

  it("removes a whole import and nothing else", () => {
    expect(removeImport(region, { pkg: "@plinth-pages/b" }).source).toBe("// plinth:imports:start\n// plinth:imports:end\n");
    expect(removeImport(region, { pkg: "@plinth-pages/zzz" }).changed).toBe(false);
  });

  it("removeBlock on an absent id changes nothing", () => {
    expect(removeBlock(template["app/page.tsx"], { slot: "afterProjects", integrationId: "github-stats" }).changed).toBe(false);
  });
});
