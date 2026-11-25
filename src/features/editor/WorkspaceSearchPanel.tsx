import { useCallback, useEffect, useRef, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  ProjectSummary,
  RookContextChip,
  SearchFileMatches,
} from "../../services/contracts";

function renderHighlightedLine(
  lineText: string,
  column: number,
  matchLength: number,
) {
  const start = Math.max(0, column - 1);
  const end = Math.min(lineText.length, start + Math.max(1, matchLength));
  if (start >= lineText.length) {
    return <code>{lineText}</code>;
  }
  return (
    <code>
      {lineText.slice(0, start)}
      <mark>{lineText.slice(start, end)}</mark>
      {lineText.slice(end)}
    </code>
  );
}

export function WorkspaceSearchPanel({
  service,
  browserPreview,
  activeProject,
  focusNonce,
  onOpenLocation,
  onAttachToRook,
}: {
  service: AppService;
  browserPreview: boolean;
  activeProject: ProjectSummary;
  focusNonce: number;
  onOpenLocation: (relativePath: string, line: number, column: number) => void;
  onAttachToRook: (chip: RookContextChip) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<{
    files: SearchFileMatches[];
    totalMatches: number;
    searchedFiles: number;
    truncated: boolean;
  } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  const executeSearch = useCallback(
    async (
      nextQuery: string,
      nextCaseSensitive: boolean,
      nextWholeWord: boolean,
    ) => {
      if (browserPreview) return;
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        setResults(null);
        setError(undefined);
        return;
      }
      setSearching(true);
      try {
        const response = await service.searchProjectText(
          activeProject.id,
          trimmed,
          {
            caseSensitive: nextCaseSensitive,
            wholeWord: nextWholeWord,
            maxResults: 200,
          },
        );
        setResults({
          files: response.files,
          totalMatches: response.totalMatches,
          searchedFiles: response.searchedFiles,
          truncated: response.truncated,
        });
        setError(undefined);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Workspace search failed.",
        );
      } finally {
        setSearching(false);
      }
    },
    [activeProject.id, browserPreview, service],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void executeSearch(query, caseSensitive, wholeWord);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [query, caseSensitive, wholeWord, executeSearch]);

  function handleAttachMatches() {
    if (!results || results.files.length === 0) return;
    const excerpt = results.files
      .slice(0, 6)
      .map((file) => {
        const hits = file.matches
          .slice(0, 3)
          .map((m) => `L${m.line}: ${m.lineText.trim()}`)
          .join("\n");
        return `${file.relativePath}\n${hits}`;
      })
      .join("\n\n");
    onAttachToRook({
      id: `search-${Date.now()}`,
      kind: "context_bundle",
      label: `Search "${query.trim().slice(0, 24)}" (${results.totalMatches})`,
      content: excerpt,
    });
  }

  return (
    <div className="workspace-search-panel">
      <form
        className="workspace-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void executeSearch(query, caseSensitive, wholeWord);
        }}
      >
        <input
          ref={inputRef}
          aria-label="Search workspace text"
          placeholder="Search codebase… (⌘⇧F)"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="workspace-search-flags">
          <button
            type="button"
            aria-pressed={caseSensitive}
            className={caseSensitive ? "is-active" : ""}
            title="Match case"
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <button
            type="button"
            aria-pressed={wholeWord}
            className={wholeWord ? "is-active" : ""}
            title="Match whole word"
            onClick={() => setWholeWord((v) => !v)}
          >
            \b
          </button>
          {results && results.totalMatches > 0 && (
            <button
              type="button"
              className="workspace-search-attach"
              title="Attach matches to Rook context"
              onClick={handleAttachMatches}
            >
              + Rook
            </button>
          )}
        </div>
      </form>

      {error && (
        <p className="inline-error explorer-error" role="alert">
          {error}
        </p>
      )}

      {browserPreview ? (
        <p className="explorer-empty">
          Workspace search requires the desktop app.
        </p>
      ) : searching && !results ? (
        <p className="explorer-empty">Searching files…</p>
      ) : results ? (
        <>
          <div className="workspace-search-summary">
            <span>
              {results.totalMatches} match
              {results.totalMatches === 1 ? "" : "es"} in {results.files.length}{" "}
              file{results.files.length === 1 ? "" : "s"}
            </span>
            {results.truncated && (
              <span className="workspace-search-capped">capped</span>
            )}
          </div>
          <div className="workspace-search-results">
            {results.files.map((file) => (
              <div className="workspace-search-file" key={file.relativePath}>
                <div
                  className="workspace-search-filepath"
                  title={file.relativePath}
                >
                  <span>{file.relativePath}</span>
                  <small>{file.matches.length}</small>
                </div>
                {file.matches.map((match, index) => (
                  <button
                    key={`${file.relativePath}:${match.line}:${match.column}:${index}`}
                    type="button"
                    className="workspace-search-hit"
                    onClick={() =>
                      onOpenLocation(
                        file.relativePath,
                        match.line,
                        match.column,
                      )
                    }
                  >
                    <span className="workspace-search-line">{match.line}</span>
                    {renderHighlightedLine(
                      match.lineText,
                      match.column,
                      match.matchLength,
                    )}
                  </button>
                ))}
              </div>
            ))}
            {results.files.length === 0 && query.trim() && (
              <p className="explorer-empty">
                No matches across {results.searchedFiles} text files.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="explorer-empty">
          Search across UTF-8 source files (skips binary, `.git`,
          `node_modules`).
        </p>
      )}
    </div>
  );
}
