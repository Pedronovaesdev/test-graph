import { selectTests, selectedTests } from "../src/engine";
import { buildReport, renderJson, renderMarkdown, renderText } from "../src/report";
import { change, graph, java, javaGradle, python, ts, vitest } from "./helpers";

const demo = () =>
  graph([
    "src/utils/math.ts contains src/utils/math.ts#add()",
    "src/services/cart.ts imports src/utils/math.ts#add()",
    "src/services/cart.ts imports_from src/utils/math.ts",
    "src/services/cart.ts contains src/services/cart.ts#Cart",
    "src/services/cart.ts#Cart method src/services/cart.ts#.total()",
    "src/services/cart.ts#.total() calls src/utils/math.ts#add()",
    "tests/math.test.ts imports_from src/utils/math.ts",
    "tests/cart.test.ts imports_from src/services/cart.ts",
    "tests/user.test.ts imports_from src/services/user.ts",
  ]);
const TESTS = ["tests/cart.test.ts", "tests/math.test.ts", "tests/user.test.ts"];

describe("selectTests", () => {
  it("seleciona testes afetados transitivamente", () => {
    const s = selectTests([change("M", "src/utils/math.ts")], ts, TESTS, demo());
    expect(s.mode).toBe("selective");
    expect(selectedTests(s)).toEqual(["tests/cart.test.ts", "tests/math.test.ts"]);
  });

  it("teste alterado e sempre selecionado", () => {
    const s = selectTests([change("M", "tests/user.test.ts")], ts, TESTS, demo());
    expect(selectedTests(s)).toEqual(["tests/user.test.ts"]);
    expect(s.tests.get("tests/user.test.ts")!.kind).toBe("changed-test");
  });

  it("teste novo que o indexador nao modelou ainda e selecionado", () => {
    const s = selectTests([change("A", "tests/new.test.ts")], ts, [...TESTS, "tests/new.test.ts"], demo());
    expect(selectedTests(s)).toEqual(["tests/new.test.ts"]);
  });

  it("documentacao nao seleciona nada (sucesso)", () => {
    const s = selectTests([change("M", "README.md"), change("A", "docs/guia.txt")], ts, TESTS, demo());
    expect(s.mode).toBe("none");
    expect(s.hits.map((h) => h.rule)).toEqual(["docs-only", "docs-only"]);
  });

  it.each(["package.json", "package-lock.json", "jest.config.js", "tsconfig.json", "tsconfig.build.json"])(
    "%s dispara a suite completa",
    (file) => {
      const s = selectTests([change("M", file)], ts, TESTS, demo());
      expect(s.mode).toBe("full");
      expect(selectedTests(s)).toEqual(TESTS);
      expect(s.hits[0].rule).toBe("build-config");
    },
  );

  it("workflow do CI dispara a suite completa", () => {
    const c = { status: "M" as const, repoPath: ".github/workflows/ci.yml", path: null, oldRepoPath: null, oldPath: null };
    expect(selectTests([c], ts, TESTS, demo()).hits[0].rule).toBe("global-config");
  });

  it("codigo fora do grafo dispara a suite completa", () => {
    const s = selectTests([change("A", "src/novo.ts")], ts, TESTS, demo());
    expect(s.mode).toBe("full");
    expect(s.hits[0].rule).toBe("source-not-in-graph");
  });

  it("arquivo desconhecido (asset, env) dispara a suite completa", () => {
    expect(selectTests([change("M", "assets/logo.png")], ts, TESTS, demo()).hits[0].rule).toBe("unclassified-file");
  });

  it("snapshot roda os testes do mesmo diretorio", () => {
    const tests = ["tests/ui/button.test.ts", "tests/ui/menu.test.ts", "tests/math.test.ts"];
    const s = selectTests([change("M", "tests/ui/__snapshots__/button.test.ts.snap")], ts, tests, demo());
    expect(selectedTests(s)).toEqual(["tests/ui/button.test.ts", "tests/ui/menu.test.ts"]);
  });

  it("fixture sem testes por perto dispara a suite completa", () => {
    const s = selectTests([change("M", "data/fixtures/x.json")], ts, TESTS, demo());
    expect(s.mode).toBe("full");
    expect(s.hits.map((h) => h.rule)).toContain("data-file-no-tests");
  });

  it("arquivo removido usa o grafo do base", () => {
    const base = graph(["tests/old.test.ts imports_from src/legacy.ts", "tests/math.test.ts imports_from src/legacy.ts"], "base");
    const head = demo();
    // sem o grafo do base: nao sabemos quem dependia -> suite completa
    expect(selectTests([change("D", "src/legacy.ts")], ts, TESTS, head).hits[0].rule).toBe("no-base-graph");
    const s = selectTests([change("D", "src/legacy.ts")], ts, TESTS, head, base);
    // old.test.ts nao existe mais no head; math.test.ts existe e dependia do arquivo
    expect(selectedTests(s)).toEqual(["tests/math.test.ts"]);
    expect(s.tests.get("tests/math.test.ts")!.graph).toBe("base");
  });

  it("renomeacao semeia o caminho novo no head e o antigo no base", () => {
    const base = graph(["tests/user.test.ts imports_from src/services/old-user.ts"], "base");
    const head = graph(["tests/cart.test.ts imports_from src/services/user.ts"]);
    const s = selectTests([change("R", "src/services/user.ts", "src/services/old-user.ts")], ts, TESTS, head, base);
    expect(selectedTests(s)).toEqual(["tests/cart.test.ts", "tests/user.test.ts"]);
  });

  it("teste removido nao seleciona nada", () => {
    const s = selectTests([change("D", "tests/gone.test.ts")], ts, TESTS, demo());
    expect(s.mode).toBe("none");
    expect(s.hits[0].rule).toBe("deleted-test");
  });

  it("java: implementacao alterada alcanca quem usa a interface", () => {
    const g = graph([
      "src/main/java/Email.java contains src/main/java/Email.java#EmailNotifier",
      "src/main/java/Email.java#EmailNotifier implements src/main/java/Notifier.java#Notifier",
      "src/main/java/Checkout.java#Checkout references src/main/java/Notifier.java#Notifier",
      "src/test/java/CheckoutTest.java calls src/main/java/Checkout.java#Checkout",
    ]);
    const s = selectTests([change("M", "src/main/java/Email.java")], java, ["src/test/java/CheckoutTest.java"], g);
    expect(selectedTests(s)).toEqual(["src/test/java/CheckoutTest.java"]);
  });
});

describe("python", () => {
  // test_cart.py recebe `cart` do conftest.py por injecao: nenhuma aresta para ele.
  const g = () =>
    graph([
      "tests/conftest.py imports_from app/services/cart.py",
      "app/services/cart.py imports_from app/utils/math.py",
      "tests/test_math.py imports_from app/utils/math.py",
      "tests/test_user.py imports_from app/services/user.py",
    ], "head", ["tests/test_cart.py", "tests/unit/test_deep.py"]);
  const tests = ["tests/test_cart.py", "tests/test_math.py", "tests/test_user.py", "tests/unit/test_deep.py"];

  it("alcancar um conftest.py seleciona os testes da pasta dele", () => {
    const s = selectTests([change("M", "app/services/cart.py")], python, tests, g());
    expect(selectedTests(s)).toEqual(tests);
    const r = buildReport(s, { base: "b", head: "h", lang: python });
    expect(r.tests.find((t) => t.test === "tests/test_cart.py")!.explanation).toBe(
      "tests/test_cart.py --usa fixtures de--> tests/conftest.py --importa--> app/services/cart.py [alterado em app/services/cart.py]",
    );
  });

  it("conftest.py alterado roda os testes da pasta dele", () => {
    const s = selectTests([change("M", "tests/unit/conftest.py")], python, tests, g());
    expect(selectedTests(s)).toEqual(["tests/unit/test_deep.py"]);
  });

  it("pyproject.toml dispara a suite completa", () => {
    expect(selectTests([change("M", "pyproject.toml")], python, tests, g()).mode).toBe("full");
  });
});

describe("spring", () => {
  const T = "src/test/java/com/shop/";
  const M = "src/main/java/com/shop/";
  const g = () => {
    const base = graph([
      `${M}CartController.java#CartController references ${M}CartService.java#CartService`,
      `${T}CartControllerWebTest.java#CartControllerWebTest references ${M}CartController.java#CartController`,
      `${T}ApiIntegrationTest.java#ApiIntegrationTest references springboottest`,
      `${T}GreetingTest.java imports ${M}Greeting.java`,
    ], "head", [`${M}README.java`]);
    return base;
  };
  const tests = [`${T}ApiIntegrationTest.java`, `${T}CartControllerWebTest.java`, `${T}GreetingTest.java`];

  it("@SpringBootTest roda com qualquer mudanca de codigo de producao", () => {
    const s = selectTests([change("M", `${M}Greeting.java`)], javaGradle, tests, g());
    expect(selectedTests(s)).toEqual([`${T}ApiIntegrationTest.java`, `${T}GreetingTest.java`]);
    expect(s.tests.get(`${T}ApiIntegrationTest.java`)!.kind).toBe("always-run");
    expect(s.hits.map((h) => h.rule)).toContain("always-run");
  });

  it("codigo modificado sem dependentes no grafo dispara a suite completa", () => {
    // ex.: graphify nao resolve uma classe chamada Clock (nome do JDK)
    const g2 = graph([`${M}Greeting.java contains ${M}Greeting.java#Greeting`], "head", [`${M}Clock.java`]);
    const s = selectTests([change("M", `${M}Clock.java`)], javaGradle, tests, g2);
    expect(s.mode).toBe("full");
    expect(s.hits[0].rule).toBe("no-dependents");
    // arquivo novo sem dependentes nao: ninguem o usa ainda
    expect(selectTests([change("A", `${M}Clock.java`)], javaGradle, tests, g2).mode).not.toBe("full");
  });

  it("@WebMvcTest e selecionado pela classe citada", () => {
    const s = selectTests([change("M", `${M}CartService.java`)], javaGradle, tests, g());
    expect(selectedTests(s)).toEqual([`${T}ApiIntegrationTest.java`, `${T}CartControllerWebTest.java`]);
  });

  it("mudanca so em teste ou documentacao nao dispara o @SpringBootTest", () => {
    expect(selectedTests(selectTests([change("M", `${T}GreetingTest.java`)], javaGradle, tests, g()))).toEqual([`${T}GreetingTest.java`]);
    expect(selectTests([change("M", "README.md")], javaGradle, tests, g()).mode).toBe("none");
  });
});

describe("relatorio", () => {
  const ctx = { base: "origin/main", head: "HEAD", lang: ts };

  it("explica a cadeia completa e conta a economia", () => {
    const s = selectTests([change("M", "src/utils/math.ts")], ts, TESTS, demo());
    const r = buildReport(s, ctx);
    expect(r.summary).toEqual({ selected: 2, total: 3, saved_percent: 33.3 });
    const cart = r.tests.find((t) => t.test === "tests/cart.test.ts")!;
    expect(cart.explanation).toBe(
      "tests/cart.test.ts --importa--> src/services/cart.ts --importa--> src/utils/math.ts [alterado em src/utils/math.ts]",
    );
    expect(r.command).toBe("npx jest --ci --passWithNoTests --runTestsByPath tests/cart.test.ts tests/math.test.ts");
  });

  it("java usa nomes de classe no comando", () => {
    const g = graph(["src/test/java/a/CartTest.java imports src/main/java/a/Cart.java"]);
    const s = selectTests([change("M", "src/main/java/a/Cart.java")], java, ["src/test/java/a/CartTest.java"], g);
    expect(buildReport(s, { ...ctx, lang: java }).command).toBe(
      "mvn -q test -Dtest=CartTest -Dsurefire.failIfNoSpecifiedTests=false",
    );
  });

  it("vitest: comando, setup global e e2e do Playwright fora", () => {
    const g = graph(["tests/unit/a.test.tsx imports_from lib/a.ts"]);
    const tests = ["tests/unit/a.test.tsx"];
    const s = selectTests([change("M", "lib/a.ts")], vitest, tests, g);
    expect(buildReport(s, { ...ctx, lang: vitest }).command).toBe("npx vitest run --passWithNoTests tests/unit/a.test.tsx");
    expect(selectTests([change("M", "tests/setup.ts")], vitest, tests, g).mode).toBe("full");
    expect(selectTests([change("M", "vitest.config.ts")], vitest, tests, g).mode).toBe("full");
    expect(vitest.testPatterns.some((p) => p.includes("spec"))).toBe(false);
  });

  it("gradle repete --tests para cada classe", () => {
    const g = graph([
      "src/test/java/a/CartTest.java imports src/main/java/a/Cart.java",
      "src/test/java/a/MoneyTest.java imports src/main/java/a/Cart.java",
    ]);
    const tests = ["src/test/java/a/CartTest.java", "src/test/java/a/MoneyTest.java"];
    const s = selectTests([change("M", "src/main/java/a/Cart.java")], javaGradle, tests, g);
    expect(buildReport(s, { ...ctx, lang: javaGradle }).command).toBe(
      "./gradlew test --rerun --console=plain -q --tests CartTest --tests MoneyTest",
    );
    expect(selectTests([change("M", "build.gradle")], javaGradle, tests, g).mode).toBe("full");
  });

  it("e deterministico: mesma entrada, mesma saida byte a byte", () => {
    const changes = [change("M", "src/utils/math.ts"), change("M", "tests/user.test.ts"), change("M", "README.md")];
    const render = () => {
      const r = buildReport(selectTests(changes, ts, TESTS, demo()), ctx);
      return renderJson(r) + renderText(r) + renderMarkdown(r);
    };
    const first = render();
    for (let i = 0; i < 5; i++) expect(render()).toBe(first);
    // a ordem das arestas no graph.json tambem nao pode mudar o resultado
    const shuffled = selectTests(changes, ts, [...TESTS].reverse(), demo());
    expect(renderJson(buildReport(shuffled, ctx))).toBe(renderJson(buildReport(selectTests(changes, ts, TESTS, demo()), ctx)));
  });
});
