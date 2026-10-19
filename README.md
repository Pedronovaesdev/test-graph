# test-graph-selector

Seleção **determinística** de testes: a partir de um diff do Git, descobre quais
arquivos, símbolos e testes foram afetados (análise AST + grafo de dependências)
e executa **somente os testes relacionados**, explicando a cadeia que levou a
cada um. Sem IA no núcleo: mesma entrada, mesma saída, byte a byte.

- Linguagens validadas (cada uma com projeto demo, `compare.sh` e prova de segurança):

  | `--lang` | Linguagem | Testes / build |
  |---|---|---|
  | `typescript` | TypeScript / JavaScript (principal) | Jest |
  | `vitest` | TypeScript / JavaScript (Next.js, Vite) | Vitest |
  | `java` | Java | JUnit 5 + Maven |
  | `java-gradle` | Java | JUnit 5 + Gradle (wrapper `./gradlew`) |
  | `python` | Python | pytest |
  | `java-gradle` | Spring Boot (demo `spring`) | JUnit 5 + Gradle + `@SpringBootTest`/`@WebMvcTest` |

- O seletor é escrito em **TypeScript** (`selector/`) e testado com **Jest**.
- A CLI de pipeline é um **Shell Script** (`select-tests.sh`).
- Integração pronta com **GitHub Actions** (`.github/workflows/selective-tests.yml`).

> Explicação completa do sistema (cada pasta, cada arquivo, o CI e os limites):
> [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

```text
$ ./select-tests.sh --project demo/ts-project --base HEAD~1 --head HEAD
SELETIVO: 3 de 6 testes (50% economizado)

Testes selecionados e por que:
  * tests/barrel.test.ts
      tests/barrel.test.ts --importa--> add() [alterado em src/utils/math.ts]
  * tests/cart.test.ts
      tests/cart.test.ts --importa--> src/services/cart.ts --importa--> src/utils/math.ts [alterado em src/utils/math.ts]
  * tests/math.test.ts
      tests/math.test.ts --importa--> src/utils/math.ts [alterado em src/utils/math.ts]

Comando: npx jest --ci --passWithNoTests --runTestsByPath tests/barrel.test.ts tests/cart.test.ts tests/math.test.ts
```

## Como funciona

```text
 git diff base...head          graphify extract (AST)          selector (TypeScript)
┌────────────────────┐        ┌────────────────────┐        ┌──────────────────────────┐
│ A/M/D/R + caminhos │──┐     │ graph.json do head │──┐     │ 1. regras de segurança   │
└────────────────────┘  │     │ (+ do base, se há  │  ├────▶│ 2. sementes = nós dos    │
                        └────▶│  remoção/renomeio) │  │     │    arquivos alterados    │
                              └────────────────────┘  │     │ 3. BFS reversa sem limite│
                                                      │     │ 4. filtra nós de teste   │
                                                      │     │ 5. relatório + comando   │
                                                      │     └────────────┬─────────────┘
                                                      │                  ▼
                                                      │     npx jest --runTestsByPath ...
                                                      │     mvn test -Dtest=...
```

1. **Diff** (`selector/src/diff.ts`): `git diff --name-status -z -M base...head`.
   Renomeação traz os dois caminhos; remoção é tratada como tal.
2. **Grafo** (indexador externo): `graphify extract <projeto> --no-cluster` gera
   `graphify-out/graph.json` com nós (arquivos, classes, funções, métodos) e
   arestas (`imports`, `calls`, `inherits`, `implements`, `contains`, `method`...).
   Uma aresta `A → B` significa **"A depende de B"**. O grafo é sempre do commit
   analisado; quando o diff remove ou renomeia arquivos, o script também indexa
   o merge-base (via `git worktree`) e as duas buscas são unidas.
3. **Regras** (`selector/src/rules.ts`): decidem, arquivo a arquivo, se a mudança
   vira semente da busca, seleção direta, suíte completa ou nada. Ver
   [Regras de segurança](#regras-de-segurança).
4. **Busca reversa** (`selector/src/graph.ts`): BFS seguindo arestas de entrada
   ("quem depende de mim"), **sem limite de profundidade**, a partir de
   **várias sementes**, guardando o pai de cada nó para reconstruir a cadeia
   completa. A consulta no sentido direto ("de quem eu dependo") também é exposta.
5. **Seleção + relatório** (`selector/src/engine.ts`, `report.ts`): nós cujo
   arquivo é de teste viram testes selecionados; o relatório sai em texto (log do
   CI), JSON (máquina) e Markdown (Job Summary / comentário de PR).

### Por que não usar o `graphify affected`

O graphify tem um comando de impacto, mas ele aceita uma semente só, para na
profundidade 2 por padrão (corta cadeias como `add() → Cart.total() → cart.ts →
cart.test.ts`) e não devolve o caminho. Por isso o graphify é usado **apenas como
indexador AST**; diff, busca, regras, seleção, relatório, shell e CI são código
deste repositório.

### Por que `--no-cluster`

No modo padrão o graphify guarda o grafo como não-direcionado internamente e
colapsa arestas opostas entre o mesmo par de nós: num ciclo de import `a.ts ↔ b.ts`
uma das direções some. Com `--no-cluster` ele grava a extração crua (chave `edges`),
direcionada e sem esse colapso. Verificado na v0.9.90: é um superconjunto das
arestas do modo padrão e é byte a byte determinístico.

## Instalação

Requisitos: **Git**, **Node.js 18+**, **Python 3.10+** (para o indexador) e o
toolchain do projeto testado: Node/Jest, Java 17+ com Maven (Gradle vem pelo
wrapper `./gradlew`) ou Python com pytest.

```bash
pip install -r requirements.txt          # graphifyy==0.9.90 (indexador AST)
(cd selector && npm ci && npm run build) # seletor (o script compila sozinho se faltar)
```

Variáveis opcionais: `GRAPHIFY` (caminho do executável do indexador),
`NODE`, `FULL_SUITE_COMMAND` (sobrescreve o comando de suíte completa).

## Uso

```bash
./select-tests.sh --base origin/main --head HEAD \
  [--project DIR] [--lang typescript|java] [--dry-run] [--format text|json|md] [--out-dir DIR]
```

| Opção | Padrão | Descrição |
|---|---|---|
| `--base` | (obrigatório) | Commit/branch de comparação. O diff é `base...head` (desde o merge-base). |
| `--head` | `HEAD` | Commit analisado. Se for o checkout atual, indexa no lugar; senão usa um worktree. |
| `--project` | `.` | Diretório do projeto (pode ser um subdiretório do repo, ex.: monorepo). |
| `--lang` | autodetecta | `package.json` + `vitest.config.*` → `vitest`; `package.json` → `typescript`; `pom.xml` → `java`; `build.gradle(.kts)` → `java-gradle`; `pyproject.toml`/`setup.py`/`pytest.ini` → `python`. |
| `--dry-run` | — | Só seleciona e explica; não executa testes. |
| `--format` | `text` | Formato impresso no stdout. Os três ficam em `--out-dir`. |
| `--out-dir` | `<projeto>/.selector-out` | `report.{txt,json,md}`, `selected-tests.txt`, `command.txt`, `mode.txt`. |

**Códigos de saída:** `0` testes passaram (ou nada a rodar) · `1` testes falharam ·
`2` erro da ferramenta sem como testar (ex.: `--dry-run`, argumento inválido).
Se a seleção falhar por qualquer motivo (indexador ausente, grafo inválido, erro
do seletor), o script **cai para a suíte completa**: erro da ferramenta nunca
significa testes pulados.

Consultar o grafo diretamente (nos dois sentidos):

```bash
node selector/dist/cli.js query --graph demo/ts-project/graphify-out/graph.json add --transitive
node selector/dist/cli.js query --graph demo/ts-project/graphify-out/graph.json Cart.total --direction dependencies
```

### No CI de qualquer repositório (GitHub Action)

O jeito mais simples. Este repositório é também uma GitHub Action
(`action.yml` na raiz). Em outro repositório:

```yaml
on: [pull_request]

jobs:
  testes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0                       # obrigatório
      - uses: actions/setup-node@v4            # a Action usa o Node do runner
        with: { node-version: "20" }
      - run: npm ci                            # dependências do SEU projeto
      - uses: Pedronovaesdev/test-graph@v1
        with:
          dry-run: true                        # comece só observando
```

A Action instala o graphify num venv próprio, compila o seletor, calcula a base
(base do PR, ou o commit anterior ao push) e roda `select-tests.sh`. O relatório
vai para o Job Summary.

| Entrada | Padrão | Descrição |
|---|---|---|
| `base` | automático | commit de comparação |
| `head` | `HEAD` | commit analisado |
| `project` | `.` | pasta do projeto (monorepo) |
| `lang` | detecta | `typescript`, `vitest`, `java`, `java-gradle`, `python` |
| `dry-run` | `false` | `true` = só seleciona e explica |
| `graphify-version` | `0.9.90` | versão do indexador |
| `cache` | `true` | guarda o cache do graphify entre execuções (só os arquivos alterados são relidos) |

Saídas: `mode` (`selective`, `full`, `none` ou `fail-safe`), `selected`, `total`,
`report` (caminho do `report.json`). O workflow `action-selftest.yml` testa a
Action neste repositório com `uses: ./`.

**Publicar uma versão da Action:** `git tag v1.0.0 && git tag -f v1 && git push origin v1.0.0 && git push -f origin v1`.
O `@v1` sempre aponta para a última versão 1.x.

### No CI do seu projeto (pacote npm)

A ferramenta é publicada como pacote npm (`selector/` é o pacote, ~21 kB). O CI do
seu projeto não precisa deste repositório:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: actions/setup-node@v4
  with: { node-version: "20" }
- uses: actions/setup-python@v5
  with: { python-version: "3.12" }
- run: pip install graphifyy==0.9.90 && npm install -g test-graph-selector@1
- run: npm ci   # (ou setup-java / pip install, conforme o projeto)
- run: select-tests --base "origin/${{ github.base_ref || 'main' }}" --head HEAD
```

**Publicar uma versão:** crie o secret `NPM_TOKEN` no GitHub (token *Automation*
do npmjs.com) e rode:

```bash
cd selector && npm version 1.0.1 --no-git-tag-version && cd ..
git commit -am "v1.0.1" && git tag v1.0.1 && git push --follow-tags
```

Depois, na aba *Actions* → **Release (npm)** → *Run workflow*, escolha a tag. A
publicação é manual de propósito: as tags também versionam a GitHub Action, e
criar uma tag não publica nada no npm sozinha. O workflow confere se a tag bate
com o `package.json`, roda os testes e publica. Para testar o pacote sem publicar:
`cd selector && npm pack` gera o `.tgz`, e `npm install -g ./test-graph-selector-1.0.0.tgz` o instala.

### Na pipeline deste repositório (GitHub Actions)

`.github/workflows/selective-tests.yml` tem quatro jobs:

- `tool-tests`: testes Jest do próprio seletor.
- `full-suite`: suíte completa dos projetos demo (referência), medindo tempo.
- `selective`: `select-tests.sh` nos mesmos projetos, com a explicação no Job Summary.
- `compare`: tabela completo × seletivo no Job Summary.

Pontos importantes para reaproveitar em outro repo:

- `actions/checkout` com `fetch-depth: 0` (sem histórico o diff falha).
- Base do diff: `github.event.pull_request.base.sha` em PR, `github.event.before` em push
  (com fallback para `HEAD~1` em branch nova).
- `actions/cache` em `graphify-out/` com chave por SO + versão do graphify e
  `restore-keys` amplas. O cache é por conteúdo de arquivo; o grafo é sempre
  regerado para o commit analisado.

Para GitLab CI / Bitbucket o passo é o mesmo: clone completo + `./select-tests.sh
--base "$CI_MERGE_REQUEST_DIFF_BASE_SHA" --head HEAD`.

## Regras de segurança

Princípio: **na dúvida, roda mais**. Cada regra disparada aparece no relatório.

| Regra | Quando | Efeito |
|---|---|---|
| `global-config` | `.github/workflows/**` (caminho a partir da raiz do repo) | suíte completa |
| `build-config` | `package.json`, lockfiles, `jest.config.*`, `tsconfig*.json`, `.env*`, `pom.xml`, `build.gradle*`, `src/*/resources/**`... | suíte completa |
| `source-not-in-graph` | arquivo de código que o indexador não modelou | suíte completa |
| `unclassified-file` | arquivo fora do grafo e de qualquer regra (asset, dado...) | suíte completa |
| `no-dependents` | código **modificado** que está no grafo, mas que nenhum outro arquivo usa (indexador perdeu as setas, ou só o framework usa: bean com `@EventListener`/`@Scheduled`) | suíte completa |
| `no-base-graph` | remoção/renomeação sem grafo do base disponível | suíte completa |
| `data-file` | `__snapshots__/`, `*.snap`, `fixtures/`, `__fixtures__/`, `__mocks__/` | testes do diretório dono da pasta (e subdiretórios) |
| `data-file-no-tests` | snapshot/fixture sem nenhum teste nesse diretório | suíte completa |
| `changed-test` | teste alterado ou adicionado | sempre selecionado |
| `deleted-test` | teste removido | nada a rodar por ele |
| `docs-only` | `*.md`, `*.rst`, `docs/**`, `LICENSE`, `.gitignore`... | nenhum teste |
| `outside-project` | arquivo fora de `--project` | ignorado |
| `graph-seed` | arquivo presente no grafo | semente da busca reversa |
| `always-run` | teste que usa um `always_run_markers` (ex.: `@SpringBootTest`), quando algum código de produção muda | selecionado sempre |

Snapshots e fixtures: a escolha foi rodar **os testes do diretório que contém a
pasta de dados** (ex.: `tests/ui/__snapshots__/x.snap` → todos os testes em
`tests/ui/`). É mais barato que a suíte completa e cobre a convenção do Jest
(snapshot ao lado do teste). Se não houver teste ali, cai para a suíte completa.

Seleção vazia (ex.: só documentação) é **sucesso**, com a mensagem "nenhum teste
afetado". O comando Jest gerado inclui `--passWithNoTests` por segurança.

## Demonstração

```bash
bash demo/compare.sh typescript     # ou java, java-gradle, python, spring
bash demo/prove-safety.sh typescript
```

`compare.sh` cria um repositório descartável em `demo/.work/<lang>` a partir do
projeto demo, faz um commit por cenário e, para cada um, mede a suíte completa e
o `select-tests.sh` contra o commit anterior.

O projeto TS (`demo/ts-project`) tem barrel `src/index.ts` com `export *`, alias
`@/` (tsconfig + `moduleNameMapper`), um teste com `jest.mock` + `require()` e a
cadeia indireta `add() → Cart.total() → cart.ts → cart.test.ts`. Resultado
esperado (e verificado):

| Mudança | Testes selecionados |
|---|---|
| `add()` em `src/utils/math.ts` | `math`, `cart`, `barrel` |
| `money()` em `src/utils/money.ts` | `alias`, `cart` |
| `User` em `src/services/user.ts` | `user`, `mock`, `barrel` (o `barrel` é sobresseleção, ver limites) |
| só `README.md` | nenhum |
| renomear `notifier.ts` (+ import no teste) | `mock` (via grafo do base + teste alterado) |
| `package.json` | suíte completa |

Resultado medido localmente (Windows 11, Node 24, Java 24, Python 3.11):

#### Suite completa vs seletiva (typescript)

| Commit | Modo | Testes (seletivo / total) | Tempo completo | Tempo seletivo | Regras |
|---|---|---|---|---|---|
| muda add() | selective | 3 / 6 | 19.9s | 19.0s | graph-seed |
| muda money() | selective | 2 / 6 | 16.8s | 17.8s | graph-seed |
| muda User | selective | 3 / 6 | 17.4s | 19.3s | graph-seed |
| so documentacao | none | 0 / 6 | 14.7s | 6.1s | docs-only |
| renomeia notifier.ts | selective | 1 / 6 | 17.0s | 19.7s | changed-test, graph-seed |
| muda package.json | full | 6 / 6 | 15.0s | 22.5s | build-config |

Total: completo 101s, seletivo 104s (o seletivo inclui indexacao AST + selecao).

#### Suite completa vs seletiva (java)

| Commit | Modo | Testes (seletivo / total) | Tempo completo | Tempo seletivo | Regras |
|---|---|---|---|---|---|
| muda MathUtils.add() | selective | 4 / 5 | 18.8s | 20.9s | graph-seed |
| muda Money.format() | selective | 3 / 5 | 14.2s | 19.3s | graph-seed |
| muda EmailNotifier (DI) | selective | 1 / 5 | 14.1s | 20.1s | graph-seed |
| so documentacao | none | 0 / 5 | 11.3s | 6.2s | docs-only |
| muda pom.xml | full | 5 / 5 | 11.9s | 18.1s | build-config |

Total: completo 70s, seletivo 84s (o seletivo inclui indexacao AST + selecao).

**Sobre o tempo:** nestes demos, de propósito pequenos (5 a 6 arquivos de teste), o
seletivo **não** fica mais rápido. O custo fixo de subir Jest/ts-jest ou Maven e de
indexar com o graphify (~5–7s) domina quando a suíte inteira leva ~15–25s. O ganho
vem da fração de testes evitada (aqui 17%–100% por commit), e só vira tempo de
pipeline quando a suíte é maior que esse custo fixo. Os demos servem para provar a
**correção** da seleção, não a economia de tempo.

**Prova de segurança** (`prove-safety.sh`): injeta `return a - b` em `add()`,
commita e roda `select-tests.sh`. Os testes selecionados falham (`cart.test.ts`
inclusive, pela cadeia indireta) e o script sai com `1`: o bug não passa.

O projeto Java (`demo/java-project`) valida a adaptação: chamada estática por
import com `*` (`com.example.shop.util.*`), classe do mesmo pacote sem import,
herança (`DiscountCart extends Cart`), interface + injeção por construtor
(`Checkout(Notifier)` recebendo `EmailNotifier`). O `demo/java-gradle-project` tem
exatamente as mesmas classes, mas com Gradle: a seleção sai igual e só o comando
muda (`./gradlew test --tests CartTest --tests MoneyTest`).

#### Suite completa vs seletiva (java-gradle)

| Commit | Modo | Testes (seletivo / total) | Tempo completo | Tempo seletivo | Regras |
|---|---|---|---|---|---|
| muda MathUtils.add() | selective | 4 / 5 | 7.7s | 14.0s | graph-seed |
| muda Money.format() | selective | 3 / 5 | 6.8s | 13.4s | graph-seed |
| muda EmailNotifier (DI) | selective | 1 / 5 | 8.9s | 14.5s | graph-seed |
| so documentacao | none | 0 / 5 | 6.9s | 6.1s | docs-only |
| muda build.gradle | full | 5 / 5 | 6.9s | 13.1s | build-config |

Total: completo 37s, seletivo 61s (o seletivo inclui indexacao AST + selecao).

O projeto Python (`demo/python-project`) cobre os casos difíceis do Python:
`app/__init__.py` reexportando (barrel), import absoluto e relativo
(`from ..utils.money import money`), herança (`Admin(User)`), `mock.patch` com o
alvo em texto e, o mais importante, **fixture do pytest**: `test_cart.py` recebe
`cart` do `tests/cart/conftest.py` por injeção, sem importar nada. Não existe nenhuma seta
de `test_cart.py` para o código. Por isso o `python.yml` declara
`scope_files: ["**/conftest.py"]`: quando a busca alcança um `conftest.py`, todos
os testes da pasta dele (`tests/cart/`) entram, com a explicação
`tests/cart/test_cart.py --usa fixtures de--> tests/cart/conftest.py --importa--> app/services/cart.py`.

#### Suite completa vs seletiva (python)

| Commit | Modo | Testes (seletivo / total) | Tempo completo | Tempo seletivo | Regras |
|---|---|---|---|---|---|
| muda add() | selective | 3 / 6 | 3.5s | 15.1s | graph-seed |
| muda money() | selective | 2 / 6 | 3.5s | 14.9s | graph-seed |
| muda Cart (fixture do conftest) | selective | 1 / 6 | 3.0s | 12.2s | graph-seed |
| muda User | selective | 3 / 6 | 3.1s | 8.4s | graph-seed |
| so documentacao | none | 0 / 6 | 2.8s | 5.1s | docs-only |
| muda pyproject.toml | full | 6 / 6 | 2.8s | 8.3s | build-config |

Total: completo 19s, seletivo 64s (o seletivo inclui indexacao AST + selecao).

Na prova de segurança do Python, o bug em `add()` foi pego por
`tests/cart/test_cart.py`, que **só** é alcançado pela fixture do `conftest.py`.
Sem a regra `scope_files`, esse teste não seria selecionado.

### Spring Boot

O `demo/spring-project` (Spring Boot 3.5 + Gradle, `--lang java-gradle`) cobre:
injeção por construtor, `@Autowired` em campo, interface com `@Service` que a
implementa, `@WebMvcTest(CartController.class)` com `@MockitoBean`, e um
`@SpringBootTest` que chama a API **pela URL** (`mvc.perform(get("/cart/total"))`)
sem citar nenhuma classe do app.

Esse último não tem nenhuma seta no AST até o controller. Por isso o
`java.yml`/`java-gradle.yml` declara `always_run_markers: [SpringBootTest]`: testes
com essa anotação rodam sempre que algum código de produção muda. Eles sobem a
aplicação inteira, então de fato dependem de tudo. `@WebMvcTest(X.class)` e
`@MockitoBean X` não precisam disso, porque citam a classe.

#### Suite completa vs seletiva (spring)

| Commit | Modo | Testes (seletivo / total) | Tempo completo | Tempo seletivo | Regras |
|---|---|---|---|---|---|
| muda DefaultPriceService (impl. da interface) | selective | 4 / 5 | 23.7s | 26.0s | always-run, graph-seed |
| muda Clock (@Autowired em campo) | full | 5 / 5 | 19.1s | 27.3s | no-dependents |
| muda CartController | selective | 3 / 5 | 17.1s | 22.9s | always-run, graph-seed |
| muda so um teste | selective | 1 / 5 | 18.2s | 13.9s | changed-test |
| so documentacao | none | 0 / 5 | 16.6s | 5.4s | docs-only |
| muda application.properties | full | 5 / 5 | 15.0s | 21.2s | build-config |

Total: completo 109s, seletivo 116s (o seletivo inclui indexacao AST + selecao).

Na prova de segurança do Spring, o bug em `DefaultPriceService` foi pego pelo teste
unitário **e** pelo `ApiIntegrationTest` (selecionado pela regra `always-run`).
O cenário `muda Clock` caiu na suíte completa pela regra `no-dependents`: o
graphify não resolve a classe `Clock` (ver limites), e sem essa regra o resultado
seria "nenhum teste afetado".

## Limites conhecidos

- **Granularidade por arquivo.** O graphify registra só a linha **inicial** de cada
  símbolo (`source_location: "L5"`), sem linha final, então não dá para mapear um
  trecho do diff para a função alterada: todo símbolo de um arquivo alterado vira
  semente. Melhoria futura: adicionar `end_line` no extrator e cruzar com os hunks
  do diff.
- **Sobresseleção por barrels/reexports.** Quem importa `src/index.ts` depende de
  tudo que ele reexporta. Mudar `User` seleciona `barrel.test.ts` mesmo que o
  teste só use `add()`.
- **Imports dinâmicos montados em runtime** (`import(\`./plugins/${name}\`)`,
  `require(variavel)`) não aparecem no AST. Mitigação: manter esses módulos sob uma
  regra `full_suite_patterns` ou `data_patterns`.
- **Classes com nome igual ao de uma classe do JDK** (verificado com `Clock`, que
  colide com `java.time.Clock`) não têm as referências resolvidas pelo graphify: o
  campo `@Autowired private Clock clock` não gera seta. A regra `no-dependents`
  pega esse caso (código modificado sem nenhum dependente → suíte completa), mas
  só quando **ninguém** mais aponta para o arquivo.
- **`@SpringBootTest` é sobresseleção proposital**: roda com qualquer mudança de
  código, inclusive os que sobem só uma fatia (`classes = {...}`).
- **DI/reflexão em Java.** Interfaces são tratadas de forma conservadora
  (`polymorphic_relations` em `java.yml`: mudar uma implementação alcança quem usa
  a interface, e também as outras implementações, o que é sobresseleção). Bean
  resolvido por nome, `Class.forName`, configuração XML do Spring ou proxies não
  são visíveis no AST.
- **Config, assets e variáveis de ambiente** não aparecem como dependência no AST;
  por isso caem nas regras de suíte completa (`build-config`, `unclassified-file`).
- **Import com `*` em Java** vira um nó externo (`util`) no grafo; as chamadas
  ainda são resolvidas (`Cart.total() → MathUtils.add()`), mas um arquivo que use
  um tipo do pacote sem chamá-lo pode não ganhar aresta.
- **Fixtures do pytest** são injetadas por nome, sem import. A regra `scope_files`
  (conftest.py) cobre o caso comum, mas é sobresseleção: entra todo teste da pasta,
  use ele a fixture ou não. Fixtures vindas de plugins (`pytest_plugins`,
  entry points) não são vistas.
- **`mock.patch("pacote.modulo.Classe")`** usa o alvo como texto: o AST não liga o
  teste ao módulo pelo patch. Em geral o teste também importa o módulo e a seta
  existe por esse import; se não importar, o teste não é selecionado.
- **Testes como arquivo.** `describe/it/test()` não viram nós no graphify; o teste
  é reconhecido pelo caminho (`test_patterns`) e selecionado por arquivo inteiro
  (Jest) ou por classe (JUnit).
- **Head = checkout atual** é indexado no lugar, então mudanças não commitadas no
  working tree entram no grafo do head (mas não no diff). Na pipeline o checkout
  é limpo.

## Adaptar para outra linguagem

O grafo já vem no mesmo formato para as 30+ linguagens que o graphify suporta (Go,
Python, Kotlin, C#...). Basta criar `selector/languages/<lang>.yml`:

```yaml
name: go
source_patterns: ["**/*.go"]
test_patterns: ["**/*_test.go"]
full_suite_patterns: ["go.mod", "go.sum"]
data_patterns: ["**/testdata/**"]
command: "go test {each_file:./%s}"
full_command: "go test ./..."
```

e rodar `./select-tests.sh --lang go ...`. Nenhum código muda. (Exemplo
ilustrativo: Go não foi testado.)

Campos do YAML:

| Campo | Para que serve |
|---|---|
| `source_patterns` | O que é código. Código fora do grafo → suíte completa. |
| `test_patterns` | O que é arquivo de teste. |
| `full_suite_patterns` | Mudou isso → suíte completa (build, lockfile, config). |
| `data_patterns` | Snapshot/fixture/conftest → testes da mesma pasta. |
| `scope_files` | Arquivo que vale para a pasta inteira sem import (ex.: `conftest.py`). Se a busca o alcança, todos os testes da pasta entram. |
| `polymorphic_relations` | Relações seguidas também no sentido direto (interface/herança). |
| `always_run_markers` | Anotações/símbolos que marcam testes de aplicação inteira (ex.: `SpringBootTest`): rodam com qualquer mudança de código de produção. |
| `ignore_patterns` | Opcional. Padrão: documentação (`*.md`, `docs/**`...). |
| `command` / `full_command` | Comandos de teste. Marcadores: `{files}` (caminhos separados por espaço), `{classes}` (nomes de classe separados por vírgula), `{each_file:TPL}` / `{each_class:TPL}` (repete `TPL` trocando `%s`, ex.: Gradle `{each_class:--tests %s}`). |

Os quatro YAMLs reais estão em [selector/languages/](selector/languages/).

### Trocar o indexador

O seletor depende **só do formato do `graph.json`**, não do graphify. Qualquer
indexador (CocoIndex, um parser próprio com `ts-morph` ou JavaParser...) serve se
gravar:

```json
{
  "nodes": [{ "id": "src_utils_math_add", "label": "add()", "source_file": "src/utils/math.ts", "source_location": "L1" }],
  "edges": [{ "source": "src_services_cart", "target": "src_utils_math_add", "relation": "imports",
              "source_file": "src/services/cart.ts", "source_location": "L1" }]
}
```

com `source` dependendo de `target`, `source_file` relativo ao projeto, um nó por
arquivo (label = nome do arquivo) e `contains`/`method` ligando arquivo → símbolo
e classe → método. A chave de arestas pode ser `edges` ou `links`. Para trocar,
altere só a função `build_graph` em `select-tests.sh`.

## Estrutura

```text
select-tests.sh                 atalho para selector/bin/select-tests.sh
selector/                       pacote npm `test-graph-selector` (TypeScript + Jest)
  bin/select-tests.sh           CLI de pipeline (Shell): o comando `select-tests`
  src/diff.ts                   leitor de diff do Git
  src/graph.ts                  grafo + BFS reversa / consulta direta
  src/rules.ts                  regras de segurança
  src/engine.ts                 motor de seleção (head + base)
  src/report.ts                 explicação: texto, JSON, Markdown
  src/cli.ts                    subcomandos: select, needs-base, query, full-command
  languages/{typescript,java,java-gradle,python}.yml
  tests/                        testes unitários (grafos montados à mão)
demo/
  ts-project/                   demo principal (TypeScript + Jest)
  java-project/                 adaptação (Java + JUnit 5 + Maven)
  java-gradle-project/          mesmas classes, com Gradle (wrapper incluído)
  python-project/               adaptação (Python + pytest)
  spring-project/               Spring Boot 3.5 + Gradle
  compare.sh                    completo × seletivo em N commits
  prove-safety.sh               bug injetado é pego por um teste selecionado
.github/workflows/selective-tests.yml
.github/workflows/release.yml   publica no npm (disparo manual)
.github/workflows/action-selftest.yml  testa a GitHub Action com uses: ./
action.yml                      a GitHub Action (uses: Pedronovaesdev/test-graph@v1)
requirements.txt                indexador AST (graphifyy==0.9.90)
legacy/                         implementação anterior (motor Java/JGraphT), não usada
```

## Créditos

- [graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0), usado sem
  modificação, apenas como indexador AST (tree-sitter). Nenhum código dele foi
  copiado.
- Diff, busca, regras, seleção, relatório, shell e CI são deste repositório.
