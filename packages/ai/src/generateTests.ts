import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";

export interface RepoContextFile {
  path: string;
  content: string;
}

export type TestRunnerKind = "vitest" | "playwright";
export type TestCaseCategory =
  | "ui"
  | "integration"
  | "form"
  | "edge-case"
  | "auth"
  | "navigation"
  | "component"
  | "hook"
  | "util";

export interface GenerateTestsInput {
  repoFullName: string;
  runnerKind: TestRunnerKind;
  framework?: string | null;
  fileTree: string[];
  files: RepoContextFile[];
}

export interface GeneratedTestCase {
  title: string;
  description: string;
  category: TestCaseCategory;
  code: string;
}

export interface GenerateTestsResult {
  framework: string;
  baseURL: string;
  plan: string;
  testCases: GeneratedTestCase[];
  usage: { inputTokens: number; outputTokens: number };
}

export const TEST_GEN_MODEL = "gemini-2.5-flash";

const PLAYWRIGHT_SYSTEM_PROMPT = `You generate end-to-end test cases for web applications using Playwright.

Given a repository's file tree and a sample of its source files, produce a JSON array of 6-10 test cases that exercise the most important user flows.

For EACH test case you must produce:
1. \`title\` — a short imperative sentence (e.g. "Verify registration calculation logic")
2. \`description\` — one sentence explaining what the test asserts
3. \`category\` — one of: ui, integration, form, edge-case, auth, navigation
4. \`code\` — a complete, self-contained Playwright spec file as a single string

CODE REQUIREMENTS:
- Use \`import { test, expect } from "@playwright/test";\` and nothing else.
- Use \`page.goto("/...")\` with relative paths only (NEVER hardcode the host).
- The runner sets \`BASE_URL\` for you via Playwright's baseURL config; \`goto("/")\` works.
- Each spec must contain exactly ONE test() call.
- Prefer accessible selectors: getByRole, getByLabel, getByText. Avoid brittle CSS selectors.
- Always include at least one expect() assertion that proves the scenario succeeded.
- Keep specs under ~30 lines.

ALSO produce top-level:
- \`framework\` — vite-react, next-pages, next-app, cra, vue, svelte, or "unknown"
- \`baseURL\` — a sensible default for local dev (e.g. http://localhost:5173 or http://localhost:3000)
- \`plan\` — a 1-3 sentence plain-English summary

Return JSON only. Do not wrap in markdown.`;

const VITEST_SYSTEM_PROMPT = `You generate component-level unit tests for a React/Vue/Svelte/Node project using Vitest + Testing Library.

Given a repository's file tree and a sample of source files, produce a JSON array of 6-10 test cases for the most important components / hooks / utilities.

For EACH test case:
1. \`title\` — short imperative sentence
2. \`description\` — one sentence about what the test asserts
3. \`category\` — one of: component, hook, util, integration, edge-case
4. \`code\` — a complete, self-contained Vitest spec file as a single string

CODE REQUIREMENTS (for React):
- Always import: \`import { describe, it, expect } from "vitest";\`
- For component tests: \`import { render, screen } from "@testing-library/react";\` and \`import "@testing-library/jest-dom/vitest";\`
- For user interaction: \`import userEvent from "@testing-library/user-event";\`
- Import the target from a RELATIVE path (e.g. \`import { Foo } from "../src/Foo";\`) — assume the spec lives under \`tests/ai/\` at the repo root.
- Each spec must contain a single \`describe\` block and ONE \`it\`/\`test\` call.
- Always include at least one \`expect(...).toBeInTheDocument()\` or equivalent assertion.
- DO NOT use Playwright APIs (\`page.goto\`, \`page.click\`, \`@playwright/test\`). DO NOT use jsdom or browser globals beyond what testing-library provides.
- Keep specs under ~40 lines.

QUERY SELECTION RULES (critical — most AI-generated tests fail because of these):
- PREFER \`screen.getByRole(role, { name: /.../i })\` for any element that has an accessible name (headings, buttons, links, form fields).
  - The \`name\` filter matches the element's *accessible name*, which composes text from child nodes. So it finds "Welcome to ICAITSC-2026" even when the markup is \`<h2>Welcome to <span>ICAITSC-2026</span></h2>\`.
- AVOID \`screen.getByText(/.../)\` for text that might be split across child elements (typical in styled headings, links with icons, etc). It only matches text that lives entirely inside one node.
  - If you must check loose text, use \`expect(container).toHaveTextContent(/.../)\` after rendering, which DOES walk children.
- For form fields, prefer \`screen.getByLabelText(/.../)\` or \`screen.getByRole("textbox", { name: /.../ })\` over guessing IDs/classes.
- For clickable elements, use \`getByRole("button", { name: /.../ })\` or \`getByRole("link", { name: /.../ })\`.
- When asserting a heading exists with specific text: \`expect(screen.getByRole("heading", { name: /Welcome to ICAITSC-2026/i })).toBeInTheDocument()\`.
- Use regex (/.../i) for text matchers — exact strings are too fragile.
- ANCHOR short regex patterns to avoid matching multiple elements. If asserting a heading whose text is a single word that may appear elsewhere, use \`name: /^Accommodation$/i\` (anchored) rather than \`name: /Accommodation/i\` (which also matches "Travel, Venue & Accommodation"). Rule of thumb: if the text is shorter than ~3 words AND appears as a substring inside another element's text, anchor with ^...$.

ROUTING RULES (critical — duplicate routers crash the render):
- BEFORE wrapping anything in \`<MemoryRouter>\` / \`<BrowserRouter>\`, inspect the component's source. If it already contains \`<BrowserRouter>\`, \`<HashRouter>\`, or \`<MemoryRouter>\`, DO NOT wrap it again — React Router throws "You cannot render a <Router> inside another <Router>".
- App.tsx in most projects already mounts the Router. Don't test \`<App />\` by wrapping it in another Router.
- Instead, test the individual page/route components in isolation. Example pattern:
    \`\`\`
    import { MemoryRouter } from "react-router-dom";
    import NotFound from "../src/pages/NotFound";
    render(<MemoryRouter initialEntries={["/anything"]}><NotFound /></MemoryRouter>);
    \`\`\`
- If you must test the whole \`<App />\` at a specific route, set \`window.history.pushState({}, "", "/path")\` BEFORE \`render(<App />)\` and add no extra Router wrapper.
- For components that consume routing hooks (\`useNavigate\`, \`useParams\`, \`useLocation\`) but don't mount a Router themselves, you DO need to wrap them in \`<MemoryRouter>\` — this is the safe case.

CODE REQUIREMENTS (for Vue/Svelte/Node libraries):
- Use the framework-appropriate testing library (\`@testing-library/vue\`, \`@testing-library/svelte\`, or plain vitest for libraries).
- Otherwise follow the same conventions: one test per spec, expect() assertions, relative imports.

ALSO produce top-level:
- \`framework\` — vite-react, next-pages, next-app, cra, vue, svelte, remix, node-library, or "unknown"
- \`baseURL\` — leave as "" since Vitest doesn't use one
- \`plan\` — 1-3 sentence plain-English summary

Return JSON only. Do not wrap in markdown.`;

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    framework: { type: SchemaType.STRING },
    baseURL: { type: SchemaType.STRING },
    plan: { type: SchemaType.STRING },
    testCases: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
          category: { type: SchemaType.STRING },
          code: { type: SchemaType.STRING },
        },
        required: ["title", "description", "category", "code"],
      },
    },
  },
  required: ["framework", "baseURL", "plan", "testCases"],
};

export async function generateTests(input: GenerateTestsInput): Promise<GenerateTestsResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const systemPrompt =
    input.runnerKind === "vitest" ? VITEST_SYSTEM_PROMPT : PLAYWRIGHT_SYSTEM_PROMPT;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: TEST_GEN_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const prompt = buildPrompt(input);
  const result = await withRetry(() => model.generateContent(prompt));
  const response = result.response;
  const text = response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON output: ${String(err).slice(0, 200)}`);
  }

  if (!isGenerateTestsResult(parsed)) {
    throw new Error("Gemini output did not match expected schema");
  }

  // Clean up: ensure categories are in the allowed set.
  const allowed = new Set([
    "ui",
    "integration",
    "form",
    "edge-case",
    "auth",
    "navigation",
    "component",
    "hook",
    "util",
  ]);
  for (const tc of parsed.testCases) {
    if (!allowed.has(tc.category)) {
      tc.category = input.runnerKind === "vitest" ? "component" : "ui";
    }
    // Safety net: rewrite the most common Vitest antipattern where the AI
    // wraps a router-owning component (like <App />) in another <MemoryRouter>.
    // React Router crashes with "You cannot render a <Router> inside another <Router>".
    if (input.runnerKind === "vitest") {
      tc.code = sanitizeNestedRouter(tc.code);
    }
  }

  const usage = response.usageMetadata;
  return {
    ...parsed,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}

function buildPrompt(input: GenerateTestsInput): string {
  const treePreview = input.fileTree.slice(0, 400).join("\n");
  const filesBlock = input.files
    .map((f) => `--- ${f.path} ---\n${truncate(f.content, 6000)}`)
    .join("\n\n");

  const lines: string[] = [`Repository: ${input.repoFullName}`];
  if (input.framework) lines.push(`Framework: ${input.framework}`);
  lines.push("");
  lines.push(`## File tree (up to 400 entries)`);
  lines.push(treePreview);
  lines.push("");
  lines.push(`## Key files`);
  lines.push(filesBlock);
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n... (truncated, ${s.length - max} more chars)`;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      const delay = base * Math.pow(2, i) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("service unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("rate limit") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

/**
 * Detect and rewrite `render(<MemoryRouter|BrowserRouter|HashRouter ...><App /></...>)`
 * — a recurring AI mistake. `App.tsx` in most projects already mounts its own
 * Router, so wrapping it in another one throws at runtime.
 *
 * Rewrite strategy:
 *   - MemoryRouter with initialEntries → push the route via window.history first, then render <App />
 *   - Other Router types → just render <App /> directly
 *
 * If the pattern isn't found, the code is returned unchanged.
 */
export function sanitizeNestedRouter(code: string): string {
  // Match `render(... <MemoryRouter initialEntries={["/path"]}> <App /> </MemoryRouter> ...)`
  const memoryRe =
    /render\s*\(\s*<MemoryRouter\b([^>]*)>\s*<App\s*\/>\s*<\/MemoryRouter>\s*\)\s*;?/gs;
  let out = code.replace(memoryRe, (_match, attrs: string) => {
    const route = extractInitialRoute(attrs) ?? "/";
    return `window.history.pushState({}, "", ${JSON.stringify(route)}); render(<App />);`;
  });

  // BrowserRouter / HashRouter — just unwrap (App brings its own router).
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

function isGenerateTestsResult(v: unknown): v is Omit<GenerateTestsResult, "usage"> {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.framework !== "string") return false;
  if (typeof o.baseURL !== "string") return false;
  if (typeof o.plan !== "string") return false;
  if (!Array.isArray(o.testCases)) return false;
  for (const tc of o.testCases) {
    if (!tc || typeof tc !== "object") return false;
    const t = tc as Record<string, unknown>;
    if (typeof t.title !== "string") return false;
    if (typeof t.description !== "string") return false;
    if (typeof t.category !== "string") return false;
    if (typeof t.code !== "string") return false;
  }
  return true;
}
