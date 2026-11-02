/**
 * Leitor de diff do Git: quais arquivos mudaram entre dois commits.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

export type ChangeStatus = "A" | "M" | "D" | "R";

/**
 * Um arquivo alterado.
 *
 * `path` e `oldPath` sao relativos ao diretorio do projeto analisado (o mesmo
 * em que o indexador rodou), para casar com o `source_file` dos nos do grafo.
 * `repoPath` e relativo a raiz do repositorio. Arquivo fora do projeto fica
 * com `path = null`.
 */
/** Um hunk de `git diff -U0`. Contagens omitidas no header valem 1. */
export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface Change {
  status: ChangeStatus;
  repoPath: string;
  path: string | null;
  oldRepoPath: string | null;
  oldPath: string | null;
  /**
   * Hunks do diff unificado. Ausente: o diff nao foi lido e a selecao
   * semeia o arquivo inteiro. Lista vazia: nao ha hunk de conteudo.
   */
  hunks?: Hunk[];
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    throw new Error(`git ${args.join(" ")} falhou: ${stderr.trim()}`);
  }
}

export function repoRoot(dir: string): string {
  return git(dir, ["rev-parse", "--show-toplevel"]).trim();
}

/** Caminho do projeto relativo a raiz do repo ('' se for a raiz). */
export function projectPrefix(projectDir: string): string {
  return git(projectDir, ["rev-parse", "--show-prefix"]).trim().replace(/\/+$/, "");
}

function relativeTo(repoPath: string, prefix: string): string | null {
  if (!prefix) return repoPath;
  if (repoPath === prefix) return "";
  return repoPath.startsWith(`${prefix}/`) ? repoPath.slice(prefix.length + 1) : null;
}

function makeChange(status: ChangeStatus, repoPath: string, prefix: string, oldRepoPath: string | null = null): Change {
  return {
    status,
    repoPath,
    path: relativeTo(repoPath, prefix),
    oldRepoPath,
    oldPath: oldRepoPath === null ? null : relativeTo(oldRepoPath, prefix),
  };
}

/**
 * Interpreta a saida de `git diff --name-status -z -M`.
 * Com `-z` os campos vem separados por NUL: `STATUS\0path\0` ou, para
 * renomeacao/copia, `R100\0antigo\0novo\0`.
 */
export function parseNameStatus(output: string, prefix = ""): Change[] {
  const fields = output.split("\0");
  const changes: Change[] = [];
  let i = 0;
  while (i < fields.length) {
    const raw = fields[i];
    if (!raw) {
      i += 1;
      continue;
    }
    const code = raw[0];
    if (code === "R" || code === "C") {
      const oldPath = fields[i + 1];
      const newPath = fields[i + 2];
      i += 3;
      // Copia: o original nao mudou, so o arquivo novo importa.
      changes.push(code === "C" ? makeChange("A", newPath, prefix) : makeChange("R", newPath, prefix, oldPath));
      continue;
    }
    const file = fields[i + 1];
    i += 2;
    const status: ChangeStatus = code === "A" || code === "D" ? code : "M"; // T/U/X -> M
    changes.push(makeChange(status, file, prefix));
  }
  return changes.sort((a, b) => compare(a.repoPath, b.repoPath) || compare(a.status, b.status));
}

/**
 * Caminho `b/` de um header `diff --git`. Sem aspas, o separador e o ultimo
 * ` b/` em que os dois lados ainda coincidem (arquivo so modificado); numa
 * renomeacao, o ultimo ` b/` do header.
 */
function pathFromDiffHeader(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const endA = quotedTokenEnd(rest, 0);
    if (endA < 0) return null;
    const bAt = rest.indexOf('"', endA);
    if (bAt < 0) return null;
    const endB = quotedTokenEnd(rest, bAt);
    if (endB < 0) return null;
    return stripAB(unescapeGit(rest.slice(bAt + 1, endB - 1)));
  }
  const candidates: Array<{ a: string; b: string }> = [];
  let from = 0;
  while (from < rest.length) {
    const idx = rest.indexOf(" b/", from);
    if (idx < 0) break;
    const left = rest.slice(0, idx);
    const right = rest.slice(idx + 1);
    if (left.startsWith("a/") && right.startsWith("b/")) candidates.push({ a: left.slice(2), b: right.slice(2) });
    from = idx + 1;
  }
  if (candidates.length === 0) return null;
  const same = candidates.filter((c) => c.a === c.b);
  return (same.length > 0 ? same[same.length - 1] : candidates[candidates.length - 1]).b;
}

function quotedTokenEnd(input: string, open: number): number {
  for (let i = open + 1; i < input.length; i++) {
    if (input[i] === "\\") {
      i += 1;
      continue;
    }
    if (input[i] === '"') return i + 1;
  }
  return -1;
}

function unescapeGit(body: string): string {
  return body.replace(/\\(?:([abtnvfr"\\])|([0-7]{1,3}))/g, (_m, simple: string | undefined, octal: string | undefined) => {
    if (octal !== undefined) return String.fromCharCode(parseInt(octal, 8));
    const named: Record<string, string> = { a: "\u0007", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    return simple ? (named[simple] ?? simple) : _m;
  });
}

function stripAB(p: string): string {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}

/**
 * Hunks de `git diff -U0`, indexados pelo caminho novo (relativo a raiz
 * do repositorio). Sem contexto: cada linha do hunk foi de fato alterada.
 */
export function parseUnifiedDiff(output: string): Map<string, Hunk[]> {
  const hunks = new Map<string, Hunk[]>();
  let current: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = pathFromDiffHeader(line);
      if (current !== null && !hunks.has(current)) hunks.set(current, []);
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!header || current === null) continue;
    const list = hunks.get(current);
    if (!list) continue;
    list.push({
      oldStart: Number(header[1]),
      oldCount: header[2] === undefined ? 1 : Number(header[2]),
      newStart: Number(header[3]),
      newCount: header[4] === undefined ? 1 : Number(header[4]),
    });
  }
  return hunks;
}

/**
 * Linhas alteradas num lado do hunk. `null` quando um hunk nao tem linhas
 * nesse lado (insercao ou remocao pura): o simbolo apagado pode nao estar
 * mais no grafo, e o fallback e o arquivo inteiro.
 */
export function changedLines(hunks: readonly Hunk[], side: "new" | "old"): number[] | null {
  const lines = new Set<number>();
  for (const hunk of hunks) {
    const start = side === "new" ? hunk.newStart : hunk.oldStart;
    const count = side === "new" ? hunk.newCount : hunk.oldCount;
    if (count === 0) return null;
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  if (lines.size === 0) return null;
  return [...lines].sort((a, b) => a - b);
}

/** Arquivos alterados de `base` ate `head` (diff de tres pontos: desde o merge-base). */
export function changedFiles(repo: string, base: string, head: string, prefix = ""): Change[] {
  const spec = `${base}...${head}`;
  const changes = parseNameStatus(git(repo, ["diff", "--name-status", "-z", "-M", spec]), prefix);
  const hunks = parseUnifiedDiff(git(repo, ["diff", "-U0", "--no-color", "--no-ext-diff", "-M", spec]));
  for (const change of changes) {
    change.hunks = hunks.get(change.repoPath) ?? (change.oldRepoPath !== null ? hunks.get(change.oldRepoPath) : undefined) ?? [];
  }
  return changes;
}

/** Todos os arquivos versionados no commit `rev`, relativos ao projeto. */
export function filesAt(repo: string, rev: string, prefix = ""): string[] {
  const args = ["ls-tree", "-r", "--name-only", "-z", rev];
  if (prefix) args.push("--", prefix);
  return git(repo, args)
    .split("\0")
    .filter(Boolean)
    .map((p) => relativeTo(p, prefix))
    .filter((p): p is string => p !== null && p !== "")
    .sort(compare);
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
