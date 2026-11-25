import type * as Monaco from "monaco-editor";
import type { AppService } from "../../services/app-service";

const MAX_HYDRATED_TS_FILES = 80;
const MAX_HYDRATED_TOTAL_BYTES = 1_048_576;

export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (
        i < input.length - 1 &&
        !(input[i] === "*" && input[i + 1] === "/")
      ) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

export function parseTsCompilerOptions(
  tsconfigText: string,
  monaco?: typeof Monaco,
): Monaco.typescript.CompilerOptions {
  const ts = monaco?.typescript;
  const targetEnum = ts?.ScriptTarget;
  const moduleEnum = ts?.ModuleKind;
  const resolutionEnum = ts?.ModuleResolutionKind;
  const jsxEnum = ts?.JsxEmit;

  const base: Monaco.typescript.CompilerOptions = {
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    skipLibCheck: true,
    target: targetEnum?.ESNext ?? targetEnum?.ES2020 ?? 99,
    module: moduleEnum?.ESNext ?? 99,
    moduleResolution: resolutionEnum?.NodeJs ?? 2,
    jsx: jsxEnum?.ReactJSX ?? 4,
  };

  try {
    const parsed = JSON.parse(stripJsonComments(tsconfigText)) as {
      compilerOptions?: Record<string, unknown>;
    };
    const opts = parsed.compilerOptions;
    if (!opts || typeof opts !== "object") return base;

    if (typeof opts.strict === "boolean") base.strict = opts.strict;
    if (typeof opts.allowJs === "boolean") base.allowJs = opts.allowJs;
    if (typeof opts.noEmit === "boolean") base.noEmit = opts.noEmit;
    if (typeof opts.jsx === "string" && jsxEnum) {
      const jsx = opts.jsx.toLowerCase();
      if (jsx === "react-jsx") base.jsx = jsxEnum.ReactJSX;
      else if (jsx === "react") base.jsx = jsxEnum.React;
      else if (jsx === "preserve") base.jsx = jsxEnum.Preserve;
    }
    if (typeof opts.module === "string" && moduleEnum) {
      const mod = opts.module.toLowerCase();
      if (mod === "commonjs") base.module = moduleEnum.CommonJS;
      else if (mod === "esnext") base.module = moduleEnum.ESNext;
    }
  } catch {
    return base;
  }

  return base;
}

/**
 * Hydrate Monaco's TypeScript/JavaScript language worker with `tsconfig.json`
 * and bounded workspace `.ts`/`.tsx`/`.d.ts` files for cross-file intelligence.
 */
export async function hydrateWorkspaceTypeScript(
  service: AppService,
  monaco: typeof Monaco,
  projectId: string,
): Promise<void> {
  const tsDefaults = monaco.typescript?.typescriptDefaults;
  const jsDefaults = monaco.typescript?.javascriptDefaults;
  if (!tsDefaults || !jsDefaults) return;

  const allFiles = await service.listProjectFiles(projectId);
  const tsconfigPath = allFiles.find((file) => file === "tsconfig.json");
  if (tsconfigPath) {
    const read = await service.readProjectFile(projectId, tsconfigPath);
    if (read.kind === "text" && read.content !== null) {
      const options = parseTsCompilerOptions(read.content, monaco);
      tsDefaults.setCompilerOptions(options);
      jsDefaults.setCompilerOptions({
        ...options,
        allowJs: true,
        checkJs: false,
      });
    }
  } else {
    const fallback = parseTsCompilerOptions("{}", monaco);
    tsDefaults.setCompilerOptions(fallback);
  }

  const tsCandidates = allFiles
    .filter((file) => /\.(tsx?|d\.ts|mts|cts)$/i.test(file))
    .sort((left, right) => {
      const leftTest = /\.(test|spec)\./i.test(left) ? 1 : 0;
      const rightTest = /\.(test|spec)\./i.test(right) ? 1 : 0;
      if (leftTest !== rightTest) return leftTest - rightTest;
      return left.localeCompare(right);
    })
    .slice(0, MAX_HYDRATED_TS_FILES);

  const libs: Array<{ content: string; filePath: string }> = [];
  let totalBytes = 0;

  for (const relPath of tsCandidates) {
    if (totalBytes >= MAX_HYDRATED_TOTAL_BYTES) break;
    try {
      const read = await service.readProjectFile(projectId, relPath);
      if (read.kind !== "text" || read.content === null) continue;
      if (totalBytes + read.content.length > MAX_HYDRATED_TOTAL_BYTES) continue;
      totalBytes += read.content.length;
      const fullPath = `${projectId}/${relPath}`.replaceAll("\\", "/");
      libs.push({
        content: read.content,
        filePath: monaco.Uri.file(fullPath).toString(),
      });
    } catch {
      // Skip unreadable file cleanly without aborting workspace hydration.
    }
  }

  tsDefaults.setExtraLibs(libs);
  tsDefaults.setEagerModelSync(true);
}
