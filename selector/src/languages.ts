/**
 * Configuracao por linguagem (`selector/languages/<nome>.yml`).
 * Adicionar uma linguagem = criar um YAML novo; nenhum codigo muda.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

export const LANGUAGES_DIR = path.resolve(__dirname, "..", "languages");

/** Valem para qualquer linguagem; um YAML pode sobrescrever. */
export const DEFAULT_IGNORE_PATTERNS = [
  "**/*.md",
  "**/*.rst",
  "**/*.adoc",
  "docs/**",
  "**/LICENSE*",
  "**/.gitignore",
  "**/.gitattributes",
  "**/.editorconfig",
];
/** Casados contra o caminho relativo a raiz do repositorio (nao do projeto). */
export const DEFAULT_GLOBAL_FULL_SUITE_PATTERNS = [".github/workflows/**"];

const regexCache = new Map<string, RegExp>();

/** Glob -> regex. `**\/` = zero ou mais diretorios; `*` e `?` nao cruzam `/`. */
export function globRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      out += "[^/]*";
      i += 1;
    } else if (pattern[i] === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  const re = new RegExp(`^${out}$`);
  regexCache.set(pattern, re);
  return re;
}

/** Primeiro padrao que casa com `file`, ou null. */
export function matches(file: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    if (globRegex(pattern).test(file)) return pattern;
  }
  return null;
}

export interface LanguageConfig {
  name: string;
  sourcePatterns: string[];
  testPatterns: string[];
  command: string;
  fullCommand: string;
  fullSuitePatterns: string[];
  dataPatterns: string[];
  ignorePatterns: string[];
  globalFullSuitePatterns: string[];
  polymorphicRelations: Set<string>;
  /**
   * Arquivos que valem para uma pasta inteira (ex.: `conftest.py` do pytest,
   * cujas fixtures sao injetadas em todo teste da pasta sem import). Se a busca
   * alcanca um deles, todos os testes da pasta dele (e subpastas) entram.
   */
  scopeFiles: string[];
  /**
   * Anotacoes/simbolos que marcam um teste que sobe a aplicacao inteira (ex.:
   * `SpringBootTest`). Esse teste costuma chamar a API por URL, sem nenhuma
   * aresta no AST para o codigo testado; por isso roda sempre que algum codigo
   * de producao muda.
   */
  alwaysRunMarkers: string[];
}

export function isTest(lang: LanguageConfig, file: string): boolean {
  return matches(file, lang.testPatterns) !== null;
}

export function isSource(lang: LanguageConfig, file: string): boolean {
  return matches(file, lang.sourcePatterns) !== null;
}

function shellQuote(s: string): string {
  return /^[\w./@%+=:,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Comando para rodar exatamente `tests` (caminhos relativos ao projeto).
 *
 * Marcadores: `{files}` = caminhos separados por espaco; `{classes}` = nomes
 * de classe separados por virgula (Maven); `{each_file:TPL}` e
 * `{each_class:TPL}` repetem TPL para cada teste, trocando `%s`
 * (Gradle: `{each_class:--tests %s}` -> `--tests A --tests B`).
 */
export function testCommand(lang: LanguageConfig, tests: string[]): string {
  const classNames = tests.map((t) => path.posix.basename(t).replace(/\.[^.]+$/, ""));
  const quoted = tests.map(shellQuote);
  return lang.command
    .replace(/\{each_(file|class):([^}]*)\}/g, (_, kind: string, tpl: string) =>
      (kind === "file" ? quoted : classNames).map((v) => tpl.split("%s").join(v)).join(" "),
    )
    .split("{files}")
    .join(quoted.join(" "))
    .split("{classes}")
    .join(classNames.join(","));
}

function stringList(raw: Record<string, unknown>, key: string, fallback: string[] = []): string[] {
  const value = raw[key];
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) throw new Error(`campo '${key}' deve ser uma lista`);
  return value.map(String);
}

export function loadLanguage(nameOrPath: string): LanguageConfig {
  const file = path.extname(nameOrPath) ? path.resolve(nameOrPath) : path.join(LANGUAGES_DIR, `${nameOrPath}.yml`);
  if (!fs.existsSync(file)) {
    const available = fs
      .readdirSync(LANGUAGES_DIR)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => f.slice(0, -4))
      .sort()
      .join(", ");
    throw new Error(`linguagem desconhecida: '${nameOrPath}' (disponiveis: ${available})`);
  }
  const raw = (parse(fs.readFileSync(file, "utf-8")) ?? {}) as Record<string, unknown>;
  for (const key of ["name", "source_patterns", "test_patterns", "command", "full_command"]) {
    if (!(key in raw)) throw new Error(`${file}: campo obrigatorio ausente: ${key}`);
  }
  return {
    name: String(raw.name),
    sourcePatterns: stringList(raw, "source_patterns"),
    testPatterns: stringList(raw, "test_patterns"),
    command: String(raw.command),
    fullCommand: String(raw.full_command),
    fullSuitePatterns: stringList(raw, "full_suite_patterns"),
    dataPatterns: stringList(raw, "data_patterns"),
    ignorePatterns: stringList(raw, "ignore_patterns", DEFAULT_IGNORE_PATTERNS),
    globalFullSuitePatterns: stringList(raw, "global_full_suite_patterns", DEFAULT_GLOBAL_FULL_SUITE_PATTERNS),
    polymorphicRelations: new Set(stringList(raw, "polymorphic_relations")),
    scopeFiles: stringList(raw, "scope_files"),
    alwaysRunMarkers: stringList(raw, "always_run_markers"),
  };
}
