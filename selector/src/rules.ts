/**
 * Regras de seguranca: como cada arquivo alterado entra na selecao.
 *
 * Principio: na duvida, roda mais. Toda mudanca que o grafo nao explica
 * (config, lockfile, arquivo que o indexador nao entendeu) leva a suite
 * completa. Cada decisao carrega o nome da regra que a disparou, para
 * aparecer no relatorio.
 */
import * as path from "node:path";
import type { Change } from "./diff";
import { DEFAULT_RELATIONS, type DependencyGraph } from "./graph";
import { isSource, isTest, matches, type LanguageConfig } from "./languages";

// Nomes de regra: estaveis, aparecem no JSON do relatorio.
export const GLOBAL_CONFIG = "global-config"; // .github/workflows/* -> suite completa
export const OUTSIDE_PROJECT = "outside-project"; // fora do projeto analisado -> ignorado
export const DOCS_ONLY = "docs-only"; // *.md etc. -> nenhum teste
export const BUILD_CONFIG = "build-config"; // package.json, pom.xml... -> suite completa
export const DATA_FILE = "data-file"; // snapshot/fixture -> testes do mesmo diretorio
export const DATA_FILE_NO_TESTS = "data-file-no-tests"; // snapshot/fixture sem testes perto -> suite completa
export const CHANGED_TEST = "changed-test"; // teste alterado/adicionado -> sempre selecionado
export const DELETED_TEST = "deleted-test"; // teste removido -> nada a rodar
export const GRAPH_SEED = "graph-seed"; // arquivo no grafo -> semente da busca reversa
export const SOURCE_NOT_IN_GRAPH = "source-not-in-graph"; // codigo que o indexador nao viu -> suite completa
export const NO_BASE_GRAPH = "no-base-graph"; // remocao/renomeacao sem grafo do base -> suite completa
export const UNCLASSIFIED = "unclassified-file"; // nenhuma regra se aplica -> suite completa
export const NO_DEPENDENTS = "no-dependents"; // codigo modificado que ninguem usa no grafo -> suite completa
export const ALWAYS_RUN = "always-run"; // teste de contexto completo (ex.: @SpringBootTest) -> roda com qualquer codigo

export const FULL_SUITE_RULES: ReadonlySet<string> = new Set([
  GLOBAL_CONFIG,
  BUILD_CONFIG,
  DATA_FILE_NO_TESTS,
  SOURCE_NOT_IN_GRAPH,
  NO_BASE_GRAPH,
  UNCLASSIFIED,
  NO_DEPENDENTS,
]);

const DATA_DIR_NAMES = new Set(["__snapshots__", "__fixtures__", "fixtures", "__mocks__"]);

export interface RuleHit {
  rule: string;
  path: string;
  detail: string;
}

export function isFullSuite(hit: RuleHit): boolean {
  return FULL_SUITE_RULES.has(hit.rule);
}

export interface FileDecision {
  change: Change;
  hits: RuleHit[];
  headSeed: string | null; // caminho a semear no grafo do head
  baseSeed: string | null; // caminho a semear no grafo do base
  forcedTest: string | null; // teste a selecionar diretamente
  dataDir: string | null; // diretorio cujos testes devem rodar
}

/** Diretorio "dono" de um snapshot/fixture: o pai da pasta de dados. */
export function dataDirFor(file: string): string {
  const parts = file.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (DATA_DIR_NAMES.has(parts[i])) return parts.slice(0, i).join("/");
  }
  const parent = path.posix.dirname(file);
  return parent === "." ? "" : parent;
}

function decision(change: Change, hits: RuleHit[], extra: Partial<FileDecision> = {}): FileDecision {
  return { change, hits, headSeed: null, baseSeed: null, forcedTest: null, dataDir: null, ...extra };
}

/** Aplica as regras em ordem; a primeira que decide o arquivo vence. */
export function classify(
  change: Change,
  lang: LanguageConfig,
  head: DependencyGraph | null,
  base: DependencyGraph | null,
): FileDecision {
  const globalPattern =
    matches(change.repoPath, lang.globalFullSuitePatterns) ??
    (change.oldRepoPath ? matches(change.oldRepoPath, lang.globalFullSuitePatterns) : null);
  if (globalPattern) {
    return decision(change, [{ rule: GLOBAL_CONFIG, path: change.repoPath, detail: `casa com '${globalPattern}'` }]);
  }
  if (change.path === null && change.oldPath === null) {
    return decision(change, [{ rule: OUTSIDE_PROJECT, path: change.repoPath, detail: "fora do diretorio do projeto" }]);
  }

  // Lado "head" (existe depois da mudanca) e lado "base" (existia antes).
  const current = change.status === "D" ? null : change.path;
  const previous = change.status === "R" ? change.oldPath : change.status === "A" ? null : change.path;
  const names = [current, previous].filter((p): p is string => p !== null);

  if (names.every((p) => matches(p, lang.ignorePatterns))) {
    return decision(change, [{ rule: DOCS_ONLY, path: names[0], detail: "documentacao, nenhum teste afetado" }]);
  }
  for (const p of names) {
    const pattern = matches(p, lang.fullSuitePatterns);
    if (pattern) return decision(change, [{ rule: BUILD_CONFIG, path: p, detail: `configuracao de build/teste ('${pattern}')` }]);
  }
  for (const p of names) {
    if (matches(p, lang.dataPatterns)) {
      const dir = dataDirFor(p);
      return decision(change, [{ rule: DATA_FILE, path: p, detail: `snapshot/fixture: roda os testes em ${dir || "(raiz do projeto)"}` }], {
        dataDir: dir,
      });
    }
  }

  const hits: RuleHit[] = [];
  let headSeed: string | null = null;
  let baseSeed: string | null = null;
  let forcedTest: string | null = null;

  if (current && isTest(lang, current)) {
    forcedTest = current;
    hits.push({ rule: CHANGED_TEST, path: current, detail: "teste alterado ou adicionado" });
  } else if (previous && !current && isTest(lang, previous)) {
    return decision(change, [{ rule: DELETED_TEST, path: previous, detail: "teste removido" }]);
  }

  if (current) {
    if (head?.hasFile(current)) {
      headSeed = current;
      // Codigo existente que mudou e que nenhum outro arquivo usa: ou o
      // indexador perdeu as arestas (ex.: classe com nome igual a uma do JDK),
      // ou quem usa e o framework (bean Spring com @EventListener). Na duvida,
      // suite completa. Arquivo novo fica de fora: ninguem o usa ainda.
      const modified = change.status === "M" || change.status === "R";
      if (!forcedTest && modified && isSource(lang, current) && !head.hasDependents(current, DEFAULT_RELATIONS, lang.polymorphicRelations)) {
        hits.push({ rule: NO_DEPENDENTS, path: current, detail: "codigo modificado sem nenhum dependente no grafo (indexador pode ter perdido referencias)" });
      } else if (!forcedTest) {
        hits.push({ rule: GRAPH_SEED, path: current, detail: "no grafo do head" });
      }
    } else if (forcedTest) {
      // teste que o indexador nao modelou: ja esta selecionado
    } else if (isSource(lang, current)) {
      hits.push({ rule: SOURCE_NOT_IN_GRAPH, path: current, detail: "codigo-fonte ausente do grafo do head" });
    } else {
      hits.push({ rule: UNCLASSIFIED, path: current, detail: "arquivo fora do grafo e de qualquer regra" });
    }
  }

  if (previous) {
    const removed = change.status === "D" || change.status === "R";
    if (base === null) {
      if (removed && !forcedTest) {
        hits.push({ rule: NO_BASE_GRAPH, path: previous, detail: "removido/renomeado, mas sem grafo do base" });
      }
    } else if (base.hasFile(previous)) {
      // Une as duas buscas: o base enxerga dependentes que o head ja perdeu.
      baseSeed = previous;
      if (!current) hits.push({ rule: GRAPH_SEED, path: previous, detail: "removido; dependentes vem do grafo do base" });
    } else if (removed && !forcedTest && isSource(lang, previous)) {
      hits.push({ rule: SOURCE_NOT_IN_GRAPH, path: previous, detail: "codigo-fonte ausente do grafo do base" });
    }
  }

  return decision(change, hits, { headSeed, baseSeed, forcedTest });
}
