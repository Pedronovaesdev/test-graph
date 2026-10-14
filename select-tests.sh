#!/usr/bin/env bash
# Atalho: o script de verdade fica no pacote (selector/bin/select-tests.sh),
# que e o mesmo publicado no npm. Veja `select-tests.sh --help`.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/selector/bin/select-tests.sh" "$@"
