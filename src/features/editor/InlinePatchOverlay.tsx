import { lazy, Suspense, useEffect, useState } from "react";

const ReviewDiffEditor = lazy(() =>
  import("../review/ReviewDiffEditor").then((module) => ({
    default: module.ReviewDiffEditor,
  })),
);

export interface PendingInlinePatch {
  path: string;
  sourceLabel: string;
  baseContent: string;
  proposedContent: string;
  suggestedObjective?: string;
}

export function InlinePatchOverlay({
  patch,
  theme,
  fontSize,
  saving,
  error,
  onAcceptAndSave,
  onReject,
  onPromoteToChange,
}: {
  patch: PendingInlinePatch;
  theme: "dark" | "light";
  fontSize: number;
  saving: boolean;
  error?: string;
  onAcceptAndSave: (nextContent: string) => Promise<void>;
  onReject: () => void;
  onPromoteToChange: (nextContent: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(patch.proposedContent);
  const [sideBySide, setSideBySide] = useState(false);

  useEffect(() => {
    setDraft(patch.proposedContent);
  }, [patch.path, patch.proposedContent]);

  return (
    <section
      className="inline-patch-overlay"
      aria-label={`Inline patch preview for ${patch.path}`}
    >
      <header className="inline-patch-header">
        <div>
          <span className="eyebrow">Inline patch · {patch.sourceLabel}</span>
          <strong>{patch.path}</strong>
        </div>
        <div className="inline-patch-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setSideBySide((v) => !v)}
          >
            {sideBySide ? "Inline diff" : "Side-by-side"}
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={saving}
            onClick={() => void onPromoteToChange(draft)}
          >
            Save &amp; Review ↗
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={saving}
            onClick={onReject}
          >
            Reject
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={saving}
            onClick={() => void onAcceptAndSave(draft)}
          >
            {saving ? "Applying…" : "Accept & save"}
          </button>
        </div>
      </header>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-patch-diff">
        <Suspense
          fallback={<p className="editor-loading">Loading patch preview…</p>}
        >
          <ReviewDiffEditor
            path={patch.path}
            original={patch.baseContent}
            modified={draft}
            theme={theme}
            fontSize={fontSize}
            sideBySide={sideBySide}
            readOnly={false}
            onChange={setDraft}
          />
        </Suspense>
      </div>
    </section>
  );
}
