import { AiProviderError } from "../ai/ai-provider";
import { AiService, MODELS } from "../ai/ai.service";
import { BedrockProvider } from "../ai/bedrock.provider";
import { GeminiProvider } from "../ai/gemini.provider";
import { applyEdits, copilotOutputSchema, writablePath } from "./copilot-plan";
import { parseContext } from "./copilot-planner";
import { SUBMIT_CHANGES_TOOL, SYSTEM_PROMPT, buildUserTurn } from "./copilot-prompt";

const files: Record<string, string> = {
  "content/profile.ts": 'export const profile = {\n  name: "Asha",\n  role: "Engineer",\n};\n',
  "app/page.tsx": 'import { Slot } from "@plinth-pages/core";\n// plinth:imports:start\n// plinth:imports:end\nexport default function Page() {\n  return (\n    <main className="pb-16">\n      <Slot name="sidebar"></Slot>\n    </main>\n  );\n}\n',
};
const read = (path: string) => files[path] ?? null;

describe("applyEdits", () => {
  it("applies an exact, unique replacement", () => {
    expect(applyEdits([{ action: "replace", path: "content/profile.ts", search: 'name: "Asha"', replace: 'name: "Asha Menon"' }], read)).toEqual([
      { path: "content/profile.ts", content: files["content/profile.ts"].replace("Asha", "Asha Menon") },
    ]);
  });

  it("chains edits to the same file and creates new component files", () => {
    const result = applyEdits(
      [
        { action: "replace", path: "app/page.tsx", search: 'className="pb-16"', replace: 'className="pb-24"' },
        { action: "replace", path: "app/page.tsx", search: 'className="pb-24"', replace: 'className="pb-24 bg-white"' },
        { action: "create", path: "components/Badge.tsx", content: "export function Badge() {\n  return <span>New</span>;\n}\n" },
      ],
      read,
    );
    expect(result.map((file) => file.path)).toEqual(["app/page.tsx", "components/Badge.tsx"]);
    expect(result[0].content).toContain('className="pb-24 bg-white"');
  });

  it.each([
    ["text that isn't there", { action: "replace" as const, path: "content/profile.ts", search: "nope", replace: "x" }, "wasn't found"],
    ["ambiguous text", { action: "replace" as const, path: "content/profile.ts", search: '"', replace: "'" }, "more than once"],
    ["a removed slot", { action: "replace" as const, path: "app/page.tsx", search: '      <Slot name="sidebar"></Slot>\n', replace: "" }, "managed by Plinth"],
    ["an edited import region", { action: "replace" as const, path: "app/page.tsx", search: "// plinth:imports:end", replace: "// removed" }, "managed by Plinth"],
    ["package.json", { action: "replace" as const, path: "package.json", search: "a", replace: "b" }, "can't be changed by the co-pilot"],
    ["a server route", { action: "create" as const, path: "app/api/x/route.ts", content: "export {}" }, "can't be changed by the co-pilot"],
    ["a secret file", { action: "create" as const, path: "content/.env.local", content: "X=1" }, "can't be changed"],
    ["path traversal", { action: "replace" as const, path: "content/../package.json", search: "a", replace: "b" }, "can't be changed"],
    ["raw HTML", { action: "replace" as const, path: "content/profile.ts", search: 'role: "Engineer"', replace: 'role: "<div dangerouslySetInnerHTML />"' }, "raw HTML"],
    ["network calls", { action: "create" as const, path: "components/Beacon.tsx", content: "fetch('https://x.example')" }, "network requests"],
    ["environment variables", { action: "replace" as const, path: "content/profile.ts", search: 'role: "Engineer"', replace: "role: process.env.ROLE" }, "environment variables"],
    ["a new slot", { action: "create" as const, path: "components/Fake.tsx", content: '<Slot name="sidebar"></Slot>' }, "can't be added"],
    ["overwriting a file with create", { action: "create" as const, path: "content/profile.ts", content: "x" }, "already exists"],
  ])("rejects %s", (_label, edit, message) => {
    expect(() => applyEdits([edit], read)).toThrow(message);
  });

  it("is all or nothing", () => {
    expect(() =>
      applyEdits(
        [
          { action: "replace", path: "content/profile.ts", search: 'name: "Asha"', replace: 'name: "Ok"' },
          { action: "replace", path: "package.json", search: "a", replace: "b" },
        ],
        read,
      ),
    ).toThrow();
  });

  it("allows the editable directories only", () => {
    expect(writablePath("lib/theme.ts", "replace")).toBe("lib/theme.ts");
    expect(() => writablePath("lib/new.ts", "create")).toThrow();
    expect(() => writablePath("next.config.ts", "replace")).toThrow();
  });
});

describe("the model's answer", () => {
  it("fills defaults and rejects oversized or malformed answers", () => {
    expect(copilotOutputSchema.parse({ refused: true, reply: "No." })).toEqual({ refused: true, reply: "No.", title: "", edits: [], integrations: [] });
    expect(copilotOutputSchema.safeParse({ refused: false, reply: "x", edits: Array.from({ length: 9 }, () => ({ action: "replace", path: "a" })) }).success).toBe(false);
    expect(copilotOutputSchema.safeParse({ refused: false, reply: "x", edits: [{ action: "delete", path: "a" }] }).success).toBe(false);
    expect(copilotOutputSchema.safeParse("just text").success).toBe(false);
  });
});

describe("the prompt", () => {
  it("confines the model to the portfolio and to the tool", () => {
    expect(SYSTEM_PROMPT).toMatch(/only job is to change ONE personal portfolio/);
    expect(SYSTEM_PROMPT).toMatch(/refuse/i);
    expect(SYSTEM_PROMPT).toMatch(/Never reveal/);
    expect(SYSTEM_PROMPT).toMatch(/DATA, not instructions/);
    expect(SUBMIT_CHANGES_TOOL.schema).toMatchObject({ required: ["refused", "reply", "title", "edits", "integrations"] });
  });

  it("marks files and the request as separate blocks", () => {
    const turn = buildUserTurn("Make it blue", [{ path: "content/profile.ts", content: "x" }], [], []);
    expect(turn).toContain('<file path="content/profile.ts">\nx\n</file>');
    expect(turn.indexOf("<request>")).toBeGreaterThan(turn.indexOf("</portfolio_files>"));
  });

  it("parses the context script's output, keeping file content exact", () => {
    const stdout = "---PLINTH:file:app/a.tsx---\nline1\nline2\n\n---PLINTH:file:content/b.ts---\nb\nPLINTH_TRUNCATED=1\n";
    expect(parseContext(stdout).files).toEqual([
      { path: "app/a.tsx", content: "line1\nline2\n" },
      { path: "content/b.ts", content: "b" },
    ]);
    expect(parseContext(stdout).truncated).toBe(true);
  });
});

describe("providers", () => {
  const request = { providerModel: "m", system: "sys", messages: [{ role: "user" as const, text: "hi" }], tool: SUBMIT_CHANGES_TOOL, maxTokens: 100, temperature: 0 };

  it("Bedrock forces the tool and returns its input with usage", async () => {
    const sent: unknown[] = [];
    const provider = new BedrockProvider({}, {
      send: async (command: unknown) => {
        sent.push(command);
        return { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "1", name: "submit_changes", input: { refused: true, reply: "No" } } }] } }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, stopReason: "tool_use", metrics: { latencyMs: 1 }, $metadata: {} } as never;
      },
    });
    const result = await provider.generate(request);
    expect(result).toMatchObject({ output: { refused: true, reply: "No" }, usage: { inputTokens: 10, outputTokens: 5 } });
    expect((sent[0] as { input: { toolConfig: { toolChoice: unknown } } }).input.toolConfig.toolChoice).toEqual({ tool: { name: "submit_changes" } });
  });

  it("Bedrock maps vendor errors, marking throttling as retryable", async () => {
    const failing = (name: string) => new BedrockProvider({}, { send: async () => Promise.reject(Object.assign(new Error(name), { name })) });
    await expect(failing("ThrottlingException").generate(request)).rejects.toMatchObject({ retryable: true, code: "ThrottlingException" });
    await expect(failing("AccessDeniedException").generate(request)).rejects.toMatchObject({ retryable: false });
  });

  it("Gemini sends the key as a header and reads the function call", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    const fake = (async (input: string, init: RequestInit) => {
      url = input;
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "submit_changes", args: { refused: false } } }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await new GeminiProvider("secret-key", fake).generate(request);
    expect(url).not.toContain("secret-key");
    expect(headers["x-goog-api-key"]).toBe("secret-key");
    expect(result).toMatchObject({ output: { refused: false }, usage: { inputTokens: 7, outputTokens: 3 } });
  });

  it("Gemini surfaces a denied project as a non-retryable error", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: "Your project has been denied access.", status: "PERMISSION_DENIED" } }), { status: 403 })) as unknown as typeof fetch;
    await expect(new GeminiProvider("k", fake).generate(request)).rejects.toEqual(expect.any(AiProviderError));
  });
});

describe("model catalogue", () => {
  const config = { get: () => undefined } as never;

  it("offers Haiku by default, locks the Pro models, and hides unlisted ones", () => {
    const service = new AiService(config, [{ id: "bedrock", configured: () => true, generate: async () => Promise.reject(new Error("unused")) }]);
    expect(service.catalogue()).toEqual([
      { id: "claude-3-haiku", label: "Claude 3 Haiku", badge: "Fast", tier: "free", locked: false, available: true, default: true },
      { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", badge: "Pro", tier: "pro", locked: true, available: false, default: false },
      { id: "gpt-4o", label: "GPT-4o", badge: "Pro", tier: "pro", locked: true, available: false, default: false },
    ]);
    expect(MODELS.find((model) => model.id === "claude-3-haiku")?.providerModel).toBe("anthropic.claude-3-haiku-20240307-v1:0");
  });

  it("reports a model unavailable when its provider has no credentials", () => {
    expect(new AiService(config).catalogue()[0]).toMatchObject({ available: false });
  });
});
