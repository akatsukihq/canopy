#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-arm64.tar.xz 406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92 node.tar.xz
tar xf node.tar.xz --strip-components=1
rm node.tar.xz
