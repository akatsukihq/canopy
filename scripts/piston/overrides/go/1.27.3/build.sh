#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://dl.google.com/go/go1.27.3.linux-arm64.tar.gz a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49 go.tar.gz
tar xzf go.tar.gz
rm go.tar.gz
# Go >=1.20 ships no compiled std; prebuild it so runs read this cache instead of spending ~6 CPU-s compiling fmt/os.
GOCACHE=$PWD/gocache GOTOOLCHAIN=local GOTELEMETRY=off ./go/bin/go build std
