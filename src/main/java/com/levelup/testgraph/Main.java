package com.levelup.testgraph;

import com.levelup.testgraph.diff.ChangedMethodDetector;
import com.levelup.testgraph.graph.DependencyGraph;
import com.levelup.testgraph.index.AstIndexer;
import com.levelup.testgraph.select.TestSelector;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.stream.Collectors;

@Command(
        name = "test-graph-selector",
        mixinStandardHelpOptions = true,
        description = "Seleciona testes JUnit afetados por um diff, via grafo de dependencias AST."
)
public final class Main implements Callable<Integer> {

    @Option(names = "--src", required = true,
            description = "Raiz de codigo-fonte Java a indexar. Repita a opcao para "
                    + "multiplas raizes, ex.: --src src/main/java --src src/test/java.")
    private List<Path> sourceRoots;

    @Option(names = "--changed-files", required = true,
            description = "Arquivo com um caminho alterado por linha "
                    + "(saida de 'git diff --name-only').")
    private Path changedFilesPath;

    @Option(names = "--format", defaultValue = "human",
            description = "human (padrao, legivel) | csv (lista separada por virgula, "
                    + "pronta para -Dtest=...).")
    private String format;

    @Option(
            names = "--diff",
            description = "Diff Git completo com --unified=0."
    )
    private Path diffPath;

    @Option(
            names = "--project-root",
            required = true,
            description = "Raiz do projeto que sera analisado."
    )
    private Path projectRoot;

    public static void main(String[] args) {
        System.exit(new CommandLine(new Main()).execute(args));
    }

    @Override
    public Integer call() throws IOException {
        DependencyGraph graph = new AstIndexer().index(sourceRoots);

        System.out.println(
                "------ GRAFO EM NIVEL DE METODO ------"
        );

        graph.printMethodGraph();

        System.err.println("Gráfico por métodos "
                            + graph.methodNodeCount()
                            + " nós, "
                            + graph.methodEdgeCount()
                            + " arestas."
        );

        System.err.printf(
                "Indexados %d nos, %d arestas (%d testes).%n",
                graph.nodeCount(), graph.edgeCount(), graph.testNodes().size());

        Set<String> changedTypes = readChangedTypes(changedFilesPath);
        Set<String> changedMethods = Set.of();
        if (diffPath != null) {
            changedMethods = new ChangedMethodDetector().detect(diffPath, projectRoot);
            System.err.printf(
                    "Detectados %d métodos alterados.%n",
                    changedMethods.size()
            );
        }
        TestSelector selector = new TestSelector();
        List<TestSelector.Selection> selections;

        // Se houver métodos alterados, prioriza a seleção por métodos, senão por classes.
        if (!changedMethods.isEmpty()) {
            System.err.println("Seleção por métodos");

            selections = selector.selectMethods(graph, changedMethods);
        } else {
            System.err.println("Seleção por classes");

            selections = selector.select(graph, changedTypes);
        }

        if ("csv".equals(format)) {
            String csv = selections.stream()
                    .map(TestSelector.Selection::test)
                    .distinct()
                    .collect(Collectors.joining(","));
            System.out.println(csv);
            return 0;
        }

        if (selections.isEmpty()) {
            System.out.println("Nenhum teste afetado pelas mudancas.");
            return 0;
        }

        for (TestSelector.Selection s : selections) {
            String because = s.test().equals(s.changedNode())
                    ? "alterado diretamente"
                    : "depende de " + s.changedNode();
            System.out.printf("%s  (%s)%n", s.test(), because);
        }

        // Resumo da analise
        System.out.println("\n------ RESUMO DA ANALISE ------");

        System.out.printf(
                "Grafo: %d metodos, %d dependencias.%n",
                graph.methodNodeCount(),
                graph.methodEdgeCount()
        );

        System.out.println("\nMetodos alterados:");
        if (changedMethods.isEmpty()) {
            System.out.println("  Nenhum metodo especifico detectado.");
        } else {
            changedMethods.forEach(
                    method -> System.out.println("  " + method)
            );
        }

        System.out.println("\nTestes afetados:");

        if (selections.isEmpty()) {
            System.out.println("  Nenhum teste afetado.");
        } else {
            selections.stream()
                    .map(TestSelector.Selection::test)
                    .distinct()
                    .forEach(
                            test -> System.out.println("  " + test)
                    );
        }

        System.out.println("\nMotivos:");

        for (TestSelector.Selection selection : selections) {
            System.out.printf(
                    "  %s depende de %s%n",
                    selection.test(),
                    selection.changedNode()
            );
        }

        System.out.println("\nDependencias encontradas:");

        for (String changedMethod : changedMethods) {

            Set<String> affectedMethods =
                    graph.affectedTestMethods(changedMethod);

            for (String testMethod : affectedMethods) {

                System.out.println(
                        "  " + testMethod
                );

                System.out.println(
                        "    -> " + changedMethod
                );

                System.out.println();
            }
        }

        System.out.println();

        return 0;


    }

    private Set<String> readChangedTypes(Path changedFilesPath) throws IOException {
        Set<String> types = new LinkedHashSet<>();
        for (String line : Files.readAllLines(changedFilesPath)) {
            String relPath = line.strip();
            if (relPath.endsWith(".java")) {
                types.add(pathToFqcn(relPath));
            }
        }
        return types;
    }

    /** Assume layout Maven padrao (src/main/java, src/test/java). Repos com outro
     * layout precisam ajustar este mapeamento — ver limitacoes no README. */
    private String pathToFqcn(String relPath) {
        String normalized = relPath.replace('\\', '/');
        for (String marker : List.of("src/main/java/", "src/test/java/")) {
            int idx = normalized.indexOf(marker);
            if (idx >= 0) {
                normalized = normalized.substring(idx + marker.length());
                break;
            }
        }
        return normalized.replace(".java", "").replace('/', '.');
    }
}
