#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.13_9.tar.gz e3522e707fc7dbe2a72c30746b1e7068301a0213ecd213d4491f35a14eb55578 java.tar.gz
tar xzf java.tar.gz --strip-components=1
rm java.tar.gz
