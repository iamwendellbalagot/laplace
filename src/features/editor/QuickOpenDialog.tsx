import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export function QuickOpenDialog({
  open,
  files,
  loading,
  onOpenChange,
  onSelectFile,
}: {
  open: boolean;
  files: string[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFile: (relativePath: string, openInSplit: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return files.slice(0, 60);
    const terms = trimmed.split(/\s+/).filter(Boolean);
    return files
      .filter((path) => {
        const lower = path.toLowerCase();
        return terms.every((term) => lower.includes(term));
      })
      .slice(0, 60);
  }, [files, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content
          className="palette-dialog quick-open-dialog"
          aria-label="Quick open file"
        >
          <Dialog.Title className="sr-only">
            Quick open project file
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Type to filter project files. Press Enter to open, or Cmd/Ctrl+Enter
            to open in split view.
          </Dialog.Description>
          <input
            ref={inputRef}
            className="quick-open-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Quick open file… (Enter: open · ⌘Enter: split)"
            aria-label="Search project files"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((idx) =>
                  filtered.length ? (idx + 1) % filtered.length : 0,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((idx) =>
                  filtered.length
                    ? (idx - 1 + filtered.length) % filtered.length
                    : 0,
                );
              } else if (event.key === "Enter" && filtered[activeIndex]) {
                event.preventDefault();
                onSelectFile(
                  filtered[activeIndex],
                  event.metaKey || event.ctrlKey,
                );
                onOpenChange(false);
              }
            }}
          />
          <div className="quick-open-results" role="listbox">
            {loading ? (
              <p className="quick-open-empty">Indexing project files…</p>
            ) : filtered.length === 0 ? (
              <p className="quick-open-empty">No matching files.</p>
            ) : (
              filtered.map((path, index) => {
                const name = path.split("/").at(-1) ?? path;
                const dir = path.includes("/")
                  ? path.slice(0, path.lastIndexOf("/"))
                  : "";
                return (
                  <button
                    key={path}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`quick-open-item${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={(event) => {
                      onSelectFile(path, event.metaKey || event.ctrlKey);
                      onOpenChange(false);
                    }}
                  >
                    <strong>{name}</strong>
                    {dir && <span>{dir}</span>}
                  </button>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
