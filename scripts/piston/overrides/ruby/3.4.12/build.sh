#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://cache.ruby-lang.org/pub/ruby/3.4/ruby-3.4.12.tar.gz 5e5d85ad93b0adcccbad47733680f4892bd0078e3342437f7babce01c1872479 ruby.tar.gz
tar xzf ruby.tar.gz --strip-components=1
./configure --prefix "$PREFIX" --disable-install-doc
make -j"$(nproc)"
make install
cd .. && rm -rf build
