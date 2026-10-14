# Contrato JSON do grafo (`--graph-json`)

Este é o formato que qualquer extrator (Python, Node, ou um futuro quarto/quinto)
precisa produzir para que o motor Java (`DependencyGraph` + `TestSelector`) consiga
consumir. É a "cola" que permite que o mesmo mecanismo de seleção sirva várias
linguagens sem duplicar a lógica de grafo/BFS em cada uma.

## Forma

```json
{
  "nodes": [
    { "id": "tests/test_calculator.py", "isTest": true },
    { "id": "app/services/calculator.py", "isTest": false }
  ],
  "edges": [
    { "from": "tests/test_calculator.py", "to": "app/services/calculator.py" }
  ]
}
```

## Regras

- **`id`**: identificador único do nó. Para os extratores de Python e Node, é o
  caminho relativo do arquivo (com `/`, não `\`), **exatamente igual ao que
  `git diff --name-only` devolve** — isso é o que permite ao `Main.java` casar um
  arquivo alterado com um nó do grafo sem nenhuma tradução (diferente do modo
  `--src` do Java, que converte caminho → nome totalmente qualificado da classe).
- **`isTest`**: `true` se esse nó é (ou contém) um teste. Cada extrator decide isso
  pela convenção da própria linguagem/framework (`@Test` em Java, `test_*.py` em
  pytest, `*.test.ts`/`*.spec.ts` em Jest).
- **`edges[].from` → `edges[].to`**: significa "`from` depende de `to`" (importa,
  chama, referencia). A direção importa — é essa direção que o `TestSelector`
  inverte na hora de perguntar "quem depende deste nó alterado?".
- Arestas para nós fora do projeto (bibliotecas externas, `node_modules`,
  `site-packages`) **não devem aparecer** — cada extrator resolve o alvo do
  import/chamada e simplesmente descarta quando não é um arquivo do próprio
  projeto. Isso é intencional, não um bug: só nos interessa saber com o que o
  *seu* código se conecta.

## Por que arquivo, não classe/função, para Python e Node

O indexador Java (`AstIndexer`) opera em nível de **método/classe** porque o
JavaParser resolve chamadas com uma resolução de tipos real (`call.resolve()`).
Python não é tipado estaticamente por padrão e, mesmo com TypeScript sendo
tipado, os extratores de Python e Node aqui ficam deliberadamente em nível de
**arquivo/módulo** (grafo de imports), pelos motivos:

1. Um grafo de chamadas preciso em Python sem executar o código é pouco confiável
   (o mesmo nome de método pode pertencer a objetos de tipos diferentes).
2. Manter a mesma granularidade nas duas linguagens dinâmicas/dinamicamente-usadas
   é mais honesto do que fingir precisão que não existe.
3. É o que ferramentas de produção reais fazem nesses ecossistemas (o
   `jest --findRelatedTests` do próprio Jest também é baseado em grafo de import,
   não em call graph).

Nada impede evoluir o extrator de Node para usar o *type checker* do `ts-morph`
e subir para granularidade de função — está listado como próximo passo natural
em [`README.md`](../README.md#limitações-conhecidas).
