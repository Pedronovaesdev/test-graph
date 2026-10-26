# Arquitetura do test-graph-selector

Este documento explica o sistema inteiro: o problema, cada pasta, cada arquivo de
código, como uma execução acontece do início ao fim, como o CI funciona e quais
são os limites. Pode ser lido do começo ao fim por quem nunca viu o projeto.

**Sumário**

1. [O problema e a ideia](#1-o-problema-e-a-ideia)
2. [Mapa das pastas](#2-mapa-das-pastas)
3. [Uma execução, do início ao fim](#3-uma-execução-do-início-ao-fim)
4. [O grafo de dependências](#4-o-grafo-de-dependências)
5. [Cada arquivo do código](#5-cada-arquivo-do-código)
6. [Regras de segurança](#6-regras-de-segurança)
7. [Regras especiais por linguagem](#7-regras-especiais-por-linguagem)
8. [Testes da própria ferramenta](#8-testes-da-própria-ferramenta)
9. [Projetos de demonstração](#9-projetos-de-demonstração)
10. [Como o CI funciona](#10-como-o-ci-funciona)
11. [O pacote npm](#11-o-pacote-npm)
12. [Garantias e limites](#12-garantias-e-limites)
13. [Como estender](#13-como-estender)
14. [Glossário](#14-glossário)

---

## 1. O problema e a ideia

Num projeto grande, rodar **todos** os testes a cada commit é lento. Na maioria das
vezes um commit mexe em poucos arquivos, e só os testes ligados a eles podem
quebrar.

A ferramenta responde: **"dado este diff, quais testes podem ter sido afetados?"**
E roda só esses, explicando o motivo de cada um.

A ideia central é tratar o código como uma rede de peças que dependem umas das
outras:

```text
math.test.ts ──usa──▶ math.ts
cart.test.ts ──usa──▶ cart.ts ──usa──▶ math.ts
user.test.ts ──usa──▶ user.ts
```

Se `math.ts` mudou, basta seguir as setas **ao contrário** a partir dele:

- `math.ts` ← `math.test.ts` → **roda**
- `math.ts` ← `cart.ts` ← `cart.test.ts` → **roda**
- `user.test.ts` não tem caminho até `math.ts` → **não roda**

Três princípios guiam o projeto:

| Princípio | O que significa na prática |
|---|---|
| **Determinístico** | Sem IA, sem aleatoriedade, sem data/hora no relatório. A mesma entrada gera a mesma saída, letra por letra. |
| **Na dúvida, roda mais** | Toda mudança que o grafo não consegue explicar (config, lockfile, arquivo desconhecido) leva à suíte completa. Rodar teste a mais custa tempo; deixar de rodar deixa bug passar. |
| **Explicável** | Cada teste escolhido vem com a cadeia completa que levou até ele. |

---

## 2. Mapa das pastas

```text
test-graph-selector/
├── select-tests.sh                 atalho: chama selector/bin/select-tests.sh
├── requirements.txt                única dependência Python: graphifyy==0.9.90
├── ci/gitlab/                      GitLab CI: template (.test-graph-selector) + run.sh do job
├── README.md                       documentação de uso
│
├── selector/                       A FERRAMENTA (é também o pacote npm)
│   ├── bin/select-tests.sh         CLI em Shell: orquestra tudo
│   ├── src/                        núcleo em TypeScript
│   │   ├── cli.ts                  porta de entrada do TypeScript (subcomandos)
│   │   ├── diff.ts                 pergunta ao Git o que mudou
│   │   ├── languages.ts            lê o .yml de cada linguagem
│   │   ├── graph.ts                carrega o grafo e anda nas setas
│   │   ├── rules.ts                regras de segurança, arquivo a arquivo
│   │   ├── engine.ts               junta tudo e decide os testes
│   │   └── report.ts               escreve a explicação (texto, JSON, Markdown)
│   ├── languages/                  o que muda entre linguagens
│   │   ├── typescript.yml          TypeScript/JavaScript + Jest
│   │   ├── vitest.yml              TypeScript/JavaScript + Vitest (Next.js, Vite)
│   │   ├── java.yml                Java + JUnit + Maven
│   │   ├── java-gradle.yml         Java + JUnit + Gradle (inclui Spring)
│   │   └── python.yml              Python + pytest
│   ├── tests/                      testes Jest da ferramenta (46)
│   ├── dist/cli.js                 seletor empacotado pelo esbuild (versionado)
│   ├── package.json                configuração do pacote npm
│   └── README.md                   página do pacote no npm
│
├── demo/                           PROJETOS DE DEMONSTRAÇÃO
│   ├── ts-project/                 TypeScript + Jest
│   ├── java-project/               Java + Maven
│   ├── java-gradle-project/        Java + Gradle (mesmas classes do Maven)
│   ├── python-project/             Python + pytest
│   ├── spring-project/             Spring Boot 3.5 + Gradle
│   ├── lib.sh                      funções comuns dos scripts de demo
│   ├── compare.sh                  suíte completa × seletiva, commit a commit
│   ├── prove-safety.sh             injeta um bug e prova que é pego
│   └── .work/                      cópias descartáveis criadas pelos scripts (fora do Git)
│
├── .github/workflows/
│   ├── selective-tests.yml         CI: testa a ferramenta e os 5 demos
│   ├── release.yml                 publica o pacote no npm (disparo manual)
│   └── action-selftest.yml         testa a GitHub Action (uses: ./) e o run.sh do GitLab
│
└── docs/ARQUITETURA.md             este documento
```

A versão antiga (motor em Java) foi removida do repositório e está na tag
`legacy-java`.

Duas pastas são geradas e nunca vão para o Git:

- **`graphify-out/`** (dentro do projeto analisado): o grafo (`graph.json`) e o
  cache do graphify.
- **`.selector-out/`** (dentro do projeto analisado): os relatórios de cada execução.

---

## 3. Uma execução, do início ao fim

Comando:

```bash
./select-tests.sh --project demo/ts-project --base HEAD~1 --head HEAD
```

```text
┌──────────────────────── select-tests.sh (Shell) ────────────────────────┐
│ 1. lê argumentos, detecta a linguagem, confere git/node/graphify          │
│ 2. graphify extract  ──▶  graphify-out/graph.json  (grafo do head)        │
│ 3. "precisa do grafo do base?" (cli.ts needs-base)                        │
│      sim ─▶ git worktree do merge-base + graphify extract (grafo do base) │
│ 4. node dist/cli.js select ...                                            │
│      ┌────────────────────── TypeScript ──────────────────────┐          │
│      │ diff.ts      git diff ─▶ lista de arquivos alterados    │          │
│      │ languages.ts lê typescript.yml                          │          │
│      │ graph.ts     carrega graph.json                         │          │
│      │ engine.ts    para cada arquivo: rules.ts decide         │          │
│      │              sementes ─▶ busca reversa no grafo          │          │
│      │              nós de teste alcançados = selecionados      │          │
│      │ report.ts    explicação + comando de teste              │          │
│      └─────────────────────────────────────────────────────────┘          │
│      grava .selector-out/{report.txt,json,md, command.txt, mode.txt}      │
│ 5. imprime o relatório (e manda para o Job Summary, se estiver no CI)     │
│ 6. roda o comando: npx jest --runTestsByPath tests/a.test.ts ...          │
└───────────────────────────────────────────────────────────────────────────┘
```

Saída típica:

```text
== test-graph-selector (typescript) ==
base: HEAD~1   head: HEAD

Arquivos alterados (1):
  M src/utils/math.ts

Regras aplicadas:
  [graph-seed] src/utils/math.ts: no grafo do head

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

O resultado tem sempre um de três **modos**:

| Modo | Quando | O que roda |
|---|---|---|
| `selective` | caso normal | só os testes escolhidos |
| `full` | alguma regra de segurança disparou | todos os testes |
| `none` | nenhum teste afetado (ex.: só documentação) | nada; é sucesso |

---

## 4. O grafo de dependências

### Quem gera: o graphify

O [graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0, versão fixada
em 0.9.90) é uma ferramenta externa, em Python, que lê o código com tree-sitter
(análise sintática, AST) e grava `graphify-out/graph.json`. Ele entende mais de 30
linguagens e gera sempre o mesmo formato. **Nenhum código dele foi copiado**: o
graphify só é chamado como programa.

O script chama sempre com duas opções obrigatórias:

| Opção | Por quê |
|---|---|
| `--code-only` | Só análise de código. Sem ela, ao achar um `.md` o graphify tenta usar um LLM e falha pedindo chave de API. |
| `--no-cluster` | Grava a extração crua, direcionada. Sem ela o graphify guarda o grafo como não-direcionado e, num ciclo de import `a ↔ b`, uma das setas some. |

### O formato do `graph.json`

```json
{
  "nodes": [
    { "id": "src_utils_math_add", "label": "add()", "source_file": "src/utils/math.ts", "source_location": "L1" }
  ],
  "edges": [
    { "source": "src_services_cart", "target": "src_utils_math_add", "relation": "imports",
      "source_file": "src/services/cart.ts", "source_location": "L1" }
  ]
}
```

- **Nós** são arquivos (`cart.ts`, label = nome do arquivo) ou coisas dentro deles
  (`add()`, `Cart`, `.total()`).
- **Arestas** (setas) têm um tipo (`relation`). A regra de direção é sempre:
  **`source` depende de `target`**.

| Relação | Exemplo | Leitura |
|---|---|---|
| `imports`, `imports_from` | `cart.ts → add()` | cart.ts importa add |
| `calls` | `Cart.total() → add()` | total chama add |
| `re_exports` | `index.ts → math.ts` | index reexporta math |
| `inherits`, `extends` | `DiscountCart → Cart` | herda de |
| `implements` | `EmailNotifier → Notifier` | implementa a interface |
| `references`, `uses` | `CartService → PriceService` | usa o tipo |
| `contains` | `cart.ts → Cart` | o arquivo contém a classe |
| `method` | `Cart → .total()` | a classe tem o método |

### Por que não usar o comando de impacto do próprio graphify

O graphify tem `graphify affected`, mas ele aceita só uma semente, para na
profundidade 2 (corta cadeias como `add() → Cart.total() → cart.ts → cart.test.ts`)
e não devolve o caminho. Por isso a busca é nossa (`graph.ts`).

### O indexador é trocável

O resto do sistema só conhece o formato acima. Qualquer outro indexador que grave
esse JSON serve (ver [seção 13](#13-como-estender)).

---

## 5. Cada arquivo do código

### 5.1 `selector/bin/select-tests.sh`: o orquestrador

É o único arquivo que se roda diretamente. Ele não decide nada: chama as peças na
ordem certa. (O `select-tests.sh` da raiz é só um atalho de uma linha para ele.)

**Argumentos:**

| Opção | Padrão | Significado |
|---|---|---|
| `--base` | obrigatório | commit de comparação (o diff é `base...head`) |
| `--head` | `HEAD` | commit analisado |
| `--project` | `.` | pasta do projeto (pode ser subpasta, em monorepo) |
| `--lang` | detecta | `package.json` + `vitest.config.*` → vitest; `package.json` → typescript; `pom.xml` → java; `build.gradle` → java-gradle; `pyproject.toml`/`setup.py`/`pytest.ini` → python |
| `--dry-run` | — | só seleciona e explica, não roda testes |
| `--format` | `text` | `text`, `json` ou `md` no terminal |
| `--out-dir` | `<projeto>/.selector-out` | onde gravar os relatórios |

**O que ele faz, em ordem:**

1. **Valida** `git`, a pasta do projeto, a linguagem e o `.yml` correspondente.
2. **Usa o seletor pronto** em `dist/cli.js`, um arquivo único gerado pelo esbuild
   com o `yaml` embutido e versionado no Git. Só compila se ele faltar ou, numa
   máquina de desenvolvimento (com `node_modules`), se algum `src/*.ts` for mais
   novo. Num clone novo as datas dos arquivos são as do checkout, então essa
   comparação fica de fora; `TGS_NO_BUILD=1` desliga a compilação de vez (a
   Action e o CI usam).
3. **Gera o grafo do head** (função `build_graph`):
   - se o commit é o que está aberto na pasta, roda o graphify ali mesmo
     (aproveitando o cache);
   - senão, cria um `git worktree` temporário daquele commit e indexa lá.
4. **Pergunta ao seletor se precisa do grafo do base** (`cli.ts needs-base`).
   Precisa quando o diff remove ou renomeia arquivos: o grafo novo não sabe mais
   quem usava o arquivo apagado. Nesse caso indexa o **merge-base** num worktree.
5. **Chama o seletor** (`node dist/cli.js select ...`).
6. **Publica o relatório**: imprime no terminal e, se a variável
   `GITHUB_STEP_SUMMARY` existir (CI do GitHub), anexa o Markdown ao Job Summary.
7. **Roda os testes** com o comando de `command.txt`, salvo em `--dry-run` ou no
   modo `none`.

**A rede de proteção (`fail_safe`):** se qualquer passo de 2 a 5 falhar (node ou
graphify ausente, commit inválido, grafo quebrado, erro no seletor), o script
**roda a suíte completa** em vez de desistir. O comando da suíte completa é lido
direto do `.yml` com `sed`, sem depender do seletor. Pode ser sobrescrito com a
variável `FULL_SUITE_COMMAND`.

**Códigos de saída:** `0` testes passaram (ou nada a rodar) · `1` testes falharam
· `2` erro sem como testar (uso inválido, ou falha em `--dry-run`).

**Variáveis de ambiente:** `GRAPHIFY` (caminho do executável do graphify), `NODE`,
`FULL_SUITE_COMMAND`.

### 5.2 `src/cli.ts`: a porta de entrada do TypeScript

Recebe os comandos do shell e distribui o trabalho. Tem um leitor de argumentos
próprio (`parseArgs`) e quatro subcomandos:

| Subcomando | Para que serve |
|---|---|
| `select` | O principal. Lê o diff, lista os testes existentes no head, carrega o(s) grafo(s), chama `selectTests`, gera o relatório e grava em `--out-dir`: `report.txt`, `report.json`, `report.md`, `mode.txt`, `command.txt`, `selected-tests.txt`. |
| `needs-base` | Imprime `yes` se o diff tem remoção/renomeação dentro do projeto. |
| `query` | Explora o grafo à mão, nos dois sentidos: `--direction dependents` (quem depende de mim, padrão) ou `dependencies` (de quem eu dependo). Com `--transitive`, mostra todos os dependentes indiretos e a cadeia de cada um. |
| `full-command` | Imprime o comando da suíte completa da linguagem. |

Exemplos de `query`:

```bash
node selector/dist/cli.js query --graph graphify-out/graph.json add --transitive
node selector/dist/cli.js query --graph graphify-out/graph.json Cart.total --direction dependencies
```

Qualquer erro termina com código `2` e a mensagem em `stderr`, e o shell então
aciona o fail-safe.

### 5.3 `src/diff.ts`: o que mudou?

Pergunta ao Git, sem analisar código.

- **`changedFiles(repo, base, head, prefix)`** roda
  `git diff --name-status -z -M base...head`.
  - `...` (três pontos) compara com o **merge-base**: num PR, só conta o que o PR
    mudou, mesmo que a `main` tenha andado depois.
  - `-M` detecta renomeações. `-z` separa nomes com um caractere invisível, para
    nomes com espaço não quebrarem nada.
- **`parseNameStatus`** transforma a resposta em objetos `Change`:

  ```ts
  { status: "R", repoPath: "app/src/new.ts", path: "src/new.ts",
    oldRepoPath: "app/src/old.ts", oldPath: "src/old.ts" }
  ```

  Status: `A` adicionado, `M` modificado, `D` deletado, `R` renomeado (cópias viram
  `A`; mudança de tipo vira `M`). `path` é relativo à pasta do projeto, para bater
  com o `source_file` do grafo; fica `null` se o arquivo está fora do projeto.
- **`filesAt(repo, rev, prefix)`**: todos os arquivos de um commit. Serve para saber
  o universo de testes (o "de 6" em "3 de 6").
- **`repoRoot` / `projectPrefix`**: raiz do repositório e subpasta do projeto.
- **`compare`**: ordenação de texto sempre igual (sem depender de idioma do
  sistema), base do determinismo.

### 5.4 `src/languages.ts` + `languages/*.yml`: o que muda por linguagem

Tudo que é específico de uma linguagem fica num YAML, fora do código.

**Campos do YAML:**

| Campo | Obrigatório | Para que serve |
|---|---|---|
| `name` | sim | nome da linguagem |
| `source_patterns` | sim | o que é código-fonte |
| `test_patterns` | sim | o que é arquivo de teste |
| `command` | sim | comando para rodar os testes escolhidos |
| `full_command` | sim | comando para rodar todos |
| `full_suite_patterns` | não | mudou um destes → suíte completa |
| `data_patterns` | não | snapshot/fixture/conftest → testes da mesma pasta |
| `scope_files` | não | arquivo que vale para a pasta inteira sem import (ex.: `conftest.py`) |
| `polymorphic_relations` | não | relações seguidas nos dois sentidos (interface/herança) |
| `always_run_markers` | não | anotações de teste de aplicação inteira (ex.: `SpringBootTest`) |
| `ignore_patterns` | não | padrão: documentação (`*.md`, `docs/**`, `LICENSE`...) |
| `global_full_suite_patterns` | não | padrão: `.github/workflows/**` (caminho a partir da raiz do repo) |

**Marcadores do `command`:**

| Marcador | Vira | Usado por |
|---|---|---|
| `{files}` | `tests/a.test.ts tests/b.test.ts` | Jest, pytest |
| `{classes}` | `CartTest,MoneyTest` | Maven |
| `{each_class:--tests %s}` | `--tests CartTest --tests MoneyTest` | Gradle |
| `{each_file:TPL}` | repete TPL por arquivo | livre |

**Funções:**

- **`globRegex` / `matches`**: entendem padrões com asterisco. `*` = qualquer nome
  dentro de uma pasta; `**/` = qualquer quantidade de pastas (inclusive zero). Um
  padrão sem barra, como `package.json`, só casa na raiz do projeto.
- **`isTest` / `isSource`**: "este arquivo é teste?", "é código?".
- **`testCommand`**: monta o comando final trocando os marcadores; caminhos com
  caracteres especiais ganham aspas.
- **`loadLanguage`**: lê o YAML (por nome, como `python`, ou por caminho) e
  valida os campos obrigatórios.

**As cinco configurações prontas:**

| Arquivo | Testes | Comando seletivo |
|---|---|---|
| `typescript.yml` | `*.test.ts`, `*.spec.ts`, `__tests__/` | `npx jest --ci --passWithNoTests --runTestsByPath {files}` |
| `vitest.yml` | `*.test.ts(x)` (sem `*.spec.ts`, que costuma ser Playwright) | `npx vitest run --passWithNoTests {files}` |
| `java.yml` | `src/test/java/**/*Test.java` | `mvn -q test -Dtest={classes} -Dsurefire.failIfNoSpecifiedTests=false` |
| `java-gradle.yml` | igual ao Java | `./gradlew test --rerun --console=plain -q {each_class:--tests %s}` |
| `python.yml` | `test_*.py`, `*_test.py` | `python -m pytest -q {files}` |

### 5.5 `src/graph.ts`: a rede e a busca

É o coração do sistema. A classe `DependencyGraph` guarda:

- `nodes`: cada nó (id, label, arquivo, linha);
- `outEdges` / `inEdges`: para cada nó, as setas que saem ("de quem eu dependo") e
  as que chegam ("quem depende de mim");
- `byFile`: quais nós pertencem a cada arquivo;
- `classOf`: de que classe é cada método, para mostrar `Cart.total()` em vez de
  `.total()`.

Arestas repetidas são descartadas e todas as listas são ordenadas na carga. Por
isso a ordem do `graph.json` nunca muda o resultado.

**Métodos:**

| Método | O que faz |
|---|---|
| `fromJson(file)` | carrega o grafo (aceita a chave `edges` ou `links`) |
| `hasFile`, `nodesInFile`, `sourceFile` | consultas por arquivo |
| `dependencies(n)` / `dependents(n)` | consulta direta nos dois sentidos |
| `find(query)` | acha nós por id, caminho ou nome (`add`, `Cart.total`) |
| `display(n)` | nome legível: caminho para arquivos, `Classe.metodo()` para métodos |
| `reverseReach(sementes, relações, polimórficas)` | **a busca reversa** (abaixo) |
| `chain(visitados, n)` | reconstrói o caminho de um nó até a semente |
| `hasDependents(arquivo)` | algum outro arquivo depende deste? (usado pela regra `no-dependents`) |
| `markerUsedBy(arquivo, marcadores)` | o arquivo usa alguma anotação da lista? (usado por `always-run`) |

**Como a busca reversa (`reverseReach`) funciona.** É uma busca em largura (BFS)
que segue setas de entrada:

```text
fila = [math.ts, add(), multiply()]          ← sementes: tudo do arquivo alterado
pega add()        → quem aponta para ele? cart.ts, Cart.total(), math.test.ts, ...
                    os não visitados entram na fila, guardando "vim de add()"
pega Cart.total() → quem aponta? Cart, Cart.formattedTotal()
pega cart.ts      → quem aponta? cart.test.ts
...                 para quando a fila esvazia
```

- **Sem limite de profundidade**: segue a cadeia até o fim.
- **Várias sementes** ao mesmo tempo, cada visita lembrando de qual arquivo
  alterado veio.
- **Guarda o pai** de cada nó, o que permite reconstruir a explicação completa.
- **`contains`/`method` no sentido reverso** sobem do símbolo para quem o contém:
  se `Cart.total()` mudou, quem usa `Cart` também pode ter mudado.
- **Relações polimórficas** (configuradas por linguagem) também são seguidas no
  sentido direto: `EmailNotifier → implements → Notifier` faz uma mudança na
  implementação chegar em quem usa a interface.
- **Determinismo**: as candidatas de cada passo são ordenadas por id antes de
  entrar na fila.

### 5.6 `src/rules.ts`: as regras de segurança

A função `classify` olha **um arquivo alterado por vez** e devolve uma
`FileDecision`:

| Campo | Significado |
|---|---|
| `hits` | regras que dispararam (vão para o relatório) |
| `headSeed` | semear este caminho no grafo novo |
| `baseSeed` | semear este caminho no grafo antigo (remoções/renomeações) |
| `forcedTest` | selecionar este teste diretamente |
| `dataDir` | rodar os testes desta pasta |

A tabela completa das regras, em ordem, está na [seção 6](#6-regras-de-segurança).

`dataDirFor` descobre a pasta "dona" de um arquivo de dados:
`tests/ui/__snapshots__/x.snap` → `tests/ui`.

### 5.7 `src/engine.ts`: o motor

A função `selectTests(changes, lang, allTests, head, base)`:

1. Passa cada arquivo alterado por `rules.classify`.
2. Se alguma regra pede suíte completa → devolve o modo `full`.
3. Adiciona os testes alterados (`forcedTest`).
4. Adiciona os testes das pastas de snapshot/fixture; pasta sem testes → `full`.
5. Se algum **código de produção** mudou, adiciona os testes com
   `always_run_markers` (ex.: `@SpringBootTest`).
6. Junta as sementes e roda `reverseReach` no grafo do head e, se houver, no do
   base.
7. Dos nós alcançados: nó em arquivo de teste → teste selecionado; nó num
   `scope_files` (ex.: `conftest.py`) → todos os testes da pasta dele.
8. Descarta testes que não existem mais no head.

Um teste pode ser alcançado por vários caminhos. A função `offer` guarda só o
**melhor motivo**, nesta preferência:

1. o próprio teste mudou;
2. está na pasta de um snapshot/fixture alterado;
3. depende do que mudou: prefere o grafo do head e, entre caminhos, o mais curto;
4. marcador `always-run` (só se não houver cadeia real).

### 5.8 `src/report.ts`: a explicação

- **`explain`** monta a frase de cada teste, trocando o nome técnico da relação
  por um verbo (tabela `VERBS`: `calls` → "chama", `imports` → "importa"...).
  Formatos possíveis:

  ```text
  tests/cart.test.ts --importa--> src/services/cart.ts --importa--> src/utils/math.ts [alterado em src/utils/math.ts]
  CartControllerWebTest --referencia--> CartService --referencia--> PriceService <--e implementada por-- DefaultPriceService [alterado em ...]
  tests/cart/test_cart.py --usa fixtures de--> tests/cart/conftest.py --importa--> app/services/cart.py [alterado em ...]
  ApiIntegrationTest.java [usa SpringBootTest: sobe a aplicacao inteira; roda com qualquer mudanca de codigo, ex.: ...]
  tests/user.test.ts [teste alterado/adicionado]
  ```

- **`buildReport`** monta o relatório estruturado: contagem (selecionados, total,
  % economizado), arquivos alterados, regras e quantas vezes cada uma disparou,
  testes com motivo e cadeia, e o comando final (`commandFor`).
- Três saídas:
  - **`renderText`**: para o log do CI e o terminal;
  - **`renderJson`**: para outro programa ler (`schema_version: 1`);
  - **`renderMarkdown`**: tabela para o Job Summary do GitHub ou comentário de PR.

Não há data, hora nem caminho absoluto no relatório, de propósito.

---

## 6. Regras de segurança

As regras são aplicadas em ordem a cada arquivo alterado; a primeira que decide
vence. Se **qualquer** arquivo cair numa regra de suíte completa, roda tudo.

| # | Regra | Exemplo | Decisão |
|---|---|---|---|
| 1 | `global-config` | `.github/workflows/ci.yml` | **suíte completa** |
| 2 | `outside-project` | arquivo fora de `--project` | ignorado |
| 3 | `docs-only` | `README.md`, `docs/**` | nenhum teste |
| 4 | `build-config` | `package.json`, lockfiles, `tsconfig*.json`, `pom.xml`, `build.gradle`, `pyproject.toml`, `src/main/resources/**` | **suíte completa** |
| 5 | `data-file` | `__snapshots__/`, `fixtures/`, `conftest.py` | testes da mesma pasta |
| 5b | `data-file-no-tests` | snapshot numa pasta sem testes | **suíte completa** |
| 6 | `changed-test` | `tests/cart.test.ts` | sempre selecionado |
| 6b | `deleted-test` | teste apagado | nada a rodar por ele |
| 7 | `no-dependents` | código **modificado**, no grafo, que nenhum outro arquivo usa | **suíte completa** |
| 8 | `graph-seed` | `src/math.ts`, presente no grafo | semente da busca |
| 9 | `source-not-in-graph` | `.ts`/`.java`/`.py` que o graphify não modelou | **suíte completa** |
| 10 | `no-base-graph` | arquivo apagado/renomeado sem o grafo antigo | **suíte completa** |
| 11 | `unclassified-file` | `logo.png`, nenhuma regra serve | **suíte completa** |
| — | `always-run` | `@SpringBootTest`, quando algum código de produção mudou | selecionado |

Por que a regra 7 existe: no demo Spring, o graphify não resolve uma classe
chamada `Clock` (o nome coincide com `java.time.Clock`). O campo
`@Autowired private Clock clock` não gera seta e, sem essa regra, mudar
`Clock.java` daria "nenhum teste afetado". Ela também cobre beans usados só pelo
framework (`@EventListener`, `@Scheduled`). Arquivos **novos** ficam de fora,
porque ninguém os usa ainda.

---

## 7. Regras especiais por linguagem

Três situações em que o código não mostra a dependência e o grafo sozinho erraria:

| Situação | Exemplo | Solução no YAML |
|---|---|---|
| **Interface / injeção de dependência** | `Checkout` só conhece `Notifier`; o Spring injeta `EmailNotifier` em runtime | `polymorphic_relations: [implements, inherits, extends]`: a busca também segue essas setas no sentido direto |
| **Fixtures do pytest** | `def test_total(cart):` recebe `cart` do `conftest.py` sem importar nada | `scope_files: ["**/conftest.py"]`: alcançou um conftest → todos os testes da pasta dele |
| **Teste de aplicação inteira** | `@SpringBootTest` chama `get("/cart/total")` pela URL, sem citar classe | `always_run_markers: [SpringBootTest]`: roda sempre que código de produção muda |

Todas essas regras pendem para a segurança: podem selecionar testes a mais, nunca
a menos.

---

## 8. Testes da própria ferramenta

Em `selector/tests/`, com Jest. Rodam sem Git e sem graphify, com grafos
montados à mão:

```ts
graph(["tests/t.test.ts imports_from src/a.ts", "src/a.ts imports_from src/b.ts"])
```

| Arquivo | O que verifica |
|---|---|
| `helpers.ts` | `graph()` (monta grafos a partir de frases) e `change()` |
| `graph.test.ts` | cadeia de 5 níveis, várias sementes, ciclo de import, subida por `contains`/`method`, polimorfismo, consulta nos dois sentidos |
| `engine.test.ts` | cada regra de segurança, arquivo apagado/renomeado, Python (conftest), Spring (`always-run`, `no-dependents`), comandos de Maven e Gradle, texto da explicação, **determinismo** (5 execuções idênticas) |
| `diff.test.ts` | leitura da saída do Git (inclusive nomes com espaço) e padrões glob |

```bash
cd selector && npm test        # 46 testes
```

No Windows, se aparecer `EPERM` ao encerrar, use `npx jest --runInBand`.

---

## 9. Projetos de demonstração

Cada demo foi montado com os casos difíceis da sua linguagem:

| Demo | Casos cobertos |
|---|---|
| `ts-project` | barrel `src/index.ts` com `export *`, alias `@/`, `jest.mock` + `require()`, cadeia indireta `add() → Cart.total() → cart.ts → cart.test.ts` |
| `java-project` | import com `*`, classe do mesmo pacote sem import, herança, interface com injeção por construtor |
| `java-gradle-project` | as mesmas classes, com Gradle e wrapper `./gradlew` incluído |
| `python-project` | `__init__.py` reexportando, import relativo, herança, `mock.patch` com texto, fixture de `conftest.py` em subpasta |
| `spring-project` | `@Autowired` em campo, interface + `@Service`, `@WebMvcTest` + `@MockitoBean`, `@SpringBootTest` chamando a API pela URL |

### Os scripts

- **`lib.sh`**: `setup_repo` copia um demo para `demo/.work/<nome>` e cria ali um
  repositório Git novo, para os scripts poderem commitar sem tocar no repositório
  real. `demo_lang` mapeia o demo para o `--lang` (o `spring` usa `java-gradle`).
- **`compare.sh <demo>`**: faz um commit por cenário (mudar uma função, só
  documentação, arquivo de build...). Para cada um, mede a suíte completa e o
  `select-tests.sh` e imprime uma tabela.
- **`prove-safety.sh <demo>`**: injeta um bug (`a + b` → `a - b`, ou um preço
  errado no Spring), commita e roda a ferramenta. Sucesso = os testes
  selecionados falham (exit 1).

### Resultados (medidos)

| Demo | Cenário | Testes |
|---|---|---|
| TypeScript | muda `add()` | 3 de 6 |
| TypeScript | muda `User` | 3 de 6 (um por sobresseleção do barrel) |
| TypeScript | só README | 0 |
| TypeScript | `package.json` | 6 de 6 |
| Java (Maven e Gradle) | muda `MathUtils.add()` | 4 de 5 |
| Java (Maven e Gradle) | muda `EmailNotifier` | 1 de 5 |
| Python | muda `add()` | 3 de 6 (inclui `test_cart.py` pela fixture) |
| Python | muda `Cart` | 1 de 6 |
| Spring | muda `DefaultPriceService` | 4 de 5 (inclui `ApiIntegrationTest`) |
| Spring | muda `Clock` | 5 de 5 (`no-dependents`) |
| Spring | `application.properties` | 5 de 5 |

As 5 provas de segurança passaram: em todas, um teste selecionado pegou o bug.

**Sobre tempo:** nestes demos pequenos, o modo seletivo **não** fica mais rápido.
Subir Jest/Maven/Gradle e rodar o graphify (5 a 7 segundos) custa mais que uma
suíte de 5 a 6 testes. Os demos provam a **correção** da seleção; o ganho de tempo
aparece quando a suíte real é maior que esse custo fixo.

---

## 10. Como o CI funciona

### 10.1 `selective-tests.yml`: o CI deste repositório

Dispara em todo **pull request** e em todo **push na `main`**. Tem quatro jobs:

```text
tool-tests ─────────────────────────────── (independente)

full-suite  (5 demos em paralelo) ──┐
                                    ├──▶ compare (tabela final)
selective   (5 demos em paralelo) ──┘
```

| Job | O que faz |
|---|---|
| `tool-tests` | instala, roda os testes Jest da ferramenta, compila e confere se o `dist/cli.js` versionado bate com o build novo |
| `full-suite` | para cada demo, roda **todos** os testes e mede o tempo (referência) |
| `selective` | para cada demo, roda `select-tests.sh` e mede o tempo; o relatório vai para o Job Summary |
| `compare` | espera os dois anteriores e escreve a tabela "completo × seletivo" no Summary |

A matriz dos dois jobs do meio tem 5 entradas (`demo`, `lang`, `project`). Cada
uma instala só o que precisa: Node sempre; Python no demo Python; Java nos três
demos Java.

Passos importantes do job `selective`:

1. **`actions/checkout` com `fetch-depth: 0`**: baixa o histórico completo. Sem
   isso, não dá para comparar commits.
2. **`chmod +x`** nos scripts: o bit de execução se perde em commits feitos no
   Windows.
3. **`pip install -r requirements.txt`**: instala o graphify. Ele **não** é
   instalado automaticamente pela ferramenta, só chamado por ela.
4. **Nada de `npm ci` nem build do seletor**: usa o `selector/dist/cli.js`
   versionado, como a Action (`TGS_NO_BUILD=1`).
5. **Dependências do demo** (`npm ci` no TypeScript, `pip install` no Python;
   Maven/Gradle baixam sozinhos).
6. **`actions/cache`** em `graphify-out/`: reaproveita a extração por arquivo entre
   execuções (chave por SO + versão do graphify + demo). O grafo em si é sempre
   regerado para o commit analisado.
7. **Definir a base do diff**:
   - em PR: `github.event.pull_request.base.sha` (início da branch de destino);
   - em push: `github.event.before` (o commit de antes do push);
   - branch nova ou commit inexistente: `HEAD~1`.
8. **`./select-tests.sh --project ... --lang ... --base <base> --head HEAD`**.

Os tempos e os `report.json` viram artefatos, que o job `compare` baixa para
montar a tabela.

### 10.2 `release.yml`: publicação no npm

Dispara **só manualmente** (aba *Actions* → *Release (npm)* → *Run workflow*,
escolhendo uma tag). As tags `v*` também versionam a GitHub Action, então criar
uma tag não publica nada sozinha. O workflow:

1. confere se a versão da tag é a mesma do `selector/package.json`;
2. `npm ci` e `npm test`;
3. `npm publish --provenance --access public`, usando o secret `NPM_TOKEN`.

`--provenance` faz o npm mostrar de qual commit e de qual CI o pacote veio.

Para lançar uma versão:

```bash
cd selector && npm version 1.0.1 --no-git-tag-version && cd ..
git commit -am "v1.0.1" && git tag v1.0.1 && git push --follow-tags
```

### 10.3 Usar no CI de outro projeto

Com o pacote publicado, o CI de qualquer projeto não precisa deste repositório:

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install graphifyy==0.9.90 && npm install -g test-graph-selector@1
      - run: npm ci   # dependências do SEU projeto

      - name: Definir base da comparação
        id: base
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            base="${{ github.event.pull_request.base.sha }}"
          else
            base="${{ github.event.before }}"
          fi
          if [ -z "$base" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
            base="$(git rev-parse HEAD~1)"
          fi
          echo "sha=$base" >> "$GITHUB_OUTPUT"

      - run: select-tests --base "${{ steps.base.outputs.sha }}" --head HEAD
```

**Num PR**, a comparação é contra o merge-base com a branch de destino: só as
mudanças do PR contam. Para **bloquear o merge** quando um teste falha, ative
*Settings → Branches → Branch protection* exigindo esse check (a ferramenta já
sai com erro quando um teste falha).

**O que é e o que não é automático:**

| Automático (a ferramenta faz) | Você instala antes |
|---|---|
| rodar o graphify a cada execução | o graphify (`pip install graphifyy==0.9.90`) |
| indexar o commit antigo, se precisar | a ferramenta (`npm install -g test-graph-selector`) |
| escolher, explicar e rodar os testes | as dependências do seu projeto |
| cair na suíte completa se algo falhar | Node, Python e Java (`setup-*`) |

---

## 11. O pacote npm

A pasta `selector/` é o pacote `test-graph-selector` (~21 kB, 14 arquivos):

```text
test-graph-selector-1.0.0.tgz
├── bin/select-tests.sh      comando `select-tests`
├── dist/cli.js              comando `test-graph-selector` (src/ + yaml num arquivo só)
├── languages/*.yml
├── package.json
└── README.md
```

- O código-fonte (`src/`) e os testes **não** vão no pacote. O `prepack` recompila o
  `dist/cli.js` (checagem de tipos com `tsc` + bundle com `esbuild`) antes de empacotar.
- O script descobre a própria pasta seguindo symlinks, porque o npm instala o
  comando como link. Assim ele funciona dentro de `node_modules/`.
- Não tem dependências de runtime: o `yaml` vai embutido no `dist/cli.js`.
- Precisa de `bash`: funciona direto em Linux/macOS/CI; no Windows, pelo Git Bash.

Para testar sem publicar:

```bash
cd selector && npm pack                               # gera test-graph-selector-1.0.0.tgz
npm install -g ./test-graph-selector-1.0.0.tgz        # instala o comando select-tests
```

---

## 12. Garantias e limites

### O que a ferramenta garante

- **Nunca deixa de testar por erro próprio**: qualquer falha → suíte completa.
- **Determinismo**: mesma entrada, mesma saída (há teste para isso).
- **Mudanças que o código não mostra** (build, lockfile, config, assets, arquivos
  desconhecidos) → suíte completa.

### Limites conhecidos

| Limite | Consequência |
|---|---|
| **Granularidade por arquivo**: o graphify não guarda a linha final de cada função | mudar uma função de um arquivo trata o arquivo inteiro como alterado |
| **Barrels/reexports** | quem importa `index.ts` depende de tudo que ele reexporta (sobresseleção) |
| **Imports dinâmicos montados em runtime** (`import(\`./${x}\`)`) | invisíveis; mitigar com `full_suite_patterns` |
| **Classe com nome igual ao do JDK** (ex.: `Clock`) | o graphify não resolve; a regra `no-dependents` pega quando ninguém mais aponta para o arquivo |
| **Spring**: `@Qualifier` por nome, `@Profile`, `@ConditionalOnProperty`, AOP, XML | não aparecem no código |
| **`@SpringBootTest`** | roda com qualquer mudança de código (sobresseleção proposital) |
| **pytest**: fixtures de plugins e `mock.patch("texto")` | não aparecem como dependência |
| **Testes como arquivo**: `describe/it` não viram nós | seleção por arquivo (Jest/pytest) ou por classe (JUnit) |
| **Working tree sujo**: o head atual é indexado no lugar | mudanças não commitadas entram no grafo, mas não no diff |

---

## 13. Como estender

### Adicionar uma linguagem

Crie `selector/languages/<nome>.yml`. Nenhum código muda. Exemplo (ilustrativo,
**Go não foi testado**):

```yaml
name: go
source_patterns: ["**/*.go"]
test_patterns: ["**/*_test.go"]
full_suite_patterns: ["go.mod", "go.sum"]
data_patterns: ["**/testdata/**"]
command: "go test {each_file:./%s}"
full_command: "go test ./..."
```

Antes de confiar numa linguagem nova, faça o que foi feito para Python e Spring:
monte um projeto pequeno com os casos difíceis, rode `graphify extract` e confira
se as setas saem certas. Foi assim que apareceram os problemas do `conftest.py`,
do `@SpringBootTest` e do `Clock`.

### Trocar o indexador

O seletor depende só do formato do `graph.json` ([seção 4](#4-o-grafo-de-dependências)).
Para usar outro indexador (ex.: `ts-morph`, JavaParser), basta ele gravar:

- nós com `id`, `label`, `source_file` (relativo ao projeto) e um nó por arquivo
  (label = nome do arquivo);
- arestas com `source`, `target`, `relation`, sendo que **source depende de target**;
- `contains` (arquivo → símbolo) e `method` (classe → método).

Depois, troque a função `build_graph` em `selector/bin/select-tests.sh`.

---

## 14. Glossário

| Termo | Significado |
|---|---|
| **AST** | Árvore de sintaxe: a estrutura do código lida por um programa, sem executá-lo |
| **base / head** | O commit de comparação / o commit analisado |
| **merge-base** | O commit onde uma branch saiu da outra; o diff `base...head` parte dele |
| **semente** | Nó do grafo onde a busca começa (tudo de um arquivo alterado) |
| **busca reversa** | Seguir as setas ao contrário: de "o que mudou" para "quem depende disso" |
| **sobresseleção** | Rodar um teste que não precisava (seguro, mas custa tempo) |
| **falso negativo** | Deixar de rodar um teste que precisava (o erro que a ferramenta mais evita) |
| **fail-safe** | Cair na suíte completa quando algo dá errado |
| **worktree** | Uma segunda cópia de trabalho do Git, num outro commit, sem mexer na pasta atual |
| **Job Summary** | A página de resumo de uma execução no GitHub Actions |
