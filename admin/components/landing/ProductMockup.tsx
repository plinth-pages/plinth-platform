/**
 * A static, Tailwind-only picture of the product: the co-pilot conversation on the left, the portfolio it just changed
 * on the right, and the safety-net checks that ran in between. Decorative — hidden from assistive technology.
 */
export function ProductMockup() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-5xl">
      {/* Glow behind the window */}
      <div className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_30%,rgb(76_98_220/0.45),transparent_70%)] blur-2xl" />

      <div className="overflow-hidden rounded-2xl bg-[#0c0d12]/90 shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_40px_120px_-30px_rgb(0_0_0/0.9)] backdrop-blur">
        {/* Title bar */}
        <div className="flex h-11 items-center gap-3 border-b border-white/[0.06] px-4">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-white/10" />
            <span className="h-3 w-3 rounded-full bg-white/10" />
            <span className="h-3 w-3 rounded-full bg-white/10" />
          </div>
          <div className="mx-auto flex h-6 items-center gap-2 rounded-md bg-white/[0.04] px-3 text-[11px] text-stone-400 ring-1 ring-white/[0.06]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> asha.plinth.app · Preview
          </div>
          <span className="rounded-md bg-gradient-to-b from-brand-500 to-brand-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">Publish</span>
        </div>

        <div className="grid md:grid-cols-[320px_minmax(0,1fr)]">
          {/* Co-pilot */}
          <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 md:border-r md:border-b-0">
            <div className="flex items-center gap-2 text-xs font-medium text-stone-300">
              <Spark /> Co-pilot
              <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-stone-400">Claude</span>
            </div>
            <div className="ml-6 self-end rounded-2xl rounded-br-md bg-white px-3 py-2 text-[13px] text-stone-900">Add my GitHub stats under projects and make the hero bolder</div>
            <div className="mr-4 rounded-2xl rounded-bl-md bg-white/[0.05] px-3 py-2.5 text-[13px] leading-relaxed text-stone-200 ring-1 ring-white/[0.06]">
              Done — your headline is heavier and GitHub Stats now sits right after your projects.
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="flex items-center gap-1 text-emerald-400">
                <Check /> Applied
              </span>
              {["Hero", "GitHub Stats"].map((chip) => (
                <span key={chip} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-stone-300 ring-1 ring-white/[0.08]">
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
              <p className="text-[11px] font-medium tracking-wide text-stone-400 uppercase">Safety net</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[12px] text-stone-300">
                {["Types compile", "Slots intact", "Page renders"].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-auto flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-[12px] text-stone-500 ring-1 ring-white/[0.06]">
              Describe a change…
              <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-md bg-white text-stone-900">↑</span>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-[radial-gradient(120%_80%_at_100%_0%,rgb(76_98_220/0.12),transparent_60%)] p-5 md:p-8">
            <div className="rounded-xl bg-[#f7f7f5] p-6 text-stone-900 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.6)] md:p-8">
              <div className="flex items-center gap-3">
                <span className="h-11 w-11 rounded-full bg-gradient-to-br from-brand-400 to-fuchsia-400" />
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-stone-500 uppercase">Backend engineer</p>
                  <p className="text-[22px] leading-tight font-extrabold tracking-tight">Asha Menon</p>
                </div>
              </div>
              <p className="mt-3 max-w-md text-sm text-stone-600">I build systems that stay boring under load, and tools that make the boring parts fast.</p>
              <div className="mt-6 grid grid-cols-3 gap-2.5">
                {["ledger-kit", "tracequery", "envseal"].map((name) => (
                  <div key={name} className="rounded-lg bg-white p-3 ring-1 ring-stone-200">
                    <p className="text-[12px] font-semibold">{name}</p>
                    <div className="mt-2 h-1.5 w-full rounded bg-stone-100" />
                    <div className="mt-1 h-1.5 w-2/3 rounded bg-stone-100" />
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg bg-white p-3 ring-2 ring-brand-400/60">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold">GitHub</p>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">New</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["48", "repos"],
                    ["2.1k", "stars"],
                    ["312", "followers"],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <p className="text-sm font-bold tabular-nums">{value}</p>
                      <p className="text-[10px] text-stone-500">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spark({ className = "h-3.5 w-3.5 text-brand-400" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8 1.5a.5.5 0 0 1 .47.33l1.2 3.3a1.5 1.5 0 0 0 .9.9l3.3 1.2a.5.5 0 0 1 0 .94l-3.3 1.2a1.5 1.5 0 0 0-.9.9l-1.2 3.3a.5.5 0 0 1-.94 0l-1.2-3.3a1.5 1.5 0 0 0-.9-.9l-3.3-1.2a.5.5 0 0 1 0-.94l3.3-1.2a1.5 1.5 0 0 0 .9-.9l1.2-3.3A.5.5 0 0 1 8 1.5Z" />
    </svg>
  );
}

function Check({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}
