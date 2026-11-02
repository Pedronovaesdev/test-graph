import { changedLines, parseNameStatus, parseUnifiedDiff } from "../src/diff";
import { matches } from "../src/languages";

describe("parseNameStatus", () => {
  it("le adicao, modificacao, remocao e renomeacao", () => {
    const out = ["M", "app/src/a.ts", "A", "app/tests/b.test.ts", "D", "app/src/c.ts", "R087", "app/src/old.ts", "app/src/new.ts", "M", "README.md", ""].join("\0");
    const changes = parseNameStatus(out, "app");
    expect(changes).toEqual([
      { status: "M", repoPath: "README.md", path: null, oldRepoPath: null, oldPath: null },
      { status: "M", repoPath: "app/src/a.ts", path: "src/a.ts", oldRepoPath: null, oldPath: null },
      { status: "D", repoPath: "app/src/c.ts", path: "src/c.ts", oldRepoPath: null, oldPath: null },
      { status: "R", repoPath: "app/src/new.ts", path: "src/new.ts", oldRepoPath: "app/src/old.ts", oldPath: "src/old.ts" },
      { status: "A", repoPath: "app/tests/b.test.ts", path: "tests/b.test.ts", oldRepoPath: null, oldPath: null },
    ]);
  });

  it("aceita caminhos com espaco", () => {
    expect(parseNameStatus("M\0src/my file.ts\0")[0].path).toBe("src/my file.ts");
  });
});

describe("parseUnifiedDiff", () => {
  const math = [
    "diff --git a/src/utils/math.ts b/src/utils/math.ts",
    "index 111..222 100644",
    "--- a/src/utils/math.ts",
    "+++ b/src/utils/math.ts",
    "@@ -12,3 +12,5 @@",
    "-  return a + b;",
    "+  return a + b;",
    "+  return a + b;",
    "",
  ].join("\n");

  it("le o hunk do simbolo alterado, sem as linhas de contexto", () => {
    const hunks = parseUnifiedDiff(math).get("src/utils/math.ts");
    expect(hunks).toEqual([{ oldStart: 12, oldCount: 3, newStart: 12, newCount: 5 }]);
    expect(changedLines(hunks!, "new")).toEqual([12, 13, 14, 15, 16]);
    expect(changedLines(hunks!, "old")).toEqual([12, 13, 14]);
  });

  it("conta 1 quando o header omite a contagem", () => {
    const out = ["diff --git a/src/a.ts b/src/a.ts", "@@ -2 +2 @@", "-a", "+b", ""].join("\n");
    expect(parseUnifiedDiff(out).get("src/a.ts")).toEqual([{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }]);
  });

  it("remocao pura nao tem linhas no arquivo novo", () => {
    const out = ["diff --git a/src/a.ts b/src/a.ts", "@@ -5,4 +4,0 @@", "-x", ""].join("\n");
    const hunks = parseUnifiedDiff(out).get("src/a.ts")!;
    expect(changedLines(hunks, "new")).toBeNull();
    expect(changedLines(hunks, "old")).toEqual([5, 6, 7, 8]);
  });

  it("aceita caminho com espaco e caminho entre aspas", () => {
    const plain = ["diff --git a/my file.ts b/my file.ts", "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
    const quoted = ['diff --git "a/my file.ts" "b/my file.ts"', "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
    expect([...parseUnifiedDiff(plain).keys()]).toEqual(["my file.ts"]);
    expect([...parseUnifiedDiff(quoted).keys()]).toEqual(["my file.ts"]);
  });

  it("renomeacao guarda os hunks no caminho novo", () => {
    const out = ["diff --git a/src/old.ts b/src/new.ts", "rename from src/old.ts", "rename to src/new.ts", "@@ -2,0 +3 @@", "+x", ""].join("\n");
    const hunks = parseUnifiedDiff(out).get("src/new.ts");
    expect(hunks).toEqual([{ oldStart: 2, oldCount: 0, newStart: 3, newCount: 1 }]);
    expect(changedLines(hunks!, "new")).toEqual([3]);
    expect(changedLines(hunks!, "old")).toBeNull();
  });
});

describe("glob", () => {
  it.each([
    ["src/a.test.ts", "**/*.test.ts", true],
    ["a.test.ts", "**/*.test.ts", true],
    ["src/a.ts", "**/*.test.ts", false],
    ["package.json", "package.json", true],
    ["sub/package.json", "package.json", false],
    ["jest.config.ts", "jest.config.*", true],
    ["src/test/java/a/b/CartTest.java", "src/test/java/**/*Test.java", true],
    ["docs/x/y.png", "docs/**", true],
  ])("%s ~ %s = %s", (file, pattern, expected) => {
    expect(matches(file, [pattern]) !== null).toBe(expected);
  });
});
