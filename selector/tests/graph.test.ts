import { graph } from "./helpers";

describe("DependencyGraph.reverseReach", () => {
  it("segue cadeias longas sem limite de profundidade", () => {
    // t.test -> a -> b -> c -> d -> e (5 niveis; graphify affected pararia em 2)
    const g = graph([
      "tests/t.test.ts imports_from src/a.ts",
      "src/a.ts imports_from src/b.ts",
      "src/b.ts imports_from src/c.ts",
      "src/c.ts imports_from src/d.ts",
      "src/d.ts imports_from src/e.ts",
    ]);
    const visited = g.reverseReach(new Map([["src/e.ts", "src/e.ts"]]));
    expect(visited.has("tests/t.test.ts")).toBe(true);
    const chain = g.chain(visited, "tests/t.test.ts");
    expect(chain.map((s) => s.dependent)).toEqual(["tests/t.test.ts", "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(chain[chain.length - 1].dependency).toBe("src/e.ts");
  });

  it("aceita multiplas sementes e guarda de qual semente veio cada no", () => {
    const g = graph(["tests/a.test.ts imports_from src/a.ts", "tests/b.test.ts imports_from src/b.ts"]);
    const visited = g.reverseReach(
      new Map([
        ["src/a.ts", "src/a.ts"],
        ["src/b.ts", "src/b.ts"],
      ]),
    );
    expect(visited.get("tests/a.test.ts")!.seedFile).toBe("src/a.ts");
    expect(visited.get("tests/b.test.ts")!.seedFile).toBe("src/b.ts");
  });

  it("termina em ciclos de import", () => {
    const g = graph([
      "src/a.ts imports_from src/b.ts",
      "src/b.ts imports_from src/a.ts",
      "tests/a.test.ts imports_from src/a.ts",
    ]);
    const visited = g.reverseReach(new Map([["src/b.ts", "src/b.ts"]]));
    expect([...visited.keys()].sort()).toEqual(["src/a.ts", "src/b.ts", "tests/a.test.ts"]);
  });

  it("sobe de simbolo para quem o contem (contains/method no sentido reverso)", () => {
    // teste importa a classe; a classe tem o metodo que chama add()
    const g = graph([
      "src/cart.ts contains src/cart.ts#Cart",
      "src/cart.ts#Cart method src/cart.ts#.total()",
      "src/cart.ts#.total() calls src/math.ts#add()",
      "tests/cart.test.ts imports src/cart.ts#Cart",
    ]);
    const visited = g.reverseReach(new Map([["src/math.ts#add()", "src/math.ts"]]));
    const chain = g.chain(visited, "tests/cart.test.ts");
    expect(chain.map((s) => s.relation)).toEqual(["imports", "method", "calls"]);
    expect(g.display("src/cart.ts#.total()")).toBe("Cart.total()");
  });

  it("nao desce de arquivo para simbolos fora das sementes", () => {
    // mudar util.ts nao deve afetar quem so usa outro simbolo de lib.ts... a nao
    // ser via o proprio arquivo: aqui ninguem importa util.ts, entao nada.
    const g = graph(["src/lib.ts contains src/lib.ts#x()", "tests/x.test.ts imports src/lib.ts#x()"], "head", ["src/util.ts"]);
    const visited = g.reverseReach(new Map([["src/util.ts", "src/util.ts"]]));
    expect([...visited.keys()]).toEqual(["src/util.ts"]);
  });

  it("segue relacoes polimorficas no sentido direto quando pedido", () => {
    const g = graph([
      "src/Email.java#EmailNotifier implements src/Notifier.java#Notifier",
      "src/Checkout.java#Checkout references src/Notifier.java#Notifier",
      "tests/CheckoutTest.java calls src/Checkout.java#Checkout",
    ]);
    const seeds = new Map([["src/Email.java#EmailNotifier", "src/Email.java"]]);
    expect(g.reverseReach(seeds).has("tests/CheckoutTest.java")).toBe(false);
    const visited = g.reverseReach(seeds, undefined, new Set(["implements"]));
    expect(visited.has("tests/CheckoutTest.java")).toBe(true);
    const poly = g.chain(visited, "tests/CheckoutTest.java").find((s) => s.polymorphic)!;
    expect(poly).toMatchObject({ dependent: "src/Email.java#EmailNotifier", dependency: "src/Notifier.java#Notifier" });
  });

  it("consulta nos dois sentidos", () => {
    const g = graph(["src/a.ts calls src/b.ts", "src/b.ts calls src/c.ts"]);
    expect(g.dependencies("src/b.ts").map((e) => e.target)).toEqual(["src/c.ts"]);
    expect(g.dependents("src/b.ts").map((e) => e.source)).toEqual(["src/a.ts"]);
  });
});

describe("symbolsOnLines", () => {
  const file = "src/utils/math.ts";
  const add = `${file}#add()`;
  const sub = `${file}#subtract()`;
  const mul = `${file}#multiply()`;
  const g = (locations: Record<string, string>) =>
    graph([`${file} contains ${add}`, `${file} contains ${sub}`, `${file} contains ${mul}`], "head", [], locations);

  it("atribui a linha ao simbolo de maior inicio", () => {
    const found = g({ [add]: "L10", [sub]: "L20", [mul]: "L30" }).symbolsOnLines(file, [12, 13, 14, 15, 16]);
    expect(found).toEqual([add]);
  });

  it("junta simbolos que comecam na mesma linha", () => {
    const found = g({ [add]: "L10", [sub]: "L10", [mul]: "L30" }).symbolsOnLines(file, [12]);
    expect(found).toEqual([add, sub]);
  });

  it("respeita o fim explicito e volta para o simbolo de fora", () => {
    const cart = "src/cart.ts";
    const total = `${cart}#.total()`;
    const graphWithEnd = graph(
      [`${cart} contains ${cart}#Cart`, `${cart}#Cart method ${total}`],
      "head",
      [],
      { [`${cart}#Cart`]: "L5-L40", [total]: "L10-L18" },
    );
    expect(graphWithEnd.symbolsOnLines(cart, [12])).toEqual([total]);
    expect(graphWithEnd.symbolsOnLines(cart, [25])).toEqual([`${cart}#Cart`]);
    expect(graphWithEnd.symbolsOnLines(cart, [41])).toBeNull();
  });

  it("pede o arquivo inteiro quando a linha ou a localizacao nao identificam o simbolo", () => {
    const located = g({ [add]: "L10", [sub]: "L20", [mul]: "L30" });
    expect(located.symbolsOnLines(file, [2])).toBeNull();
    expect(g({ [add]: "L10", [sub]: "sem-linha", [mul]: "L30" }).symbolsOnLines(file, [12])).toBeNull();
    expect(located.symbolsOnLines(file, [])).toBeNull();
  });
});
