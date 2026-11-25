import type {
  ContextProvenance,
  ContextRelation,
  FileContextSnapshot,
  RookContextChip,
  SystemModuleNode,
} from "../../services/contracts";

export type ProvenanceFilter = "all" | ContextProvenance | "stale";

export function provenanceLabel(provenance: ContextProvenance): string {
  if (provenance === "developer_confirmed") return "Confirmed";
  if (provenance === "inferred") return "Inferred";
  return "Observed";
}

export function filterContextRelations(
  relations: ContextRelation[],
  query: string,
  filter: ProvenanceFilter,
): ContextRelation[] {
  const needle = query.trim().toLowerCase();
  return relations.filter((rel) => {
    if (filter === "stale" && !rel.stale) return false;
    if (filter !== "all" && filter !== "stale" && rel.provenance !== filter) {
      return false;
    }
    if (!needle) return true;
    return (
      rel.sourcePath.toLowerCase().includes(needle) ||
      rel.targetPath.toLowerCase().includes(needle) ||
      rel.relationKind.toLowerCase().includes(needle) ||
      rel.evidence.toLowerCase().includes(needle)
    );
  });
}

export function buildFileContextBundleChip(
  context: FileContextSnapshot,
  fileContent: string,
): RookContextChip {
  const lines: string[] = [`File: ${context.filePath} (${context.language})`];
  if (context.annotation) {
    lines.push(
      `Developer-confirmed note${context.annotation.stale ? " [STALE]" : ""}: ${context.annotation.summary}`,
    );
  }
  if (context.activeSymbol) {
    lines.push(
      `Active symbol: ${context.activeSymbol.kind} ${context.activeSymbol.name} (line ${context.activeSymbol.line})`,
    );
  }
  if (context.importers.length > 0) {
    lines.push(
      `Observed callers/importers (${context.importers.length}):`,
      ...context.importers
        .slice(0, 12)
        .map(
          (rel) =>
            `- ${rel.sourcePath}${rel.sourceLine ? `:${rel.sourceLine}` : ""}`,
        ),
    );
  }
  if (context.imports.length > 0) {
    lines.push(
      `Observed imports (${context.imports.length}):`,
      ...context.imports.slice(0, 12).map((rel) => `- ${rel.targetPath}`),
    );
  }
  if (context.relatedTests.length > 0) {
    lines.push(
      `Related tests (${context.relatedTests.length}):`,
      ...context.relatedTests
        .slice(0, 8)
        .map(
          (rel) =>
            `- ${rel.targetPath} [${provenanceLabel(rel.provenance)}${rel.stale ? ", Stale" : ""}]`,
        ),
    );
  }
  lines.push("", "--- Active source excerpt ---", fileContent.slice(0, 12_000));
  return {
    id: `ctx-bundle-${context.filePath}`,
    kind: "context_bundle",
    label: `${context.filePath} + callers & tests`,
    filePath: context.filePath,
    content: lines.join("\n").slice(0, 16_000),
    sourceSnapshot: fileContent,
  };
}

export function buildModuleContextChip(
  module: SystemModuleNode,
  relatedEdges: {
    sourceModule: string;
    targetModule: string;
    referenceCount: number;
  }[],
): RookContextChip {
  const lines: string[] = [
    `Module: ${module.key} (${module.fileCount} files)`,
    `Primary file: ${module.primaryFile}`,
  ];
  if (module.annotation) {
    lines.push(
      `Developer-confirmed note${module.annotation.stale ? " [STALE]" : ""}: ${module.annotation.summary}`,
    );
  }
  lines.push("Files:", ...module.files.slice(0, 20).map((path) => `- ${path}`));
  if (relatedEdges.length > 0) {
    lines.push(
      "Observed module dependencies:",
      ...relatedEdges
        .slice(0, 15)
        .map(
          (edge) =>
            `- ${edge.sourceModule} -> ${edge.targetModule} (${edge.referenceCount} import${edge.referenceCount === 1 ? "" : "s"})`,
        ),
    );
  }
  return {
    id: `ctx-mod-${module.key}`,
    kind: "context_bundle",
    label: `Module ${module.key}`,
    filePath: module.primaryFile,
    content: lines.join("\n").slice(0, 16_000),
  };
}
