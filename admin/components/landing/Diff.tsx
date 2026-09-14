export type Change = [" " | "+" | "-", string];

/** What a request changed, in plain words: green for added, red for removed, grey for what stayed as it was. */
export function ChangeList({ title, changes, stagger = false }: { title: string; changes: Change[]; stagger?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#08090d] ring-1 ring-white/[0.07]">
      <p className="border-b border-white/[0.06] px-3 py-2 text-[11px] font-medium text-stone-400">{title}</p>
      <ul className="py-1.5 text-[13px] leading-[1.9]">
        {changes.map(([mark, text], index) => (
          <li
            key={index}
            className={`flex gap-2 px-3 ${stagger ? "animate-demo-in" : ""} ${mark === "+" ? "bg-emerald-400/[0.08] text-emerald-200" : mark === "-" ? "bg-red-400/[0.08] text-red-200 line-through decoration-red-300/40" : "text-stone-500"}`}
            style={stagger ? { animationDelay: `${index * 60}ms` } : undefined}
          >
            <span aria-hidden className={`w-3 shrink-0 font-mono select-none ${mark === "+" ? "text-emerald-400" : mark === "-" ? "text-red-400" : ""}`}>
              {mark === " " ? "" : mark === "+" ? "+" : "−"}
            </span>
            <span className="sr-only">{mark === "+" ? "Added: " : mark === "-" ? "Removed: " : "Unchanged: "}</span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Check({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}
