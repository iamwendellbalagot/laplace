import { useEffect, useRef, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  EditorDiagnostic,
  RookContextChip,
} from "../../services/contracts";
import { useRookStore } from "../../state/rook-store";
import type { PendingInlinePatch } from "./InlinePatchOverlay";

export function extractProposedCodeBlock(responseText: string): string | null {
  const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(responseText);
  if (fenced) {
    return fenced[1].replace(/\n$/, "");
  }
  const trimmed = responseText.trim();
  return trimmed ? trimmed : null;
}

export function spliceLines(
  originalContent: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const eol = originalContent.includes("\r\n") ? "\r\n" : "\n";
  const lines = originalContent.split(/\r?\n/);
  const clampedStart = Math.max(1, Math.min(startLine, lines.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endLine, lines.length));
  const replacementLines = replacement.split(/\r?\n/);
  const next = [
    ...lines.slice(0, clampedStart - 1),
    ...replacementLines,
    ...lines.slice(clampedEnd),
  ];
  return next.join(eol);
}

export function InlineCommandBar({
  service,
  projectId,
  filePath,
  fileContent,
  startLine,
  endLine,
  diagnostics,
  onClose,
  onProposePatch,
  onExplainInRook,
}: {
  service: AppService;
  projectId: string;
  filePath: string;
  fileContent: string;
  startLine: number;
  endLine: number;
  diagnostics: EditorDiagnostic[];
  onClose: () => void;
  onProposePatch: (patch: PendingInlinePatch) => void;
  onExplainInRook: (chip: RookContextChip, promptText: string) => void;
}) {
  const currentModel = useRookStore((state) => state.currentModel);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"edit" | "fix" | "explain">(
    diagnostics.length > 0 ? "fix" : "edit",
  );
  const [instruction, setInstruction] = useState(
    diagnostics.length > 0 ? "Fix diagnostics in this block" : "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [filePath, startLine, endLine]);

  const targetSnippet = fileContent
    .split(/\r?\n/)
    .slice(Math.max(0, startLine - 1), Math.max(1, endLine))
    .join("\n");

  async function runInlineCommand() {
    const trimmed = instruction.trim();
    if (!trimmed) return;

    if (mode === "explain") {
      onExplainInRook(
        {
          id: `inline-${Date.now()}`,
          kind: "selection",
          label: `${filePath.split("/").at(-1) ?? filePath}:${startLine}-${endLine}`,
          filePath,
          startLine,
          endLine,
          content: targetSnippet.slice(0, 3000),
        },
        trimmed,
      );
      onClose();
      return;
    }

    setPending(true);
    setError(undefined);
    const ephemeralSessionId = crypto.randomUUID().replaceAll("-", "");
    let unlisten: (() => void) | undefined;
    let settled = false;

    try {
      await service.startRookAsk(ephemeralSessionId, projectId);
      if (currentModel) {
        await service.selectRookModel(ephemeralSessionId, currentModel);
      }

      const relevantDiags = diagnostics
        .filter((d) => d.line >= startLine - 2 && d.line <= endLine + 2)
        .map((d) => `L${d.line} [${d.severity}]: ${d.message}`)
        .join("\n");

      const promptText = [
        `Return ONLY a single fenced code block with the exact replacement for lines ${startLine}-${endLine} of ${filePath}. No prose outside the code block.`,
        `Instruction: ${trimmed}`,
        relevantDiags ? `Diagnostics:\n${relevantDiags}` : null,
        `Target block (lines ${startLine}-${endLine}):\n\`\`\`\n${targetSnippet}\n\`\`\``,
      ]
        .filter(Boolean)
        .join("\n\n");

      const assistantText = await new Promise<string>((resolve, reject) => {
        let buffer = "";
        const timeout = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error("Inline edit timed out before Rook responded."));
          }
        }, 45_000);

        void service
          .listenRook((event) => {
            if (event.sessionId !== ephemeralSessionId || settled) return;
            const method = event.message.method;
            const params = event.message.params as
              | Record<string, unknown>
              | undefined;
            if (
              method === "session/message_delta" &&
              typeof params?.delta === "string"
            ) {
              buffer += params.delta;
            }
            if (
              method === "session/message_end" &&
              typeof params?.text === "string"
            ) {
              buffer = params.text;
            }
            if (method === "session/run_settled") {
              settled = true;
              window.clearTimeout(timeout);
              resolve(buffer);
            }
          })
          .then((stop) => {
            unlisten = stop;
            void service
              .promptRookAsk(ephemeralSessionId, promptText)
              .catch((err) => {
                if (!settled) {
                  settled = true;
                  window.clearTimeout(timeout);
                  reject(err);
                }
              });
          })
          .catch((err) => {
            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              reject(err);
            }
          });
      });

      const replacement = extractProposedCodeBlock(assistantText);
      if (replacement === null) {
        setError(
          "Rook did not return replacement code. Try a clearer instruction.",
        );
        return;
      }

      onProposePatch({
        path: filePath,
        sourceLabel: `⌘K ${mode === "fix" ? "Fix" : "Inline Edit"} (L${startLine}–${endLine})`,
        baseContent: fileContent,
        proposedContent: spliceLines(
          fileContent,
          startLine,
          endLine,
          replacement,
        ),
        suggestedObjective: trimmed,
      });
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Inline edit failed.",
      );
    } finally {
      unlisten?.();
      void service.stopRookAsk(ephemeralSessionId).catch(() => undefined);
      setPending(false);
    }
  }

  return (
    <div
      className="inline-command-bar"
      role="dialog"
      aria-label="Inline editor command"
    >
      <div className="inline-command-head">
        <span className="inline-command-target">
          ⌘K · {filePath.split("/").at(-1)}:{startLine}
          {endLine > startLine ? `–${endLine}` : ""}
        </span>
        <div
          className="inline-command-modes"
          role="group"
          aria-label="Inline action"
        >
          <button
            type="button"
            className={mode === "edit" ? "is-active" : ""}
            onClick={() => setMode("edit")}
          >
            Edit
          </button>
          {diagnostics.length > 0 && (
            <button
              type="button"
              className={mode === "fix" ? "is-active" : ""}
              onClick={() => {
                setMode("fix");
                if (!instruction.trim()) {
                  setInstruction("Fix diagnostics in this block");
                }
              }}
            >
              Fix
            </button>
          )}
          <button
            type="button"
            className={mode === "explain" ? "is-active" : ""}
            onClick={() => setMode("explain")}
          >
            Explain
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close inline edit"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <form
        className="inline-command-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runInlineCommand();
        }}
      >
        <input
          ref={inputRef}
          aria-label="Inline instruction"
          placeholder={
            mode === "explain"
              ? "Ask Rook about these lines…"
              : "Describe edit for this selection… (Enter)"
          }
          disabled={pending}
          value={instruction}
          onChange={(event) => setInstruction(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={pending || !instruction.trim()}
        >
          {pending
            ? "Thinking…"
            : mode === "explain"
              ? "Ask Rook"
              : "Generate diff"}
        </button>
      </form>
      {error && (
        <p className="inline-error inline-command-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
