/**
 * Rewrites for the antipatterns the model keeps producing in generated Vitest
 * specs.
 *
 * These run in two places and must behave identically in both:
 *   - at generation time, so what we persist is what actually runs;
 *   - at run time in the worker, so cases stored before a rewrite existed
 *     self-heal on their next run.
 *
 * Every rewrite here must be idempotent — applying it twice is a no-op.
 */

/**
 * Apply all known AI-antipattern rewrites, in order.
 */
export function sanitizeTestCode(code: string): string {
  let out = sanitizeNestedRouter(code);
  out = sanitizeGetByText(out);
  out = sanitizeRelativeImportDepth(out);
  return out;
}

/**
 * Detect and rewrite `render(<MemoryRouter|BrowserRouter|HashRouter ...><App /></...>)`
 * — a recurring AI mistake. `App.tsx` usually mounts its own Router; wrapping
 * <App /> in another Router throws "You cannot render a <Router> inside another <Router>".
 *
 * MemoryRouter with initialEntries → push the route via window.history first, then render <App />.
 * BrowserRouter / HashRouter wrapping <App /> → unwrap (App brings its own router).
 */
export function sanitizeNestedRouter(code: string): string {
  const memoryRe =
    /render\s*\(\s*<MemoryRouter\b([^>]*)>\s*<App\s*\/>\s*<\/MemoryRouter>\s*\)\s*;?/gs;
  let out = code.replace(memoryRe, (_match, attrs: string) => {
    const route = extractInitialRoute(attrs) ?? "/";
    return `window.history.pushState({}, "", ${JSON.stringify(route)}); render(<App />);`;
  });
  out = out.replace(
    /render\s*\(\s*<(BrowserRouter|HashRouter)\b[^>]*>\s*<App\s*\/>\s*<\/\1>\s*\)\s*;?/gs,
    "render(<App />);",
  );
  return out;
}

function extractInitialRoute(attrs: string): string | null {
  // Looks for: initialEntries={["/path"]} or initialEntries={['/path']}
  const m = attrs.match(/initialEntries\s*=\s*\{\s*\[\s*["'`]([^"'`]+)["'`]/);
  return m && m[1] ? m[1] : null;
}

/**
 * Rewrite `expect(screen.getByText(X)).toBeInTheDocument()` to
 * `expect(document.body).toHaveTextContent(X)`.
 *
 * `getByText` matches text that lives entirely in a single element. The AI
 * keeps using it for content that's actually split across elements (a styled
 * span inside a heading, for example), which produces "Unable to find an
 * element with the text" failures even when the rendered DOM contains the
 * expected words. `toHaveTextContent` walks the subtree, which is what the
 * AI actually means.
 */
export function sanitizeGetByText(code: string): string {
  // Conservative match: only handle the explicit toBeInTheDocument assertion
  // form. We leave standalone getByText() calls alone — they might be used
  // for click handlers etc.
  return code.replace(
    /expect\s*\(\s*screen\.getByText\s*\(\s*([^)]+?)\s*\)\s*\)\s*\.toBeInTheDocument\s*\(\s*\)/g,
    "expect(document.body).toHaveTextContent($1)",
  );
}

/**
 * Specs are written to tests/ai/<id>.test.tsx — TWO levels below the repo root
 * — but the AI keeps importing source as if the spec sat one level deep (e.g.
 * `from "../src/Foo"`, which resolves to the non-existent tests/src/Foo).
 * Prepend one more `../` to single-level relative specifiers so they reach the
 * repo root. Leaves `../../…`, `./…`, `@/…` aliases, and package specifiers
 * untouched, so it's idempotent.
 */
export function sanitizeRelativeImportDepth(code: string): string {
  return code.replace(
    /((?:from|import|require|vi\.mock|vi\.importActual)\s*\(?\s*["'])\.\.\/(?!\.\.\/)/g,
    "$1../../",
  );
}
