#!/usr/bin/env node
/**
 * Extrai um grafo de dependencias de um projeto TypeScript/JavaScript via
 * ts-morph — uma camada sobre o COMPILADOR REAL do TypeScript, entao a
 * resolucao de "pra qual arquivo este import aponta" e a mesma que o `tsc`
 * usa, nao um palpite textual.
 *
 * Granularidade: nivel de ARQUIVO (import graph), igual ao extrator Python —
 * nao nivel de funcao/metodo como o indexador Java. TypeScript ate permite
 * resolucao de tipo (poderia dar call-graph fino via type checker), mas
 * ficamos no nivel de import por consistencia com Python e porque e o que
 * ferramentas reais do ecossistema (Jest --findRelatedTests) tambem fazem.
 *
 * Uso:
 *   node extract-graph.mjs --repo-root . --out graph.json
 */
import { Project } from "ts-morph";
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

function parseArgs(argv) {
  const args = { repoRoot: ".", out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo-root") args.repoRoot = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  if (!args.out) {
    console.error("uso: node extract-graph.mjs --repo-root <dir> --out <arquivo.json>");
    process.exit(1);
  }
  return args;
}

function toPosixRelative(repoRoot, absPath) {
  return relative(repoRoot, absPath).split("\\").join("/");
}

/** Convencao Jest: *.test.ts(x) / *.spec.ts(x) / *.test.js(x) / *.spec.js(x). */
function isTestFile(relPath) {
  return /\.(test|spec)\.[jt]sx?$/.test(relPath);
}

function main() {
  const { repoRoot: repoRootArg, out } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(repoRootArg);

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });
  project.addSourceFilesAtPaths([
    `${repoRoot}/**/*.{ts,tsx,js,jsx}`,
    `!${repoRoot}/**/node_modules/**`,
    `!${repoRoot}/**/dist/**`,
    `!${repoRoot}/**/build/**`,
  ]);

  const sourceFiles = project.getSourceFiles();
  const nodes = [];
  const edges = [];

  for (const sourceFile of sourceFiles) {
    const relPath = toPosixRelative(repoRoot, sourceFile.getFilePath());
    nodes.push({ id: relPath, isTest: isTestFile(relPath) });

    // import { x } from './y'  /  export { x } from './y'
    const specifiers = [
      ...sourceFile.getImportDeclarations(),
      ...sourceFile.getExportDeclarations(),
    ];
    for (const decl of specifiers) {
      const targetFile = decl.getModuleSpecifierSourceFile();
      // undefined = pacote externo (node_modules) ou nao resolvido — ignora,
      // igual ao "resolveSafely" do indexador Java: aresta a menos, nao erro.
      if (!targetFile) continue;
      const targetRel = toPosixRelative(repoRoot, targetFile.getFilePath());
      if (targetRel !== relPath) {
        edges.push({ from: relPath, to: targetRel });
      }
    }
  }

  const graph = { nodes, edges };
  writeFileSync(out, JSON.stringify(graph, null, 2), "utf-8");
  const testCount = nodes.filter((n) => n.isTest).length;
  console.error(
    `Indexados ${nodes.length} nos, ${edges.length} arestas (${testCount} testes). Escrito em ${out}`
  );
}

main();
