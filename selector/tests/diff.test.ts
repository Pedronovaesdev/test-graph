import { parseNameStatus } from "../src/diff";
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
