#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://www.python.org/ftp/python/3.13.18/Python-3.13.18.tgz 99dbc847fb6a3fb26358370fb4c591215864116ebb584f2b89ab0b74c51dfa2a python.tar.gz
tar xzf python.tar.gz --strip-components=1
./configure --prefix "$PREFIX" --with-ensurepip=install
make -j"$(nproc)"
make install
cd .. && rm -rf build
