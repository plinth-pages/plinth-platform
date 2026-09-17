import { AiProviderError } from "../ai/ai-provider";
import { AiService, buildModels } from "../ai/ai.service";
import { BedrockProvider } from "../ai/bedrock.provider";
import { GeminiProvider } from "../ai/gemini.provider";
import { GroqProvider, type GroqChat } from "../ai/groq.provider";
import { applyEdits, copilotOutputSchema, writablePath } from "./copilot-plan";
import { selectContext } from "./copilot-context";
import { parseContext } from "./copilot-planner";
import { affordableTokens } from "../ai/ai-provider";
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
    ["package.json", { action: "replace" as const, path: "package.json", search: "a", replace: "b" }, "can't be changed by Plinth AI"],
    ["a server route", { action: "create" as const, path: "app/api/x/route.ts", content: "export {}" }, "can't be changed by Plinth AI"],
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

describe("Groq", () => {
  const request = { providerModel: "openai/gpt-oss-120b", system: "sys", messages: [{ role: "user" as const, text: "hi" }], tool: SUBMIT_CHANGES_TOOL, maxTokens: 100, temperature: 0 };

  it("sends the system prompt first, forces the tool, and parses its arguments", async () => {
    const calls: Record<string, unknown>[] = [];
    const chat = {
      create: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "submit_changes", arguments: "{\"refused\":true,\"reply\":\"No\"}" } }] } }], usage: { prompt_tokens: 12, completion_tokens: 4 } };
      },
    } as unknown as GroqChat;
    const result = await new GroqProvider(undefined, chat).generate(request);
    expect(result).toMatchObject({ output: { refused: true, reply: "No" }, usage: { inputTokens: 12, outputTokens: 4 }, stopReason: "tool_calls" });
    expect(calls[0]).toMatchObject({ model: "openai/gpt-oss-120b", tool_choice: { type: "function", function: { name: "submit_changes" } } });
    expect((calls[0].messages as { role: string }[])[0]).toEqual({ role: "system", content: "sys" });
  });

  it("treats unparseable arguments as no answer, and maps rate limits as retryable", async () => {
    const garbled = { create: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "submit_changes", arguments: "{oops" } }] } }] }) } as unknown as GroqChat;
    expect((await new GroqProvider(undefined, garbled).generate(request)).output).toBeNull();
    const limited = { create: async () => Promise.reject(Object.assign(new Error("Rate limit"), { status: 429 })) } as unknown as GroqChat;
    await expect(new GroqProvider(undefined, limited).generate(request)).rejects.toMatchObject({ provider: "groq", retryable: true, code: "429" });
    expect(new GroqProvider(undefined).configured()).toBe(false);
  });
});

describe("model catalogue", () => {
  const config = { get: () => undefined } as never;

  it("offers the Groq model free by default, locks the Pro models, and keeps paused providers hidden", () => {
    const service = new AiService(config, [{ id: "groq", configured: () => true, generate: async () => Promise.reject(new Error("unused")) }]);
    expect(service.catalogue()).toEqual([
      { id: "free", label: "GPT-OSS 120B", badge: "Free", tier: "free", locked: false, available: true, default: true },
      { id: "claude-3-5-sonnet", label: "Claude Sonnet 5", badge: "Pro", tier: "pro", locked: true, available: false, default: false },
      { id: "gpt-4o", label: "GPT-4o", badge: "Pro", tier: "pro", locked: true, available: false, default: false },
    ]);
    expect(buildModels().find((model) => model.id === "claude-3-haiku")).toMatchObject({ provider: "bedrock", providerModel: "anthropic.claude-3-haiku-20240307-v1:0", hidden: true });
    expect(buildModels({ groqModel: "llama3-70b-8192" })[0]).toMatchObject({ label: "Llama 3 70B", provider: "groq", providerModel: "llama3-70b-8192" });
  });

  it("reports a model unavailable when its provider has no credentials", () => {
    expect(new AiService(config).catalogue()[0]).toMatchObject({ available: false });
  });
});

describe("selectContext", () => {
  const tree = [
    { path: "app/globals.css", content: ":root { --accent: blue; }" },
    { path: "app/page.tsx", content: "export default function Page() {}" },
    { path: "components/sections/Hero.tsx", content: "<h1 className=\"text-4xl\">{profile.name}</h1>" },
    { path: "components/sections/Projects.tsx", content: "x".repeat(3000) },
    { path: "content/profile.ts", content: 'export const profile = { name: "Asha", role: "Engineer" };' },
    { path: "content/projects.ts", content: "y".repeat(3000) },
    { path: "content/theme.ts", content: "export const theme = { accent: '#4c62dc' };" },
    { path: "content/types.ts", content: "export interface Profile {}" },
  ];

  it("sends the files a request is about and lists the rest by name", () => {
    const name = selectContext(tree, "Change my name and role", 2_000);
    expect(name.included.map((file) => file.path)).toEqual(expect.arrayContaining(["content/profile.ts", "components/sections/Hero.tsx", "content/types.ts"]));
    expect(name.included.map((file) => file.path)).not.toContain("content/projects.ts");
    expect(name.omitted).toContain("content/projects.ts");

    const colour = selectContext(tree, "Change the accent colour to teal", 2_000);
    expect(colour.included.map((file) => file.path)).toEqual(expect.arrayContaining(["app/globals.css", "content/theme.ts"]));
  });

  it("never exceeds the budget", () => {
    const selected = selectContext(tree, "Update my projects", 3_500);
    expect(selected.included.reduce((sum, file) => sum + file.content.length, 0)).toBeLessThanOrEqual(3_500);
    expect(selected.included.map((file) => file.path)).toContain("content/projects.ts");
  });
});

describe("affordableTokens", () => {
  it("reads the smaller reply size a low-credit account can pay for", () => {
    const refusal = new AiProviderError("openai", "This request requires more credits, or fewer max_tokens. You requested up to 16000 tokens, but can only afford 4000.", false, "402");
    expect(affordableTokens(refusal)).toBe(3950);
  });

  it("gives up when the account can't afford a useful reply, or the error is something else", () => {
    expect(affordableTokens(new AiProviderError("openai", "You requested up to 16000 tokens, but can only afford 300.", false, "402"))).toBeNull();
    expect(affordableTokens(new AiProviderError("openai", "Rate limited", true, "429"))).toBeNull();
    expect(affordableTokens(new Error("can only afford 4000"))).toBeNull();
  });
});
