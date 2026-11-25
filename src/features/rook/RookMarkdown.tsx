import { useState } from "react";
import {
  parseRookInlineSegments,
  parseRookMarkdown,
  type RookInlineSegment,
} from "./rook-markdown";

function renderInlineSegments(
  segments: RookInlineSegment[],
  onOpenFileRef?: (
    relativePath: string,
    line?: number,
    column?: number,
  ) => void,
) {
  return segments.map((segment, index) => {
    switch (segment.kind) {
      case "text":
        return <span key={index}>{segment.text}</span>;
      case "bold":
        return <strong key={index}>{segment.text}</strong>;
      case "italic":
        return <em key={index}>{segment.text}</em>;
      case "code":
        return (
          <code className="rook-inline-code" key={index}>
            {segment.text}
          </code>
        );
      case "file_ref":
        return onOpenFileRef ? (
          <button
            key={index}
            type="button"
            className="rook-file-pill"
            title={`Open ${segment.relativePath}${segment.line ? `:${segment.line}` : ""} in Editor`}
            onClick={() =>
              onOpenFileRef(segment.relativePath, segment.line, segment.column)
            }
          >
            <span aria-hidden="true">↗</span>
            <span>{segment.raw}</span>
          </button>
        ) : (
          <code className="rook-inline-code" key={index}>
            {segment.raw}
          </code>
        );
    }
  });
}

function CodeBlock({
  language,
  code,
  onPreviewPatch,
}: {
  language: string;
  code: string;
  onPreviewPatch?: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rook-code-block">
      <div className="rook-code-block-head">
        <span>{language || "code"}</span>
        <div className="rook-code-block-actions">
          {onPreviewPatch && (
            <button
              type="button"
              className="rook-code-action"
              onClick={() => onPreviewPatch(code)}
            >
              Preview in Editor
            </button>
          )}
          <button
            type="button"
            className="rook-code-action"
            onClick={() => {
              if (!navigator.clipboard?.writeText) return;
              void navigator.clipboard
                .writeText(code)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                })
                .catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function RookMarkdown({
  text,
  projectPath,
  onOpenFileRef,
  onPreviewPatch,
}: {
  text: string;
  projectPath?: string;
  onOpenFileRef?: (
    relativePath: string,
    line?: number,
    column?: number,
  ) => void;
  onPreviewPatch?: (code: string) => void;
}) {
  const blocks = parseRookMarkdown(text);

  return (
    <div className="rook-markdown">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const content = renderInlineSegments(
              parseRookInlineSegments(block.text, projectPath),
              onOpenFileRef,
            );
            if (block.level === 1) return <h3 key={index}>{content}</h3>;
            if (block.level === 2) return <h4 key={index}>{content}</h4>;
            return <h5 key={index}>{content}</h5>;
          }
          case "paragraph":
            return (
              <p key={index}>
                {renderInlineSegments(
                  parseRookInlineSegments(block.text, projectPath),
                  onOpenFileRef,
                )}
              </p>
            );
          case "blockquote":
            return (
              <blockquote key={index}>
                {renderInlineSegments(
                  parseRookInlineSegments(block.text, projectPath),
                  onOpenFileRef,
                )}
              </blockquote>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index}>
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx}>
                    {renderInlineSegments(
                      parseRookInlineSegments(item, projectPath),
                      onOpenFileRef,
                    )}
                  </li>
                ))}
              </Tag>
            );
          }
          case "code":
            return (
              <CodeBlock
                key={index}
                language={block.language}
                code={block.code}
                onPreviewPatch={onPreviewPatch}
              />
            );
        }
      })}
    </div>
  );
}
