import { describe, it, expect } from "vitest";
import {
  sanitizeTestCode,
  sanitizeNestedRouter,
  sanitizeGetByText,
  sanitizeRelativeImportDepth,
} from "./sanitize";

describe("sanitizeRelativeImportDepth", () => {
  it("deepens single-level relative imports", () => {
    const out = sanitizeRelativeImportDepth(`import Foo from "../src/components/Foo";`);
    expect(out).toBe(`import Foo from "../../src/components/Foo";`);
  });

  it("handles from / require / vi.mock forms", () => {
    expect(sanitizeRelativeImportDepth(`const x = require("../src/a");`)).toContain('"../../src/a"');
    expect(sanitizeRelativeImportDepth(`vi.mock("../src/b");`)).toContain('"../../src/b"');
    expect(sanitizeRelativeImportDepth(`await vi.importActual("../src/c");`)).toContain('"../../src/c"');
  });

  it("leaves already-correct and non-relative specifiers alone", () => {
    const untouched = [
      `import A from "../../src/A";`,
      `import B from "./B";`,
      `import C from "@/components/C";`,
      `import { render } from "@testing-library/react";`,
    ];
    for (const line of untouched) {
      expect(sanitizeRelativeImportDepth(line)).toBe(line);
    }
  });
});

describe("sanitizeNestedRouter", () => {
  it("unwraps MemoryRouter around <App /> and preserves the route", () => {
    const out = sanitizeNestedRouter(
      `render(<MemoryRouter initialEntries={["/about"]}><App /></MemoryRouter>);`,
    );
    expect(out).not.toContain("MemoryRouter");
    expect(out).toContain(`window.history.pushState({}, "", "/about")`);
    expect(out).toContain("render(<App />)");
  });

  it("defaults to / when no initialEntries are given", () => {
    const out = sanitizeNestedRouter(`render(<MemoryRouter><App /></MemoryRouter>);`);
    expect(out).toContain(`pushState({}, "", "/")`);
  });

  it("unwraps BrowserRouter and HashRouter around <App />", () => {
    expect(sanitizeNestedRouter(`render(<BrowserRouter><App /></BrowserRouter>);`)).toBe(
      "render(<App />);",
    );
    expect(sanitizeNestedRouter(`render(<HashRouter><App /></HashRouter>);`)).toBe(
      "render(<App />);",
    );
  });

  it("leaves routers around non-App components alone — those are the correct case", () => {
    const legit = `render(<MemoryRouter initialEntries={["/x"]}><NotFound /></MemoryRouter>);`;
    expect(sanitizeNestedRouter(legit)).toBe(legit);
  });
});

describe("sanitizeGetByText", () => {
  it("rewrites the toBeInTheDocument assertion to walk child nodes", () => {
    const out = sanitizeGetByText(
      `expect(screen.getByText(/Welcome/i)).toBeInTheDocument()`,
    );
    expect(out).toBe(`expect(document.body).toHaveTextContent(/Welcome/i)`);
  });

  it("leaves standalone getByText calls alone", () => {
    const click = `await user.click(screen.getByText(/Submit/i));`;
    expect(sanitizeGetByText(click)).toBe(click);
  });

  it("does not touch getByRole assertions", () => {
    const role = `expect(screen.getByRole("heading", { name: /Hi/i })).toBeInTheDocument()`;
    expect(sanitizeGetByText(role)).toBe(role);
  });
});

describe("sanitizeTestCode", () => {
  const dirty = `import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
it("works", () => {
  render(<MemoryRouter initialEntries={["/about"]}><App /></MemoryRouter>);
  expect(screen.getByText(/Hello/i)).toBeInTheDocument();
});`;

  it("applies every rewrite in one pass", () => {
    const out = sanitizeTestCode(dirty);
    expect(out).toContain(`"../../src/App"`);
    expect(out).not.toContain("<MemoryRouter");
    expect(out).toContain("toHaveTextContent");
  });

  // The worker re-sanitizes stored code on every run and writes the result
  // back. If any rewrite were non-idempotent it would churn the row forever
  // (e.g. ../ -> ../../ -> ../../../).
  it("is idempotent", () => {
    const once = sanitizeTestCode(dirty);
    expect(sanitizeTestCode(once)).toBe(once);
    expect(sanitizeTestCode(sanitizeTestCode(once))).toBe(once);
  });

  it("leaves already-clean code untouched", () => {
    const clean = `import { render, screen } from "@testing-library/react";
import Foo from "../../src/Foo";
it("works", () => {
  render(<Foo />);
  expect(screen.getByRole("heading", { name: /Foo/i })).toBeInTheDocument();
});`;
    expect(sanitizeTestCode(clean)).toBe(clean);
  });
});
