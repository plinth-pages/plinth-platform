import { CodemodError } from "./source";

export type PropValue = string | number | boolean;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMPONENT = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "style", "className"]);

export function assertComponent(name: string): void {
  if (!COMPONENT.test(name)) throw new CodemodError("INVALID_IDENTIFIER", `"${name}" isn't a valid component name.`);
}

/**
 * The injection boundary. Every value becomes a JavaScript literal inside a JSX expression container: strings through
 * JSON.stringify (quotes, backslashes, newlines and control characters escaped), numbers only if finite, booleans as
 * `true`/`false`. A value can never close the attribute, open a tag or become code. Names must be plain identifiers,
 * and names that can carry markup or handlers are refused.
 */
export function renderProps(props: Record<string, PropValue>): string {
  return Object.keys(props)
    .sort()
    .map((name) => {
      if (!IDENTIFIER.test(name) || RESERVED.has(name) || /^on[A-Z]/.test(name)) {
        throw new CodemodError("INVALID_PROP", `"${name}" can't be used as an integration prop.`);
      }
      const value = props[name];
      if (typeof value === "string") return `${name}={${JSON.stringify(value)}}`;
      if (typeof value === "boolean") return `${name}={${value}}`;
      if (typeof value === "number" && Number.isFinite(value)) return `${name}={${Object.is(value, -0) ? 0 : value}}`;
      throw new CodemodError("INVALID_PROP", `The value of "${name}" must be a string, a finite number or a boolean.`);
    })
    .join(" ");
}

export function renderElement(component: string, props: Record<string, PropValue>): string {
  assertComponent(component);
  const rendered = renderProps(props);
  return rendered ? `<${component} ${rendered} />` : `<${component} />`;
}
