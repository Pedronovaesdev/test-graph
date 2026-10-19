/**
 * Relatorio: o que foi selecionado e por que, em texto, JSON e Markdown.
 * Sem horario nem caminho absoluto: a mesma entrada gera o mesmo relatorio,
 * byte a byte.
 */
import { compare } from "./diff";
import { selectedTests, type Reason, type Selection } from "./engine";
import type { Step } from "./graph";
import { testCommand, type LanguageConfig } from "./languages";
import { isFullSuite } from "./rules";

const VERBS: Record<string, [string, string]> = {
  // relacao: [sentido normal, sentido polimorfico]
  calls: ["chama", "e chamado por"],
  imports: ["importa", "e importado por"],
  imports_from: ["importa", "e importado por"],
  dynamic_import: ["importa dinamicamente", "e importado dinamicamente por"],
  re_exports: ["reexporta", "e reexportado por"],
  inherits: ["herda de", "e herdado por"],
  extends: ["estende", "e estendido por"],
  implements: ["implementa", "e implementada por"],
  uses: ["usa", "e usado por"],
  references: ["referencia", "e referenciado por"],
  requires: ["requer", "e requerido por"],
  contains: ["contem", "esta contido em"],
  method: ["tem o metodo", "e metodo de"],
};

export interface ReportContext {
  base: string;
  head: string;
  lang: LanguageConfig;
}

export interface JsonStep {
  from: string;
  relation: string;
  to: string;
  location: string | null;
  polymorphic: boolean;
}

export interface JsonReport {
  tool: "test-graph-selector";
  schema_version: 1;
  base: string;
  head: string;
  language: string;
  mode: Selection["mode"];
  summary: { selected: number; total: number; saved_percent: number };
  changes: Array<{ status: string; path: string; old_path: string | null }>;
  rules: Array<{ rule: string; path: string; detail: string; full_suite: boolean }>;
  rules_triggered: Record<string, number>;
  tests: Array<{ test: string; reason: string; seed_file: string | null; graph: string | null; scope: string | null; chain: JsonStep[]; explanation: string }>;
  command: string | null;
}

/** `test --importa--> a.ts --contem--> add() [alterado em a.ts]` */
export function explain(selection: Selection, test: string, reason: Reason): string {
  if (reason.kind === "changed-test") return `${test} [teste alterado/adicionado]`;
  if (reason.kind === "always-run") {
    return `${test} [usa ${reason.scope}: sobe a aplicacao inteira; roda com qualquer mudanca de codigo, ex.: ${reason.seedFile}]`;
  }
  if (reason.kind === "data-file") return `${test} [mesmo diretorio do snapshot/fixture ${reason.seedFile}]`;
  const graph = selection.graphs.get(reason.graph ?? "head")!;
  const tail = `[alterado em ${reason.seedFile}${reason.graph === "base" ? ", via grafo do base" : ""}]`;
  const parts: string[] = [];
  // Teste que recebe fixtures de um arquivo de escopo (ex.: conftest.py) sem importa-lo.
  if (reason.scope) parts.push(`${test} --${reason.scopeVerb ?? "usa fixtures de"}-->`);
  if (reason.steps.length === 0) return `${[...parts, reason.scope ?? test].join(" ")} ${tail}`;
  const first = reason.steps[0];
  parts.push(graph.display(first.polymorphic ? first.dependency : first.dependent));
  for (const step of reason.steps) {
    const [normal, reverse] = VERBS[step.relation] ?? [step.relation, `<- ${step.relation}`];
    parts.push(step.polymorphic ? `<--${reverse}-- ${graph.display(step.dependent)}` : `--${normal}--> ${graph.display(step.dependency)}`);
  }
  return `${parts.join(" ")} ${tail}`;
}

function jsonStep(selection: Selection, graphName: string | null, step: Step): JsonStep {
  const graph = selection.graphs.get(graphName ?? "head")!;
  return {
    from: graph.display(step.dependent),
    relation: step.relation,
    to: graph.display(step.dependency),
    location: step.location,
    polymorphic: step.polymorphic,
  };
}

export function commandFor(selection: Selection, lang: LanguageConfig): string | null {
  if (selection.mode === "full") return lang.fullCommand;
  if (selection.mode === "none") return null;
  return testCommand(lang, selectedTests(selection));
}

export function buildReport(selection: Selection, ctx: ReportContext): JsonReport {
  const selected = selectedTests(selection);
  const total = selection.allTests.length;
  const saved = total === 0 ? 0 : Math.round((1000 * (total - selected.length)) / total) / 10;
  const counts: Record<string, number> = {};
  for (const h of selection.hits) counts[h.rule] = (counts[h.rule] ?? 0) + 1;
  const rulesTriggered = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compare(a, b)));

  return {
    tool: "test-graph-selector",
    schema_version: 1,
    base: ctx.base,
    head: ctx.head,
    language: ctx.lang.name,
    mode: selection.mode,
    summary: { selected: selected.length, total, saved_percent: saved },
    changes: selection.changes.map((c) => ({ status: c.status, path: c.path ?? c.repoPath, old_path: c.oldPath ?? c.oldRepoPath })),
    rules: selection.hits.map((h) => ({ ...h, full_suite: isFullSuite(h) })),
    rules_triggered: rulesTriggered,
    tests:
      selection.mode === "full"
        ? []
        : [...selection.tests.entries()].map(([test, reason]) => ({
            test,
            reason: reason.kind,
            seed_file: reason.seedFile,
            graph: reason.graph,
            scope: reason.scope,
            chain: reason.steps.map((s) => jsonStep(selection, reason.graph, s)),
            explanation: explain(selection, test, reason),
          })),
    command: commandFor(selection, ctx.lang),
  };
}

function headline(r: JsonReport): string {
  const { selected, total, saved_percent } = r.summary;
  if (r.mode === "full") return `SUITE COMPLETA: ${total} de ${total} testes (regra de seguranca disparada)`;
  if (r.mode === "none") return `NENHUM TESTE AFETADO: 0 de ${total} testes (${saved_percent}% economizado)`;
  return `SELETIVO: ${selected} de ${total} testes (${saved_percent}% economizado)`;
}

export function renderJson(r: JsonReport): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}

export function renderText(r: JsonReport): string {
  const lines: string[] = [];
  lines.push(`== test-graph-selector (${r.language}) ==`);
  lines.push(`base: ${r.base}   head: ${r.head}`);
  lines.push("");
  lines.push(`Arquivos alterados (${r.changes.length}):`);
  for (const c of r.changes) lines.push(`  ${c.status} ${c.old_path ? `${c.old_path} -> ` : ""}${c.path}`);
  if (r.changes.length === 0) lines.push("  (nenhum)");
  lines.push("");
  lines.push("Regras aplicadas:");
  for (const h of r.rules) lines.push(`  [${h.rule}]${h.full_suite ? " (SUITE COMPLETA)" : ""} ${h.path}: ${h.detail}`);
  if (r.rules.length === 0) lines.push("  (nenhuma)");
  lines.push("");
  lines.push(headline(r));
  if (r.tests.length > 0) {
    lines.push("");
    lines.push("Testes selecionados e por que:");
    for (const t of r.tests) {
      lines.push(`  * ${t.test}`);
      lines.push(`      ${t.explanation}`);
    }
  }
  if (r.mode === "none") lines.push("Nada a executar: sucesso.");
  lines.push("");
  lines.push(`Comando: ${r.command ?? "(nenhum)"}`);
  return `${lines.join("\n")}\n`;
}

function md(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export function renderMarkdown(r: JsonReport): string {
  const lines: string[] = [];
  lines.push(`## Selecao de testes (${r.language})`);
  lines.push("");
  lines.push(`**${headline(r)}**`);
  lines.push("");
  lines.push(`Base \`${r.base}\` → head \`${r.head}\``);
  lines.push("");
  const triggered = Object.entries(r.rules_triggered).map(([k, v]) => `\`${k}\` ×${v}`);
  lines.push(`Regras disparadas: ${triggered.length ? triggered.join(", ") : "nenhuma"}`);
  lines.push("");
  if (r.tests.length > 0) {
    lines.push("| Teste | Motivo | Cadeia de dependencias |");
    lines.push("|---|---|---|");
    for (const t of r.tests) lines.push(`| \`${md(t.test)}\` | ${t.reason} | ${md(t.explanation)} |`);
    lines.push("");
  }
  lines.push("<details><summary>Arquivos alterados e regras</summary>");
  lines.push("");
  lines.push("| Status | Arquivo | Regra | Detalhe |");
  lines.push("|---|---|---|---|");
  for (const h of r.rules) {
    const change = r.changes.find((c) => c.path === h.path || c.old_path === h.path);
    lines.push(`| ${change?.status ?? ""} | \`${md(h.path)}\` | \`${h.rule}\`${h.full_suite ? " ⚠️" : ""} | ${md(h.detail)} |`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push(r.command ? `Comando: \`${md(r.command)}\`` : "Nada a executar.");
  return `${lines.join("\n")}\n`;
}
