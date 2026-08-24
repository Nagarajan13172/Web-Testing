import { describe, it, expect } from "vitest";
import { localImportPaths } from "./repairTest";

describe("localImportPaths", () => {
  it("extracts relative source imports at the runner's depth", () => {
    const code = `import Foo from "../../src/components/Foo";
import Bar from "../../src/hooks/useBar";`;
    expect(localImportPaths(code)).toEqual([
      "src/components/Foo",
      "src/hooks/useBar",
    ]);
  });

  it("maps the @/ alias onto src/", () => {
    expect(localImportPaths(`import Foo from "@/components/Foo";`)).toEqual([
      "src/components/Foo",
    ]);
  });

  it("ignores package imports", () => {
    const code = `import { render } from "@testing-library/react";
import { describe } from "vitest";
import userEvent from "@testing-library/user-event";`;
    expect(localImportPaths(code)).toEqual([]);
  });

  it("deduplicates repeated imports of the same module", () => {
    const code = `import A from "../../src/A";
import { b } from "../../src/A";`;
    expect(localImportPaths(code)).toEqual(["src/A"]);
  });

  it("handles any relative depth", () => {
    expect(localImportPaths(`import A from "../src/A";`)).toEqual(["src/A"]);
    expect(localImportPaths(`import A from "../../../src/A";`)).toEqual(["src/A"]);
  });

  // Leading ../ segments are consumed by the match, so a leading-traversal
  // specifier always comes back as a repo-relative path and can't escape the
  // checkout when joined to it.
  it("strips leading traversal, yielding a repo-relative path", () => {
    expect(localImportPaths(`import x from "../../../../etc/passwd";`)).toEqual([
      "etc/passwd",
    ]);
  });

  // Traversal in the MIDDLE survives, which is exactly what the worker's
  // `rel.includes("..")` guard exists to reject before it touches the disk.
  it("surfaces embedded traversal for the caller to reject", () => {
    expect(localImportPaths(`import x from "../../src/../../../etc/passwd";`)).toEqual([
      "src/../../../etc/passwd",
    ]);
  });
});
