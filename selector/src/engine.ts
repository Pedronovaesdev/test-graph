/**
 * Motor de selecao: alteracoes -> testes afetados, com o motivo de cada um.
 */
import { compare, type Change } from "./diff";
import { DEFAULT_RELATIONS, type DependencyGraph, type Step } from "./graph";
import { isTest, matches, type LanguageConfig } from "./languages";
import * as rules from "./rules";

export type Mode = "selective" | "full" | "none";

export interface Reason {
  kind: "changed-test" | "data-file" | "dependency" | "always-run" | "manual-mapping";
  seedFile: string | null;
  graph: string | null;
  steps: Step[];
  /** Arquivo de escopo (ex.: conftest.py) ou marcador (ex.: SpringBootTest) que trouxe o teste. */
  scope: string | null;
}

export interface Selection {
  mode: Mode;
  /** teste -> motivo principal (o mais direto) */
  tests: Map<string, Reason>;
  allTests: string[];
  hits: rules.RuleHit[];
  changes: Change[];
  graphs: Map<string, DependencyGraph>;
}

export function selectedTests(selection: Selection): string[] {
  return selection.mode === "full" ? [...selection.allTests] : [...selection.tests.keys()].sort(compare);
}

type Rank = Array<number | string>;

function compareRank(a: Rank, b: Rank): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    const c = typeof x === "number" && typeof y === "number" ? x - y : compare(String(x), String(y));
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/**
 * Decide o que rodar. `allTests` sao os arquivos de teste existentes no head
 * (o universo). `base` e opcional: so e necessario com remocoes/renomeacoes.
 */
export function selectTests(
  changes: Change[],
  lang: LanguageConfig,
  allTests: string[],
  head: DependencyGraph | null,
  base: DependencyGraph | null = null,
): Selection {
  const universe = [...allTests].sort(compare);
  const existing = new Set(universe);
  const decisions = changes.map((c) => rules.classify(c, lang, head, base));
  const hits = decisions.flatMap((d) => d.hits);
  const graphs = new Map<string, DependencyGraph>();
  for (const g of [head, base]) if (g) graphs.set(g.name, g);
  const result = (mode: Mode, tests = new Map<string, Reason>()): Selection => ({
    mode,
    tests,
    allTests: universe,
    hits,
    changes,
    graphs,
  });

  if (hits.some(rules.isFullSuite)) return result("full");

  const best = new Map<string, { rank: Rank; reason: Reason }>();
  const offer = (test: string, rank: Rank, reason: Reason): void => {
    if (!existing.has(test)) return; // teste que nao existe mais no head
    const current = best.get(test);
    if (!current || compareRank(rank, current.rank) < 0) best.set(test, { rank, reason });
  };

  for (const d of decisions) {
    if (d.forcedTest) offer(d.forcedTest, [0], { kind: "changed-test", seedFile: d.forcedTest, graph: null, steps: [], scope: null });
  }

  for (const d of decisions) {
    if (d.dataDir === null) continue;
    const prefix = d.dataDir ? `${d.dataDir}/` : "";
    const inDir = universe.filter((t) => t.startsWith(prefix));
    if (inDir.length === 0) {
      hits.push({ rule: rules.DATA_FILE_NO_TESTS, path: d.change.path ?? d.change.repoPath, detail: `nenhum teste em ${d.dataDir || "(raiz)"}` });
      return result("full");
    }
    for (const t of inDir) offer(t, [1], { kind: "data-file", seedFile: d.change.path, graph: null, steps: [], scope: null });
  }

  // Testes que sobem a aplicacao inteira (ex.: @SpringBootTest) rodam com
  // qualquer mudanca de codigo de producao: o AST nao liga a URL chamada ao
  // controller, entao nao da para saber quais sao afetados.
  const productionSeed = decisions.find((d) => {
    const file = d.headSeed ?? d.baseSeed;
    return file !== null && !isTest(lang, file);
  });
  if (productionSeed && head && lang.alwaysRunMarkers.length > 0) {
    const seedFile = productionSeed.headSeed ?? productionSeed.baseSeed;
    for (const test of universe) {
      const marker = head.markerUsedBy(test, lang.alwaysRunMarkers);
      if (!marker) continue;
      hits.push({ rule: rules.ALWAYS_RUN, path: test, detail: `usa ${marker}: sobe a aplicacao inteira, roda com qualquer mudanca de codigo` });
      offer(test, [3], { kind: "always-run", seedFile, graph: "head", steps: [], scope: marker });
    }
  }

  const sides: Array<[DependencyGraph | null, "headSeed" | "baseSeed"]> = [
    [head, "headSeed"],
    [base, "baseSeed"],
  ];
  sides.forEach(([graph, attr], order) => {
    if (!graph) return;
    const seeds = new Map<string, string>();
    for (const d of decisions) {
      const seedFile = d[attr];
      if (!seedFile) continue;
      for (const node of graph.nodesInFile(seedFile)) if (!seeds.has(node)) seeds.set(node, seedFile);
    }
    if (seeds.size === 0) return;
    const visited = graph.reverseReach(seeds, DEFAULT_RELATIONS, lang.polymorphicRelations);
    for (const [node, visit] of visited) {
      const file = graph.sourceFile(node);
      if (!file) continue;
      if (isTest(lang, file)) {
        const steps = graph.chain(visited, node);
        // Prefere: grafo do head, cadeia mais curta, ordem de id (desempate estavel).
        offer(file, [2, order, steps.length, node], { kind: "dependency", seedFile: visit.seedFile, graph: graph.name, steps, scope: null });
      } else if (matches(file, lang.scopeFiles)) {
        const steps = graph.chain(visited, node);
        const dir = rules.dataDirFor(file);
        for (const test of universe.filter((t) => t.startsWith(dir ? `${dir}/` : ""))) {
          offer(test, [2, order, steps.length + 1, node], { kind: "dependency", seedFile: visit.seedFile, graph: graph.name, steps, scope: file });
        }
      }
    }
  });

  for (const d of decisions) {
    const changedFiles = [d.headSeed, d.baseSeed].filter((file, index, all): file is string => file !== null && all.indexOf(file) === index);
    for (const seedFile of changedFiles) {
      for (const mapping of lang.testMappings) {
        if (!matches(seedFile, [mapping.source])) continue;
        for (const test of universe.filter((candidate) => matches(candidate, mapping.tests) !== null)) {
          offer(test, [2, -1, mapping.source, test], {
            kind: "manual-mapping",
            seedFile,
            graph: null,
            steps: [],
            scope: mapping.source,
          });
        }
      }
    }
  }

  const tests = new Map([...best.entries()].sort(([a], [b]) => compare(a, b)).map(([t, v]) => [t, v.reason]));
  return result(tests.size > 0 ? "selective" : "none", tests);
}
