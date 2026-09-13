"use client";

import type { WorkspaceFileResponse } from "@plinth-pages/shared";
import { Highlight, themes, type Language } from "prism-react-renderer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";

export interface CodeTarget {
  path: string;
  /** Scroll to and mark the first line containing this text. */
  find?: string;
}

type TreeNode = { name: string; path: string; children: TreeNode[] | null };

/** Read-only file tree and viewer. Files come from the running sandbox; the backend refuses secrets. */
export function CodeView({
  portfolioId,
  live,
  target,
  onOpen,
}: {
  portfolioId: string;
  live: boolean;
  target: CodeTarget | null;
  onOpen: (target: CodeTarget) => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [file, setFile] = useState<WorkspaceFileResponse | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const loadTree = useCallback(async () => {
    setTreeError(null);
    try {
      setFiles((await api.files(portfolioId)).files);
    } catch (e) {
      setTreeError(describe(e));
    }
  }, [portfolioId]);

  useEffect(() => {
    if (live) void loadTree();
  }, [live, loadTree]);

  useEffect(() => {
    if (!target || !live) return;
    let cancelled = false;
    setLoadingFile(true);
    setFileError(null);
    api
      .file(portfolioId, target.path)
      .then((result) => !cancelled && setFile(result))
      .catch((e) => {
        if (cancelled) return;
        setFile(null);
        setFileError(describe(e));
      })
      .finally(() => !cancelled && setLoadingFile(false));
    return () => {
      cancelled = true;
    };
  }, [portfolioId, target, live]);

  const tree = useMemo(() => buildTree(files ?? []), [files]);

  if (!live) {
    return <Centered title="Code appears once the preview is running" detail="The viewer reads files straight from your sandbox." />;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Files" className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">Files</span>
          <button onClick={() => void loadTree()} className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none dark:hover:bg-zinc-800">
            Refresh
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-3 font-mono text-[12.5px]">
          {treeError ? <p className="px-3 text-xs text-red-700 dark:text-red-300">{treeError}</p> : null}
          {files === null && !treeError ? <p className="px-3 text-xs text-zinc-500">Loading…</p> : null}
          {tree.map((node) => (
            <TreeItem key={node.path} node={node} depth={0} selected={target?.path ?? null} onOpen={(path) => onOpen({ path })} />
          ))}
        </div>
      </nav>

      <section className="flex min-h-0 flex-col">
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{target?.path ?? "No file open"}</span>
          <span className="shrink-0 text-[11px] text-zinc-500">Read-only</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {!target ? <Centered title="Pick a file" detail="Start with app/page.tsx — it's where the page's slots live." /> : null}
          {target && loadingFile && !file ? <p className="p-4 text-xs text-zinc-500">Opening…</p> : null}
          {target && fileError ? <Centered title="Can't open this file" detail={fileError} tone="error" /> : null}
          {target && file && !fileError ? <FileBody file={file} find={target.find} /> : null}
        </div>
      </section>
    </div>
  );
}

function FileBody({ file, find }: { file: WorkspaceFileResponse; find?: string }) {
  const dark = usePrefersDark();
  const marked = useRef<HTMLDivElement>(null);
  const markLine = useMemo(() => {
    if (!find || file.content === null) return -1;
    return file.content.split("\n").findIndex((line) => line.includes(find));
  }, [file, find]);

  useEffect(() => {
    marked.current?.scrollIntoView({ block: "center" });
  }, [markLine, file.path]);

  if (file.kind === "binary") return <Centered title="Binary file" detail={`${file.path} isn't text, so it isn't shown.`} />;
  if (file.kind === "too_large") {
    return <Centered title="Too large to show" detail={`${Math.round(file.size / 1024)} KB — the viewer shows files up to 512 KB.`} />;
  }

  return (
    <Highlight theme={dark ? themes.vsDark : themes.github} code={file.content ?? ""} language={languageFor(file.path)}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="min-w-fit py-3 font-mono text-[12.5px] leading-5" style={{ background: "transparent" }}>
          {tokens.map((line, index) => {
            const { className, ...props } = getLineProps({ line });
            const isMarked = index === markLine;
            return (
              <div
                key={index}
                ref={isMarked ? marked : undefined}
                {...props}
                className={`${className} flex pr-6 ${isMarked ? "bg-amber-100 dark:bg-amber-500/15" : ""}`}
              >
                <span className="w-12 shrink-0 pr-4 text-right text-zinc-400 select-none tabular-nums dark:text-zinc-600">{index + 1}</span>
                <span className="whitespace-pre">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}

function TreeItem({ node, depth, selected, onOpen }: { node: TreeNode; depth: number; selected: string | null; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(depth === 0 && ["app", "content", "components"].includes(node.name));
  const indent = { paddingLeft: 12 + depth * 12 };

  if (node.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          style={indent}
          className="flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-zinc-700 hover:bg-zinc-200/70 focus-visible:bg-zinc-200 focus-visible:outline-none dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span className="w-2.5 text-[10px] text-zinc-400">{open ? "▾" : "▸"}</span>
          {node.name}
        </button>
        {open ? node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} selected={selected} onOpen={onOpen} />) : null}
      </div>
    );
  }
  const active = node.path === selected;
  return (
    <button
      onClick={() => onOpen(node.path)}
      style={{ paddingLeft: 12 + depth * 12 + 16 }}
      aria-current={active ? "true" : undefined}
      className={`block w-full truncate py-0.5 pr-2 text-left focus-visible:outline-none ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-200/70 focus-visible:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {node.name}
    </button>
  );
}

function Centered({ title, detail, tone }: { title: string; detail?: string; tone?: "error" }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-8 text-center">
      <p className={`text-sm font-medium ${tone === "error" ? "text-red-800 dark:text-red-300" : ""}`}>{title}</p>
      {detail ? <p className="max-w-md text-xs text-zinc-500">{detail}</p> : null}
    </div>
  );
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const path of paths) {
    let node = root;
    path.split("/").forEach((part, index, parts) => {
      const isFile = index === parts.length - 1;
      const childPath = parts.slice(0, index + 1).join("/");
      let child = node.children!.find((c) => c.name === part && (c.children === null) === isFile);
      if (!child) {
        child = { name: part, path: childPath, children: isFile ? null : [] };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => (a.children === null) === (b.children === null) ? a.name.localeCompare(b.name) : a.children ? -1 : 1)
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children!);
}

function languageFor(path: string): Language {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "ts" || ext === "tsx" || ext === "mts") return "tsx";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "jsx";
  if (ext === "json") return "json";
  if (ext === "css") return "css";
  if (ext === "md" || ext === "mdx") return "markdown";
  if (ext === "yml" || ext === "yaml") return "yaml";
  return "markup";
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}

function usePrefersDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(query.matches);
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return dark;
}
