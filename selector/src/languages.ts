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
   * cujas fixtures sao injetadas em todo teste da pasta sem import; steps
   * compartilhados do Cucumber). Se a busca alcanca um deles, todos os testes
   * de `dir` (padrao: a pasta do proprio arquivo) e subpastas entram.
   */
  scopeFiles: ScopeFile[];
  /**
   * Arquivo de codigo que "representa" um teste que nao e codigo. Ex.: no
   * Cypress/Cucumber, `X.steps.tsx` importa o componente e `X.feature` (texto)
   * e o que roda. Se a busca alcanca `X.steps.tsx`, o teste `X.feature` entra.
   */
  companionTests: CompanionTest[];
  /**
   * Arquivo que nao e codigo mas pertence a um arquivo de codigo. Ex.: no
   * Angular, `x.component.html` e o template de `x.component.ts` (via
   * `templateUrl`). Mudar o template conta como mudar o componente.
   */
  ownerFiles: OwnerFile[];
  /**
   * Pasta (relativa ao projeto) onde o comando de teste roda, em monorepos.
   * Os caminhos dos testes no comando ficam relativos a ela.
   */
  cwd: string | null;
  /**
   * Anotacoes/simbolos que marcam um teste que sobe a aplicacao inteira (ex.:
   * `SpringBootTest`). Esse teste costuma chamar a API por URL, sem nenhuma
   * aresta no AST para o codigo testado; por isso roda sempre que algum codigo
   * de producao muda.
   */
  alwaysRunMarkers: string[];
}

export interface ScopeFile {
  pattern: string;
  dir: string | null;
}

export interface CompanionTest {
  /** sufixo do arquivo de codigo, ex.: ".steps.tsx" */
  source: string;
  /** sufixo do teste que roda no lugar dele, ex.: ".feature" */
  test: string;
}

/** Teste representado por `file` (`X.steps.tsx` -> `X.feature`), ou null. */
export function companionTestFor(lang: LanguageConfig, file: string): string | null {
  for (const c of lang.companionTests) {
    if (file.endsWith(c.source)) return file.slice(0, -c.source.length) + c.test;
  }
  return null;
}

export interface OwnerFile {
  /** sufixo do arquivo dependente, ex.: ".component.html" */
  file: string;
  /** sufixo do arquivo de codigo dono dele, ex.: ".component.ts" */
  owner: string;
}

/** Arquivo de codigo dono de `file` (`x.component.html` -> `x.component.ts`), ou null. */
export function ownerFor(lang: LanguageConfig, file: string): string | null {
  for (const o of lang.ownerFiles) {
    if (file.endsWith(o.file)) return file.slice(0, -o.file.length) + o.owner;
  }
  return null;
}

/** Regra de escopo que casa com `file`, ou null. */
export function scopeFor(lang: LanguageConfig, file: string): ScopeFile | null {
  return lang.scopeFiles.find((s) => matches(file, [s.pattern]) !== null) ?? null;
}

/**
 * Codigo que existe para os testes (steps, conftest): ninguem o importa, e
 * isso e normal. Nao deve disparar a regra de "codigo sem dependentes".
 */
export function isTestSupport(lang: LanguageConfig, file: string): boolean {
  return companionTestFor(lang, file) !== null || scopeFor(lang, file) !== null;
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
 * Marcadores: `{files}` = caminhos separados por espaco; `{files_comma}` =
 * separados por virgula (Cypress `--spec`); `{classes}` = nomes de classe
 * separados por virgula (Maven); `{each_file:TPL}` e `{each_class:TPL}`
 * repetem TPL para cada teste, trocando `%s` (Gradle: `{each_class:--tests %s}`).
 * Com `cwd`, os caminhos ficam relativos a essa pasta e o comando roda nela.
 */
export function testCommand(lang: LanguageConfig, tests: string[]): string {
  const prefix = lang.cwd ? `${lang.cwd.replace(/\/+$/, "")}/` : "";
  const relative = tests.map((t) => (prefix && t.startsWith(prefix) ? t.slice(prefix.length) : t));
  const classNames = relative.map((t) => path.posix.basename(t).replace(/\.[^.]+$/, ""));
  const quoted = relative.map(shellQuote);
  const command = lang.command
    .replace(/\{each_(file|class):([^}]*)\}/g, (_, kind: string, tpl: string) =>
      (kind === "file" ? quoted : classNames).map((v) => tpl.split("%s").join(v)).join(" "),
    )
    .split("{files}")
    .join(quoted.join(" "))
    .split("{files_comma}")
    .join(shellQuote(relative.join(",")))
    .split("{classes}")
    .join(classNames.join(","));
  return lang.cwd ? `cd ${shellQuote(lang.cwd)} && ${command}` : command;
}

function scopeList(raw: Record<string, unknown>): ScopeFile[] {
  const value = raw.scope_files;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("campo 'scope_files' deve ser uma lista");
  return value.map((item) => {
    if (typeof item === "string") return { pattern: item, dir: null };
    const obj = item as Record<string, unknown>;
    if (!obj.pattern) throw new Error("scope_files: cada item objeto precisa de 'pattern'");
    return { pattern: String(obj.pattern), dir: obj.dir === undefined ? null : String(obj.dir).replace(/\/+$/, "") };
  });
}

function companionList(raw: Record<string, unknown>): CompanionTest[] {
  const value = raw.companion_tests;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("campo 'companion_tests' deve ser uma lista");
  return value.map((item) => {
    const obj = item as Record<string, unknown>;
    if (!obj.source || !obj.test) throw new Error("companion_tests: cada item precisa de 'source' e 'test'");
    return { source: String(obj.source), test: String(obj.test) };
  });
}

function ownerList(raw: Record<string, unknown>): OwnerFile[] {
  const value = raw.owner_files;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("campo 'owner_files' deve ser uma lista");
  return value.map((item) => {
    const obj = item as Record<string, unknown>;
    if (!obj.file || !obj.owner) throw new Error("owner_files: cada item precisa de 'file' e 'owner'");
    return { file: String(obj.file), owner: String(obj.owner) };
  });
}

function languageFile(nameOrPath: string, relativeTo = process.cwd()): string {
  return path.extname(nameOrPath) ? path.resolve(relativeTo, nameOrPath) : path.join(LANGUAGES_DIR, `${nameOrPath}.yml`);
}

/**
 * Le o YAML e resolve `extends`: herda todos os campos da configuracao base
 * (ex.: `extends: typescript`, ou um caminho relativo a este arquivo) e
 * sobrescreve so os que declarar. Assim um projeto mantem o proprio
 * `.github/test-selector.yml` com poucas linhas.
 */
function readRaw(file: string, chain: string[] = []): Record<string, unknown> {
  if (chain.includes(file)) throw new Error(`extends circular: ${[...chain, file].join(" -> ")}`);
  const raw = (parse(fs.readFileSync(file, "utf-8")) ?? {}) as Record<string, unknown>;
  if (raw.extends === undefined) return raw;
  const baseName = String(raw.extends);
  const baseFile = languageFile(baseName, path.dirname(file));
  if (!fs.existsSync(baseFile)) throw new Error(`${file}: extends '${baseName}' nao encontrado`);
  const own = { ...raw };
  delete own.extends;
  return { ...readRaw(baseFile, [...chain, file]), ...own };
}

function stringList(raw: Record<string, unknown>, key: string, fallback: string[] = []): string[] {
  const value = raw[key];
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) throw new Error(`campo '${key}' deve ser uma lista`);
  return value.map(String);
}

export function loadLanguage(nameOrPath: string): LanguageConfig {
  const file = languageFile(nameOrPath);
  if (!fs.existsSync(file)) {
    const available = fs
      .readdirSync(LANGUAGES_DIR)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => f.slice(0, -4))
      .sort()
      .join(", ");
    throw new Error(`linguagem desconhecida: '${nameOrPath}' (disponiveis: ${available})`);
  }
  const raw = readRaw(file);
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
    scopeFiles: scopeList(raw),
    companionTests: companionList(raw),
    ownerFiles: ownerList(raw),
    cwd: raw.cwd === undefined || raw.cwd === null ? null : String(raw.cwd).replace(/\/+$/, ""),
    alwaysRunMarkers: stringList(raw, "always_run_markers"),
  };
}
