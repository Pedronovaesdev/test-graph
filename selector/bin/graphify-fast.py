# Roda o graphify com memoizacao da resolucao de caminhos.
#
# Na extracao incremental, o graphify resolve o caminho real do arquivo de
# cada no e aresta do grafo (Path.resolve), dezenas de vezes por arquivo. Em
# projetos medios isso vira ~60% do tempo (no Windows, 48 s -> 17 s). As duas
# funcoes sao puras durante uma execucao, entao guardar o resultado por
# argumento nao muda a saida: o graph.json sai identico byte a byte.
#
# Chamado por select-tests.sh com o python do ambiente do graphify e
# PYTHONHASHSEED=0 (senao o graphify se re-executa e perde a memoizacao).
#
# Tambem corrige a leitura de `extends` do tsconfig: o TypeScript completa
# "../../tsconfig.base" para "tsconfig.base.json", mas o graphify so acrescenta
# ".json" quando o nome nao tem ponto nenhum. Sem isso, um monorepo com
# `"extends": "../../tsconfig.base"` perde todos os `paths` (ex.:
# `@bitwarden/common/*`) e os imports por apelido somem do grafo.
import functools
import sys
from pathlib import Path

import graphify.build as build

for name in ("_abs_identity", "_norm_source_file"):
    fn = getattr(build, name, None)
    if callable(fn):
        setattr(build, name, functools.lru_cache(maxsize=None)(fn))

try:
    import graphify.extractors.resolution as resolution
except ImportError:
    resolution = None

if resolution is not None and callable(getattr(resolution, "_read_tsconfig_aliases", None)):
    _read_aliases = resolution._read_tsconfig_aliases
    _resolve = resolution._resolve_cached

    def _resolve_config(p):
        r = _resolve(p)
        with_json = Path(str(r) + ".json")
        if r.suffix != ".json" and not r.exists() and with_json.is_file():
            return with_json
        return r

    def _read_tsconfig_aliases(tsconfig, base_dir, seen):
        # troca o resolvedor so durante a leitura do tsconfig (extends/references)
        previous = resolution._resolve_cached
        resolution._resolve_cached = _resolve_config
        try:
            return _read_aliases(tsconfig, base_dir, seen)
        finally:
            resolution._resolve_cached = previous

    resolution._read_tsconfig_aliases = _read_tsconfig_aliases

from graphify.__main__ import main  # noqa: E402

# A extracao em paralelo usa multiprocessing; no Windows cada processo filho
# reimporta este arquivo, e sem a guarda rodaria o graphify de novo.
if __name__ == "__main__":
    sys.argv[0] = "graphify"
    main()
