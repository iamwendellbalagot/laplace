import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";

export interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  run: () => void;
}

export function CommandPalette({
  commands,
  onRun,
}: {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = commands.filter((command) =>
    `${command.label} ${command.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => setSelectedIndex(0), [query]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) onRun(command);
    }
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="palette-overlay" />
      <Dialog.Content
        className="command-palette"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setQuery("");
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
            Search screens and commands. Use the arrow keys to move and Enter to
            run.
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
            placeholder="Where would you like to go?"
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
        <div
          className="palette-results"
          id="command-results"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <p className="palette-empty">No matching commands.</p>
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
                onClick={() => onRun(command)}
              >
                <span className="palette-command-symbol" aria-hidden="true">
                  ↗
                </span>
                <span className="palette-command-label">{command.label}</span>
                <span className="palette-command-description">
                  {command.description}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="palette-help" aria-hidden="true">
          <span>↑ ↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
