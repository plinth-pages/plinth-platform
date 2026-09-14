process.loadEnvFile(".env");
const Groq = require("groq-sdk").default;
const { PrismaClient } = require("@prisma/client");
const { SYSTEM_PROMPT, SUBMIT_CHANGES_TOOL, buildUserTurn } = require("./dist/copilot/copilot-prompt");
const { selectContext } = require("./dist/copilot/copilot-context");
const { copilotOutputSchema, applyEdits } = require("./dist/copilot/copilot-plan");
const fs = require("fs"), path = require("path");
const tpl = "../../plinth-template/";
const walk = (d) => fs.readdirSync(tpl + d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(tsx?|css)$/.test(e.name) ? [`${d}/${e.name}`] : []);
const files = ["app", "components", "content", "lib"].flatMap(walk).map((p) => ({ path: p, content: fs.readFileSync(tpl + p, "utf8") }));
(async () => {
  const p = new PrismaClient();
  const msg = await p.copilotMessage.findFirst({ where: { role: "user", content: { startsWith: "sumit verma" } }, orderBy: { createdAt: "desc" } });
  await p.$disconnect();
  const request = msg.content;
  console.log("request chars", request.length);
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
  for (const [ctx, out] of [[11000, 1500], [6000, 3500], [4500, 4000]]) {
    const sel = selectContext(files, request, ctx);
    const t = Date.now();
    try {
      const r = await groq.chat.completions.create({ model: "openai/gpt-oss-120b", temperature: 0.2, max_tokens: out, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: buildUserTurn(request, sel.included, [], [], sel.omitted) }], tools: [{ type: "function", function: { name: "submit_changes", description: SUBMIT_CHANGES_TOOL.description, parameters: SUBMIT_CHANGES_TOOL.schema } }], tool_choice: { type: "function", function: { name: "submit_changes" } } });
      const args = JSON.parse(r.choices[0].message.tool_calls[0].function.arguments);
      const parsed = copilotOutputSchema.safeParse(args);
      let applied = "-";
      if (parsed.success) { try { applied = applyEdits(parsed.data.edits, (q) => files.find((f) => f.path === q)?.content ?? null).map((f) => f.path).join(","); } catch (e) { applied = "APPLY FAIL " + e.message; } }
      console.log(`ctx=${ctx} out=${out} OK ${Date.now() - t}ms files=[${sel.included.map((f) => f.path).join(",")}] usage=${r.usage.prompt_tokens}/${r.usage.completion_tokens} valid=${parsed.success} applied=${applied} reply=${args.reply?.slice(0, 80)}`);
    } catch (e) {
      const body = e.error?.error ?? {};
      console.log(`ctx=${ctx} out=${out} ERR ${e.status} ${body.code ?? ""} ${String(body.message ?? e.message).slice(0, 110)} | failed_generation: ${String(body.failed_generation ?? "").slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
})();
