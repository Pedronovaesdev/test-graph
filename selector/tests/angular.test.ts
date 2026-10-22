import { selectTests, selectedTests } from "../src/engine";
import { loadLanguage } from "../src/languages";
import { change, graph } from "./helpers";

const angular = loadLanguage("angular");
const C = "libs/components/src";

const g = () =>
  graph([
    `${C}/button/button.component.spec.ts imports ${C}/button/button.component.ts`,
    `${C}/dialog/dialog.component.ts imports ${C}/button/button.component.ts`,
    `${C}/dialog/dialog.component.spec.ts imports ${C}/dialog/dialog.component.ts`,
    `${C}/menu/menu.component.spec.ts imports ${C}/menu/menu.component.ts`,
  ], "head", [`${C}/orphan/orphan.component.ts`]);
const tests = [
  `${C}/button/button.component.spec.ts`,
  `${C}/dialog/dialog.component.spec.ts`,
  `${C}/menu/menu.component.spec.ts`,
];

describe("Angular: template e estilo pertencem ao componente", () => {
  it("template alterado roda os testes de quem usa o componente", () => {
    const s = selectTests([change("M", `${C}/button/button.component.html`)], angular, tests, g());
    expect(s.mode).toBe("selective");
    expect(selectedTests(s)).toEqual([`${C}/button/button.component.spec.ts`, `${C}/dialog/dialog.component.spec.ts`]);
    expect(s.hits.map((h) => h.rule)).toEqual(["owned-file"]);
  });

  it("estilo alterado conta como o componente", () => {
    const s = selectTests([change("M", `${C}/menu/menu.component.scss`)], angular, tests, g());
    expect(selectedTests(s)).toEqual([`${C}/menu/menu.component.spec.ts`]);
  });

  it("template sem componente no grafo roda a suite completa", () => {
    const s = selectTests([change("M", `${C}/sem-dono/sem-dono.component.html`)], angular, tests, g());
    expect(s.mode).toBe("full");
  });

  it("template de componente que ninguem usa roda a suite completa", () => {
    const s = selectTests([change("M", `${C}/orphan/orphan.component.html`)], angular, tests, g());
    expect(s.mode).toBe("full");
    expect(s.hits.map((h) => h.rule)).toEqual(["no-dependents"]);
  });

  it("na configuracao typescript, sem owner_files, template roda a suite completa", () => {
    const s = selectTests([change("M", `${C}/button/button.component.html`)], loadLanguage("typescript"), tests, g());
    expect(s.mode).toBe("full");
  });
});
