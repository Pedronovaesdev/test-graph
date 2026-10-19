import { selectTests, selectedTests } from "../src/engine";
import { change, graph, javaGradle } from "./helpers";

// Casos tirados do primeiro PR real do piloto no TransportEasy backend.
const M = "src/main/java/app";
const T = "src/test/java/app";

describe("heranca de classes de biblioteca", () => {
  const g = () =>
    graph([
      `${M}/UsuarioRepository.java#UsuarioRepository inherits ext:JpaRepository`,
      `${M}/PecaRepository.java#PecaRepository inherits ext:JpaRepository`,
      `${T}/UsuarioServiceTest.java imports ${M}/UsuarioRepository.java#UsuarioRepository`,
      `${T}/PecaServiceTest.java imports ${M}/PecaRepository.java#PecaRepository`,
    ]);
  const tests = [`${T}/PecaServiceTest.java`, `${T}/UsuarioServiceTest.java`];

  it("mudar um repositorio nao alcanca os outros repositorios via JpaRepository", () => {
    const s = selectTests([change("M", `${M}/PecaRepository.java`)], javaGradle, tests, g());
    expect(selectedTests(s)).toEqual([`${T}/PecaServiceTest.java`]);
  });

  it("interface do proprio projeto continua sendo seguida (DI)", () => {
    const g2 = graph([
      `${M}/Email.java#EmailNotifier implements ${M}/Notifier.java#Notifier`,
      `${M}/Checkout.java#Checkout references ${M}/Notifier.java#Notifier`,
      `${T}/CheckoutTest.java imports ${M}/Checkout.java#Checkout`,
    ]);
    const s = selectTests([change("M", `${M}/Email.java`)], javaGradle, [`${T}/CheckoutTest.java`], g2);
    expect(selectedTests(s)).toEqual([`${T}/CheckoutTest.java`]);
  });
});

describe("heranca entre testes", () => {
  const g = () =>
    graph([
      `${T}/AbstractSecurityIntegrationTest.java#AbstractSecurityIntegrationTest references ext:SpringBootTest`,
      `${T}/CorridaResourceTest.java#CorridaResourceTest inherits ${T}/AbstractSecurityIntegrationTest.java#AbstractSecurityIntegrationTest`,
      `${T}/PecaResourceTest.java#PecaResourceTest inherits ${T}/AbstractSecurityIntegrationTest.java#AbstractSecurityIntegrationTest`,
      `${T}/MathTest.java imports ${M}/MathUtils.java`,
      `${M}/Peca.java contains ${M}/Peca.java#Peca`,
      `${T}/PecaResourceTest.java imports ${M}/Peca.java#Peca`,
    ]);
  const tests = [
    `${T}/AbstractSecurityIntegrationTest.java`,
    `${T}/CorridaResourceTest.java`,
    `${T}/MathTest.java`,
    `${T}/PecaResourceTest.java`,
  ];

  it("teste novo herdando da base nao arrasta os testes irmaos", () => {
    const s = selectTests([change("A", `${T}/PecaResourceTest.java`)], javaGradle, tests, g());
    expect(selectedTests(s)).toEqual([`${T}/PecaResourceTest.java`]);
  });

  it("@SpringBootTest herdado da base faz o teste rodar com qualquer mudanca de codigo", () => {
    const s = selectTests([change("M", `${M}/MathUtils.java`)], javaGradle, tests, g());
    // MathTest pela dependencia; base e filhas por herdarem @SpringBootTest
    expect(selectedTests(s)).toEqual(tests);
    expect(s.tests.get(`${T}/CorridaResourceTest.java`)!.kind).toBe("always-run");
  });

  it("mudanca so em teste nao dispara os @SpringBootTest", () => {
    const s = selectTests([change("M", `${T}/MathTest.java`)], javaGradle, tests, g());
    expect(selectedTests(s)).toEqual([`${T}/MathTest.java`]);
  });
});
