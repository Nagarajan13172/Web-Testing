import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import { sanitizeTestCode } from "./sanitize";
import { withRetry, MAX_OUTPUT_TOKENS } from "./retry";

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

const VITEST_SYSTEM_PROMPT = `You generate component-level unit tests for a React project using Vitest + React Testing Library.

Given the repository's file tree and a sample of source files, produce a JSON array of 6-10 test cases for the most important components / hooks / utilities.

For EACH test case:
1. \`title\` — short imperative sentence
2. \`description\` — one sentence about what the test asserts
3. \`category\` — one of: component, hook, util, integration, edge-case
4. \`code\` — a complete, self-contained Vitest spec file as a single string

CODE REQUIREMENTS:
- Always import: \`import { describe, it, expect, vi } from "vitest";\`
- For component tests: \`import { render, screen } from "@testing-library/react";\` and \`import "@testing-library/jest-dom/vitest";\`
- For user interaction: \`import userEvent from "@testing-library/user-event";\` and inside the test body call \`const user = userEvent.setup();\` then \`await user.click(...)\`. Prefer \`userEvent\` over \`fireEvent\` — it simulates real browser behaviour (focus, key events) that components depend on.
- The spec is saved to \`tests/ai/<name>.test.tsx\` — TWO directories below the repo root. So a source file at \`src/components/Footer.tsx\` must be imported as \`"../../src/components/Footer"\` (note the DOUBLE \`../\`), NOT \`"../src/..."\`. If the repo's tsconfig defines the \`@/*\` path alias, prefer it instead: \`import Footer from "@/components/Footer";\` (it resolves regardless of the spec's depth).
- Each spec must contain a single \`describe\` block and ONE \`it\`/\`test\` call.
- Always include at least one \`expect(...).toBeInTheDocument()\` or equivalent assertion that proves the scenario succeeded.
- DO NOT use Playwright APIs (\`page.goto\`, \`page.click\`, \`@playwright/test\`). DO NOT use jsdom or browser globals beyond what testing-library provides.
- DO NOT wrap render() output or user interactions in \`act(...)\`. React Testing Library already wraps these for you; explicit \`act\` calls produce console warnings.
- Keep specs under ~40 lines.

QUERY PRIORITY (per Testing Library — pick the highest-priority query that fits):
1. \`getByRole(role, { name: /.../i })\` — first choice for any element with an accessible name (headings, buttons, links, form fields, regions).
2. \`getByLabelText(/.../i)\` — for form inputs associated with a label.
3. \`getByPlaceholderText(/.../i)\` — when there's no label, fall back to placeholder.
4. \`getByText(/.../i)\` — for non-interactive text. Only when the text lives in a single text node (not split across child elements).
5. \`getByDisplayValue\`, \`getByAltText\`, \`getByTitle\`.
6. \`getByTestId\` — last resort.

ASYNC QUERIES — when the element appears after an effect, fetch, or timer, use \`await screen.findByRole(...)\` instead of \`getByRole\`. \`findBy*\` is async and retries until the element exists (or times out). \`getBy*\` is synchronous and throws immediately. Use \`findBy*\` whenever the component does data fetching, lazy loading, or has a useEffect that updates the DOM.

QUERY-SELECTION DETAIL RULES:
- The \`name\` filter on \`getByRole\` matches the element's *accessible name*, which composes text from child nodes. So it finds "Welcome to ICAITSC-2026" even when the markup is \`<h2>Welcome to <span>ICAITSC-2026</span></h2>\`.
- AVOID \`screen.getByText(/.../)\` for text that might be split across child elements (typical in styled headings, links with icons). It only matches text that lives entirely inside one node. If you must check loose text, use \`expect(document.body).toHaveTextContent(/.../i)\` after rendering — this DOES walk children.
- When asserting a heading exists with specific text: \`expect(screen.getByRole("heading", { name: /Welcome to ICAITSC-2026/i })).toBeInTheDocument()\`.
- Use regex (/.../i) for text matchers — exact strings are too fragile.
- ANCHOR short regex patterns to avoid matching multiple elements. If asserting a heading whose text is a single word that may appear elsewhere, use \`name: /^Accommodation$/i\` (anchored) rather than \`name: /Accommodation/i\` (which also matches "Travel, Venue & Accommodation"). Rule of thumb: if the text is shorter than ~3 words AND appears as a substring inside another element's text, anchor with ^...$.
- DUPLICATED ACCESSIBLE NAMES (critical for master/detail UIs): the SAME title often renders in more than one place — e.g. a selectable nav/list AND a detail panel both show the active item's name. \`getByRole\`/\`getByText\` THROW "Found multiple elements" in that case. Before asserting on a name that the source renders in both a list and a detail view: (a) scope the query to one region with \`within\` — \`import { within } from "@testing-library/react"\`, then \`within(screen.getByRole("region", { name: /.../i })).getByRole("heading", ...)\`; OR (b) assert on something unique to the selected item (its topic/body text, which the list buttons don't render) instead of its title; OR (c) if you only mean "at least one exists", use \`expect(screen.getAllByRole("heading", { name: /.../i }).length).toBeGreaterThan(0)\`. For the negative case use \`expect(screen.queryAllByText(/.../i)).toHaveLength(0)\` — \`queryByText\` also throws on multiple matches.

NETWORK / FETCH:
- If the component calls \`fetch\`, stub it: \`vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ... }), { status: 200 }));\` before \`render\`. Then use \`await screen.findByRole(...)\` to wait for the rendered result.
- Restore fetch in an \`afterEach\` or by calling \`vi.restoreAllMocks()\` (you can rely on the project's \`clearMocks: true\` config — no manual reset needed within a single test).

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

ALSO produce top-level:
- \`framework\` — vite-react, next-pages, next-app, cra, or remix
- \`baseURL\` — leave as "" (Vitest doesn't use one)
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
      maxOutputTokens: MAX_OUTPUT_TOKENS,
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
    // Safety net for the antipatterns the model keeps producing (nested
    // <Router>, split-text getByText assertions, wrong relative import depth).
    // Applied here so the code we persist is the code that actually runs — the
    // worker applies the same rewrites again, which is a no-op for new cases.
    if (input.runnerKind === "vitest") {
      tc.code = sanitizeTestCode(tc.code);
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
