export type DiffLine = [" " | "+" | "-", string];

/** A unified diff, as the co-pilot shows it: green additions, red removals, context in between. */
export function DiffView({ file, lines, stagger = false, startLine = 12 }: { file: string; lines: DiffLine[]; stagger?: boolean; startLine?: number }) {
  let number = startLine;
  return (
    <div className="overflow-hidden rounded-xl bg-[#08090d] ring-1 ring-white/[0.07]">
      <p className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 font-mono text-[11px] text-stone-400">
        <FileIcon /> {file}
      </p>
      <div className="overflow-x-auto py-2">
        <div className="min-w-max font-mono text-[12px] leading-[1.7] whitespace-pre">
          {lines.map(([mark, code], index) => {
            const shown = mark === "-" ? "" : String(number++);
            return (
              <div
                key={index}
                className={`flex pr-4 ${stagger ? "animate-demo-in" : ""} ${mark === "+" ? "bg-emerald-400/[0.09] text-emerald-200" : mark === "-" ? "bg-red-400/[0.09] text-red-200" : "text-stone-400"}`}
                style={stagger ? { animationDelay: `${index * 60}ms` } : undefined}
              >
                <span className="w-9 shrink-0 pr-2 text-right text-stone-600 select-none">{shown}</span>
                <span className={`w-4 shrink-0 select-none ${mark === "+" ? "text-emerald-400" : mark === "-" ? "text-red-400" : ""}`}>{mark === " " ? "" : mark}</span>
                <code>{code}</code>
              </div>
            );
          })}
        </div>
      </div>
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

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M4 1.75h5.5L12.25 4.5v9.75H4z" />
      <path d="M9.25 1.75V4.75h3" />
    </svg>
  );
}
