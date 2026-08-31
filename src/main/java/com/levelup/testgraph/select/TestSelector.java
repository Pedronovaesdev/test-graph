package com.levelup.testgraph.select;

import com.levelup.testgraph.graph.DependencyGraph;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Dado o grafo de dependencias e o conjunto de tipos alterados, encontra todo teste
 * que (transitivamente) depende de algum deles — via travessia reversa no grafo.
 */
public final class TestSelector {

    /** Um teste selecionado, e o no alterado que o justifica (para explicabilidade). */
    public record Selection(String test, String changedNode) {
    }

    public List<Selection> select(DependencyGraph graph, Set<String> changedNodes) {
        List<Selection> selections = new ArrayList<>();
        Set<String> alreadySelected = new LinkedHashSet<>();

        for (String changed : changedNodes) {
            if (!graph.contains(changed)) {
                continue; // arquivo alterado nao e um tipo Java indexado (ex.: pom.xml, README)
            }
            if (graph.testNodes().contains(changed) && alreadySelected.add(changed)) {
                selections.add(new Selection(changed, changed));
            }
            for (String ancestor : graph.ancestorsOf(changed)) {
                if (graph.testNodes().contains(ancestor) && alreadySelected.add(ancestor)) {
                    selections.add(new Selection(ancestor, changed));
                }
            }
        }
        return selections;
    }
}
