"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, AlertTriangle, Code2, ChevronDown } from "lucide-react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from "@/components/ui/modal";

export interface EditableCase {
  id: string;
  title: string;
  description: string;
  category: string;
  targetRoute?: string | null;
  expectedResult?: string | null;
  playwrightCode?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The case being edited. Null in "create" mode. */
  caseData: EditableCase | null;
  /** Required in "create" mode — the repo the new case belongs to. */
  repoId?: string;
  mode?: "edit" | "create";
  onSaved: (updated: EditableCase) => void;
  /** Called with the newly created case so the card can show it immediately. */
  onCreated?: (created: EditableCase) => void;
}

/**
 * Starting point for a hand-written spec.
 *
 * The import depth is not incidental: the runner writes every spec to
 * tests/ai/<id>.test.tsx, two directories below the repo root, so source
 * imports need "../../". Handing the user a skeleton that already gets this
 * right avoids the single most common way a first manual test fails.
 */
const STARTER_SPEC = `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Component from "../../src/components/Component";

describe("Component", () => {
  it("renders", () => {
    render(<Component />);
    expect(screen.getByRole("heading", { name: /hello/i })).toBeInTheDocument();
  });
});
`;

const CATEGORY_OPTIONS = [
  "ui",
  "integration",
  "form",
  "edge-case",
  "auth",
  "navigation",
  "component",
  "hook",
  "util",
] as const;

export function EditCaseDialog({
  open,
  onClose,
  caseData,
  repoId,
  mode = "edit",
  onSaved,
  onCreated,
}: Props) {
  const isCreate = mode === "create";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ui");
  const [targetRoute, setTargetRoute] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [playwrightCode, setPlaywrightCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate) {
      if (!open) return;
      setTitle("");
      setDescription("");
      setCategory("component");
      setTargetRoute("");
      setExpectedResult("");
      setPlaywrightCode(STARTER_SPEC);
      setShowCode(true); // the code IS the case — never hide it here
      setError(null);
      return;
    }
    if (!caseData) return;
    setTitle(caseData.title);
    setDescription(caseData.description);
    setCategory(caseData.category);
    setTargetRoute(caseData.targetRoute ?? "");
    setExpectedResult(caseData.expectedResult ?? "");
    setPlaywrightCode(caseData.playwrightCode ?? "");
    setShowCode(false);
    setError(null);
  }, [caseData, isCreate, open]);

  async function create() {
    if (!repoId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          code: playwrightCode,
          targetRoute: targetRoute.trim() || null,
          expectedResult: expectedResult.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);
      onCreated?.(json.case as EditableCase);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (isCreate) return create();
    if (!caseData) return;
    setSaving(true);
    setError(null);
    const codeChanged =
      caseData.playwrightCode !== undefined && playwrightCode !== caseData.playwrightCode;
    try {
      const res = await fetch(`/api/test-cases/${caseData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          targetRoute: targetRoute.trim() || null,
          expectedResult: expectedResult.trim() || null,
          ...(codeChanged ? { playwrightCode } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);

      onSaved({
        id: caseData.id,
        title: title.trim(),
        description: description.trim(),
        category,
        targetRoute: targetRoute.trim() || null,
        expectedResult: expectedResult.trim() || null,
        playwrightCode: codeChanged ? playwrightCode : caseData.playwrightCode,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-xl">
        <ModalHeader>
          <ModalTitle>{isCreate ? "Write a test case" : "Edit testing requirements"}</ModalTitle>
          <ModalDescription className="text-xs">
            {isCreate ? (
              <>
                Your spec runs exactly as written — it is never rewritten by the
                sanitizers or replaced by the AI repair pass, and{" "}
                <strong>Regenerate</strong> will not delete it. It is saved to{" "}
                <span className="font-mono">tests/ai/&lt;id&gt;.test.tsx</span>, two directories
                below the repo root, so import source as{" "}
                <span className="font-mono">../../src/...</span>.
              </>
            ) : (
              <>
                Modifying these parameters resets the case to{" "}
                <span className="font-mono">pending</span> so the next run reflects the new
                requirements. Click <strong>Regenerate</strong> on the repo card to rewrite the
                test code from the updated description.
              </>
            )}
          </ModalDescription>
        </ModalHeader>

        <div className="grid gap-4">
          <Field label="Test title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Description / action">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Target route / path">
              <input
                value={targetRoute}
                onChange={(e) => setTargetRoute(e.target.value)}
                placeholder="/ or /about"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Expected result">
            <textarea
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              rows={3}
              placeholder="What should happen when this test passes?"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          {(playwrightCode || isCreate) && (
            <div>
              <button
                type="button"
                onClick={() => setShowCode((s) => !s)}
                className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <Code2 className="h-3 w-3" strokeWidth={1.75} />
                {isCreate
                  ? "Vitest test code (required)"
                  : "Vitest test code (advanced — edit directly to override the AI)"}
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showCode ? "rotate-180" : ""}`}
                  strokeWidth={1.75}
                />
              </button>
              {showCode && (
                <textarea
                  value={playwrightCode}
                  onChange={(e) => setPlaywrightCode(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  className="w-full rounded-md border border-input bg-[#0c0c10] px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-200 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
              {showCode && (
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  Tip: use{" "}
                  <code className="rounded bg-muted/40 px-1">
                    expect(document.body).toHaveTextContent(/pattern/i)
                  </code>{" "}
                  for content that spans multiple elements.
                </p>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="font-mono">{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            // A manual case is meaningless without code, so require it here.
            disabled={saving || !title.trim() || (isCreate && !playwrightCode.trim())}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Save className="h-4 w-4" strokeWidth={1.75} />
            )}
            {isCreate ? "Create case" : "Update case"}
          </button>
        </div>
      </ModalContent>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
