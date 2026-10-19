import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.resolve(__dirname, "../bin/select-tests.sh");

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-graph-preflight-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "tests@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Preflight Tests"]);
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["-C", dir, "add", "README.md"]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "initial"]);
  return dir;
}

describe("shell preflight", () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  it("falha com exit 2 quando o projeto nao tem repositorio Git", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "test-graph-no-git-"));
    dirs.push(project);
    const result = spawnSync("bash", [script, "--project", project, "--base", "HEAD", "--lang", "java"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nao esta num repositorio git");
  });

  it("rejeita referencias Git invalidas antes de iniciar a analise", () => {
    const project = makeRepo();
    dirs.push(project);
    const result = spawnSync("bash", [script, "--project", project, "--base", "missing-ref", "--head", "HEAD", "--lang", "java"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("commit base invalido: missing-ref");
    expect(result.stderr).not.toContain("indexando o head");
  });

  it("encerra com sucesso sem indexar quando base e head nao tem diferencas", () => {
    const project = makeRepo();
    dirs.push(project);
    const result = spawnSync("bash", [script, "--project", project, "--base", "HEAD", "--head", "HEAD", "--lang", "java"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("base e head nao tem diferencas");
    expect(result.stderr).not.toContain("indexando o head");
  });
});
