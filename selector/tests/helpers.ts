import type { Change } from "../src/diff";
import { DependencyGraph } from "../src/graph";
import { loadLanguage } from "../src/languages";

export const ts = loadLanguage("typescript");
export const java = loadLanguage("java");
export const javaGradle = loadLanguage("java-gradle");
export const python = loadLanguage("python");
export const vitest = loadLanguage("vitest");

/**
 * Monta um grafo a partir de arestas no formato "origem relacao alvo".
 * Nos com `/` no id viram nos de arquivo (label = nome do arquivo); os demais
 * sao simbolos `arquivo#simbolo`, cujo source_file e a parte antes de `#`.
 */
export function graph(
  edges: string[],
  name = "head",
  extraFiles: string[] = [],
  locations: Record<string, string> = {},
): DependencyGraph {
  const nodes = new Map<string, Record<string, unknown>>();
  const addNode = (id: string) => {
    if (nodes.has(id)) return;
    if (id.startsWith("ext:")) {
      // simbolo de biblioteca (ex.: ext:JpaRepository): nao pertence a nenhum arquivo do projeto
      nodes.set(id, { id, label: id.slice(4) });
      return;
    }
    const [file, symbol] = id.split("#");
    nodes.set(id, {
      id,
      label: symbol ?? file.split("/").pop(),
      source_file: file,
      source_location: locations[id] ?? "L1",
    });
  };
  const raw = edges.map((line, i) => {
    const [source, relation, target] = line.trim().split(/\s+/);
    addNode(source);
    addNode(target);
    return { source, target, relation, source_file: source.split("#")[0], source_location: `L${i + 1}` };
  });
  extraFiles.forEach(addNode);
  return new DependencyGraph([...nodes.values()], raw, name);
}

export function change(status: Change["status"], file: string, oldFile: string | null = null, hunks?: Change["hunks"]): Change {
  const result: Change = { status, repoPath: file, path: file, oldRepoPath: oldFile, oldPath: oldFile };
  if (hunks !== undefined) result.hunks = hunks;
  return result;
}
