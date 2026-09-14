package com.levelup.testgraph.index;

import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;

public final class MethodResolver {
    private MethodResolver() {
    }

    public static String resolve(String typeName, MethodDeclaration methodDeclaration) {
        try {
            // Tenta resolver o método para obter a assinatura qualificada completa
            ResolvedMethodDeclaration resolved = methodDeclaration.resolve();
            return resolved.getQualifiedSignature();
        } catch (RuntimeException e) {
            // Se não for possível resolver, retorna uma representação simples
            return typeName + "." + methodDeclaration.getSignature().asString();
        }
    }
}
