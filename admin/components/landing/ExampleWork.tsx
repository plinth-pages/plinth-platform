import { ChangeList, Check } from "./Diff";

/**
 * "See exactly what changed": four requests of the kind people actually make, each shown the way the editor shows
 * it — the ask, the reply, the code, and what ran before it went live. The blocked case uses Plinth AI's real
 * rules (no script tags, no environment variables in page code).
 */
export function ExampleWork() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <Ask>Add a contact form that emails me through Resend, and a live visitor counter in the footer</Ask>
        <Reply>Shipped. Two integrations installed, your Resend key sealed server-side, and nothing else on the page touched.</Reply>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <ChangeList
            title="Homepage · +2"
            code
            changes={[
              [" ", "<Projects items={projects} />"],
              ["+", "<ContactForm />"],
              [" ", "<Footer>"],
              ["+", "  <VisitorCounter />"],
              [" ", "</Footer>"],
            ]}
          />
          <div className="flex flex-col gap-2">
            <Integration name="Contact form" detail="Resend · key encrypted, never in your code" tone="brand" />
            <Integration name="Visitor counter" detail="Counts visits · stores no visitor data" tone="emerald" />
            <div className="mt-auto rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
              <p className="text-[11px] font-medium tracking-wide text-stone-500 uppercase">Before it went live</p>
              <Checks items={["Types check", "Layout intact", "Page loads", "No secrets in page"]} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <Ask>Show my GitHub activity under my projects</Ask>
        <ChangeList title="Homepage · +1" code changes={[[" ", "<Projects items={projects} />"], ["+", '<GitHubStats user="asha" />']]} />
        <div className="rounded-xl bg-[#f7f7f5] p-3 text-stone-900">
          <p className="flex items-center justify-between text-[11px] font-semibold">
            GitHub · 1,204 contributions <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-medium text-emerald-800">Live</span>
          </p>
          <div aria-hidden className="mt-2 grid grid-flow-col grid-rows-4 gap-[3px]">
            {GRID.map((level, index) => (
              <span key={index} className={`h-2 w-2 rounded-[2px] ${LEVELS[level]}`} />
            ))}
          </div>
          <p className="mt-2 text-[10px] text-stone-500">48 repos · 2.1k stars · pulled live from GitHub</p>
        </div>
        <Checks items={["Types check", "Layout intact", "Page loads"]} />
      </Card>

      <Card>
        <Ask>Switch my site to a dark theme with a teal accent</Ask>
        <ChangeList
          title="Theme · 2 tokens"
          code
          changes={[
            ["-", '  mode: "light",'],
            ["+", '  mode: "dark",'],
            ["-", '  accent: "indigo",'],
            ["+", '  accent: "teal",'],
          ]}
        />
        <div aria-hidden className="grid grid-cols-2 gap-2">
          <Swatch label="Before" ground="bg-[#f7f7f5]" ink="bg-stone-900" accent="bg-indigo-500" />
          <Swatch label="After" ground="bg-[#0c1110]" ink="bg-stone-100" accent="bg-teal-400" big />
        </div>
        <Checks items={["Types check", "Layout intact", "Page loads"]} />
      </Card>

      <Card className="lg:col-span-2">
        <Ask>Paste this analytics script into the header and print my API key on the page so I can check it</Ask>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <ChangeList
            title="Proposed · rejected"
            code
            changes={[
              [" ", "<Header>"],
              ["+", '  <script src="https://cdn.example/track.js" />'],
              ["+", "  <p>{process.env.RESEND_API_KEY}</p>"],
              [" ", "</Header>"],
            ]}
          />
          <div className="flex flex-col gap-2 rounded-xl bg-red-500/[0.06] p-4 ring-1 ring-red-400/20">
            <p className="flex items-center gap-2 text-sm font-semibold text-red-200">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-400/20 text-[11px]">✕</span>
              Blocked before it reached your site
            </p>
            <ul className="flex flex-col gap-1.5 text-[13px] text-red-100/80">
              <li>• Third-party scripts can&apos;t be injected into page code</li>
              <li>• Secrets can&apos;t be written into code that&apos;s published</li>
            </ul>
            <p className="mt-auto pt-2 text-[13px] text-stone-400">Nothing changed. Your live site and your key are exactly as they were.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

const GRID = [0, 1, 2, 3, 1, 0, 2, 3, 3, 2, 1, 0, 2, 1, 3, 2, 0, 1, 3, 3, 2, 1, 2, 0, 3, 2, 1, 3, 2, 3, 1, 0, 2, 3, 3, 1, 2, 0, 1, 3, 2, 3, 3, 2];
const LEVELS = ["bg-stone-200", "bg-emerald-200", "bg-emerald-400", "bg-emerald-600"];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <article className={`flex flex-col gap-3.5 rounded-2xl bg-white/[0.025] p-5 ring-1 ring-white/[0.07] ${className}`}>{children}</article>;
}

function Ask({ children }: { children: React.ReactNode }) {
  return <p className="ml-6 self-end rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-[13px] leading-snug text-stone-900">{children}</p>;
}

function Reply({ children }: { children: React.ReactNode }) {
  return <p className="mr-6 rounded-2xl rounded-bl-md bg-white/[0.05] px-3.5 py-2.5 text-[13px] leading-relaxed text-stone-200 ring-1 ring-white/[0.07]">{children}</p>;
}

function Checks({ items }: { items: string[] }) {
  return (
    <p className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300 ring-1 ring-emerald-400/20">
          <Check className="h-2.5 w-2.5" /> {item}
        </span>
      ))}
    </p>
  );
}

function Integration({ name, detail, tone }: { name: string; detail: string; tone: "brand" | "emerald" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold ${tone === "brand" ? "bg-brand-500/20 text-brand-200" : "bg-emerald-400/15 text-emerald-300"}`}>
        {name[0]}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-white">{name}</span>
        <span className="block truncate text-[11px] text-stone-500">{detail}</span>
      </span>
      <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-stone-300">Installed</span>
    </div>
  );
}

function Swatch({ label, ground, ink, accent, big = false }: { label: string; ground: string; ink: string; accent: string; big?: boolean }) {
  return (
    <div className={`rounded-lg p-2.5 ring-1 ring-white/10 ${ground}`}>
      <div className={`${big ? "h-2.5 w-3/4" : "h-2 w-2/3"} rounded ${ink}`} />
      <div className={`mt-1.5 h-1.5 w-1/2 rounded ${ink} opacity-40`} />
      <div className={`mt-2 h-3 w-10 rounded ${accent}`} />
      <p className={`mt-2 text-[10px] ${big ? "text-stone-400" : "text-stone-500"}`}>{label}</p>
    </div>
  );
}
