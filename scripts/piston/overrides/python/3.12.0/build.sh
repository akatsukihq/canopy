#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://www.python.org/ftp/python/3.12.0/Python-3.12.0.tgz 51412956d24a1ef7c97f1cb5f70e185c13e3de1f50d131c0aac6338080687afb python.tar.gz
tar xzf python.tar.gz --strip-components=1
./configure --prefix "$PREFIX" --with-ensurepip=install
make -j"$(nproc)"
make install
cd .. && rm -rf build
# ponytail: upstream also pip-installs numpy/scipy/pandas; omitted to keep the image small. Re-add only on demand.
