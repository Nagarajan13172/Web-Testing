export {
  streamExplainFailure,
  EXPLAIN_FAILURE_MODEL,
  type ExplainFailureInput,
  type ExplainResult,
} from "./explainFailure";

export {
  generateTests,
  TEST_GEN_MODEL,
  type GenerateTestsInput,
  type GenerateTestsResult,
  type GeneratedTestCase,
  type TestCaseCategory,
  type RepoContextFile,
} from "./generateTests";

export async function reviewDiff(): Promise<never> {
  throw new Error("ai.reviewDiff not implemented — see MVP step 8 in the plan");
}
