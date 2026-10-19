import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { selectTests, selectedTests } from "../src/engine";
import { loadLanguage, testCommand } from "../src/languages";
import { buildReport } from "../src/report";
import { change, graph } from "./helpers";

/** Grava um .yml temporario (configuracao propria de um projeto) e o carrega. */
function projectConfig(yaml: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tgs-"));
  const file = path.join(dir, "test-selector.yml");
  fs.writeFileSync(file, yaml);
  return loadLanguage(file);
}

describe("configuracao do projeto (extends)", () => {
  it("herda a configuracao base e sobrescreve so o que declara", () => {
    const lang = projectConfig(`extends: typescript
command: "node --experimental-vm-modules node_modules/jest/bin/jest.js --runTestsByPath {files}"
`);
    expect(lang.name).toBe("typescript");
    expect(lang.testPatterns).toContain("**/*.test.ts");
    expect(testCommand(lang, ["src/a.test.ts"])).toBe(
      "node --experimental-vm-modules node_modules/jest/bin/jest.js --runTestsByPath src/a.test.ts",
    );
  });
});

describe("Cypress + Cucumber (frontend)", () => {
  const lang = projectConfig(`extends: typescript
test_patterns: ["packages/frontend/**/*.feature"]
companion_tests:
  - { source: ".steps.tsx", test: ".feature" }
cwd: packages/frontend
command: "npx cypress run --component --spec {files_comma}"
`);
  const F = "packages/frontend/src/components";
  const g = () =>
    graph([
      `${F}/Pagination/Pagination.steps.tsx imports ${F}/Pagination/Pagination.tsx`,
      `${F}/Table/Table.steps.tsx imports ${F}/Table/Table.tsx`,
      `${F}/Table/Table.tsx imports ${F}/Pagination/Pagination.tsx`,
      `${F}/Menu/Menu.steps.tsx imports ${F}/Menu/Menu.tsx`,
    ]);
  const tests = [`${F}/Menu/Menu.feature`, `${F}/Pagination/Pagination.feature`, `${F}/Table/Table.feature`];

  it("componente alterado roda o .feature de quem o usa, via .steps.tsx", () => {
    const s = selectTests([change("M", `${F}/Pagination/Pagination.tsx`)], lang, tests, g());
    expect(selectedTests(s)).toEqual([`${F}/Pagination/Pagination.feature`, `${F}/Table/Table.feature`]);
    const r = buildReport(s, { base: "b", head: "h", lang });
    expect(r.tests.find((t) => t.test.endsWith("Table.feature"))!.explanation).toBe(
      `${F}/Table/Table.feature --usa os passos de--> ${F}/Table/Table.steps.tsx --importa--> ${F}/Table/Table.tsx --importa--> ${F}/Pagination/Pagination.tsx [alterado em ${F}/Pagination/Pagination.tsx]`,
    );
    expect(r.command).toBe(
      `cd packages/frontend && npx cypress run --component --spec src/components/Pagination/Pagination.feature,src/components/Table/Table.feature`,
    );
  });

  it(".steps.tsx alterado roda so o seu .feature (sem cair em no-dependents)", () => {
    const s = selectTests([change("M", `${F}/Menu/Menu.steps.tsx`)], lang, tests, g());
    expect(s.mode).toBe("selective");
    expect(selectedTests(s)).toEqual([`${F}/Menu/Menu.feature`]);
  });

  it(".feature alterado e um teste alterado", () => {
    expect(selectedTests(selectTests([change("M", `${F}/Menu/Menu.feature`)], lang, tests, g()))).toEqual([`${F}/Menu/Menu.feature`]);
  });
});

describe("Cucumber com steps compartilhados (backend)", () => {
  const lang = projectConfig(`extends: typescript
test_patterns: ["packages/backend/features/**/*.feature"]
scope_files:
  - { pattern: "packages/backend/features/step-definitions/**", dir: "packages/backend/features" }
cwd: packages/backend
command: "npx cucumber-js --config cucumber.js {files}"
`);
  const B = "packages/backend";
  const g = () =>
    graph([
      `${B}/features/step-definitions/app.steps.ts imports ${B}/src/app.ts`,
      `${B}/src/app.ts imports ${B}/src/user.ts`,
      `${B}/src/report.ts imports ${B}/src/util.ts`,
      `${B}/src/cli.ts imports ${B}/src/report.ts`,
    ]);
  const tests = [`${B}/features/login.feature`, `${B}/features/models/user.feature`];

  it("codigo alcancado pelos steps roda todos os cenarios da pasta", () => {
    const s = selectTests([change("M", `${B}/src/user.ts`)], lang, tests, g());
    expect(selectedTests(s)).toEqual(tests);
    expect(buildReport(s, { base: "b", head: "h", lang }).command).toBe(
      "cd packages/backend && npx cucumber-js --config cucumber.js features/login.feature features/models/user.feature",
    );
  });

  it("codigo que os steps nao alcancam nao roda nenhum cenario", () => {
    expect(selectTests([change("M", `${B}/src/util.ts`)], lang, tests, g()).mode).toBe("none");
  });

  it("step definition alterado roda todos os cenarios (sem cair em no-dependents)", () => {
    const s = selectTests([change("M", `${B}/features/step-definitions/app.steps.ts`)], lang, tests, g());
    expect(s.mode).toBe("selective");
    expect(selectedTests(s)).toEqual(tests);
  });
});
