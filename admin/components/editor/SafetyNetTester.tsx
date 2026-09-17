"use client";

import type { EditOperationRequest } from "@plinth-pages/shared";
import { useState } from "react";
import { api } from "@/lib/api";

type Scenario = {
  id: string;
  label: string;
  expect: string;
  build: (read: (path: string) => Promise<string>) => Promise<EditOperationRequest>;
};

const NAME = /name: "([^"]*)"/;

/**
 * Development and admin only: submits real edits through the safety net, so its behaviour can be watched in the editor
 * before the codemod engine and Plinth AI exist. Uses the dev-only edit endpoint.
 */
const SCENARIOS: Scenario[] = [
  {
    id: "valid",
    label: "Valid edit",
    expect: "applied",
    build: async (read) => {
      const source = await read("content/profile.ts");
      const current = NAME.exec(source)?.[1] ?? "";
      const next = current.endsWith(" ✦") ? current.slice(0, -2) : `${current} ✦`;
      return { summary: "Safety net test: valid edit", files: [{ path: "content/profile.ts", content: source.replace(NAME, `name: "${next}"`) }] };
    },
  },
  {
    id: "type-error",
    label: "Type error",
    expect: "rejected by tsc",
    build: async (read) => {
      const source = await read("content/profile.ts");
      return { summary: "Safety net test: type error", files: [{ path: "content/profile.ts", content: source.replace(NAME, "name: 42") }] };
    },
  },
  {
    id: "slot",
    label: "Delete a slot",
    expect: "rejected by plinth check",
    build: async (read) => {
      const source = await read("app/page.tsx");
      const content = source.replace(/\n?[ \t]*<Slot name="sidebar"[^>]*?(\/>|>\s*<\/Slot>)/, "");
      return { summary: "Safety net test: delete the sidebar slot", files: [{ path: "app/page.tsx", content }] };
    },
  },
  {
    id: "render",
    label: "Crash on render",
    expect: "applied, then reverted",
    build: async (read) => {
      const source = await read("app/page.tsx");
      const content = source.replace(
        /(export default function \w+\([^)]*\)\s*\{)/,
        `$1\n  throw new Error("Plinth safety net test: this page throws while rendering");`,
      );
      return { summary: "Safety net test: throw while rendering", files: [{ path: "app/page.tsx", content }] };
    },
  },
];

export function SafetyNetTester({ portfolioId, disabled }: { portfolioId: string; disabled: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(scenario: Scenario) {
    setBusy(scenario.id);
    setError(null);
    try {
      const read = async (path: string) => {
        const file = await api.file(portfolioId, path);
        if (file.content === null) throw new Error(`${path} can't be read as text`);
        return file.content;
      };
      await api.devEdit(portfolioId, await scenario.build(read));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the edit");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
      <h3 className="font-medium">Test the safety net</h3>
      <p className="text-stone-500">Development only. Each button submits a real change to your draft branch.</p>
      <div className="grid grid-cols-2 gap-2">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            onClick={() => void run(scenario)}
            disabled={disabled || busy !== null}
            title={`Expected: ${scenario.expect}`}
            className="flex flex-col items-start rounded-md border border-stone-300 px-2.5 py-1.5 text-left hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-900"
          >
            <span className="font-medium">{busy === scenario.id ? "Submitting…" : scenario.label}</span>
            <span className="text-[11px] text-stone-500">{scenario.expect}</span>
          </button>
        ))}
      </div>
      {error ? <p className="text-red-800 dark:text-red-300">{error}</p> : null}
    </section>
  );
}
