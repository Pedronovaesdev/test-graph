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
import functools
import sys

import graphify.build as build

for name in ("_abs_identity", "_norm_source_file"):
    fn = getattr(build, name, None)
    if callable(fn):
        setattr(build, name, functools.lru_cache(maxsize=None)(fn))

from graphify.__main__ import main  # noqa: E402

# A extracao em paralelo usa multiprocessing; no Windows cada processo filho
# reimporta este arquivo, e sem a guarda rodaria o graphify de novo.
if __name__ == "__main__":
    sys.argv[0] = "graphify"
    main()
