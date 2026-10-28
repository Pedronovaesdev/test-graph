import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadLanguage } from "../src/languages";

describe("test_mappings configuration", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-graph-language-"));
    file = path.join(dir, "custom.yml");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("loads manual source-to-test glob mappings", () => {
    fs.writeFileSync(
      file,
      [
        "name: custom",
        "source_patterns: ['**/*.java']",
        "test_patterns: ['**/*Test.java']",
        "command: 'mvn test -Dtest={classes}'",
        "full_command: 'mvn test'",
        "test_mappings:",
        "  - source: '**/OrderService.java'",
        "    tests:",
        "      - '**/OrderFlowSpec.java'",
      ].join("\n"),
    );
    expect(loadLanguage(file).testMappings).toEqual([
      { source: "**/OrderService.java", tests: ["**/OrderFlowSpec.java"] },
    ]);
  });

  it("rejects mappings without source or test globs", () => {
    fs.writeFileSync(
      file,
      [
        "name: custom",
        "source_patterns: ['**/*.java']",
        "test_patterns: ['**/*Test.java']",
        "command: 'mvn test -Dtest={classes}'",
        "full_command: 'mvn test'",
        "test_mappings:",
        "  - source: '**/OrderService.java'",
        "    tests: []",
      ].join("\n"),
    );
    expect(() => loadLanguage(file)).toThrow("tests deve ser uma lista de globs nao vazia");
  });
});
