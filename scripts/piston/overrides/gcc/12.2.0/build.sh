#!/usr/bin/env bash
set -euo pipefail
# No toolchain is built: this package is a thin wrapper over Debian bookworm's gcc/g++ from the
# image's build-essential (see docs/code-execution.md). Fail the build if the pinned version drifts.
[[ $(gcc -dumpfullversion) == 12.2.0 && $(g++ -dumpfullversion) == 12.2.0 ]]
