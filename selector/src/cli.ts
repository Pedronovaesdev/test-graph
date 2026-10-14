#!/usr/bin/env node
/**
 * CLI do seletor. Normalmente chamada por `select-tests.sh`, nao a mao.
 *
 *   select       diff + grafo(s) -> relatorio e comando de teste
 *   needs-base   diz se o diff exige o grafo do commit base (remocao/renomeacao)
 *   query        consulta o grafo nos dois sentidos (quem depende / de quem depende)
 *   full-command imprime o comando da suite completa da linguagem
 *
 * Saida: 0 = ok, 2 = erro da ferramenta (o shell cai para a suite completa).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { changedFiles, compare, filesAt, projectPrefix, repoRoot } from "./diff";
import { selectTests, selectedTests } from "./engine";
import { DEFAULT_RELATIONS, DependencyGraph } from "./graph";
import { isTest, loadLanguage } from "./languages";
import { buildReport, renderJson, renderMarkdown, renderText } from "./report";

const USAGE = `uso:
  test-graph-selector select --project DIR --base REV --head REV --lang LANG
                             --head-graph FILE [--base-graph FILE]
                             [--format text|json|md] [--out-dir DIR]
  test-graph-selector needs-base --project DIR --base REV --head REV
  test-graph-selector query --graph FILE NO [--direction dependents|dependencies] [--transitive]
  test-graph-selector full-command --lang LANG`;

type Args = { positional: string[]; flags: Map<string, string | true> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags.set(key, inline);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags.set(key, argv[++i]);
    else flags.set(key, true);
  }
  return { positional, flags };
}

function required(args: Args, key: string): string {
  const value = args.flags.get(key);
  if (typeof value !== "string" || value === "") throw new UsageError(`faltou --${key}`);
  return value;
}

function optional(args: Args, key: string): string | null {
  const value = args.flags.get(key);
  return typeof value === "string" && value !== "" ? value : null;
}

class UsageError extends Error {}

function cmdSelect(args: Args): void {
  const project = path.resolve(required(args, "project"));
  const base = required(args, "base");
  const head = required(args, "head");
  const lang = loadLanguage(required(args, "lang"));
  const format = optional(args, "format") ?? "text";
  if (!["text", "json", "md"].includes(format)) throw new UsageError(`--format invalido: ${format}`);

  const repo = repoRoot(project);
  const prefix = projectPrefix(project);
  const changes = changedFiles(repo, base, head, prefix);
  const allTests = filesAt(repo, head, prefix).filter((f) => isTest(lang, f));
  const headGraph = DependencyGraph.fromJson(required(args, "head-graph"), "head");
  const baseGraphFile = optional(args, "base-graph");
  const baseGraph = baseGraphFile ? DependencyGraph.fromJson(baseGraphFile, "base") : null;

  const selection = selectTests(changes, lang, allTests, headGraph, baseGraph);
  const report = buildReport(selection, { base, head, lang });
  const rendered = { text: renderText(report), json: renderJson(report), md: renderMarkdown(report) };

  const outDir = optional(args, "out-dir");
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "report.txt"), rendered.text);
    fs.writeFileSync(path.join(outDir, "report.json"), rendered.json);
    fs.writeFileSync(path.join(outDir, "report.md"), rendered.md);
    fs.writeFileSync(path.join(outDir, "mode.txt"), `${report.mode}\n`);
    fs.writeFileSync(path.join(outDir, "command.txt"), report.command ? `${report.command}\n` : "");
    const tests = selectedTests(selection);
    fs.writeFileSync(path.join(outDir, "selected-tests.txt"), tests.length ? `${tests.join("\n")}\n` : "");
  }
  process.stdout.write(rendered[format as keyof typeof rendered]);
}

function cmdNeedsBase(args: Args): void {
  const project = path.resolve(required(args, "project"));
  const repo = repoRoot(project);
  const changes = changedFiles(repo, required(args, "base"), required(args, "head"), projectPrefix(project));
  const needs = changes.some((c) => (c.status === "D" || c.status === "R") && (c.oldPath ?? c.path) !== null);
  process.stdout.write(needs ? "yes\n" : "no\n");
}

function cmdQuery(args: Args): void {
  const graph = DependencyGraph.fromJson(required(args, "graph"));
  const query = args.positional[0];
  if (!query) throw new UsageError("faltou o no a consultar");
  const direction = optional(args, "direction") ?? "dependents";
  if (direction !== "dependents" && direction !== "dependencies") throw new UsageError(`--direction invalido: ${direction}`);
  const nodes = graph.find(query);
  if (nodes.length === 0) throw new Error(`nenhum no encontrado para '${query}'`);

  for (const node of nodes) {
    const title = direction === "dependents" ? "quem depende de" : "de quem depende";
    process.stdout.write(`${graph.display(node)} (${node}) — ${title}:\n`);
    if (args.flags.has("transitive") && direction === "dependents") {
      const visited = graph.reverseReach(new Map([[node, graph.sourceFile(node) ?? node]]), DEFAULT_RELATIONS);
      const reached = [...visited.keys()].filter((n) => n !== node).sort(compare);
      for (const n of reached) {
        const chain = graph.chain(visited, n).map((s) => `${graph.display(s.dependent)} --${s.relation}--> ${graph.display(s.dependency)}`);
        process.stdout.write(`  ${graph.display(n)}\n      ${chain.join(", ")}\n`);
      }
      if (reached.length === 0) process.stdout.write("  (ninguem)\n");
      continue;
    }
    const edges = direction === "dependents" ? graph.dependents(node) : graph.dependencies(node);
    for (const e of edges) {
      const other = direction === "dependents" ? e.source : e.target;
      process.stdout.write(`  ${e.relation.padEnd(13)} ${graph.display(other)}${e.location ? `  (${e.location})` : ""}\n`);
    }
    if (edges.length === 0) process.stdout.write("  (ninguem)\n");
  }
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    const args = parseArgs(rest);
    switch (command) {
      case "select":
        cmdSelect(args);
        return 0;
      case "needs-base":
        cmdNeedsBase(args);
        return 0;
      case "query":
        cmdQuery(args);
        return 0;
      case "full-command":
        process.stdout.write(`${loadLanguage(required(args, "lang")).fullCommand}\n`);
        return 0;
      case undefined:
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}\n`);
        return command === undefined ? 2 : 0;
      default:
        throw new UsageError(`comando desconhecido: ${command}`);
    }
  } catch (err) {
    process.stderr.write(`test-graph-selector: erro: ${(err as Error).message}\n`);
    if (err instanceof UsageError) process.stderr.write(`${USAGE}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
