export type PaletteCategory = "action" | "file" | "symbol" | "rook";

export type PaletteScope = "all" | PaletteCategory;

export interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  category: PaletteCategory;
  keywords?: string;
  supportsSplit?: boolean;
  run: (options?: { split?: boolean }) => void;
}

/** Parse leading command prefixes (`>`, `@`, `/`, `?`) from the palette query. */
export function parsePaletteQuery(
  rawQuery: string,
  explicitScope: PaletteScope,
): { scope: PaletteScope; term: string } {
  const trimmed = rawQuery.trimStart();
  if (trimmed.startsWith(">")) {
    return { scope: "action", term: trimmed.slice(1).trim().toLowerCase() };
  }
  if (trimmed.startsWith("@")) {
    return { scope: "symbol", term: trimmed.slice(1).trim().toLowerCase() };
  }
  if (trimmed.startsWith("/")) {
    return { scope: "file", term: trimmed.slice(1).trim().toLowerCase() };
  }
  if (trimmed.startsWith("?")) {
    return { scope: "rook", term: trimmed.slice(1).trim().toLowerCase() };
  }
  return { scope: explicitScope, term: rawQuery.trim().toLowerCase() };
}

function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const target = text.toLowerCase();
  const exactIndex = target.indexOf(query);
  if (exactIndex === 0) return 120;
  if (exactIndex > 0) return 90 - Math.min(exactIndex, 40);

  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) {
      consecutive += 1;
      score += 4 + consecutive * 3;
      qi += 1;
    } else {
      consecutive = 0;
    }
  }
  return qi === query.length ? score : -1;
}

const categoryBaseWeight: Record<PaletteCategory, number> = {
  action: 40,
  rook: 30,
  symbol: 20,
  file: 15,
};

/** Filter and rank unified palette items by scope and fuzzy match score. */
export function filterPaletteItems(
  items: PaletteCommand[],
  rawQuery: string,
  explicitScope: PaletteScope,
  limit = 75,
): { items: PaletteCommand[]; effectiveScope: PaletteScope } {
  const { scope, term } = parsePaletteQuery(rawQuery, explicitScope);
  const scored: { item: PaletteCommand; score: number }[] = [];

  for (const item of items) {
    if (scope !== "all" && item.category !== scope) continue;

    if (!term) {
      // Keep default unfiltered All view concise before typing (actions & rook first)
      if (
        scope === "all" &&
        (item.category === "file" || item.category === "symbol")
      ) {
        continue;
      }
      scored.push({ item, score: categoryBaseWeight[item.category] });
      continue;
    }

    const labelScore = fuzzyScore(item.label, term);
    const metaScore = fuzzyScore(
      `${item.description} ${item.keywords ?? ""}`,
      term,
    );
    const best = Math.max(labelScore * 2, metaScore);
    if (best < 0) continue;

    scored.push({
      item,
      score: best + categoryBaseWeight[item.category],
    });
  }

  scored.sort(
    (a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label),
  );
  return {
    items: scored.slice(0, limit).map((entry) => entry.item),
    effectiveScope: scope,
  };
}
