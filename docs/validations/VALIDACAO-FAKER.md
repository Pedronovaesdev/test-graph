# Validação do test-graph-selector no Faker

## 1. Objetivo

Medir, com comandos reais no clone do Faker, se o commit `bda3904` (`feat: detect changed symbols from diff hunks`) reduz a sobresseleção, se preserva a segurança e qual é o custo de desempenho em relação à versão anterior.

A versão anterior é `C:/Users/gabri/Residencia IV/test-graph-before`, commit `45698b99560eb2f9ea208b1de43695816bb85606`. Ela semeia todos os nós do arquivo alterado.

A versão atual é `C:/Users/gabri/Residencia IV/test-graph-after`, commit `bda39042281b43b557e7005fe7c7bea98d5e4103`. Ela semeia os símbolos que cobrem as linhas do hunk e, quando não consegue localizá-los, volta ao arquivo inteiro.

O seletor não foi modificado. `DEFAULT_RELATIONS` não foi modificado. Nada foi enviado ao GitHub do Faker nem ao repositório do seletor.

## 2. Repositório e licença

O projeto avaliado é o clone em `C:/Users/gabri/Residencia IV/faker-eval`.

- Pacote: `@faker-js/faker` 10.6.0
- Origem: `https://github.com/faker-js/faker.git`
- Licença: MIT (`LICENSE`, copyright 2022-2025)
- Não é um monorepo de pacotes. `pnpm-workspace.yaml` só lista `allowBuilds`.

`AGENTS.md` aponta para a seção de desenvolvimento assistido por IA em `CONTRIBUTING.md`. A seção de testes do `CONTRIBUTING.md` pede `pnpm install`, `pnpm run build` e `pnpm run test`, porque parte dos testes importa `dist`.

## 3. Commit avaliado

Commit original do Faker, antes das mutações locais:

```text
73afc25320da7ee0afa45cbd257d8950d4a02f89
fix(locale): use province names for zh_CN state abbreviations (#4233)
```

Branch local, sem upstream e sem push: `eval/test-graph-symbol-diff`.

A working tree estava limpa nesse commit antes da avaliação. Os três cenários foram commits locais com o mesmo pai, `73afc253`. O tip atual da branch é o cenário 3. Os outros dois continuam recuperáveis pelas tags.

| Tag | SHA | Mutação |
|---|---|---|
| `eval-baseline-73afc25` | `73afc25320da7ee0afa45cbd257d8950d4a02f89` | baseline |
| `eval-s1-luhncheck` | `ef20f8c3b36ef69b34b693c1a437ce6ca33bf921` | corpo de `luhnCheck` |
| `eval-s2-luhncheckvalue` | `10e0a983d97f5fccee8b3e35160e3a40e5c91f8f` | corpo de `luhnCheckValue` |
| `eval-s3-pre-symbol` | `a30fd17b10a8fbefad926b684b3c8a3dbcaf8aaf` | comentário na linha 2, antes do primeiro símbolo |

A working tree ainda tem diretórios não rastreados da ferramenta (`.selector-*`, `graphify-out`). Eles não entraram nos commits.

## 4. Ambiente

Saída registrada em `logs/00-ambiente.txt`, capturada dentro de `faker-eval` em 2026-11-02.

| Item | Valor medido |
|---|---|
| `node` | v24.19.0 |
| `npm` | 11.17.0 |
| `pnpm` e `corepack pnpm` | 12.16.1 |
| `packageManager` | `pnpm@12.16.1` |
| `engines.node` | `^22.13.0 \|\| ^23.5.0 \|\| >=24.0.0` |
| `devEngines.packageManager` | pnpm 12.16.1, `onFail: download` |
| Git Bash | GNU bash 5.2.37 |
| `python` no PATH | não imprimiu versão |
| `graphify` no PATH | comando não encontrado |
| Python embutido | 3.12.10 em `tgs-eval-tools/python/python.exe` |
| graphify embutido | 0.9.90 em `tgs-eval-tools/python/Scripts/graphify.exe` |

O Node instalado satisfaz `>=24.0.0`. O gerenciador exigido pelo repositório é o pnpm 12.16.1 via Corepack. `npx vitest` não executa neste repositório: o npm 11.17.0 é recusado por `EBADDEVENGINES` porque `devEngines` exige pnpm. A execução dos testes usou `corepack pnpm exec vitest`.

## 5. Metodologia

Instalação: `corepack pnpm install --frozen-lockfile` (541 pacotes). A suíte oficial sem `dist` falhou, como o `CONTRIBUTING.md` prevê. `logs/01-suite-sem-build.txt` registra 80 testes falhos, entre eles `test/locale-imports.spec.ts` (import dinâmico de `../dist/locale/*.js` ausente), `test/require.spec.cts`, `test/faker.spec.ts` e `test/simple-faker.spec.ts`.

Depois de `corepack pnpm run build`, a suíte ainda falhou enquanto o cache de transform do Vitest (`node_modules/.vitest-cache`, além de `node_modules/.vite`) guardava um glob vazio de locales, gravado quando `dist` ainda não existia. Apagar os dois caches, com `dist` presente, produziu a suíte verde em `logs/06-suite-oficial-cache-limpo.txt`:

```text
EXIT=0
Test Files  57 passed (57)
Tests  56578 passed | 490 expected fail | 696 skipped (57764)
Duration  124.38s
parede 128102 ms
```

Os 490 `expected fail` são falhas esperadas do Vitest, já presentes na suíte verde. Não são falhas da mutação.

Comandos oficiais usados:

1. Um arquivo: `corepack pnpm exec vitest run test/internal/base32.spec.ts` (4 testes, passou, sem build).
2. Um módulo: `corepack pnpm exec vitest run test/modules/finance.spec.ts`.
3. Suíte relevante: `$env:CI='true'; corepack pnpm run test`. O script `test` é `vitest`. Com `CI=true` ele roda uma vez. Lint, documentação, Cypress e `integration-test` não foram usados.

Cada dry-run usou `TGS_NO_BUILD=1` e o `GRAPHIFY` embutido, pelo runner `logs/run-selector.sh`. Entre rodadas, o script apagou só `graphify-out`, `.selector-before` e `.selector-after`. O log mostra extração AST `uncached` em 3697 arquivos de código. O grafo resultante tem 6024 nós e 15505 arestas nas 18 rodadas.

Indexação e seleção foram separadas pelos carimbos do log: do texto `indexando o head` até `wrote ... graph.json`, e dali até `relatorios em`. A fase de seleção inclui a impressão do relatório JSON. O total é o relógio do PowerShell em volta do processo. Não há um cronômetro interno só de `symbolsOnLines`.

A execução dos testes foi uma vez por cenário, compartilhada pelas duas versões, porque as duas emitiram a mesma lista de arquivos. Não há três execuções da suíte por versão.

## 6. Estrutura do projeto

Vitest 5.0.5. `vitest.config.ts` inclui `test/**/*.spec.ts` e `test/**/*.spec.cts`, exclui `test/integration/**/*.spec.ts` e habilita typecheck em `test/**/*.spec-d.ts`. Também usa `isolate: false`, `maxWorkers: 4`, `fsModuleCache: true` e sequência embaralhada.

Há 56 arquivos `*.spec.ts` / `*.spec.cts` rastreados pelo Git. O Vitest reporta 57 arquivos de teste: os 56, menos `test/integration/modules/image.spec.ts` (excluído pela config), mais os dois typecheck `test/modules/finance.spec-d.ts` e `test/modules/helpers.spec-d.ts`. A linha `✓ TS` desses dois arquivos aparece em `logs/s1-full-suite.txt`.

O `vitest.yml` das duas versões do seletor omite `*.spec.ts` de propósito. O comentário no arquivo diz que esse padrão fica de fora para não capturar e2e de Playwright. Com `--lang vitest`, as duas versões terminaram em modo `none`, 0 selecionados de 0, regra `graph-seed`, no intervalo do commit de locale. Logs: `07-compat-before.txt` (parede 110005 ms, grafo frio) e `08-compat-after.txt` (parede 31309 ms, cache reaproveitado). Executar esse comando seria um falso negativo: "nada a rodar" com sucesso.

Configuração mínima que faz as duas versões enxergarem os testes do Faker: `faker-vitest.yml`, com `extends: vitest`, os padrões originais repetidos (porque `extends` substitui a lista) e `**/*.spec.ts` / `**/*.spec.cts`. O `command` foi ajustado para `pnpm exec vitest run --passWithNoTests {files}` depois que `npx` falhou com `EBADDEVENGINES`. As rodadas do cenário 1 ainda gravaram o comando `npx`, porque ocorreram antes dessa linha. O conjunto de arquivos não depende do texto do comando: o hash do conjunto é o mesmo nos três cenários.

Com o overlay, no diff real `HEAD~1..HEAD` do baseline (só `src/locales/zh_CN/location/state_abbr.ts`, arquivo sem símbolo), as duas versões selecionaram os mesmos 41 de 56. A cadeia sobe por `imports_from` até o arquivo. Não há `contains` porque não há semente de símbolo. Logs: `10-overlay-before.txt` e `11-overlay-after.txt`.

## 7. Critérios de escolha dos símbolos

O grafo foi inspecionado antes da escolha. Cópia e anotações: `logs/graph-head.json` e `logs/09-graph-candidates.txt`. O caso definitivo é `src/modules/helpers/_luhn-check.ts`.

| Candidato | Símbolos | Testes e arestas | Decisão |
|---|---|---|---|
| `src/modules/helpers/_luhn-check.ts` | `luhnCheck` L6, `luhnCheckValue` L16, `luhnChecksum` privado L26 | Três specs importam o símbolo `luhnCheck` e o arquivo. `replace-credit-card-symbols.ts` importa o símbolo `luhnCheckValue` e o arquivo, e `fakeHelpersReplaceCreditCardSymbols()` chama `luhnCheckValue`. `contains` liga o arquivo aos três símbolos. | Escolhido. Duas funções exportadas, sem rede, sem geração, hunk de uma linha, testes identificáveis. |
| `src/utils/mersenne.ts` | `generateMersenne32Randomizer` L22, `generateMersenne53Randomizer` L54 | `core.ts` importa o arquivo e o símbolo de 53 bits e o chama. `src/index.ts` reexporta os dois. Vários specs importam o símbolo. | Rejeitado. Um bug em 53 bits derrubaria a maior parte da suíte. Um bug em 32 bits ainda alcança `core.ts` por `imports_from` do arquivo mais `contains`. |
| `src/modules/finance/iban.ts` | `prettyPrintIban` L15, `fakeFinanceIban` L45 | `fakeFinanceIban` chama `prettyPrintIban`. O módulo de finance reexporta `fakeFinanceIban`. O spec importa `prettyPrintIban`. | Rejeitado. Os dois símbolos não são independentes: um chama o outro. |
| `src/modules/vehicle/vin.ts` | `vinCheckDigit` L44, `fakeVehicleVin` L66, mais duas constantes | `fakeVehicleVin` é o caminho de produção. O spec importa `vinCheckDigit`. | Reserva. Mesma forma do Luhn, com mais símbolos no arquivo. |
| `src/internal/base64.ts` | `toBase64` L16, `toBase64Url` L41 | `data-uri.ts` importa `toBase64`. `jwt.ts` importa `toBase64Url`. O spec importa `toBase64`. | Reserva. No Node, `toBase64Url` não chama `toBase64`. |
| `src/locales/zh_CN/location/state_abbr.ts` | nenhum; um nó de arquivo em L1 | Uma aresta `imports_from` desde `zh_CN/location/index.ts`. | Usado só como compatibilidade. A versão atual cai no arquivo inteiro porque não há símbolo. |

## 8. Cenário 1: primeiro símbolo

Commit `ef20f8c3`. Diff de um hunk, uma linha, só o corpo de `luhnCheck`:

```diff
-  return luhnChecksum(str) === 0;
+  return luhnChecksum(str) !== 0;
```

`git diff --check` limpo. Nenhum import, nenhum outro símbolo, nenhum arquivo de configuração. `luhnCheckValue` permaneceu intacto.

As seis rodadas (três de cada versão) selecionaram o mesmo conjunto, hash sha256 dos caminhos `91d1758f40ed`: modo `selective`, 42 de 56, 25% poupados, uma regra `graph-seed` em `src/modules/helpers/_luhn-check.ts`, detalhe `no grafo do head`.

A versão anterior termina as 42 cadeias no arquivo. Exemplo implícito do comportamento antigo: a semente é cada nó do arquivo, e a cadeia mais curta para no nó do arquivo.

A versão atual termina as 42 cadeias em `luhnCheck()`. Três testes importam o símbolo e não usam `contains` na cadeia gravada:

```text
test/modules/finance.spec.ts --importa--> luhnCheck()
test/modules/helpers.spec.ts --importa--> luhnCheck()
test/modules/phone.spec.ts --importa--> luhnCheck()
```

Os outros 39 sobem do símbolo ao arquivo por `contains` e daí pelo barrel. Exemplo de `logs/s1-after-run1.report.txt`:

```text
test/all-functional.spec.ts --importa--> src/index.ts --importa--> helpers/index.ts
  --importa--> src/modules/helpers/replace-credit-card-symbols.ts
  --importa--> src/modules/helpers/_luhn-check.ts --contem--> luhnCheck()
```

`replace-credit-card-symbols.ts` não importa `luhnCheck`. Importa `luhnCheckValue` e o arquivo. A aresta que coloca esses 39 testes na seleção é `contains`, no sentido reverso, do símbolo para o arquivo, seguida de `imports_from` de quem importa o arquivo.

Suíte completa (`logs/s1-full-suite.txt`, parede 92314 ms, Duration 88.87s): 4 arquivos falhos, 53 passaram, 57 no total. Testes: 66 falhos, 56512 passaram, 490 expected fail, 696 skipped.

Falhas determinísticas, 65, todas dentro dos três arquivos selecionados. Os títulos `it()` são os que chamam `luhnCheck`. O log quebrou a linha e, em `logs/s1-full-failures.txt`, comeu o espaço depois de `>`:

- `test/modules/phone.spec.ts`, 25 vezes, `imei() > should be Luhn-valid`
- `test/modules/finance.spec.ts`, 5 sementes, cinco títulos: `should return a random credit card number`, `should return a valid credit card number`, `should return a correct credit card number when issuer provided`, `should generate a valid union pay credit card`, `should return custom formatted strings`
- `test/modules/helpers.spec.ts`, 5 sementes, três títulos: `returns a credit card number given a schema`, `supports different symbols`, `handles regexp style input`

A 66ª falha da suíte completa foi `test/simple-faker.spec.ts > simpleFaker > should not log anything on startup`, timeout de 5000 ms. Na execução da seleção (`logs/s1-selected-pnpm.txt`, parede 53240 ms, Duration 49.62s, 4 arquivos falhos e 37 passaram, 41 arquivos) o timeout apareceu em `test/faker.spec.ts > faker > should not log anything on startup`. Os dois arquivos estão entre os 42. Esse timeout passou na suíte verde e não acompanha o bug do Luhn. Nenhum teste falho ficou entre os 14 não selecionados.

`test/all-functional.spec.ts` (38992 testes) passou. Ele está entre os 39 alcançados por `contains`. Para este bug, essa seleção é sobra.

A primeira tentativa de executar o comando literal do cenário 1 usou `npx` e morreu em cerca de 9,7 s com `EBADDEVENGINES`. Esse resultado não é resultado de teste. A execução válida é a de `corepack pnpm exec vitest` com a mesma lista de arquivos.

## 9. Cenário 2: símbolo irmão

Baseline restaurado. Commit `10e0a983`, pai outra vez `73afc253`. Um hunk, só a linha 18, corpo de `luhnCheckValue`:

```diff
-  return checksum === 0 ? 0 : 10 - checksum;
+  return checksum === 0 ? 1 : 0;
```

`luhnCheck` permaneceu `checksum === 0`. O dígito verificador gerado fica errado. As asserções continuam chamando o `luhnCheck` original.

As seis rodadas devolveram o mesmo hash `91d1758f40ed`: 42 de 56, modo `selective`, regra `graph-seed`. O símbolo irmão não produziu outro conjunto.

A explicação mudou. A versão atual termina as 42 cadeias em `luhnCheckValue()`. Só três cadeias usam `contains`, e são outra vez os três specs que importam o arquivo e o símbolo irmão `luhnCheck`:

```text
test/modules/finance.spec.ts --importa--> src/modules/helpers/_luhn-check.ts --contem--> luhnCheckValue()
test/modules/helpers.spec.ts --importa--> src/modules/helpers/_luhn-check.ts --contem--> luhnCheckValue()
test/modules/phone.spec.ts --importa--> src/modules/helpers/_luhn-check.ts --contem--> luhnCheckValue()
```

Os outros 39 chegam ao símbolo por import real, sem `contains`. Exemplo:

```text
test/all-functional.spec.ts --importa--> src/index.ts --importa--> helpers/index.ts
  --importa--> src/modules/helpers/replace-credit-card-symbols.ts
  --importa--> luhnCheckValue()
```

Suíte completa (`logs/s2-full-suite.txt`, parede 87042 ms, Duration 83.19s): 3 arquivos falhos, 54 passaram. Testes: 124 falhos, 56454 passaram, 490 expected fail, 696 skipped. Sem timeout. Os 124 estão em `finance.spec.ts`, `helpers.spec.ts` e `phone.spec.ts`.

Títulos estáveis, com a contagem desta execução. O `describe` inclui um `randomSeed()` novo a cada processo, então o nome completo do Vitest muda de execução para execução. O `it()` não muda. A lista completa das linhas `FAIL` está no log.

`test/modules/phone.spec.ts`:

- `imei`, 3 vezes (sementes fixas 42, 1337 e 1211)
- `should be Luhn-valid`, 25 vezes

`test/modules/helpers.spec.ts`:

- `noArgs`, `only symbols`, `some string`, 3 vezes cada
- `returns a credit card number given a schema`, `supports different symbols`, `handles regexp style input`, 5 vezes cada

`test/modules/finance.spec.ts`:

- `noArgs`, `with issuer`, `with issuer option visa`, `with issuer option mastercard`, 3 vezes cada
- `should return a random credit card number`, `should return a valid credit card number`, `should return a correct credit card number when issuer provided`, `should generate a valid union pay credit card`, `should return custom formatted strings`, 5 vezes cada
- um teste por padrão de cartão nas locales `el`, `en`, `fa` e `zh_CN`, títulos `pattern "..." should generate a valid credit card number`. Os padrões desta execução foram `"/34##-######-####L/"`, `"/37##-######-####L/"`, `"/4###########L/"`, `"/4###-####-####-###L/"`, `"/6011-####-####-###L/"`, `"/65##-####-####-###L/"`, `"2[221-720]-####-####-###L"` (4), `"30[0-5]#-######-###L"`, `"34##-######-####L"`, `"3528-####-####-###L"`, `"3529-####-####-###L"`, `"35[3-8]#-####-####-###L"`, `"36##-######-###L"`, `"37##-######-####L"`, `"4###########L"` (3), `"4###-####-####-###L"` (3), `"5[1-5]##-####-####-###L"` (4), `"6011-####-####-###L"`, `"62#############L"`, `"65##-####-####-###L"`, `"67#############L"`, `"81################L"`, `"81###############L"`, `"81##############L"`, `"81#############L"`.

A seleção (`logs/s2-selected-pnpm.txt`, parede 58795 ms, Duration 56.38s) falhou os mesmos três arquivos e mais `test/faker.spec.ts > faker > should not log anything on startup` (timeout de 5000 ms). Total 125. O timeout está dentro dos 42. Nenhum falho ficou de fora.

O conjunto é idêntico ao do cenário 1. Os dois símbolos do mesmo arquivo não produzem seleções diferentes neste projeto.

## 10. Cenário 3: fallback

Baseline restaurado. Commit `a30fd17b`. Um hunk, só o comentário da linha 2, antes de `luhnCheck` na linha 6:

```diff
- * Checks that the given string passes the luhn algorithm.
+ * Checks that the given string passes the Luhn algorithm.
```

`symbolsOnLines` devolve nulo quando a linha alterada fica antes do primeiro símbolo. A versão atual então semeia todos os nós do arquivo, que é o comportamento da versão anterior.

As seis rodadas devolveram o mesmo hash `91d1758f40ed`, 42 de 56, regra `graph-seed`, detalhe ainda `no grafo do head`. O relatório não tem uma regra com o nome "fallback". O fallback aparece na cadeia: as 42 explicações da versão atual terminam no arquivo, não num símbolo, e nenhuma usa `contains`. Na versão anterior isso já era o formato de todas as cadeias. Exemplos de `logs/s3-after-run1.report.txt`:

```text
test/all-functional.spec.ts --importa--> src/index.ts --importa--> helpers/index.ts
  --importa--> src/modules/helpers/replace-credit-card-symbols.ts
  --importa--> src/modules/helpers/_luhn-check.ts
test/modules/finance.spec.ts --importa--> src/modules/helpers/_luhn-check.ts
test/modules/helpers.spec.ts --importa--> src/modules/helpers/_luhn-check.ts
test/modules/phone.spec.ts --importa--> src/modules/helpers/_luhn-check.ts
```

Suíte completa (`logs/s3-full-suite.txt`, parede 73558 ms, Duration 70.24s, EXIT 0): 57 arquivos passaram, 56578 testes passaram, 490 expected fail, 696 skipped. Seleção (`logs/s3-selected-pnpm.txt`, parede 52335 ms, Duration 50.01s, EXIT 0): 41 passaram. O 42º caminho, `test/integration/modules/image.spec.ts`, está na lista do seletor e é excluído pelo `vitest.config.ts`, então o Vitest executa 41. Não houve falha. O conjunto vazio de falhas está contido na seleção das duas versões.

## 11. Comparação anterior × atual

O conjunto não mudou em nenhum cenário. O hash dos 42 caminhos é `91d1758f40ed` nas 18 rodadas. A versão anterior sempre explica pelo arquivo. A versão atual explica pelo símbolo nos cenários 1 e 2 e volta ao arquivo no cenário 3.

| Cenário | Versão | Modo | Selecionados/Total | Testes selecionados | Regras | Semente | Seleção | Execução | Falso negativo |
|---|---|---|---|---|---:|---:|---:|---|
| 1 `luhnCheck` | anterior | selective | 42/56 | conjunto `91d1758f40ed` | graph-seed | todos os nós do arquivo | 1529 ms | 53240 ms | não |
| 1 `luhnCheck` | atual | selective | 42/56 | o mesmo conjunto | graph-seed | `luhnCheck()` | 1836 ms | 53240 ms | não |
| 2 `luhnCheckValue` | anterior | selective | 42/56 | o mesmo conjunto | graph-seed | todos os nós do arquivo | 1665 ms | 58795 ms | não |
| 2 `luhnCheckValue` | atual | selective | 42/56 | o mesmo conjunto | graph-seed | `luhnCheckValue()` | 1790 ms | 58795 ms | não |
| 3 comentário L2 | anterior | selective | 42/56 | o mesmo conjunto | graph-seed | arquivo inteiro | 1523 ms | 52335 ms | não |
| 3 comentário L2 | atual | selective | 42/56 | o mesmo conjunto | graph-seed | arquivo inteiro, `symbolsOnLines` nulo | 1603 ms | 52335 ms | não |

Seleção é a mediana de três rodadas da fase depois do `graph.json`, incluindo a impressão do relatório. Execução é a parede de uma rodada da lista selecionada com `corepack pnpm exec vitest`. As duas versões compartilham essa execução porque a lista era idêntica.

Os 42 selecionados:

```text
test/all-functional.spec.ts
test/faker.spec.ts
test/integration/modules/image.spec.ts
test/internal/base64.spec.ts
test/internal/bind-this-to-member-functions.spec.ts
test/internal/date.spec.ts
test/internal/locale-proxy.spec.ts
test/locale-data.spec.ts
test/locale-imports.spec.ts
test/modules/airline.spec.ts
test/modules/animal.spec.ts
test/modules/book.spec.ts
test/modules/color.spec.ts
test/modules/commerce.spec.ts
test/modules/company.spec.ts
test/modules/database.spec.ts
test/modules/datatype.spec.ts
test/modules/date.spec.ts
test/modules/finance-iban.spec.ts
test/modules/finance.spec.ts
test/modules/food.spec.ts
test/modules/git.spec.ts
test/modules/hacker.spec.ts
test/modules/helpers-eval.spec.ts
test/modules/helpers.spec.ts
test/modules/image.spec.ts
test/modules/internet.spec.ts
test/modules/location.spec.ts
test/modules/lorem.spec.ts
test/modules/medical.spec.ts
test/modules/music.spec.ts
test/modules/number.spec.ts
test/modules/person.spec.ts
test/modules/phone.spec.ts
test/modules/science.spec.ts
test/modules/string.spec.ts
test/modules/system.spec.ts
test/modules/vehicle.spec.ts
test/modules/word.spec.ts
test/simple-faker.spec.ts
test/utils/merge-locales.spec.ts
test/utils/mersenne.spec.ts
```

Os 14 de fora, em todos os cenários:

```text
test/core.spec.ts
test/distributors/exponential.spec.ts
test/distributors/uniform.spec.ts
test/docs/format.spec.ts
test/docs/versions.spec.ts
test/exports.spec.ts
test/internal/base32.spec.ts
test/internal/seed.spec.ts
test/require.spec.cts
test/scripts/apidocs/class.spec.ts
test/scripts/apidocs/method.spec.ts
test/scripts/apidocs/page.spec.ts
test/scripts/apidocs/verify-jsdoc-tags.spec.ts
test/scripts/shared/markdown.spec.ts
```

Nenhum desses 14 falhou nas suítes completas dos três cenários.

## 12. Prova de segurança

Critério: as falhas da suíte completa precisam ser um subconjunto dos testes selecionados pela versão atual. Como as duas versões selecionaram os mesmos arquivos, a mesma execução cobre as duas.

| Cenário | Suíte completa | Seleção | Falhos deixados de fora |
|---|---|---|---|
| 1 | 65 asserções Luhn em `finance.spec.ts`, `helpers.spec.ts`, `phone.spec.ts`, mais timeout em `simple-faker.spec.ts` | as mesmas 65, mais timeout em `faker.spec.ts` em vez de `simple-faker.spec.ts` | nenhum |
| 2 | 124 asserções Luhn nos mesmos três arquivos | as mesmas 124, mais timeout em `faker.spec.ts` | nenhum |
| 3 | nenhuma falha; 56578 passaram | nenhuma falha; 54189 passaram em 41 arquivos | nenhum |

Os timeouts de startup não são determinísticos e não são o bug introduzido. Os dois arquivos em que apareceram estão na seleção. Não há regressão crítica: nenhum teste falho ficou de fora da versão atual.

## 13. Análise do graph.json

Nós e arestas tirados de `logs/s2-after-run3.graph.json`.

```text
luhnCheck()            id src_modules_helpers_luhn_check_luhncheck      L6
luhnCheckValue()       id src_modules_helpers_luhn_check_luhncheckvalue  L16
luhnChecksum()         id src_modules_helpers_luhn_check_luhnchecksum    L26
_luhn-check.ts         id src_modules_helpers_luhn_check                 L1

_luhn-check.ts --contains--> luhnCheck()
_luhn-check.ts --contains--> luhnCheckValue()
_luhn-check.ts --contains--> luhnChecksum()

finance.spec.ts  --imports_from--> _luhn-check.ts
finance.spec.ts  --imports--> luhnCheck()
helpers.spec.ts  --imports_from--> _luhn-check.ts
helpers.spec.ts  --imports--> luhnCheck()
phone.spec.ts    --imports_from--> _luhn-check.ts
phone.spec.ts    --imports--> luhnCheck()

replace-credit-card-symbols.ts --imports_from--> _luhn-check.ts
replace-credit-card-symbols.ts --imports--> luhnCheckValue()
fakeHelpersReplaceCreditCardSymbols() --calls--> luhnCheckValue()
```

Os três specs também têm `imports_from` para `src/index.ts`. Há `indirect_call` dos specs para `luhnCheck`. `indirect_call` não está em `DEFAULT_RELATIONS` e o seletor não a segue.

Caminho do cenário 1 para um teste que só importa o barrel:

```text
luhnCheck()
  <- contains -
_luhn-check.ts
  <- imports_from -
replace-credit-card-symbols.ts
  <- imports_from -
helpers/index.ts
  <- imports_from -
src/index.ts
  <- imports_from -
teste
```

Respostas:

1. Os três specs importam o símbolo `luhnCheck` e também o arquivo. Não importam `luhnCheckValue`. O código de produção importa o símbolo `luhnCheckValue` e o arquivo.
2. O graphify cria a aresta `imports` até o símbolo importado e a aresta `imports_from` até o arquivo. Também cria `calls` de `fakeHelpersReplaceCreditCardSymbols()` para `luhnCheckValue()`.
3. A BFS reversa chega ao nó do arquivo. `contains` aponta do arquivo para o símbolo, então o sentido reverso sobe do símbolo ao arquivo. As cadeias do cenário 1 mostram esse passo.
4. `contains` anula a granularidade entre estes dois símbolos. Mudar `luhnCheck` ou mudar `luhnCheckValue` seleciona os mesmos 42 arquivos. No primeiro caso, 39 testes só entram porque a busca sobe ao arquivo e encontra quem importa o arquivo. No segundo, esses 39 já importam o símbolo certo pelo barrel, e os três specs entram pela subida `contains`, que é a cadeia mais curta gravada. Eles também importam `src/index.ts`, então a BFS os alcançaria pelo barrel mesmo sem essa cadeia curta.
5. Os testes do símbolo irmão continuam selecionados. `finance.spec.ts`, `helpers.spec.ts` e `phone.spec.ts` afirmam `luhnCheck` e foram selecionados quando o símbolo alterado era `luhnCheckValue`. Os testes que só passam pelo barrel foram selecionados quando o símbolo alterado era `luhnCheck`.
6. Remover `contains` deste caminho não foi executado. Pelo grafo gravado, não criaria falso negativo nos dois bugs medidos. No bug de `luhnCheck`, os três arquivos que falharam importam esse símbolo por `imports`; os 39 que não falharam, inclusive `all-functional.spec.ts`, sairiam. No bug de `luhnCheckValue`, os 39 já chegam por `imports` do símbolo, e os três specs também importam `src/index.ts`, que alcança `luhnCheckValue` por `replace-credit-card-symbols.ts`. Isso é leitura do grafo, não uma rodada com `DEFAULT_RELATIONS` alterado.

## 14. Impacto de desempenho

Três rodadas frias por versão e cenário. `graphify-out` foi apagado antes de cada uma. Instalação, download e o build inicial do Faker ficam de fora. Tempos em milissegundos. Mediana é o valor do meio das três amostras.

| Cenário | Versão | Indexação min / mediana / max | Seleção min / mediana / max | Total do dry-run min / mediana / max |
|---|---|---:|---:|---:|
| 1 | anterior | 48381 / 48681 / 48766 | 1492 / 1529 / 1755 | 51584 / 52000 / 52487 |
| 1 | atual | 48517 / 49450 / 55132 | 1608 / 1836 / 1843 | 51774 / 52862 / 58718 |
| 2 | anterior | 50034 / 50586 / 53062 | 1620 / 1665 / 1709 | 53330 / 54501 / 56559 |
| 2 | atual | 49334 / 49387 / 52303 | 1789 / 1790 / 1810 | 52977 / 52981 / 55942 |
| 3 | anterior | 46948 / 47601 / 47859 | 1221 / 1523 / 1539 | 49983 / 50858 / 51590 |
| 3 | atual | 42536 / 47990 / 50895 | 1529 / 1603 / 1911 | 45207 / 51369 / 54564 |

A indexação é quase o tempo todo. A diferença de mediana da fase de seleção, atual menos anterior, foi 307 ms, 125 ms e 80 ms. A oscilação da indexação numa mesma versão passa de 6 s (cenário 1, atual, 48517 a 55132). O custo de hunks e `symbolsOnLines` cabe dentro dessa fase de cerca de 1,5 a 1,9 s e não foi isolado do tempo de imprimir o relatório. Ele não é relevante diante da indexação nem da execução dos testes.

Execução, uma amostra por cenário, parede e Duration do Vitest:

| Cenário | Suíte completa | Seleção |
|---|---|---|
| 1 | 92314 ms, Duration 88.87s, inclui um timeout | 53240 ms, Duration 49.62s, inclui um timeout |
| 2 | 87042 ms, Duration 83.19s | 58795 ms, Duration 56.38s, inclui um timeout |
| 3 | 73558 ms, Duration 70.24s, EXIT 0 | 52335 ms, Duration 50.01s, EXIT 0 |

A suíte verde de referência, com cache frio, levou 128102 ms e Duration 124.38s. As execuções seguintes ficaram na faixa de 70 a 92 s.

## 15. Limitações

- Um único arquivo de produção, dois símbolos e um fallback no mesmo arquivo. `mersenne.ts` foi rejeitado porque um bug útil contaminaria a suíte inteira.
- A execução dos testes foi uma vez por cenário, não três por versão. As 18 dry-runs cobrem indexação, seleção e total.
- O timeout de 5000 ms em `should not log anything on startup` apareceu em `simple-faker.spec.ts` ou `faker.spec.ts` sob carga e passou na suíte verde e no cenário 3. Não é falha do seletor.
- `contains` não foi desligado. A resposta sobre falso negativo nesse caso é uma leitura do `graph.json` e das cadeias gravadas.
- O universo do seletor (56 specs, incluindo integração) não é o universo do Vitest (57, sem integração, com dois `spec-d.ts`).
- O comando gerado no cenário 1 ainda diz `npx`, que este repositório recusa. A lista de arquivos foi executada com `corepack pnpm exec vitest`.
- Há diretórios não rastreados `.selector-*` e `graphify-out` na working tree do Faker. Não foram commitados.

## 16. Conclusão

1. A versão atual não selecionou menos testes. Nos três cenários as duas versões selecionaram os mesmos 42 arquivos, hash `91d1758f40ed`.
2. O conjunto não mudou. A explicação mudou nos cenários 1 e 2: a cadeia da versão atual termina em `luhnCheck()` ou `luhnCheckValue()`, e a da versão anterior termina no arquivo. No cenário 3 as explicações coincidem e terminam no arquivo.
3. Nenhum teste falho deixou de ser selecionado. As falhas determinísticas ficaram em `test/modules/finance.spec.ts`, `test/modules/helpers.spec.ts` e `test/modules/phone.spec.ts`. O timeout de startup, quando ocorreu, ficou em `test/simple-faker.spec.ts` ou `test/faker.spec.ts`, ambos dentro dos 42.
4. A relação `contains` anulou a granularidade entre os dois símbolos. Os dois bugs selecionaram o mesmo conjunto. No bug de `luhnCheck`, 39 dos 42 testes entram pela subida do símbolo ao arquivo e pelo `imports_from` de quem importa o arquivo, não o símbolo. `test/all-functional.spec.ts` foi selecionado e passou.
5. O custo adicional de hunks e `symbolsOnLines` não foi relevante. A mediana da fase de seleção ficou entre 1,5 e 1,8 s, com diferença entre versões de 80 a 307 ms, menor que a oscilação da indexação. A indexação ficou em torno de 43 a 55 s.
6. O comportamento confirma as demos internas em `docs/VALIDACAO-SYMBOL-DIFF.md` do seletor: no grafo real do graphify o conjunto permanece igual ao da versão anterior, a segurança se mantém e a redução só aparecia num grafo sintético sem `imports_from` para o arquivo. O Faker reproduz esse resultado fora das demos. Os dois símbolos irmãos também não separam os conjuntos.
7. `bda3904` deve ser mantido. Não há falso negativo nem aumento de conjunto que justifique revertê-lo. Também não entregou, neste repositório, a redução de sobresseleção. Reverter só apagaria as cadeias que nomeiam o símbolo e o fallback já observado no cenário 3, que selecionou o mesmo que a versão anterior.
8. Se a meta passar a ser reduzir o conjunto, a menor hipótese a testar, sem implementá-la agora, é parar de seguir `contains` no sentido reverso, do símbolo semeado para o arquivo. No bug de `luhnCheck`, a leitura do grafo indica que `finance.spec.ts`, `helpers.spec.ts` e `phone.spec.ts` permaneceriam, porque importam o símbolo, e que os outros 39 sairiam. O risco a medir é um teste que só importa o arquivo, sem aresta até o símbolo e sem outro caminho. Esta avaliação não rodou o seletor com essa relação removida.

## 17. Recomendação

Manter `bda3904`. No Faker ele é seguro e equivalente à versão anterior no conjunto selecionado. A sobresseleção que `contains` produz com os `imports_from` de arquivo continua igual à da semente por arquivo inteiro.

Não reverter com base nesta avaliação. Não tratar a ausência de redução como regressão de segurança: as falhas medidas foram cobertas.

Há um problema anterior a `bda3904`, idêntico nas duas versões: `--lang vitest` não vê `*.spec.ts` e gera modo `none` com zero testes. Neste repositório, `npx vitest` também não executa. A configuração mínima usada foi `faker-vitest.yml`. Isso não foi corrigido no seletor.

## 18. Comandos reproduzíveis

Ambiente, dentro de `faker-eval`:

```bash
git remote -v
git rev-parse HEAD
git status --short
git branch --show-current
node --version
npm --version
pnpm --version
corepack pnpm --version
python --version
graphify --version
```

Instalação e suíte, depois do build e com os caches do Vitest limpos apenas na corrida que ainda tinha o glob vazio:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run build
CI=true corepack pnpm run test
```

Dry-run, Git Bash, três vezes por versão, apagando `graphify-out` e o diretório de saída entre elas. O runner grava `TGS_NO_BUILD=1` e o `GRAPHIFY` embutido:

```bash
export TGS_NO_BUILD=1
export GRAPHIFY="/c/Users/gabri/Residencia IV/tgs-eval-tools/python/Scripts/graphify.exe"
bash "/c/Users/gabri/Residencia IV/test-graph-before/select-tests.sh" \
  --project . \
  --base HEAD~1 \
  --head HEAD \
  --lang "/c/Users/gabri/Residencia IV/tgs-open-source-eval/faker-vitest.yml" \
  --dry-run \
  --format json \
  --out-dir .selector-before
```

O comando da versão atual troca o script por `test-graph-after/select-tests.sh` e o diretório por `.selector-after`.

Execução da seleção, com a lista emitida em `command.txt`:

```bash
CI=true corepack pnpm exec vitest run --passWithNoTests <arquivos do command.txt>
```

Tags locais, sem push: `eval-baseline-73afc25`, `eval-s1-luhncheck`, `eval-s2-luhncheckvalue`, `eval-s3-pre-symbol`.

Logs desta avaliação: `C:/Users/gabri/Residencia IV/tgs-open-source-eval/logs/`.
