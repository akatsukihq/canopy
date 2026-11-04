#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
PREFIX=$(realpath "$(dirname "$0")")
mkdir -p build && cd build
fetch https://cache.ruby-lang.org/pub/ruby/4.0/ruby-4.0.9.tar.gz c35350682ff050b79702d57ade4516e7336063f510155d19fb2fb5b3f3909511 ruby.tar.gz
tar xzf ruby.tar.gz --strip-components=1
./configure --prefix "$PREFIX" --disable-install-doc
make -j"$(nproc)"
make install
cd .. && rm -rf build
