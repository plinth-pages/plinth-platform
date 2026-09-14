"use client";

import type {
  CatalogueIntegration,
  CredentialStatus,
  IntegrationSecretSpec,
  InstalledIntegrationSummary,
  InstalledIntegrationsResponse,
  IntegrationCategory,
  IntegrationPropSpec,
  IntegrationsResponse,
  LiveCheck,
  OperationStatus,
  PendingIntegrationChange,
  PlannedIntegration,
  PortfolioRole,
} from "@plinth-pages/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockIcon } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";

type Category = IntegrationCategory | "all";
type PropValue = string | number | boolean;

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "coding", label: "Coding" },
  { id: "social", label: "Social" },
  { id: "writing", label: "Writing" },
  { id: "analytics", label: "Analytics" },
  { id: "contact", label: "Contact" },
  { id: "other", label: "Other" },
];

const TILE: Record<string, string> = {
  coding: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  social: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  writing: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  analytics: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  contact: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  other: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200",
};

const PENDING_LABEL: Record<PendingIntegrationChange["type"], string> = { install: "Installing", move: "Moving", uninstall: "Removing" };
const STATUS_LABEL: Partial<Record<OperationStatus, string>> = { queued: "queued", staging: "preparing", checking: "checking", applying: "applying" };

const button =
  "rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-900";
const primary =
  "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300";
const field =
  "w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-xs placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none dark:border-stone-700 dark:bg-stone-900";

/** "afterProjects" → "After projects". */
function slotLabel(slot: string) {
  const words = slot.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function roleLabel(role: string) {
  return role.replace(/[-_]/g, " ");
}

/**
 * The integration catalogue. What the codemod engine supports installs into a slot as a checked change to the draft
 * branch; everything else can be requested, which is how the next integrations get chosen.
 */
export function IntegrationsPanel({
  portfolioId,
  role,
  revision,
  activeOperationId,
}: {
  portfolioId: string;
  role: PortfolioRole;
  revision: number;
  activeOperationId: string | null;
}) {
  const [catalogue, setCatalogue] = useState<IntegrationsResponse | null>(null);
  const [installed, setInstalled] = useState<InstalledIntegrationsResponse | null>(null);
  const [keys, setKeys] = useState<Record<string, CredentialStatus[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [configuring, setConfiguring] = useState<string | null>(null);

  const loadCatalogue = useCallback(async () => {
    try {
      setCatalogue(await api.integrations());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load integrations");
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const response = await api.credentials(portfolioId);
      setKeys(Object.fromEntries(response.integrations.map((entry) => [entry.integrationId, entry.secrets])));
    } catch {
      // Keys are shown as not connected until the next refresh.
    }
  }, [portfolioId]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const loadInstalled = useCallback(async () => {
    try {
      setInstalled(await api.installedIntegrations(portfolioId));
    } catch {
      // Shown as "—" until the next refresh.
    }
  }, [portfolioId]);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  // Operations finishing (revision) or starting (active id) change what's installed.
  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled, revision, activeOperationId]);

  const matches = useCallback(
    (entry: { name: string; description: string; category: string }) =>
      (category === "all" || entry.category === category) &&
      (!query.trim() || `${entry.name} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase())),
    [category, query],
  );

  const installedIds = useMemo(() => new Set(installed?.installed.map((entry) => entry.id)), [installed]);
  const pendingById = useMemo(() => new Map(installed?.pending.map((change) => [change.integrationId, change])), [installed]);

  if (error) return <p className="p-4 text-xs text-red-800 dark:text-red-300">{error}</p>;
  if (!catalogue) return <p className="p-4 text-xs text-stone-500">Loading integrations…</p>;

  const available = catalogue.integrations
    .filter(matches)
    .sort((a, b) => Number(b.recommendedFor.includes(role)) - Number(a.recommendedFor.includes(role)) || a.name.localeCompare(b.name));
  const planned = catalogue.planned.filter(matches);
  const byId = new Map(catalogue.integrations.map((entry) => [entry.id, entry]));
  const used = (installed?.installed.length ?? 0) + (installed?.pending.filter((p) => p.type === "install").length ?? 0);
  const atLimit = installed ? used >= installed.limit : false;

  const setRequested = (id: string, requested: boolean) =>
    setCatalogue((current) =>
      current && {
        ...current,
        planned: current.planned.map((entry) => (entry.id === id ? { ...entry, requested } : entry)),
        requestedKeys: requested ? [...new Set([...current.requestedKeys, id])] : current.requestedKeys.filter((key) => key !== id),
      },
    );

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-stone-200 bg-white/95 p-3 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${catalogue.integrations.length + catalogue.planned.length} integrations`} aria-label="Search integrations" className={field} />
        <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1">
          {CATEGORIES.map(({ id, label }) => (
            <button
              key={id}
              role="radio"
              aria-checked={category === id}
              onClick={() => setCategory(id)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none ${
                category === id ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-100 text-stone-600 hover:text-stone-900 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Section title="On your portfolio" aside={installed ? `${used} of ${installed.limit}` : "—"}>
        {installed && installed.installed.length === 0 && !installed.pending.some((p) => p.type === "install") ? (
          <p className="px-1 text-xs text-stone-500">Nothing installed yet. Pick one below — it shows up in your preview first, and goes live when you publish.</p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {installed?.installed.map((entry) => (
            <InstalledRow
              key={entry.id}
              portfolioId={portfolioId}
              entry={entry}
              pending={pendingById.get(entry.id) ?? null}
              category={byId.get(entry.id)?.category ?? "other"}
              secrets={byId.get(entry.id)?.secrets ?? []}
              keys={keys[entry.id]}
              onKeysChanged={setKeys}
              onQueued={loadInstalled}
            />
          ))}
          {installed?.pending
            .filter((change) => change.type === "install" && !installedIds.has(change.integrationId))
            .map((change) => (
              <li key={change.operationId} className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <Tile name={byId.get(change.integrationId)?.name ?? change.integrationId} category={byId.get(change.integrationId)?.category ?? "other"} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{byId.get(change.integrationId)?.name ?? change.integrationId}</span>
                <PendingBadge change={change} />
              </li>
            ))}
        </ul>
      </Section>

      <Section title="Ready to install" aside={`${available.length}`}>
        {available.length === 0 ? <p className="px-1 text-xs text-stone-500">No matches.</p> : null}
        <ul className="flex flex-col gap-1">
          {available.map((entry) => (
            <AvailableRow
              key={entry.id}
              portfolioId={portfolioId}
              entry={entry}
              recommended={entry.recommendedFor.includes(role)}
              role={role}
              installed={installedIds.has(entry.id)}
              pending={pendingById.get(entry.id) ?? null}
              atLimit={atLimit}
              open={configuring === entry.id}
              keys={keys[entry.id]}
              onKeysChanged={setKeys}
              onToggle={() => setConfiguring((current) => (current === entry.id ? null : entry.id))}
              onQueued={() => (setConfiguring(null), void loadInstalled())}
            />
          ))}
        </ul>
      </Section>

      <Section title="Coming soon" aside={`${planned.length}`}>
        <p className="px-1 text-xs text-stone-500">Not built yet. Request the ones you want — the most requested are built first.</p>
        <ul className="flex flex-col">
          {planned.map((entry) => (
            <PlannedRow key={entry.id} entry={entry} portfolioId={portfolioId} onChange={(requested) => setRequested(entry.id, requested)} />
          ))}
        </ul>
        <SuggestForm portfolioId={portfolioId} onRequested={loadCatalogue} />
      </Section>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-stone-100 px-3 py-4 last:border-b-0 dark:border-stone-900">
      <h3 className="flex items-baseline justify-between px-1 text-[11px] font-medium tracking-wide text-stone-500 uppercase">
        {title}
        <span className="font-mono tracking-normal tabular-nums normal-case">{aside}</span>
      </h3>
      {children}
    </section>
  );
}

function Tile({ name, category }: { name: string; category: string }) {
  const letters = name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold ${TILE[category] ?? TILE.other}`}>
      {letters}
    </span>
  );
}

function PendingBadge({ change }: { change: PendingIntegrationChange }) {
  return (
    <span role="status" className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" />
      {PENDING_LABEL[change.type]} · {STATUS_LABEL[change.status] ?? change.status}
    </span>
  );
}

function InstalledRow({
  portfolioId,
  entry,
  pending,
  category,
  secrets,
  keys,
  onKeysChanged,
  onQueued,
}: {
  portfolioId: string;
  entry: InstalledIntegrationSummary;
  pending: PendingIntegrationChange | null;
  category: string;
  secrets: IntegrationSecretSpec[];
  keys: CredentialStatus[] | undefined;
  onKeysChanged: KeysChanged;
  onQueued: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "move" | "remove" | "keys">("idle");
  const keysMissing = secrets.some((spec) => spec.required && !keys?.find((status) => status.env === spec.env)?.connected);
  const [slot, setSlot] = useState(entry.slot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("idle");
      onQueued();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md px-1 py-1.5">
      <div className="flex items-center gap-2.5">
        <Tile name={entry.name} category={category} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{entry.name}</span>
          <span className="block truncate text-[11px] text-stone-500">
            {slotLabel(entry.slot)} · <span className="font-mono">{entry.version}</span>
            {keysMissing ? <span className="text-amber-700 dark:text-amber-400"> · keys needed</span> : null}
          </span>
        </span>
        {pending ? (
          <PendingBadge change={pending} />
        ) : mode === "idle" ? (
          <span className="flex shrink-0 gap-1">
            {secrets.length ? (
              <button onClick={() => setMode("keys")} className={button}>
                Keys
              </button>
            ) : null}
            {entry.allowedSlots.length > 1 ? (
              <button onClick={() => setMode("move")} className={button}>
                Move
              </button>
            ) : null}
            <button onClick={() => setMode("remove")} className={button}>
              Remove
            </button>
          </span>
        ) : null}
      </div>

      {!pending && mode === "move" ? (
        <div className="flex items-center gap-1.5 pl-[42px]">
          <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label={`Move ${entry.name} to`} className={field}>
            {entry.allowedSlots.map((name) => (
              <option key={name} value={name}>
                {slotLabel(name)}
              </option>
            ))}
          </select>
          <button disabled={busy || slot === entry.slot} onClick={() => void run(() => api.moveIntegration(portfolioId, entry.id, slot))} className={primary}>
            Move
          </button>
          <button onClick={() => (setMode("idle"), setSlot(entry.slot))} className="px-1.5 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
            Cancel
          </button>
        </div>
      ) : null}

      {!pending && mode === "keys" ? (
        <div className="flex flex-col gap-2 pl-[42px]">
          <KeysSection portfolioId={portfolioId} integrationId={entry.id} name={entry.name} secrets={secrets} keys={keys} onChanged={onKeysChanged} allowDisconnect />
          <button onClick={() => setMode("idle")} className="w-fit px-0.5 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
            Done
          </button>
        </div>
      ) : null}

      {!pending && mode === "remove" ? (
        <div className="flex flex-col gap-1.5 pl-[42px]">
          <p className="text-[11px] text-stone-600 dark:text-stone-400">
            Removes {entry.name} from your site.{secrets.length ? " Your keys stay saved until you disconnect them." : ""}
          </p>
          <span className="flex gap-1.5">
            <button disabled={busy} onClick={() => void run(() => api.uninstallIntegration(portfolioId, entry.id))} className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none disabled:opacity-50">
              Remove {entry.name}
            </button>
            <button onClick={() => setMode("idle")} className="px-1.5 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      {error ? <p className="pl-[42px] text-[11px] text-red-800 dark:text-red-300">{error}</p> : null}
    </li>
  );
}

function AvailableRow({
  portfolioId,
  entry,
  recommended,
  role,
  installed,
  pending,
  atLimit,
  open,
  keys,
  onKeysChanged,
  onToggle,
  onQueued,
}: {
  portfolioId: string;
  entry: CatalogueIntegration;
  recommended: boolean;
  role: string;
  installed: boolean;
  pending: PendingIntegrationChange | null;
  atLimit: boolean;
  open: boolean;
  keys: CredentialStatus[] | undefined;
  onKeysChanged: KeysChanged;
  onToggle: () => void;
  onQueued: () => void;
}) {
  return (
    <li className={`flex flex-col gap-2 rounded-md px-1 py-1.5 ${open ? "bg-stone-50 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800" : ""}`}>
      <div className="flex items-start gap-2.5">
        <Tile name={entry.name} category={entry.category} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs font-medium">
            {entry.name}
            {recommended ? <span className="rounded bg-emerald-50 px-1 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">For {roleLabel(role)}s</span> : null}
            {entry.secrets.length ? <span className="rounded bg-stone-100 px-1 text-[10px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">Uses your own key</span> : null}
          </span>
          <span className="block text-[11px] text-stone-500">{entry.description}</span>
        </span>
        {pending ? (
          <PendingBadge change={pending} />
        ) : installed ? (
          <span className="shrink-0 pt-1 text-[11px] text-emerald-800 dark:text-emerald-300">✓ Installed</span>
        ) : (
          <button onClick={onToggle} disabled={atLimit && !open} title={atLimit ? "Your plan's integration limit is reached" : undefined} aria-expanded={open} className={open ? button : primary}>
            {open ? "Close" : "Install"}
          </button>
        )}
      </div>
      {open && !installed && !pending ? <InstallForm portfolioId={portfolioId} entry={entry} keys={keys} onKeysChanged={onKeysChanged} onQueued={onQueued} /> : null}
    </li>
  );
}

function initialProps(specs: IntegrationPropSpec[]): Record<string, PropValue> {
  return Object.fromEntries(specs.map((spec) => [spec.name, spec.default ?? (spec.type === "boolean" ? false : "")]));
}

function InstallForm({
  portfolioId,
  entry,
  keys,
  onKeysChanged,
  onQueued,
}: {
  portfolioId: string;
  entry: CatalogueIntegration;
  keys: CredentialStatus[] | undefined;
  onKeysChanged: KeysChanged;
  onQueued: () => void;
}) {
  const keysReady = entry.secrets.every((spec) => !spec.required || keys?.find((status) => status.env === spec.env)?.connected);
  const [slot, setSlot] = useState(entry.defaultSlot);
  const [props, setProps] = useState<Record<string, PropValue>>(() => initialProps(entry.props));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [live, setLive] = useState<Record<string, LiveCheck>>({});
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const missing = entry.props.some((spec) => spec.required && (props[spec.name] === "" || props[spec.name] === undefined));

  // Check as the user types: the manifest's rules, then whether the account exists.
  useEffect(() => {
    if (missing) {
      setValid(false);
      setLive({});
      setFields({});
      return;
    }
    const id = ++sequence.current;
    setValidating(true);
    const timer = setTimeout(async () => {
      try {
        const payload = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== ""));
        const result = await api.validateIntegration(entry.id, payload);
        if (id !== sequence.current) return;
        setFields(result.fields);
        setLive(result.live);
        setValid(result.ok);
      } catch {
        if (id === sequence.current) setValid(true); // the install request validates again
      } finally {
        if (id === sequence.current) setValidating(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [entry.id, props, missing]);

  async function install() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== ""));
      await api.installIntegration(portfolioId, { integrationId: entry.id, slot, props: payload });
      onQueued();
    } catch (e) {
      if (e instanceof ApiError && e.body?.fields) setFields(e.body.fields as Record<string, string>);
      setError(e instanceof Error ? e.message : "The install couldn't be queued");
    } finally {
      setSubmitting(false);
    }
  }

  const setProp = (name: string, value: PropValue) => setProps((current) => ({ ...current, [name]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void install();
      }}
      className="flex flex-col gap-3 pb-1 pl-[42px]"
    >
      {entry.secrets.length ? (
        <KeysSection portfolioId={portfolioId} integrationId={entry.id} name={entry.name} secrets={entry.secrets} keys={keys} onChanged={onKeysChanged} allowDisconnect={false} />
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">Place it</span>
        <select value={slot} onChange={(e) => setSlot(e.target.value)} className={field}>
          {entry.allowedSlots.map((name) => (
            <option key={name} value={name}>
              {slotLabel(name)}
              {name === entry.defaultSlot ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </label>

      {entry.props.map((spec) => (
        <PropField key={spec.name} spec={spec} value={props[spec.name]} error={fields[spec.name]} live={live[spec.name]} onChange={(value) => setProp(spec.name, value)} />
      ))}

      <p className="text-[11px] leading-relaxed text-stone-500">
        Adds {entry.name} to <span className="font-medium text-stone-700 dark:text-stone-300">{slotLabel(slot).toLowerCase()}</span> in your preview. It&apos;s checked
        first and undone automatically if anything breaks.
      </p>
      {error ? <p className="text-[11px] text-red-800 dark:text-red-300">{error}</p> : null}
      <span className="flex items-center gap-2">
        <button type="submit" disabled={missing || validating || !valid || submitting || !keysReady} title={keysReady ? undefined : "Connect the keys above first"} className={primary}>
          {submitting ? "Queuing…" : `Install ${entry.name}`}
        </button>
        {validating && !missing ? <span className="text-[11px] text-stone-500">Checking…</span> : null}
      </span>
    </form>
  );
}

type KeysChanged = (update: (current: Record<string, CredentialStatus[]>) => Record<string, CredentialStatus[]>) => void;

/**
 * Connect, replace or disconnect an integration's keys. Values are typed here once, verified with the provider by the
 * server, stored encrypted, and never shown again — only a masked hint comes back.
 */
function KeysSection({
  portfolioId,
  integrationId,
  name,
  secrets,
  keys,
  onChanged,
  allowDisconnect,
}: {
  portfolioId: string;
  integrationId: string;
  name: string;
  secrets: IntegrationSecretSpec[];
  keys: CredentialStatus[] | undefined;
  onChanged: KeysChanged;
  allowDisconnect: boolean;
}) {
  const connected = secrets.every((spec) => !spec.required || keys?.find((status) => status.env === spec.env)?.connected);
  const [editing, setEditing] = useState(!connected);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (response: { integrations: { integrationId: string; secrets: CredentialStatus[] }[] }) =>
    onChanged((current) => ({ ...current, ...Object.fromEntries(response.integrations.map((entry) => [entry.integrationId, entry.secrets])) }));

  async function save() {
    setBusy("save");
    setError(null);
    setFields({});
    try {
      apply(await api.connectCredentials(portfolioId, integrationId, { values }));
      setValues({});
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.body?.fields) setFields(e.body.fields as Record<string, string>);
      setError(e instanceof Error ? e.message : "The keys couldn't be saved");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError(null);
    try {
      apply(await api.disconnectCredentials(portfolioId, integrationId));
      setConfirming(false);
      setEditing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The keys couldn't be disconnected");
    } finally {
      setBusy(null);
    }
  }

  const pendingProduction = keys?.some((status) => status.connected && !status.syncedToProduction);

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-white p-2.5 ring-1 ring-stone-200 dark:bg-stone-950 dark:ring-stone-800">
      <div className="flex items-center gap-1.5">
        <LockIcon className="h-3.5 w-3.5 text-stone-500" />
        <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">Your keys</span>
        {connected && !editing ? <span className="ml-auto text-[11px] text-emerald-700 dark:text-emerald-400">✓ Connected</span> : null}
      </div>

      {!editing ? (
        <>
          <ul className="flex flex-col gap-1">
            {secrets.map((spec) => {
              const status = keys?.find((entry) => entry.env === spec.env);
              return (
                <li key={spec.env} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-stone-600 dark:text-stone-400">{spec.label}</span>
                  <span className="font-mono text-stone-700 dark:text-stone-300">{status?.hint ?? "not set"}</span>
                </li>
              );
            })}
          </ul>
          {pendingProduction ? <p className="text-[11px] text-stone-500">Active in your preview now, and on your live site after you next publish.</p> : null}
          <span className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setEditing(true)} className={button}>
              Replace
            </button>
            {allowDisconnect ? (
              confirming ? (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void disconnect()}
                    className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                  >
                    {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="px-1.5 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="px-1.5 text-xs text-red-700 hover:underline dark:text-red-400">
                  Disconnect…
                </button>
              )
            ) : null}
          </span>
          {confirming ? <p className="text-[11px] text-stone-600 dark:text-stone-400">Deletes the keys from Plinth, your preview and your live site. {name} stops working until you connect again.</p> : null}
        </>
      ) : (
        <>
          {secrets.map((spec) => {
            const status = keys?.find((entry) => entry.env === spec.env);
            const id = `secret-${integrationId}-${spec.env}`;
            return (
              <label key={spec.env} htmlFor={id} className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[11px] font-medium text-stone-700 dark:text-stone-300">
                  {spec.label}
                  {spec.helpUrl ? (
                    <a href={spec.helpUrl} target="_blank" rel="noopener noreferrer" className="font-normal text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-900">
                      Get one ↗
                    </a>
                  ) : null}
                </span>
                <input
                  id={id}
                  type={spec.kind === "api_key" ? "password" : spec.kind === "email" ? "email" : "text"}
                  value={values[spec.env] ?? ""}
                  onChange={(e) => setValues((current) => ({ ...current, [spec.env]: e.target.value }))}
                  placeholder={status?.connected ? `Saved (${status.hint}) — leave blank to keep` : spec.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(fields[spec.env])}
                  className={`${field} font-mono ${fields[spec.env] ? "border-red-400 dark:border-red-700" : ""}`}
                />
                {fields[spec.env] ? (
                  <span className="text-[11px] text-red-800 dark:text-red-300">{fields[spec.env]}</span>
                ) : spec.description ? (
                  <span className="text-[11px] text-stone-500">{spec.description}</span>
                ) : null}
              </label>
            );
          })}
          <p className="text-[11px] leading-relaxed text-stone-500">Encrypted and used only by your site&apos;s server. Never added to your code or shown again.</p>
          {error && !Object.keys(fields).length ? <p className="text-[11px] text-red-800 dark:text-red-300">{error}</p> : null}
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy !== null || !secrets.some((spec) => values[spec.env]?.trim())}
              onClick={() => void save()}
              className={primary}
            >
              {busy === "save" ? "Checking…" : "Verify & save"}
            </button>
            {connected ? (
              <button type="button" onClick={() => (setEditing(false), setValues({}), setFields({}))} className="px-1.5 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
                Cancel
              </button>
            ) : null}
          </span>
        </>
      )}
    </div>
  );
}

function PropField({
  spec,
  value,
  error,
  live,
  onChange,
}: {
  spec: IntegrationPropSpec;
  value: PropValue | undefined;
  error: string | undefined;
  live: LiveCheck | undefined;
  onChange: (value: PropValue) => void;
}) {
  const id = `prop-${spec.name}`;
  if (spec.type === "boolean") {
    return (
      <label htmlFor={id} className="flex items-start gap-2">
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
        <span className="flex flex-col">
          <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">{spec.label}</span>
          {spec.description ? <span className="text-[11px] text-stone-500">{spec.description}</span> : null}
        </span>
      </label>
    );
  }
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
        {spec.label}
        {spec.required ? null : <span className="font-normal text-stone-500"> · optional</span>}
      </span>
      <input
        id={id}
        type={spec.type === "number" ? "number" : "text"}
        value={value === undefined ? "" : String(value)}
        placeholder={spec.type === "string" ? spec.placeholder : undefined}
        maxLength={spec.type === "string" ? spec.maxLength : undefined}
        min={spec.type === "number" ? spec.min : undefined}
        max={spec.type === "number" ? spec.max : undefined}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(spec.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
        className={`${field} font-mono ${error ? "border-red-400 dark:border-red-700" : ""}`}
      />
      {error ? (
        <span className="text-[11px] text-red-800 dark:text-red-300">{error}</span>
      ) : live?.status === "found" ? (
        <span className="text-[11px] text-emerald-800 dark:text-emerald-300">✓ {live.message}</span>
      ) : live?.status === "unknown" ? (
        <span className="text-[11px] text-stone-500">{live.message}</span>
      ) : spec.description ? (
        <span className="text-[11px] text-stone-500">{spec.description}</span>
      ) : null}
    </label>
  );
}

function PlannedRow({ entry, portfolioId, onChange }: { entry: PlannedIntegration; portfolioId: string; onChange: (requested: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (entry.requested) await api.withdrawIntegrationRequest(entry.id);
      else await api.requestIntegration({ key: entry.id, portfolioId });
      onChange(!entry.requested);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 px-1 py-1.5">
      <div className="flex items-center gap-2.5">
        <Tile name={entry.name} category={entry.category} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{entry.name}</span>
          <span className="block truncate text-[11px] text-stone-500" title={entry.description}>
            {entry.description}
          </span>
        </span>
        <button
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={entry.requested}
          title={entry.requested ? "Withdraw your request" : undefined}
          className={
            entry.requested
              ? "group shrink-0 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-stone-100 hover:text-stone-700 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:opacity-50 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-stone-900 dark:hover:text-stone-300"
              : `${button} shrink-0`
          }
        >
          {entry.requested ? (
            <>
              <span className="group-hover:hidden">✓ Requested</span>
              <span className="hidden group-hover:inline">Withdraw</span>
            </>
          ) : (
            "Request"
          )}
        </button>
      </div>
      {error ? <p className="pl-[42px] text-[11px] text-red-800 dark:text-red-300">{error}</p> : null}
    </li>
  );
}

function SuggestForm({ portfolioId, onRequested }: { portfolioId: string; onRequested: () => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.requestIntegration({ name: name.trim(), note: note.trim() || undefined, portfolioId });
      setMessage({ tone: "ok", text: `Requested ${result.name}. Thanks — it counts towards what's built next.` });
      setName("");
      setNote("");
      onRequested();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "The request didn't go through" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="mt-2 flex flex-col gap-1.5 rounded-md border border-dashed border-stone-300 p-2.5 dark:border-stone-700"
    >
      <span className="text-xs font-medium">Don&apos;t see it?</span>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Notion pages" aria-label="Integration name" className={field} />
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="What would you use it for? (optional)" aria-label="Note" className={field} />
      <span className="flex items-center gap-2">
        <button type="submit" disabled={busy || name.trim().length < 2} className={button}>
          {busy ? "Sending…" : "Request"}
        </button>
        {message ? <span className={`text-[11px] ${message.tone === "ok" ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}>{message.text}</span> : null}
      </span>
    </form>
  );
}
