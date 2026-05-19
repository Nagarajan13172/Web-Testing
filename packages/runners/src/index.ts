import type { JsDetection, TestKind } from "@webtesting/detector";

export interface PipelineStep {
  name: string;                            // "install" | "lint" | "typecheck" | "test"
  kind: TestKind | null;                   // only set for test steps
  command: string;                         // shell command run inside the sandbox
  optional: boolean;                       // skipped (status=skipped) on missing tool
  junitOutputFile: string | null;          // relative to /workspace, if any
}

const JUNIT_PATH = "junit-results.xml";

export function buildJsPipeline(d: JsDetection): PipelineStep[] {
  const pm = d.packageManager;
  const steps: PipelineStep[] = [];

  steps.push({
    name: "install",
    kind: null,
    command: installCommand(pm),
    optional: false,
    junitOutputFile: null,
  });

  if (d.hasEslint) {
    steps.push({
      name: "lint",
      kind: null,
      command: runCmd(pm, "lint"),
      optional: true,
      junitOutputFile: null,
    });
  }

  if (d.hasTypescript) {
    steps.push({
      name: "typecheck",
      kind: null,
      command: `${execCmd(pm)} tsc --noEmit || true`,   // tsc reports errors via exit code; we still want output
      optional: true,
      junitOutputFile: null,
    });
  }

  if (d.testRunner === "vitest") {
    steps.push({
      name: "test",
      kind: "unit",
      command: `${execCmd(pm)} vitest run --reporter=junit --outputFile=${JUNIT_PATH}`,
      optional: false,
      junitOutputFile: JUNIT_PATH,
    });
  } else if (d.testRunner === "jest") {
    // jest needs jest-junit; if not installed we fall back to default reporter (no XML).
    steps.push({
      name: "test",
      kind: "unit",
      command: `JEST_JUNIT_OUTPUT_FILE=${JUNIT_PATH} ${execCmd(pm)} jest --reporters=default --reporters=jest-junit || ${execCmd(pm)} jest`,
      optional: false,
      junitOutputFile: JUNIT_PATH,
    });
  }

  return steps;
}

function installCommand(pm: "pnpm" | "npm" | "yarn"): string {
  switch (pm) {
    case "pnpm": return "pnpm install --frozen-lockfile=false";
    case "yarn": return "yarn install --frozen-lockfile=false";
    case "npm": return "npm install --no-audit --no-fund";
  }
}

function execCmd(pm: "pnpm" | "npm" | "yarn"): string {
  switch (pm) {
    case "pnpm": return "pnpm exec";
    case "yarn": return "yarn";
    case "npm": return "npx --no-install";
  }
}

function runCmd(pm: "pnpm" | "npm" | "yarn", script: string): string {
  switch (pm) {
    case "pnpm": return `pnpm run ${script}`;
    case "yarn": return `yarn run ${script}`;
    case "npm": return `npm run ${script} --if-present`;
  }
}
