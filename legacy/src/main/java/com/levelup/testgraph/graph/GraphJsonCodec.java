package com.levelup.testgraph.graph;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

/**
 * Le um {@link DependencyGraph} a partir do formato JSON que QUALQUER extrator
 * (Java, Python, Node, ou um futuro quarto) pode produzir. Esse arquivo e o
 * "contrato" entre o motor de grafo (agnostico de linguagem) e a etapa de
 * indexacao (especifica de cada linguagem) — ver docs/graph-schema.md.
 *
 * Formato esperado:
 * <pre>{@code
 * {
 *   "nodes": [ { "id": "src/calculator.py", "isTest": false } ],
 *   "edges": [ { "from": "tests/test_calculator.py", "to": "src/calculator.py" } ]
 * }
 * }</pre>
 */
public final class GraphJsonCodec {

    private GraphJsonCodec() {
    }

    public static DependencyGraph load(Path jsonFile) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        GraphFile parsed = mapper.readValue(jsonFile.toFile(), GraphFile.class);

        DependencyGraph graph = new DependencyGraph();
        for (NodeEntry node : nullToEmpty(parsed.nodes())) {
            graph.addNode(node.id());
            if (node.isTest()) {
                graph.markAsTest(node.id());
            }
        }
        for (EdgeEntry edge : nullToEmpty(parsed.edges())) {
            graph.addEdge(edge.from(), edge.to());
        }
        return graph;
    }

    private static <T> List<T> nullToEmpty(List<T> list) {
        return list == null ? List.of() : list;
    }

    /** Espelha exatamente a forma do JSON — Jackson preenche por nome de campo. */
    record GraphFile(List<NodeEntry> nodes, List<EdgeEntry> edges) {
    }

    record NodeEntry(String id, boolean isTest) {
    }

    record EdgeEntry(String from, String to) {
    }
}
