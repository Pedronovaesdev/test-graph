# Validação da seleção por símbolo

## 1. Objetivo

Medir, nas demos deste repositório, se o commit `bda3904` (`feat: detect changed symbols from diff hunks`) melhorou ou piorou o `test-graph-selector`. A comparação usa as duas árvores isoladas `test-graph-before` (`bda3904^`) e `test-graph-after` (`bda3904`). Nenhum arquivo versionado do produto foi alterado para acomodar o ambiente. Esta avaliação não corrige o código.

## 2. Versões comparadas

| | Commit | SHA |
|---|---|---|
| Anterior | `bda3904^` | `45698b99560eb2f9ea208b1de43695816bb85606` |
| Atual | `bda3904` | `bda39042281b43b557e7005fe7c7bea98d5e4103` |

`git status --short` na raiz, antes dos worktrees, não imprimiu nada. Os worktrees foram criados com `git worktree add --detach` e também saíram limpos. `git show --stat --oneline bda3904` altera 11 arquivos (`diff.ts`, `engine.ts`, `graph.ts`, testes, `dist/cli.js`, README e arquitetura), 526 inserções e 18 remoções.

O checkout deixa `selector/src/engine.ts` alguns milissegundos mais novo que `selector/dist/cli.js`. Sem `TGS_NO_BUILD=1`, `select-tests.sh` recompilaria o bundle versionado. As demos rodaram com `TGS_NO_BUILD=1`, usando o `dist/cli.js` do próprio commit.

## 3. Ambiente

| Ferramenta | Resultado |
|---|---|
| git | `git version 2.53.0.windows.2` |
| Node | `v24.19.0` |
| npm | `11.17.0` |
| Bash | Git Bash `5.2.37(1)-release`. O `bash.exe` de `C:\Windows\system32` falha (WSL ausente). |
| Java | `java version "23.0.2"` |
| Python do PATH | `python` e `python3` são o alias da Microsoft Store (código 9009). |
| Python usado | CPython `3.12.10` portátil em `tgs-eval-tools`, só para `pip install -r requirements.txt` (`graphifyy==0.9.90`) e `demo/python-project/requirements.txt` (`pytest 9.2.0`). |
| Maven | `mvn` ausente. |
| Gradle de sistema | `gradle` ausente. Os projetos Gradle usam o wrapper `gradle-8.14.3`. |
| graphify | `graphify 0.9.90` |

Worktrees:

- `C:\Users\gabri\Residencia IV\test-graph-before`
- `C:\Users\gabri\Residencia IV\test-graph-after`

Logs: `C:\Users\gabri\Residencia IV\tgs-eval-logs`.

## 4. Metodologia

1. `npm ci` e `npm test` em `selector/` de cada worktree.
2. `bash demo/compare.sh <stack>` três vezes em cada versão, quando a stack executa. O script oficial mede, por commit, a suíte completa e o `select-tests.sh` (indexação + seleção + testes).
3. Depois da última comparação, `select-tests.sh --dry-run` em cada commit, para guardar o conjunto de testes, o comando e as cadeias. Esse tempo não entra na tabela do `compare.sh`.
4. `bash demo/prove-safety.sh <stack>` três vezes. Saída 0 do script significa que o `select-tests.sh` saiu com 1.
5. Onde a seleção ficou menor ou houve bug injetado, a suíte completa rodou no mesmo código. A seleção só é segura quando as falhas da suíte completa estão entre os testes selecionados.
6. Casos A–K num repositório descartável copiado de `demo/ts-project`, com dois testes extras (`tests/add-only.test.ts` e `tests/multiply-only.test.ts`). Os dois seletores apontaram para o mesmo repositório. O diff de cada caso é um hunk curto; a primeira tentativa foi descartada porque reescrever o arquivo trocava CRLF por LF e o hunk cobria o arquivo inteiro.

Tempos de instalação (`npm ci`, download do Gradle na primeira suíte) ficam fora das colunas medidas pelo `compare.sh`. A coluna **Seleção** abaixo, nas demos oficiais, é o dry-run único (indexação + seleção, sem executar testes). A coluna **Execução** é a mediana do “tempo seletivo” do `compare.sh`, que inclui indexação, seleção e a execução dos testes. Mínimo e máximo estão no texto.

## 5. Demos executadas

Scripts aceitos por `demo/compare.sh` e `demo/prove-safety.sh`: `typescript`, `java`, `java-gradle`, `python`, `spring`.

| Stack | Comparação | Prova de segurança | Execução dos testes |
|---|---|---|---|
| typescript | 3 + 3, saída 0 | 3 + 3, saída 0 | Jest executou |
| python | 3 + 3, saída 0 | 3 + 3, saída 0 | pytest executou |
| java-gradle | 3 + 3, saída 0 | 3 + 3, saída 0 | `gradlew test` executou |
| spring | 3 + 3, saída 0 | 3 + 3, saída 0 | `gradlew test` executou |
| java (Maven) | 1 + 1, o script sai 0, mas os testes não rodam | 1 + 1, saída 0 enganosa | **não executado** |

Java Maven, comando e causa:

```text
mvn -q test
/selector/bin/select-tests.sh: line 120: mvn: command not found
```

`prove-safety.sh` trata qualquer saída 1 como “o bug foi pego”. Com `mvn` ausente essa saída 1 não é falha de teste. A seleção Maven foi comparada em dry-run; a execução não entra como aprovada nem reprovada.

## 6. Resultados por stack

Conjuntos de testes, não só as quantidades, são iguais nas duas versões em todos os cenários oficiais. O que muda em TypeScript e Python é o fim de algumas cadeias: a versão atual nomeia o símbolo (`add()`, `money()`) onde a anterior nomeava o arquivo.

### TypeScript

Testes do cenário `muda add()`: `tests/barrel.test.ts`, `tests/cart.test.ts`, `tests/math.test.ts`.

| Stack | Cenário | Versão | Modo | Selecionados/Total | Testes selecionados | Regras | Seleção | Execução | Bug detectado |
|---|---|---|---|---|---:|---:|---|
| typescript | muda add() | anterior | selective | 3/6 | barrel, cart, math | graph-seed | 2.8s | 16.3s (11.1–18.0) | sim, na prova |
| typescript | muda add() | atual | selective | 3/6 | barrel, cart, math | graph-seed | 2.7s | 10.9s (10.4–20.4) | sim, na prova |
| typescript | muda money() | anterior | selective | 2/6 | alias, cart | graph-seed | 2.3s | 9.7s (9.3–15.3) | — |
| typescript | muda money() | atual | selective | 2/6 | alias, cart | graph-seed | 2.5s | 9.7s (9.3–16.8) | — |
| typescript | muda User | anterior | selective | 3/6 | barrel, mock, user | graph-seed | 2.3s | 16.2s (10.5–19.9) | — |
| typescript | muda User | atual | selective | 3/6 | barrel, mock, user | graph-seed | 2.3s | 10.2s (10.1–15.3) | — |
| typescript | só documentação | anterior | none | 0/6 | — | docs-only | 2.3s | 4.3s (2.7–4.4) | — |
| typescript | só documentação | atual | none | 0/6 | — | docs-only | 2.2s | 2.9s (2.8–3.6) | — |
| typescript | renomeia notifier.ts | anterior | selective | 1/6 | mock | changed-test, graph-seed | 3.8s | 16.8s (15.3–19.3) | — |
| typescript | renomeia notifier.ts | atual | selective | 1/6 | mock | changed-test, graph-seed | 4.0s | 9.9s (9.7–16.5) | — |
| typescript | muda package.json | anterior | full | 6/6 | suíte completa | build-config | 2.4s | 22.7s (12.3–23.5) | — |
| typescript | muda package.json | atual | full | 6/6 | suíte completa | build-config | 2.2s | 12.7s (12.6–14.2) | — |

Suíte completa no bug `a + b` → `a - b` (`npx jest --ci` no worktree atual, saída 1): falham `math`, `cart` e `barrel`; passam `alias`, `user` e `mock`. As três falhas são exatamente os três arquivos selecionados.

### Python

| Stack | Cenário | Versão | Modo | Selecionados/Total | Testes selecionados | Regras | Seleção | Execução | Bug detectado |
|---|---|---|---|---|---:|---:|---|
| python | muda add() | anterior | selective | 3/6 | cart/test_cart, test_barrel, test_math | graph-seed | 2.7s | 3.4–3.6s nas 3 rodadas | sim |
| python | muda add() | atual | selective | 3/6 | os mesmos três | graph-seed | 2.8s | 3.2–3.7s nas 3 rodadas | sim |
| python | muda money() | ambas | selective | 2/6 | cart/test_cart, test_money | graph-seed | 2.5–2.7s | 2.8–3.1s | — |
| python | muda Cart | ambas | selective | 1/6 | cart/test_cart | graph-seed | 2.6–2.7s | 2.7–3.1s | — |
| python | muda User | ambas | selective | 3/6 | test_barrel, test_mock, test_user | graph-seed | 2.6–2.8s | 2.9–3.3s | — |
| python | só documentação | ambas | none | 0/6 | — | docs-only | 2.3–2.8s | 2.2–2.6s | — |
| python | muda pyproject.toml | ambas | full | 6/6 | suíte completa | build-config | 2.9–3.3s | 3.1–3.8s | — |

`python -m pytest -q` no bug de `add()`: `4 failed, 5 passed`. As falhas são `tests/cart/test_cart.py`, `tests/test_barrel.py` e `tests/test_math.py`, os três arquivos selecionados.

Na versão atual, a cadeia de `muda User` termina em `User.greeting()` porque o método novo entra no intervalo aberto de `greeting()`. O conjunto de testes permanece o mesmo.

### Java Maven

Seleção igual nas duas versões. Execução não realizada.

| Cenário | Modo | Selecionados/Total | Testes |
|---|---|---|---|
| muda MathUtils.add() | selective | 4/5 | CartTest, CheckoutTest, DiscountCartTest, MathUtilsTest |
| muda Money.format() | selective | 3/5 | CartTest, CheckoutTest, MoneyTest |
| muda EmailNotifier | selective | 1/5 | CheckoutTest |
| só documentação | none | 0/5 | — |
| muda pom.xml | full | 5/5 | suíte completa |

Os 0,1s da coluna “tempo completo” do `compare.sh` são a falha imediata de `mvn`, não uma suíte.

### Java Gradle

Conjuntos iguais aos do Maven. Três rodadas de cada versão, todas com saída 0. Tempos seletivos estáveis: `muda MathUtils.add()` anterior 5.0 / 5.4 / 5.6 s, atual 5.0 / 5.1 / 5.8 s. Suíte completa entre 2.6 s e 3.2 s nas duas versões, exceto um 4.5 s no cenário do `EmailNotifier` na primeira rodada atual.

Suíte completa no bug de `add()` (`gradlew test`, 6 testes, 4 falhas): falham `CartTest.sumsItems`, `CheckoutTest.sendsTotalThroughNotifier`, `DiscountCartTest.appliesDiscount` e `MathUtilsTest.adds`. `MathUtilsTest.multiplies` passa dentro da classe selecionada. `MoneyTest.formatsCents` passa e não estava selecionado.

### Spring

Conjuntos e regras iguais nas duas versões: `DefaultPriceService` 4/5 (`always-run`, `graph-seed`), `Clock` suíte completa (`no-dependents`), `CartController` 3/5, teste alterado 1/5, documentação 0/5, `application.properties` suíte completa.

Suíte completa no bug do preço: falham `ApiIntegrationTest` e `DefaultPriceServiceTest`. Passam `CartControllerWebTest` e `GreetingServiceTest` (selecionados) e `CartServiceTest` (não selecionado). As duas falhas estão dentro da seleção.

Tempos da versão anterior, cenário do preço: suíte seletiva 11.2 s, 10.5 s e 9.5 s. Na atual: 9.4 s, 76.7 s e 42.2 s. A suíte completa das mesmas rodadas 2 e 3 também subiu (102.7 s e 40.8 s, contra 7.9–10.3 s na primeira rodada e na versão anterior). O aumento acompanha as duas colunas e coincide com a retomada depois que o lote foi interrompido. Não é um aumento isolado da fase de símbolo.

## 7. Comparação antes × depois

| O que foi comparado | Resultado |
|---|---|
| Conjunto de testes das 5 demos oficiais | igual nas duas versões, cenário por cenário |
| Modo e regras oficiais | iguais |
| Cadeias | em TS e Python, várias passam a terminar no símbolo; em Java, Gradle e Spring o texto já terminava no símbolo |
| Falhas da suíte completa com bug injetado | subconjunto dos testes selecionados em TS, Python, Gradle e Spring |
| Java Maven | seleção igual; testes não executados |

Classificação dos cenários oficiais: inconclusivo para “a granularidade reduziu testes”, porque o conjunto não mudou. Não há regressão de segurança nem regressão de desempenho consistente. A diferença das cadeias é o efeito observável do commit nessas demos.

## 8. Cenários de granularidade

Repositório descartável com 10 arquivos de teste. Hunks conferidos com `git diff -U0`. `missed=[]` em todos os casos que rodaram Jest: nenhuma falha da suíte completa ficou de fora da seleção.

| Stack | Cenário | Versão | Modo | Selecionados/Total | Testes selecionados | Regras | Seleção | Execução | Bug detectado |
|---|---|---|---|---|---|---:|---:|---|
| ts fixture | A corpo de `multiply` | ambas | selective | 5/10 | add-only, barrel, cart, math, multiply-only | graph-seed | CLI 0.35s / 0.42s | Jest da seleção falhou nos 3 arquivos que a suíte completa falhou | sim |
| ts fixture | B assinatura de `multiply` | ambas | selective | 5/10 | os mesmos 5 | graph-seed | CLI ~0.37s / ~0.45s | mesmas 3 falhas cobertas | sim |
| ts fixture | C import antes do 1º símbolo | ambas | selective | 5/10 | os mesmos 5, cadeia no arquivo | graph-seed | — | suíte passou | sem bug de comportamento |
| ts fixture | D linha entre `add` e `multiply` | ambas | selective | 5/10 | os mesmos 5; a cadeia da versão atual semeia `add()` | graph-seed | — | suíte passou | sem bug |
| ts fixture | E apaga o `return` de `multiply` | ambas | selective | 5/10 | arquivo inteiro (hunk `+5,0`) | graph-seed | — | as 5 falhas da suíte estão na seleção | sim |
| ts fixture | F apaga `multiply` | ambas | selective | 5/10 | arquivo inteiro (hunk `+3,0`) | graph-seed | — | falham cart, math, multiply-only; add-only passa e estava selecionado | sim |
| ts fixture | I dois hunks | ambas | selective | 5/10 | os mesmos 5 | graph-seed | — | no bug, as 5 falhas estão na seleção | sim no bug |
| ts fixture | J campo, métodos e intervalo | ambas | selective | 1/10 | só `cart.test.ts` | graph-seed | — | quando o corpo quebra o total, `cart.test.ts` falha e é o único selecionado | sim nos bugs |
| ts fixture | K renomeia arquivo | ambas | selective | 1/10 | `mock.test.ts` | changed-test, graph-seed | — | suíte passou | — |
| ts fixture | K apaga `money.ts` | ambas | selective | 2/10 | alias, cart | graph-seed | — | essas duas falham; o restante passa | sim |
| ts fixture | K renomeia símbolo e call sites | ambas | selective | 5/10 | os 5 de math/cart | graph-seed | — | suíte passou | — |

O caso A, com hunk único `@@ -6 +6 @@` dentro de `multiply`, ainda seleciona `add-only` e `barrel`. A cadeia registrada é:

```text
tests/add-only.test.ts --importa--> src/utils/math.ts --contem--> multiply()
```

O grafo real tem `imports_from` de `tests_add_only_test` para `src_utils_math` e `contains` de `src_utils_math` para `multiply`. A busca reversa sobe do símbolo ao arquivo e desce para todo importador do arquivo. O teste unitário que mostra redução usa um grafo montado à mão, sem essa aresta de arquivo.

O caso D atribui a linha 4, entre as funções, a `add()` (`symbolsOnLines`: maior início `<=` linha). `multiply-only` continua selecionado pela aresta até o arquivo. A linha fica com o símbolo anterior, e o conjunto de testes não muda.

Os casos C, E e F caem no arquivo inteiro: inserção antes do primeiro símbolo, ou hunk com contagem 0 no lado novo (`changedLines` devolve `null`). O conjunto fica igual ao da versão anterior.

### Caso H e caso G

Grafo escrito à mão, com `outer()` em `L5-L40` e `inner()` em `L10-L18`, sem aresta `imports_from` para o arquivo. Só a fase `node dist/cli.js select` rodou; os testes desse grafo não foram executados. A versão anterior semeia o arquivo inteiro em todas as linhas.

| Stack | Cenário | Versão | Modo | Selecionados/Total | Testes selecionados | Regras | Seleção | Execução | Bug detectado |
|---|---|---|---|---|---|---:|---:|---|
| grafo sintético | H linha 9 | anterior | selective | 2/2 | inner, outer | graph-seed | ~0.38s | não executada | — |
| grafo sintético | H linha 9 | atual | selective | 1/2 | outer | graph-seed | ~0.46s | não executada | — |
| grafo sintético | H linha 10 | atual | selective | 1/2 | inner | graph-seed | ~0.45s | não executada | — |
| grafo sintético | H linha 18 | atual | selective | 1/2 | inner | graph-seed | ~0.44s | não executada | — |
| grafo sintético | H linha 19 | atual | selective | 1/2 | outer | graph-seed | ~0.46s | não executada | — |
| grafo sintético | H linha 41 | atual | selective | 2/2 | inner, outer | graph-seed | ~0.44s | não executada | — |
| grafo sintético | G localização ausente | ambas | selective | 2/2 | inner, outer | graph-seed | ~0.4s | não executada | — |

O graphify 0.9.90, no grafo da demo TypeScript, gravou só localizações `L<n>`. `RANGE_COUNT` foi 0. O formato `L10-L18` não aparece na indexação real; o caso H força esse formato no `graph.json`. Três nós sem `source_location` tinham `source_file` vazio (símbolos externos), não um arquivo do projeto.

## 9. Provas de segurança

| Prova | Anterior | Atual | O que falhou de fato |
|---|---|---|---|
| `prove-safety.sh typescript` | saída 0 nas 3 rodadas | saída 0 nas 3 rodadas | Jest: `math`, `barrel`, `cart` |
| `prove-safety.sh python` | saída 0 nas 3 | saída 0 nas 3 | pytest: cart, barrel, math |
| `prove-safety.sh java-gradle` | saída 0 nas 3 | saída 0 nas 3 | Gradle: 4 falhas nas classes selecionadas |
| `prove-safety.sh spring` | saída 0 nas 3 | saída 0 nas 3 | Gradle: `ApiIntegrationTest` e `DefaultPriceServiceTest` |
| `prove-safety.sh java` | saída 0 | saída 0 | `mvn: command not found`. Não é detecção de bug. |

Nos quatro stacks em que o runner rodou, a suíte completa no mesmo commit não falhou em arquivo deixado de fora da seleção.

## 10. Impacto de desempenho

No caso A, `node dist/cli.js select` com o grafo já pronto, três vezes:

- anterior: 362 ms, 338 ms, 353 ms
- atual: 424 ms, 493 ms, 403 ms

A fase de seleção, que lê `git diff -U0` e chama `symbolsOnLines`, fica cerca de 70–150 ms mais alta nesse fixture. Os outros casos A–K repetem a mesma faixa. Isso não aparece como aumento consistente do `compare.sh`: a mediana seletiva do TypeScript atual ficou abaixo da anterior, e a suíte completa também variou na mesma direção. No Python as duas versões ficam em ~3 s seletivos contra ~0,7 s da suíte completa, por causa da indexação. No Gradle as duas versões ficam em ~5 s seletivos. No Spring, as rodadas 2 e 3 da versão atual inflaram suíte completa e suíte seletiva juntas.

Indexar continua dominante. O dry-run oficial (indexação + seleção) fica em torno de 2–4 s nas demos pequenas, nas duas versões.

## 11. Regressões encontradas

Nenhuma regressão crítica. Nenhum teste que falhou na suíte completa ficou de fora da seleção.

Não houve regressão de segurança nas demos executadas. Não houve regressão de desempenho atribuível ao algoritmo: a única fase mais lenta de forma repetida é a seleção pura, em dezenas ou poucas centenas de milissegundos.

O estreitamento prometido pelos testes unitários novos (68 testes na versão anterior, 84 na atual, todos passando) não aparece nos grafos do graphify dessas demos. Os testes unitários passam e o conjunto prático permanece o da versão anterior.

## 12. Limitações da avaliação

- Java Maven não executou testes.
- O caso H não executou Jest; só a seleção no grafo sintético.
- `compare.sh` não separa indexação, seleção e execução. A separação da seleção pura veio do `cli.js select` no fixture.
- As rodadas 2 e 3 do Spring atual saíram do patamar das outras medições. Elas entram no mínimo/mediana/máximo e não sustentam uma conclusão de desempenho.
- O fixture de granularidade acrescenta dois testes que não existem na demo oficial. Os cenários oficiais foram medidos à parte, sem esses arquivos.
- `TGS_NO_BUILD=1` fixa o bundle commitado. Um rebuild não foi comparado.

## 13. Evidências e comandos

```text
git status --short
git rev-parse bda3904^
git rev-parse bda3904
git show --stat --oneline bda3904
git worktree add --detach ../test-graph-before bda3904^
git worktree add --detach ../test-graph-after bda3904
```

Em cada `selector/`: `npm ci` e `npm test`.

Demos, com `TGS_NO_BUILD=1` e o `graphify` 0.9.90 no `PATH`:

```text
bash demo/compare.sh typescript|python|java|java-gradle|spring
bash demo/prove-safety.sh typescript|python|java|java-gradle|spring
```

Suítes completas no bug, worktree atual:

```text
npx jest --ci
python -m pytest -q
gradlew.bat test --rerun --console=plain -q
```

Saídas: `tgs-eval-logs/*.md`, `tgs-eval-logs/detail-*`, `tgs-eval-logs/granularity/all.json`.

Trechos do algoritmo citados na conclusão:

- `selector/src/diff.ts`, `changedLines`: contagem 0 devolve `null` e o motor semeia o arquivo.
- `selector/src/engine.ts`, `seedNodes`: só um arquivo modificado com hunks é filtrado; senão, todos os nós do arquivo.
- `selector/src/graph.ts`, `symbolsOnLines`: a linha fica com o símbolo de maior início que a cobre; sem dono, devolve `null`.
- `selector/src/graph.ts`, `DEFAULT_RELATIONS`: inclui `contains` e `method`, seguidos na busca reversa até quem contém o símbolo.

## 14. Conclusão

1. A granularidade reduziu a sobresseleção? Não nas demos oficiais e não nos casos A–K indexados pelo graphify. O conjunto de testes foi idêntico ao da versão anterior. A redução apareceu só no grafo sintético do caso H, que não tem a aresta `imports_from` para o arquivo.
2. A granularidade produziu falsos negativos? Não. Em todo bug executado, as falhas da suíte completa foram um subconjunto dos testes selecionados. O caso D semeia o símbolo anterior, e o teste do símbolo seguinte continua na seleção por causa de `contains`.
3. Quais demos foram impactadas negativamente? Nenhuma das que executaram testes. Java Maven não executou.
4. O impacto negativo ocorreu na corretude, no desempenho ou em ambos? Não houve impacto negativo de corretude. O desempenho das demos não piora de forma consistente; a seleção pura custa cerca de 0,1 s a mais neste fixture.
5. A implementação deve ser mantida, corrigida ou revertida? Mantida. Reverter só perderia cadeias que nomeiam o símbolo e os fallbacks de hunk vazio, que nas medições selecionaram o mesmo que a versão anterior e cobriram as falhas.
6. Qual trecho causou cada regressão? Não há regressão medida. O trecho que impede o conjunto de encolher no grafo real é a busca reversa de `contains` em `selector/src/graph.ts` (`DEFAULT_RELATIONS` e `reverseReach`), junto com as arestas `imports_from` que o graphify grava para o arquivo. A atribuição da linha entre símbolos ao símbolo anterior está em `symbolsOnLines`.
7. Qual é a menor correção possível? Nenhuma correção é exigida pelos resultados. Se o objetivo passar a ser remover o teste do símbolo irmão, a menor alteração seria não seguir `contains` do símbolo semeado até o nó do arquivo. Isso pode deixar de fora um teste que só importa o arquivo, e esta avaliação não mediu essa variante.

## 15. Recomendação

Manter `bda3904`. Nas demos executadas a seleção continua segura e equivalente à anterior. Os testes unitários novos passam e não são, sozinhos, a evidência desse parecer: a evidência é o conjunto igual nas cinco stacks e as suítes completas dos bugs em TypeScript, Python, Gradle e Spring.
