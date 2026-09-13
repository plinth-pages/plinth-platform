import ts from "typescript";
import { assertComponent } from "./props";
import { CodemodError, applyEdits, lineEnd, lineStart, parse } from "./source";

const START = /\/\/[ \t]*plinth:imports:start\b.*$/gm;
const END = /\/\/[ \t]*plinth:imports:end\b.*$/gm;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/;

export interface Changed {
  source: string;
  changed: boolean;
}

interface Region {
  /** First character after the start marker's line. */
  start: number;
  /** First character of the end marker's line. */
  end: number;
}

function region(source: string, fileName: string): Region {
  const starts = [...source.matchAll(START)];
  const ends = [...source.matchAll(END)];
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index! < starts[0].index!) {
    throw new CodemodError("IMPORT_REGION_MISSING", `${fileName} needs exactly one // plinth:imports:start … // plinth:imports:end region.`);
  }
  return { start: lineEnd(source, starts[0].index!), end: lineStart(source, ends[0].index!) };
}

function declarationsIn(file: ts.SourceFile, bounds: Region): ts.ImportDeclaration[] {
  return file.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) && statement.getStart(file) >= bounds.start && statement.getStart(file) < bounds.end,
  );
}

const specifierOf = (declaration: ts.ImportDeclaration) => (declaration.moduleSpecifier as ts.StringLiteral).text;

function namedImports(declaration: ts.ImportDeclaration): string[] | null {
  const clause = declaration.importClause;
  if (!clause || clause.name || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return null;
  return clause.namedBindings.elements.map((element) => (element.propertyName ? null : element.name.text)).filter((n): n is string => n !== null);
}

const renderImport = (names: string[], pkg: string) => `import { ${[...names].sort().join(", ")} } from ${JSON.stringify(pkg)};`;

/**
 * Adds `import { named } from "pkg"` inside the managed imports region. Declarations in the region stay sorted by
 * package; an existing import from the same package gains the name. Importing a name that is already there is a no-op.
 */
export function addImport(source: string, spec: { pkg: string; named: string }, fileName = "file.tsx"): Changed {
  if (!PACKAGE.test(spec.pkg)) throw new CodemodError("INVALID_IDENTIFIER", `"${spec.pkg}" isn't an npm package name.`);
  assertComponent(spec.named);
  const bounds = region(source, fileName);
  const file = parse(source, fileName);
  const declarations = declarationsIn(file, bounds);

  const existing = declarations.find((declaration) => specifierOf(declaration) === spec.pkg && namedImports(declaration) !== null);
  if (existing) {
    const names = namedImports(existing)!;
    if (names.includes(spec.named)) return { source, changed: false };
    const text = renderImport([...names, spec.named], spec.pkg);
    return { source: applyEdits(source, [{ start: existing.getStart(file), end: existing.getEnd(), text }]), changed: true };
  }

  const next = declarations.find((declaration) => specifierOf(declaration) > spec.pkg);
  const at = next ? lineStart(source, next.getStart(file)) : bounds.end;
  return { source: applyEdits(source, [{ start: at, end: at, text: `${renderImport([spec.named], spec.pkg)}\n` }]), changed: true };
}

/** Removes a package's import from the managed region — the whole declaration. Absent imports are a no-op. */
export function removeImport(source: string, spec: { pkg: string }, fileName = "file.tsx"): Changed {
  const bounds = region(source, fileName);
  const file = parse(source, fileName);
  const edits = declarationsIn(file, bounds)
    .filter((declaration) => specifierOf(declaration) === spec.pkg)
    .map((declaration) => ({ start: lineStart(source, declaration.getStart(file)), end: lineEnd(source, declaration.getEnd() - 1), text: "" }));
  return edits.length ? { source: applyEdits(source, edits), changed: true } : { source, changed: false };
}
