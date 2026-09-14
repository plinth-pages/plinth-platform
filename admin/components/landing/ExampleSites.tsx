/**
 * Four sample sites, one per role, drawn in Tailwind. They're examples of what the same template becomes after a few
 * sentences — labelled as such on the page, never presented as customers.
 */
const SITES = [
  { role: "Software engineer", uses: ["GitHub Stats", "Contact form"], Preview: EngineerSite },
  { role: "Product designer", uses: ["Dark theme", "Visitor counter"], Preview: DesignerSite },
  { role: "Data scientist", uses: ["Teal accent", "Projects grid"], Preview: DataSite },
  { role: "CS student", uses: ["LeetCode Stats", "Timeline layout"], Preview: StudentSite },
];

export function ExampleSites() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {SITES.map(({ role, uses, Preview }) => (
        <article key={role} className="group flex flex-col overflow-hidden rounded-2xl bg-white/[0.025] ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.04]">
          <div aria-hidden className="h-60 p-3">
            <div className="h-full overflow-hidden rounded-lg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)] transition-transform duration-300 group-hover:-translate-y-0.5">
              <Preview />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 border-t border-white/[0.06] px-4 py-3.5">
            <h3 className="text-[15px] font-semibold tracking-tight text-white">{role}</h3>
            <p className="flex flex-wrap gap-1.5">
              {uses.map((use) => (
                <span key={use} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-stone-400 ring-1 ring-white/[0.07]">
                  {use}
                </span>
              ))}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

// A fixed pattern, so the server and client render the same contribution grid.
const CONTRIBUTIONS = [0, 2, 1, 3, 0, 1, 2, 3, 2, 0, 1, 3, 3, 2, 1, 0, 2, 3, 1, 2, 3, 0, 1, 2, 3, 3, 1, 2, 0, 2, 3, 1, 2, 1, 3];
const LEVEL = ["bg-stone-200", "bg-indigo-200", "bg-indigo-400", "bg-indigo-600"];

function EngineerSite() {
  return (
    <div className="h-full bg-[#f7f7f5] p-3.5 text-stone-900">
      <p className="text-[8px] font-medium tracking-wider text-stone-500 uppercase">Backend engineer</p>
      <p className="text-base leading-tight font-extrabold tracking-tight">Asha Menon</p>
      <p className="mt-1 text-[9px] leading-snug text-stone-500">Systems that stay boring under load.</p>
      <div className="mt-3 rounded-md bg-white p-2 ring-1 ring-stone-200">
        <p className="text-[8px] font-semibold">GitHub · 1,204 contributions</p>
        <div className="mt-1.5 grid grid-flow-col grid-rows-5 gap-[3px]">
          {CONTRIBUTIONS.map((level, index) => (
            <span key={index} className={`h-[7px] w-[7px] rounded-[1.5px] ${LEVEL[level]}`} />
          ))}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {["ledger-kit", "tracequery"].map((name) => (
          <div key={name} className="rounded-md bg-white p-1.5 ring-1 ring-stone-200">
            <p className="text-[8px] font-semibold">{name}</p>
            <p className="text-[7px] text-stone-400">★ 1.2k · Go</p>
          </div>
        ))}
      </div>
      <div className="mt-2 h-5 w-16 rounded bg-indigo-600" />
    </div>
  );
}

function DesignerSite() {
  return (
    <div className="flex h-full flex-col bg-[#111113] p-3.5 text-white">
      <p className="text-[8px] tracking-wider text-stone-500 uppercase">Product designer · Seoul</p>
      <p className="mt-1 text-[26px] leading-[0.95] font-black tracking-[-0.05em]">
        Leo
        <br />
        Park.
      </p>
      <div className="mt-3 grid flex-1 grid-cols-2 gap-1.5">
        <div className="rounded-md bg-gradient-to-br from-rose-400 to-orange-300" />
        <div className="rounded-md bg-gradient-to-br from-sky-400 to-indigo-500" />
        <div className="rounded-md bg-gradient-to-br from-lime-300 to-emerald-500" />
        <div className="rounded-md bg-stone-800 ring-1 ring-white/10" />
      </div>
      <p className="mt-2 flex items-center justify-between text-[8px] text-stone-500">
        <span>© Leo Park</span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-emerald-400" /> 3,902 visitors
        </span>
      </p>
    </div>
  );
}

function DataSite() {
  return (
    <div className="h-full bg-white p-3.5 text-stone-900">
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-teal-400 to-cyan-600" />
        <div>
          <p className="text-[13px] leading-tight font-bold tracking-tight">Maya Chen</p>
          <p className="text-[8px] text-teal-700">Data scientist · Climate models</p>
        </div>
      </div>
      <div className="mt-3 rounded-md bg-teal-50 p-2 ring-1 ring-teal-100">
        <p className="text-[8px] font-semibold text-teal-900">Forecast error, 2021–2025</p>
        <svg viewBox="0 0 120 36" className="mt-1 h-10 w-full" aria-hidden>
          <path d="M0 8 L15 12 L30 10 L45 18 L60 16 L75 23 L90 22 L105 28 L120 30 L120 36 L0 36 Z" fill="rgb(20 184 166 / 0.15)" />
          <path d="M0 8 L15 12 L30 10 L45 18 L60 16 L75 23 L90 22 L105 28 L120 30" fill="none" stroke="rgb(13 148 136)" strokeWidth="1.5" />
          <circle cx="120" cy="30" r="2" fill="rgb(13 148 136)" />
        </svg>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[
          ["3", "papers"],
          ["12", "notebooks"],
          ["41%", "less error"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-md p-1.5 ring-1 ring-stone-200">
            <p className="text-[11px] font-bold tabular-nums">{value}</p>
            <p className="text-[7px] text-stone-500">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentSite() {
  return (
    <div className="h-full bg-[#fffaf2] p-3.5 text-stone-900">
      <p className="text-[13px] leading-tight font-bold tracking-tight">Rahul Das</p>
      <p className="text-[8px] text-amber-700">CS undergrad · Looking for 2027 internships</p>
      <div className="mt-3 flex items-center gap-3 rounded-md bg-white p-2 ring-1 ring-amber-100">
        <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="14" fill="none" stroke="rgb(254 243 199)" strokeWidth="4" />
          <circle cx="18" cy="18" r="14" fill="none" stroke="rgb(217 119 6)" strokeWidth="4" strokeDasharray="62 88" strokeLinecap="round" />
        </svg>
        <div>
          <p className="text-[8px] font-semibold text-stone-500">LeetCode</p>
          <p className="text-sm leading-tight font-bold tabular-nums">412 solved</p>
          <p className="text-[7px] text-stone-500">Top 8% · 60-day streak</p>
        </div>
      </div>
      <ol className="mt-2.5 flex flex-col gap-1.5 border-l border-amber-200 pl-2.5">
        {[
          ["2026", "SWE intern, fintech startup"],
          ["2025", "ICPC regionals"],
        ].map(([year, text]) => (
          <li key={year} className="relative text-[8px]">
            <span className="absolute top-1 -left-[13px] h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span className="font-semibold tabular-nums">{year}</span> <span className="text-stone-600">{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
