#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://www.python.org/ftp/python/3.14.10/Python-3.14.10.tgz 9e4996c19ae5a3df31f10c37723661f71d3455d73bd005f79df7098e5cc13192 python.tar.gz
tar xzf python.tar.gz --strip-components=1
./configure --prefix "$PREFIX" --with-ensurepip=install
make -j"$(nproc)"
make install
cd .. && rm -rf build
