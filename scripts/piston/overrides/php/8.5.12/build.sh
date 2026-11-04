#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build/php && cd build
fetch https://www.php.net/distributions/php-8.5.12.tar.gz 81a0f450349e84b08eb43faa85f8a4c835684f3cc1c50471775d1317a046c525 php.tar.gz
tar xzf php.tar.gz --strip-components=1 -C php
cd php
./configure --prefix "$PREFIX"
make -j"$(nproc)"
make install
cd ../.. && rm -rf build
