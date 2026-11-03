#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://ftp.gnu.org/gnu/bash/bash-5.2.tar.gz a139c166df7ff4471c5e0733051642ee5556c1cc8a4a78f145583c5c81ab32fb bash.tar.gz
tar xzf bash.tar.gz --strip-components=1
./configure --prefix "$PREFIX"
make -j"$(nproc)"
make install
cd .. && rm -rf build
