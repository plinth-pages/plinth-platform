"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type Tone = "info" | "success" | "error" | "premium";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

const TONE: Record<Tone, string> = {
  info: "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900",
  success: "bg-emerald-700 text-white",
  error: "bg-red-700 text-white",
  premium: "bg-brand-950 text-white ring-1 ring-brand-400/30",
};

/** Small, bottom-centred notices that dismiss themselves. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const show = useCallback((message: string, tone: Tone = "info") => {
    const id = ++next.current;
    setItems((current) => [...current.filter((item) => item.message !== message), { id, message, tone }].slice(-3));
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3_500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div key={item.id} role="status" className={`animate-toast-in pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-float ${TONE[item.tone]}`}>
            {item.tone === "premium" ? <LockIcon className="h-3.5 w-3.5 text-brand-300" /> : null}
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function LockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5V4.5a2 2 0 1 0-4 0V6h4Z" fillRule="evenodd" />
    </svg>
  );
}
