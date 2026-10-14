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
export interface Change {
  status: ChangeStatus;
  repoPath: string;
  path: string | null;
  oldRepoPath: string | null;
  oldPath: string | null;
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

/** Arquivos alterados de `base` ate `head` (diff de tres pontos: desde o merge-base). */
export function changedFiles(repo: string, base: string, head: string, prefix = ""): Change[] {
  return parseNameStatus(git(repo, ["diff", "--name-status", "-z", "-M", `${base}...${head}`]), prefix);
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
