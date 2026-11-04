#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-arm64.tar.xz 6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b node.tar.xz
tar xf node.tar.xz --strip-components=1
rm node.tar.xz
