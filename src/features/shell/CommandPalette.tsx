import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  filterPaletteItems,
  type PaletteCategory,
  type PaletteCommand,
  type PaletteScope,
} from "./palette-filter";

export type { PaletteCategory, PaletteCommand, PaletteScope };

const scopeTabs: { id: PaletteScope; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "" },
  { id: "action", label: "Actions", hint: ">" },
  { id: "file", label: "Files", hint: "/" },
  { id: "symbol", label: "Symbols", hint: "@" },
  { id: "rook", label: "Rook", hint: "?" },
];

const categoryIcon: Record<PaletteCategory, string> = {
  action: "↗",
  file: "◇",
  symbol: "λ",
  rook: "◆",
};

export function CommandPalette({
  commands,
  loadingExtras = false,
  onRun,
}: {
  commands: PaletteCommand[];
  loadingExtras?: boolean;
  onRun: (command: PaletteCommand, options?: { split?: boolean }) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<PaletteScope>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { items: filtered, effectiveScope } = useMemo(
    () => filterPaletteItems(commands, query, scope),
    [commands, query, scope],
  );

  useEffect(() => setSelectedIndex(0), [query, scope]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) =>
        filtered.length ? Math.min(index + 1, filtered.length - 1) : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) {
        onRun(command, {
          split: command.supportsSplit && (event.metaKey || event.ctrlKey),
        });
      }
    }
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="palette-overlay" />
      <Dialog.Content
        className="command-palette command-palette-unified"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setQuery("");
          setScope("all");
          setSelectedIndex(0);
          inputRef.current?.focus();
        }}
      >
        <div className="palette-search-row">
          <span className="search-glyph" aria-hidden="true">
            ⌕
          </span>
          <Dialog.Title className="visually-hidden">
            Command palette
          </Dialog.Title>
          <Dialog.Description className="visually-hidden">
            Search actions, workspace files, symbols, and Rook commands. Use the
            arrow keys to move and Enter to run.
          </Dialog.Description>
          <input
            ref={inputRef}
            aria-label="Search screens and commands"
            aria-controls="command-results"
            aria-activedescendant={
              filtered[selectedIndex]
                ? `command-${filtered[selectedIndex].id}`
                : undefined
            }
            autoComplete="off"
            placeholder="Search actions, files (/), symbols (@), or Rook (?)…"
            role="combobox"
            aria-expanded="true"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <Dialog.Close asChild>
            <button className="palette-escape" type="button">
              Esc
            </button>
          </Dialog.Close>
        </div>

        <div className="palette-scope-bar" role="tablist" aria-label="Scope">
          {scopeTabs.map((tab) => {
            const active = effectiveScope === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`palette-scope-tab${active ? " is-active" : ""}`}
                onClick={() => {
                  setScope(tab.id);
                  inputRef.current?.focus();
                }}
              >
                <span>{tab.label}</span>
                {tab.hint && <kbd>{tab.hint}</kbd>}
              </button>
            );
          })}
          {loadingExtras && (
            <span className="palette-indexing-note">Indexing…</span>
          )}
        </div>

        <div
          className="palette-results"
          id="command-results"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <p className="palette-empty">
              No matching commands, files, or symbols.
            </p>
          ) : (
            filtered.map((command, index) => (
              <button
                id={`command-${command.id}`}
                className={`palette-command${index === selectedIndex ? " palette-command-active" : ""}`}
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={(event) =>
                  onRun(command, {
                    split:
                      command.supportsSplit && (event.metaKey || event.ctrlKey),
                  })
                }
              >
                <span className="palette-command-symbol" aria-hidden="true">
                  {categoryIcon[command.category]}
                </span>
                <span className="palette-command-label">{command.label}</span>
                <span className={`palette-kind-badge is-${command.category}`}>
                  {command.category}
                </span>
                <span className="palette-command-description">
                  {command.description}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="palette-help" aria-hidden="true">
          <span>↑ ↓ Navigate</span>
          <span>↵ Run / Open</span>
          <span>⌘↵ Split file</span>
          <span>&gt; Action · @ Symbol · / File · ? Rook</span>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
