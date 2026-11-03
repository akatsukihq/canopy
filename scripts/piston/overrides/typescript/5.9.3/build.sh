#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-arm64.tar.xz eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8 node.tar.xz
tar xf node.tar.xz --strip-components=1
rm node.tar.xz
export PATH=$PWD/bin:$PATH
# @types/node lets `import { readFileSync } from "fs"` type-check; versions are exact so builds repeat.
bin/npm install -g --no-audit --no-fund typescript@5.9.3 @types/node@24.19.2
