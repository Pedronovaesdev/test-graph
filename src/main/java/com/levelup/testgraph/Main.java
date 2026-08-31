package com.levelup.testgraph;

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

    public static void main(String[] args) {
        System.exit(new CommandLine(new Main()).execute(args));
    }

    @Override
    public Integer call() throws IOException {
        DependencyGraph graph = new AstIndexer().index(sourceRoots);
        System.err.printf(
                "Indexados %d nos, %d arestas (%d testes).%n",
                graph.nodeCount(), graph.edgeCount(), graph.testNodes().size());

        Set<String> changedTypes = readChangedTypes(changedFilesPath);
        List<TestSelector.Selection> selections = new TestSelector().select(graph, changedTypes);

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
