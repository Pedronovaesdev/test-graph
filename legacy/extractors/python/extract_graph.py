#!/usr/bin/env python3
"""Extrai um grafo de dependencias de um projeto Python, via modulo `ast`
(a mesma arvore de sintaxe que o interpretador usa — nao e regex, nao e IA).

Diferenca importante em relacao ao indexador Java (que usa JavaParser +
resolucao de tipos): Python nao e tipado estaticamente por padrao, entao nao
da pra resolver com confianca "esta chamada de metodo vai exatamente para
aquela classe" — o mesmo nome pode significar coisas diferentes dependendo do
tipo em tempo de execucao. Por isso este extrator fica no nivel de MODULO
(arquivo): a aresta e "este arquivo importa aquele arquivo", nao "esta funcao
chama aquela funcao". Mais grosseiro que o grafo Java, mas confiavel — e e
assim que ferramentas reais (Jest --findRelatedTests, por exemplo) resolvem
esse problema em linguagens dinamicas.

Uso:
    python extract_graph.py --repo-root . --out graph.json
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

DEFAULT_EXCLUDED_DIRS = {
    ".git", ".venv", "venv", "__pycache__", "build", "dist",
    ".tox", "node_modules", ".mypy_cache", ".pytest_cache",
}


def find_python_files(repo_root: Path) -> list[Path]:
    files = []
    for path in repo_root.rglob("*.py"):
        if any(part in DEFAULT_EXCLUDED_DIRS or part.endswith(".egg-info") for part in path.parts):
            continue
        files.append(path)
    return files


def to_relpath(path: Path, repo_root: Path) -> str:
    return path.relative_to(repo_root).as_posix()


def build_module_index(files: list[Path], repo_root: Path) -> dict[str, str]:
    """Mapeia 'nome.de.modulo.pontuado' -> caminho relativo do arquivo, pra
    todo arquivo .py do projeto. E o que permite transformar um 'import
    app.services.calculator' numa aresta para o arquivo de verdade."""
    index: dict[str, str] = {}
    for file in files:
        rel = to_relpath(file, repo_root)
        no_ext = rel[:-3]  # remove ".py"
        if no_ext.endswith("/__init__"):
            dotted = no_ext[: -len("/__init__")].replace("/", ".")
        else:
            dotted = no_ext.replace("/", ".")
        index[dotted] = rel
    return index


def is_test_file(relpath: str) -> bool:
    """Convencao do pytest: arquivos test_*.py ou *_test.py."""
    name = Path(relpath).name
    return name.startswith("test_") or name.endswith("_test.py")


def resolve_plain_import(node: ast.Import, module_index: dict[str, str]) -> set[str]:
    resolved = set()
    for alias in node.names:
        if alias.name in module_index:
            resolved.add(module_index[alias.name])
    return resolved


def resolve_from_import(
    node: ast.ImportFrom, current_relpath: str, module_index: dict[str, str]
) -> set[str]:
    """Resolve 'from X import Y' (absoluto ou relativo, node.level > 0)."""
    dir_parts = current_relpath.split("/")[:-1]

    if node.level and node.level > 0:
        # "from . import x" (level=1) fica no mesmo diretorio; cada "." extra
        # (level=2 "from .. import x") sobe mais um nivel.
        up = node.level - 1
        base_parts = dir_parts[: len(dir_parts) - up] if up <= len(dir_parts) else []
        if node.module:
            base_parts = base_parts + node.module.split(".")
    else:
        base_parts = node.module.split(".") if node.module else []

    base = ".".join(base_parts)
    candidates = {base} if base else set()
    for alias in node.names:
        if alias.name == "*":
            continue
        candidates.add(f"{base}.{alias.name}" if base else alias.name)

    return {module_index[c] for c in candidates if c in module_index}


def extract_file(
    file: Path, repo_root: Path, module_index: dict[str, str]
) -> tuple[str, bool, set[str]]:
    relpath = to_relpath(file, repo_root)
    try:
        source = file.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=relpath)
    except (SyntaxError, UnicodeDecodeError) as e:
        print(f"aviso: nao consegui parsear {relpath}: {e}", file=sys.stderr)
        return relpath, is_test_file(relpath), set()

    edges: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            edges |= resolve_plain_import(node, module_index)
        elif isinstance(node, ast.ImportFrom):
            edges |= resolve_from_import(node, relpath, module_index)
    edges.discard(relpath)  # nao conta auto-referencia
    return relpath, is_test_file(relpath), edges


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=".", help="Raiz do projeto Python a indexar.")
    parser.add_argument("--out", required=True, help="Caminho do arquivo JSON de saida.")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    files = find_python_files(repo_root)
    module_index = build_module_index(files, repo_root)

    nodes = []
    edges = []
    for file in files:
        relpath, is_test, deps = extract_file(file, repo_root, module_index)
        nodes.append({"id": relpath, "isTest": is_test})
        for dep in deps:
            edges.append({"from": relpath, "to": dep})

    graph = {"nodes": nodes, "edges": edges}
    Path(args.out).write_text(json.dumps(graph, indent=2), encoding="utf-8")
    print(
        f"Indexados {len(nodes)} nos, {len(edges)} arestas "
        f"({sum(1 for n in nodes if n['isTest'])} testes). Escrito em {args.out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
