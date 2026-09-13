import { readFileSync } from "fs";
import { join } from "path";
import { gzipSync } from "zlib";
import { inspectTarball } from "./catalogue-ingest";
import { CatalogueService } from "./catalogue.service";
import { slugify } from "./integration-requests.service";
import { readTarballFiles } from "./tarball";

const GITHUB_STATS = join(__dirname, "../../../integrations/github-stats/plinth-pages-github-stats-0.1.0.tgz");

/** A minimal ustar archive, gzipped, as `npm pack` would produce. */
function tgz(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("        ", 148);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const realManifest = () => JSON.parse(readTarballFiles(readFileSync(GITHUB_STATS), ["package/plinth.manifest.json"])["package/plinth.manifest.json"]);

describe("readTarballFiles", () => {
  it("reads package.json and the manifest out of a real packed integration", () => {
    const files = readTarballFiles(readFileSync(GITHUB_STATS), ["package/package.json", "package/plinth.manifest.json", "package/missing.txt"]);
    expect(JSON.parse(files["package/package.json"])).toMatchObject({ name: "@plinth-pages/github-stats", version: "0.1.0" });
    expect(JSON.parse(files["package/plinth.manifest.json"])).toMatchObject({ id: "github-stats" });
    expect(files["package/missing.txt"]).toBeUndefined();
  });

  it("reads files that span several blocks", () => {
    const big = "x".repeat(1500);
    expect(readTarballFiles(tgz({ "package/a.txt": big, "package/b.txt": "after" }), ["package/a.txt", "package/b.txt"])).toEqual({ "package/a.txt": big, "package/b.txt": "after" });
  });
});

describe("inspectTarball", () => {
  const pkg = JSON.stringify({ name: "@plinth-pages/github-stats", version: "0.1.0" });

  it("accepts the real package", () => {
    expect(inspectTarball(readFileSync(GITHUB_STATS))).toEqual({ manifest: expect.objectContaining({ id: "github-stats", version: "0.1.0" }) });
  });

  it("rejects a slot outside the vocabulary", () => {
    const manifest = { ...realManifest(), allowedSlots: ["afterProjects", "adminPanel"] };
    const result = inspectTarball(tgz({ "package/package.json": pkg, "package/plinth.manifest.json": JSON.stringify(manifest) }));
    expect(result).toEqual({ reasons: [expect.stringContaining("allowedSlots")] });
  });

  it("rejects a manifest that describes a different package or version", () => {
    const manifest = { ...realManifest(), package: "@evil/stats", version: "9.9.9" };
    const result = inspectTarball(tgz({ "package/package.json": pkg, "package/plinth.manifest.json": JSON.stringify(manifest) }));
    expect(result).toEqual({
      reasons: ["The manifest names @evil/stats, but the package is @plinth-pages/github-stats.", "The manifest is for 9.9.9, but the package is 0.1.0."],
    });
  });

  it("rejects a package without a manifest, and bytes that aren't a tarball", () => {
    expect(inspectTarball(tgz({ "package/package.json": pkg }))).toEqual({ reasons: ["The package has no plinth.manifest.json."] });
    expect(inspectTarball(Buffer.from("not a tarball"))).toEqual({ reasons: [expect.stringMatching(/^Not a readable package tarball/)] });
  });
});

describe("slugify", () => {
  it("counts the same wish typed differently once", () => {
    expect(slugify("Notion Pages!")).toBe("notion-pages");
    expect(slugify("  notion   pages ")).toBe("notion-pages");
    expect(slugify("Cal.com")).toBe("cal-com");
    expect(slugify("***")).toBe("");
  });
});

describe("CatalogueService", () => {
  const row = { id: "github-stats", isActive: true, manifest: realManifest(), tarball: "github-stats/x.tgz" };
  const prisma = { integration: { findUnique: async () => row, findMany: async () => [row] } };
  const service = (fetchImpl: typeof fetch) => new CatalogueService(prisma as never, fetchImpl);

  it("applies manifest defaults and refuses unknown settings", () => {
    const catalogue = service(fetch);
    expect(catalogue.parseProps(row.manifest, { username: " octocat " })).toEqual({ username: "octocat", showTopRepos: true });
    expect(() => catalogue.parseProps(row.manifest, { username: "octocat", onClick: "alert(1)" })).toThrow("Some settings aren't valid.");
    expect(() => catalogue.parseProps(row.manifest, { username: "-bad-" })).toThrow();
  });

  it("confirms a GitHub account exists, and says when it doesn't", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return url.endsWith("/octocat")
        ? new Response(JSON.stringify({ login: "octocat", name: "The Octocat" }), { status: 200 })
        : new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const catalogue = service(fake);

    expect(await catalogue.validate("github-stats", { username: "octocat" })).toEqual({
      ok: true,
      fields: {},
      live: { username: { status: "found", message: "The Octocat (@octocat)" } },
    });
    expect(await catalogue.validate("github-stats", { username: "nobody-here-123" })).toMatchObject({
      ok: false,
      fields: { username: "There's no GitHub account called nobody-here-123." },
    });
    await catalogue.validate("github-stats", { username: "OctoCat" });
    expect(calls).toHaveLength(2); // cached, case-insensitively
  });

  it("never blocks on a lookup that couldn't run", async () => {
    const catalogue = service((async () => new Response("", { status: 503 })) as unknown as typeof fetch);
    expect(await catalogue.validate("github-stats", { username: "octocat" })).toMatchObject({ ok: true, live: { username: { status: "unknown" } } });
  });

  it("lists the catalogue with the exact package and version", async () => {
    expect(await service(fetch).list()).toEqual([
      expect.objectContaining({ id: "github-stats", package: "@plinth-pages/github-stats", version: "0.1.0", source: "vendored", kind: "element" }),
    ]);
  });
});
