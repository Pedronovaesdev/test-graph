# Resultados do test-graph-selector

Este documento reúne as avaliações feitas com a ferramenta até outubro de 2026:

- dois projetos reais de empresa: um monorepo TypeScript com Cypress (sem o nome, a pedido do dono do código) e o backend da TransportEasy;
- quatro projetos open source: jsoup, Apache Commons Math, Bitwarden e, só como análise de CI, Apache Kafka e Twenty.

Para cada um: o que foi medido, como, o resultado e o que ele ensinou sobre a ferramenta.

## Legenda

| Marca | Significado |
|---|---|
| **MEDIDO** | execução real, com tempo cronometrado |
| **SIMULADO** | a ferramenta rodou em `--dry-run` sobre commits reais do histórico: sabemos quais testes ela escolheria, mas eles não foram executados |
| **PROJEÇÃO** | conta feita a partir de medições (ex.: tempo por cenário × cenários escolhidos) |

## Resumo

| Projeto | Stack | Suíte completa | Testes evitados | Ganho de tempo |
|---|---|---|---|---|
| Monorepo (empresa) | React + Cypress/Cucumber, NestJS + Cucumber | **~30 min** (MEDIDO) | **45% dos cenários** (SIMULADO, 10 commits) | **~40%** (PROJEÇÃO: ~180 min contra ~300 min nos 10 commits) |
| TransportEasy | Spring Boot + Gradle + Testcontainers | 6 min 34 s (MEDIDO, CI) | **45%** no PR real de 42 arquivos (MEDIDO) | depende do PR; o piso são 104 testes `@SpringBootTest` |
| [jsoup](https://github.com/jhy/jsoup) | Java + Maven | ~45 s (MEDIDO) | ~9% | **nenhum**: fica mais lento |
| [Apache Commons Math](https://github.com/apache/commons-math) | Java + Maven | 84 s (MEDIDO) | mediana de **93%** das classes | **nenhum**: o custo fixo empata |
| [Bitwarden clients](https://github.com/bitwarden/clients) | Angular + Jest | 232 min de espera em 15 commits (MEDIDO, CI) | **43%** (15 commits) | **−38% na espera do PR, −33% em minutos de CI** (MEDIDO no GitHub Actions) |

**A conclusão principal:** a seleção funciona bem em código modular, mas só **economiza tempo** quando a suíte é longa comparada ao custo fixo da ferramenta (~15 s a 2 min, conforme o tamanho do repositório). Em suítes de segundos ou de 1 a 2 minutos ela não compensa. Em suítes de dezenas de minutos (Cypress, testes de integração), compensa.

---

## 1. Monorepo da empresa (nome omitido)

**Stack:** monorepo npm com frontend React + Vite (testes de componente no Cypress 15 com Cucumber/BDD), backend NestJS + TypeORM (Cucumber-js) e um pacote compartilhado. CI no GitHub Actions, em container do Cypress.

**Tamanho:**

| Tipo de teste | Arquivos | Cenários |
|---|---|---|
| Interface (Cypress + Cucumber), frontend | 128 `.feature` | 529 |
| API (Cucumber), backend | 26 `.feature` | 119 |
| Unitários (Vitest) | 17 | — |

**Suíte completa:** ~30 min (MEDIDO pelo time no próprio projeto).

### Como foi medido

1. A ferramenta rodou em `--dry-run` nos 10 últimos commits, uma vez para o frontend e outra para o backend, com uma configuração própria do projeto (`extends: typescript`, cenários `.feature` como teste, `X.steps.tsx` como representante de `X.feature`, steps compartilhados valendo para a pasta inteira).
2. Para cada commit, contamos os cenários dentro das features escolhidas.
3. Antes, para calibrar o tempo, os cenários escolhidos em 2 commits foram executados de verdade no Cypress.

### Execução real de cenários escolhidos (MEDIDO)

| Commit | Features escolhidas | Cenários que passaram | Tempo dos specs | Tempo total |
|---|---|---|---|---|
| A | 2 de 120 | 41 | 15 s | 182 s |
| B | 7 de 123 | 80 | 47 s | 209 s |

Cada execução do Cypress tem **~2,7 min fixos** (abrir o navegador e compilar o frontend), não importa quantos cenários rode.

### Seleção nos últimos 10 commits — frontend (SIMULADO)

| Commit | Cenários escolhidos | Tempo estimado (PROJEÇÃO) |
|---|---|---|
| 1 | 45 de 529 | ~5 min |
| 2 | 351 de 526 | ~21 min |
| 3 | **8 de 527** | **~3 min** |
| 4 | todos (mudou `package.json`) | 30 min |
| 5 | 100 de 519 | ~8 min |
| 6 | todos (mudou config do Cypress) | 30 min |
| 7 | todos (mudou config) | 30 min |
| 8 | 364 de 518 | ~22 min |
| 9 | 346 de 500 | ~22 min |
| 10 | 72 de 506 | ~7 min |
| **Total** | **2.819 de 5.158 (−45%)** | **~180 min contra 300 min (−40%)** |

**Como o tempo foi projetado:** 2,7 min fixos + o restante dos 30 min na proporção dos cenários escolhidos.

**Backend:** em 6 dos 10 commits a mudança não tocava o backend, e nenhum cenário de API precisaria rodar. Nos outros 4, rodariam todos os 26, porque todos os cenários usam os mesmos steps.

### Custo da ferramenta neste projeto (MEDIDO)

| Situação | Antes da otimização | Depois |
|---|---|---|
| Commit comum | ~18-23 s | ~14-18 s |
| Commit grande (40+ arquivos) | ~54-59 s | ~47-52 s |

A seleção saiu idêntica antes e depois da otimização nos 20 casos medidos.

### O que aprendemos

- **É o cenário ideal para a ferramenta:** testes lentos (Cypress) e componentes independentes. ~15 s de análise para economizar até 27 min.
- **Steps BDD compartilhados aumentam a seleção.** Os commits com ~350 cenários escolhidos passam por steps usados por muitas features.
- **Mudanças de dependência ou configuração rodam tudo** (3 de 10 commits), por segurança.
- Falta medir o tempo do modo seletivo dentro do CI do projeto.

---

## 2. TransportEasy (backend)

**Stack:** Java 17, Spring Boot 3.5, Gradle, JUnit 5, Testcontainers (PostgreSQL), H2, Flyway, JaCoCo + diff-cover. ~780 arquivos de código e 224 classes de teste.

**CI:** GitHub Actions. O passo "Build + Test" leva **6 min 34 s** (MEDIDO), de um job de 6 min 51 s.

### Como foi medido

1. **Piloto em modo observação:** a Action rodou em todo PR ao lado do CI normal, só mostrando quais testes escolheria. O job levou 51 s (MEDIDO), sem cache.
2. **PR real de 42 arquivos:** reanalisado localmente com a versão original da ferramenta e com a corrigida.
3. **Conferência de segurança:** todo teste que importa diretamente um arquivo alterado precisa estar na seleção.

### Resultados

| Medição | Resultado |
|---|---|
| PR real, versão original | 183 de 224 (−18%) (MEDIDO) |
| **PR real, versão corrigida** | **122 de 224 (−45%)** (MEDIDO) |
| Testes que usam diretamente o código alterado | **18 de 18 selecionados** |
| Simulação nos últimos 10 commits (versão original) | ~32% a menos; 4 de 10 rodariam tudo (SIMULADO) |

### Problemas encontrados e corrigidos

1. **Herança de classes do framework ligava o projeto inteiro.** Todo repositório estende `JpaRepository`, então mudar um repositório alcançava todos os outros (o mesmo com `OncePerRequestFilter`). Correção: a regra de polimorfismo só segue herança entre classes do próprio projeto.
2. **Teste novo arrastava os testes vizinhos.** Correção: a busca não segue polimorfismo a partir de um teste.
3. **`@SpringBootTest` herdado não era reconhecido.** Uma classe base com a anotação, estendida pelos testes, passava despercebida. Correção: o marcador é procurado subindo pela herança.

### O que aprendemos

- **104 dos 122 testes selecionados são `@SpringBootTest`** (direto ou herdado). Eles sobem a aplicação inteira e chamam a API por URL, sem ligação no código com o que testam, então rodam com qualquer mudança. **Esse é o piso de testes do projeto.** Para baixar mais, seria preciso migrar testes para `@WebMvcTest`/`@DataJpaTest`, que citam a classe testada.
- **Situação atual:** a branch `ci/testes-seletivos-valendo` liga a seleção de verdade nos PRs, mantendo a suíte completa nos pushes para `develop`, `staging` e `main` como rede de segurança.

---

## 3. jsoup — biblioteca acoplada

**Repositório:** https://github.com/jhy/jsoup

**Stack:** Java + Maven + JUnit 5. ~100 arquivos de código, 72 arquivos de teste (78 classes) e 2.251 testes.

**Suíte completa:** 134 s na primeira execução e 40-53 s depois, com o Maven aquecido (MEDIDO).

### Resultado nos últimos 11 commits (MEDIDO)

| Medida | Valor |
|---|---|
| Classes escolhidas | 67 a 71, de 74 a 78 (~9% a menos) |
| Tempo com a ferramenta | 155 a 188 s por commit (média ~174 s) |
| Tempo da suíte completa | ~45 s |
| Falhas | nenhuma |

### O que aprendemos

- **A ferramenta acertou ao escolher quase tudo.** No jsoup, todo teste passa pelo mesmo núcleo (parser e árvore de nós), e mudar o núcleo pode quebrar qualquer teste.
- **Suíte rápida + código acoplado = não compensa:** a análise custa mais do que a pouca economia que sobra.
- É o **contraexemplo**: o tipo de projeto em que a ferramenta não deve ser usada.
- A análise de mutantes começou mas foi interrompida, e não tem resultado.

---

## 4. Apache Commons Math — modular, mas com suíte rápida

**Repositório:** https://github.com/apache/commons-math

**Stack:** Java + Maven, vários módulos. A avaliação usou o módulo `commons-math-legacy`, que tem 564 arquivos de código e 310 classes de teste (~3.200 testes).

**Suíte completa do módulo:** 110 s na primeira execução e **84 s** depois (MEDIDO), com os plugins de verificação desligados (RAT, checkstyle, PMD, SpotBugs, japicmp, javadoc) nas duas medições, para comparar só testes.

**CI do projeto:** 4 a 7 min por job, em uma matriz de 3 sistemas × 3 versões do Java. A maior parte é build completo, verificações e javadoc, não testes: compilar e instalar tudo sem testes levou 304 s localmente.

### Resultado nos últimos 15 commits (MEDIDO)

| Commit | Arquivos | Classes escolhidas | Ferramenta | Testes | Total |
|---|---|---|---|---|---|
| 6df549558 | 2 | 18 de 310 | 57 s | 47 s | 104 s |
| 50ba7180e | 1 | **1** de 310 | 43 s | 40 s | 83 s |
| 208f64fcd | 2 | **1** de 310 | 47 s | 39 s | 86 s |
| be9a7b000 | 1 | 37 de 310 | 59 s | 69 s | 128 s |
| 95cda7581 | 3 | 21 de 310 | 48 s | 64 s | 112 s |
| 9c450d57c | 2 | 197 de 310 | 45 s | 88 s | 133 s |
| da3d79c0d | 1 | **4** de 310 | 45 s | 42 s | 87 s |
| 25c3ade21 | 2 | 236 de 310 | 42 s | 85 s | 127 s |
| b4b67d1fb | 2 | 63 de 310 | 42 s | 51 s | 93 s |
| 7f9061404 | 1 | 12 de 310 | 43 s | 61 s | 104 s |
| a6109b5d8 | 2 | **1** de 310 | 50 s | 65 s | 115 s |
| 8a940bfc5 | 2 | 200 de 310 | 45 s | 94 s | 139 s |
| fad211362 | 4 | 196 de 310 | 48 s | 90 s | 138 s |
| 2e251dd1b | 4 | 25 de 310 | 50 s | 89 s | 139 s |
| f0f0af135 | 2 | **1** de 310 | 54 s | 56 s | 110 s |
| **Média** | | **68 de 310** (mediana 21) | **48 s** | **65 s** | **113 s** |

### O que aprendemos

- **A seleção é boa:** 10 dos 15 commits escolheram menos de 15% das classes. Só 4 commits, que mexiam em código central (vetores e matrizes), puxaram ~2/3 da suíte.
- **O tempo não melhora,** por dois custos fixos:
  - ~48 s da ferramenta;
  - ~40 s do Maven, mesmo para rodar 1 classe. Dos 84 s da suíte completa, só ~44 s são testes de fato.
- **Esta avaliação levou à otimização do graphify** (seção 6): 48,6 s → 16,9 s neste projeto.
- 4 commits tiveram testes falhando. Pelo menos um é o otimizador aleatório (`SimplexOptimizerTest`), que falha às vezes sozinho. Os outros não foram investigados; uma hipótese é o código antigo ter sido testado contra os módulos irmãos da versão atual. A suíte completa não foi rodada nesses commits para comparar.

---

## 5. Bitwarden clients — Angular

**Repositório:** https://github.com/bitwarden/clients

**Stack:** monorepo Angular (web vault, extensão de navegador, desktop) + Jest, com ~40 bibliotecas em `libs/`. 6.752 arquivos TypeScript, 815 templates HTML e **1.500 arquivos de teste** (`.spec.ts`).

**CI do projeto:** os testes rodam em 5 grupos. O grupo "Libs" levou **19 min, dos quais 16,5 min só testes** ([run de referência](https://github.com/bitwarden/clients/actions/runs/39812000382)).

### Seleção nos últimos 15 commits (SIMULADO)

A ferramenta rodou em `--dry-run` com `--lang angular`, já com as correções desta seção.

| Commit | Arquivos | Resultado | O que decidiu |
|---|---|---|---|
| 49a6fabee4 | 1 (`.html`) | **518 de 1.500** (−65%) | regra de template |
| 1e4eef19bd | 7 | **520 de 1.500** (−65%) | template; o `.stories.ts` foi ignorado |
| 40a5d481f1 | 23 | suíte completa | traduções |
| 0ad8f11a67 | 1 | suíte completa | workflow do CI (correto) |
| 9904c0a193 | 6 | 1.114 de 1.497 (−26%) | código central |
| 16a22195c5 | 22 | suíte completa | traduções |
| 18d6d9f10c | 2 | suíte completa | `package.json` (correto) |
| 2e473d7133 | 5 | **70 de 1.496** (−95%) | — |
| 5b775536fd | 7 | **nenhum teste** | ver abaixo |
| 44b120f667 | 9 | **1 de 1.495** (−99,9%) | — |
| 589d8b50ef | 7 | suíte completa | `package.json` (correto) |
| 9a03963fa0 | 4 | **516 de 1.495** (−65%) | template; o `.stories.ts` foi ignorado |
| 162fc00f96 | 27 | suíte completa | traduções |
| ea6c9e20bc | 1 (`.html`) | **507 de 1.493** (−66%) | regra de template |
| 98b19b848b | 4 | **539 de 1.493** (−64%) | — |
| **Total** | | **12.765 de 22.444 (−43%)** | 8 seletivos, 1 sem testes, 6 suíte completa |

Das 6 vezes em que rodou tudo, 3 foram por dependências ou workflow do CI e 3 por traduções (`messages.json`), ambos de propósito.

**O commit sem testes (`5b775536fd`) foi conferido à mão.** Ele refatora três componentes do portal de provedores, e nenhum teste Jest os alcança, nem diretamente nem pelo módulo que os registra. Só os stories do Storybook os usam. O único teste com nome parecido (`members.component.spec.ts`) testa outro `MembersComponent`, de outra pasta. Ou seja, a seleção está certa: esse código não tem teste automatizado no projeto.

### Tempo medido no GitHub Actions (MEDIDO)

**Como:** um workflow num fork ([Pedronovaesdev/clients](https://github.com/Pedronovaesdev/clients), branch `medicao`, [run](https://github.com/Pedronovaesdev/clients/actions/runs/39848533926)) rodou os 15 commits nos mesmos 5 grupos do CI do Bitwarden, com o mesmo comando e as mesmas opções (`npm test -- <pastas> --coverage --maxWorkers=2 --workerIdleMemoryLimit=1500MiB`, `ubuntu-22.04`).

- Em cada job, na mesma máquina, rodou primeiro a suíte completa do grupo e depois só os testes escolhidos que caem nele.
- O cache do Jest foi limpo antes de cada execução, para nenhuma herdar a compilação da outra.
- O grafo veio de um cache montado antes, como num CI em uso.
- O tempo da seleção (uma vez por commit) entra no tempo da seletiva.

**Duas formas de contar:**
- **parede:** quanto o PR espera; os 5 grupos rodam em paralelo, então vale o mais lento;
- **máquina:** soma dos 5 grupos; é o que se paga em minutos de CI.

| Commit | Seleção | Completa (parede) | Com a ferramenta (parede) | Completa (máquina) | Com a ferramenta (máquina) |
|---|---|---|---|---|---|
| 49a6fabee4 | 33 s | 18m24s | **6m12s** | 27m03s | **13m42s** |
| 1e4eef19bd | 33 s | 15m03s | **5m27s** | 21m58s | **11m25s** |
| 40a5d481f1 | 22 s | 14m02s | 14m25s (suíte completa) | 21m39s | 22m10s |
| 0ad8f11a67 | 32 s | 19m45s | 20m05s (suíte completa) | 28m15s | 28m39s |
| 9904c0a193 | 33 s | 15m18s | 13m37s | 23m09s | 21m19s |
| 16a22195c5 | 31 s | 19m25s | 21m02s (suíte completa) | 27m55s | 29m42s |
| 18d6d9f10c | 25 s | 18m45s | 19m29s (suíte completa) | 26m07s | 26m50s |
| 2e473d7133 | 32 s | 18m20s | **1m41s** | 25m57s | **3m47s** |
| 5b775536fd | 16 s | 13m15s | **0m22s** | 19m29s | **0m28s** |
| 44b120f667 | 26 s | 15m10s | **0m48s** | 23m03s | **1m00s** |
| 589d8b50ef | 31 s | 11m52s | 12m19s (suíte completa) | 19m26s | 19m57s |
| 9a03963fa0 | 16 s | 11m34s | **4m07s** | 18m34s | **10m14s** |
| 162fc00f96 | 31 s | 12m12s | 12m29s (suíte completa) | 19m22s | 19m41s |
| ea6c9e20bc | 29 s | 16m53s | **6m10s** | 24m14s | **12m29s** |
| 98b19b848b | 29 s | 12m23s | **4m53s** | 19m47s | **11m14s** |
| **Total** | | **232 min** | **143 min (−38%)** | **346 min** | **233 min (−33%)** |

- **Nos 9 commits em que a ferramenta selecionou testes** (ou nenhum), o PR esperou de 0,4 a 13,6 min, contra 11,6 a 18,4 min com tudo. Em 4 deles, caiu de mais de 13 min para menos de 2 min.
- **Nos 6 que rodaram tudo** (dependências, workflow do CI, traduções), o custo extra foi de ~20 a 30 s, o tempo da seleção. A diferença maior em `16a22195c5` (+1,6 min) é variação entre execuções da suíte completa, não custo da ferramenta.
- **O tempo da ferramenta no Linux do CI** foi de 16 a 33 s por commit. No Windows local tinha sido ~2,4 min. O grafo do zero levou 100 s, contra 351 s no Windows.

### Problemas encontrados e corrigidos

1. **Bug no graphify: imports por apelido não eram resolvidos.**
   - **Situação:** o `tsconfig` do projeto diz `"extends": "../../tsconfig.base"`, sem `.json`.
   - **O bug:** o TypeScript completa o nome para `tsconfig.base.json`; o graphify só completa quando o nome não tem ponto. Assim ele lia 0 apelidos, e imports como `@bitwarden/common/platform/...` viravam um nó genérico do pacote.
   - **Efeito:** só **2%** desses imports viravam ligações (86 de 4.381). A ferramenta teria deixado de escolher testes afetados por mudanças em `libs/common`.
   - **Correção:** o wrapper do graphify completa o `.json` ao ler o `tsconfig`. Depois dela, **100%** (4.381 de 4.381), e o grafo passou de 155 mil para 198 mil ligações.
2. **Templates do Angular rodavam a suíte completa.** 13 de 30 commits recentes mexem em `.html`. Correção: nova regra `owned-file` e nova config `--lang angular`. Mudar `x.component.html`, `.scss`, `.css` ou `.less` conta como mudar `x.component.ts`.
3. **Stories do Storybook rodavam a suíte completa.** Ninguém importa um `.stories.ts` e o Jest não o executa. Correção: a config Angular passou a ignorá-los.
4. **Traduções (`messages.json`) continuam rodando a suíte completa, de propósito.** 3 testes leem esse arquivo diretamente, sem import, então não há como saber quais testes uma tradução afeta.

### O que aprendemos

- **A seleção estática depende do indexador resolver os imports.** Sem a conferência, o resultado teria parecido bom e seria inseguro. **Em cada projeto novo, é preciso conferir que os imports por apelido viram ligações no grafo.**
- Monorepos Angular têm arquivos fora do código TypeScript (templates, stories, traduções) que precisam de regra própria.

---

## 6. Melhorias feitas na ferramenta a partir das avaliações

| Melhoria | Motivo | Efeito medido |
|---|---|---|
| Cache da resolução de caminhos no graphify (`graphify-fast.py`) | o graphify consultava o caminho real de cada ligação do grafo, dezenas de vezes por arquivo | commons-math: 48,6 s → 16,9 s; monorepo da empresa: ~18 s → ~14 s; grafo idêntico byte a byte |
| Correção do `extends` do `tsconfig` | bug do graphify (seção 5) | imports por apelido: 2% → 100% resolvidos |
| Regra `owned-file` + `--lang angular` | templates e estilos do Angular rodavam tudo | template alterado roda só os testes de quem usa o componente |
| Herança só entre classes do projeto, marcador `@SpringBootTest` herdado | TransportEasy (seção 2) | PR real: 183 → 122 de 224, com 18 de 18 testes diretos |
| Storybook ignorado na config Angular | Bitwarden (seção 5) | 3 commits saíram da suíte completa |
| Polimorfismo só conta com consumidor real | apontado em revisão: mudar a implementação de uma interface que ninguém usa dava "nenhum teste" | agora roda a suíte completa (regra `no-dependents`); 4 testes de regressão, dos quais 2 falhavam no código antigo |

A ferramenta tem **68 testes automatizados** cobrindo essas regras.

---

## 7. Quando usar a ferramenta

A conta é sempre: **tempo da suíte × fração de testes evitados − custo fixo da ferramenta**.

| Perfil | Exemplo | Compensa? |
|---|---|---|
| Suíte de segundos | jsoup (45 s), commons-math (84 s) | ❌ o custo fixo come o ganho |
| Biblioteca muito acoplada | jsoup | ❌ quase todo teste é escolhido |
| Suíte de alguns minutos, com containers | TransportEasy (6,5 min) | ⚠️ depende do PR; o piso é o de testes de aplicação inteira |
| Suíte de dezenas de minutos, código modular | monorepo Cypress (30 min), Bitwarden (~23 min) | ✅ |

**Bons sinais num projeto:**
- o CI divide os testes em várias máquinas;
- há testes de interface (Cypress, Playwright) ou de integração com banco/Docker;
- o código é dividido em módulos, plugins ou bibliotecas independentes.

## 8. Candidatos avaliados só pelo CI

Estes não foram rodados, mas o CI deles foi analisado:

| Projeto | O que o CI mostra | Observação |
|---|---|---|
| [Apache Kafka](https://github.com/apache/kafka) | o passo de testes JUnit leva **131 min por versão do Java** ([run](https://github.com/apache/kafka/actions/runs/39755008719/job/119749560956)) | parte do código é Scala; a ligação Java↔Scala no grafo precisa ser verificada |
| [Twenty](https://github.com/twentyhq/twenty) | testes de integração divididos em **16 máquinas**, cada uma com Postgres, Redis e ClickHouse | o job de 31 min visto primeiro era CodeQL (segurança), não teste; os testes de integração chamam a API por GraphQL, como o `@SpringBootTest` |

## 9. Limitações e pendências

- **Segurança contra bugs reais:** a análise de mutantes (injetar bugs e ver se a seleção os pega) ficou pendente nos projetos open source. Nas demos, 5 de 5 bugs injetados foram pegos.
- **Tempo no CI:** nos projetos da empresa, o tempo seletivo é medido localmente ou projetado; falta a medição dentro do CI.
- **Tempo medido em CI:** só no Bitwarden. Nos projetos da empresa, o tempo seletivo ainda é medido localmente ou projetado.
- **Testes que chamam a aplicação por URL/HTTP** (`@SpringBootTest`, testes de integração GraphQL) não têm ligação no código com o que testam. A ferramenta os roda sempre, e isso define o piso de economia.
