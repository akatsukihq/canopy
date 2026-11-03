#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://www.python.org/ftp/python/3.15.2/Python-3.15.2.tgz f74e1db0eabd651cd01e4e2a00201bd41866abe74869ab716f9bf33cbbaa0943 python.tar.gz
tar xzf python.tar.gz --strip-components=1
./configure --prefix "$PREFIX" --with-ensurepip=install
make -j"$(nproc)"
make install
cd .. && rm -rf build
