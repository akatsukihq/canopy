#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_aarch64_linux_hotspot_17.0.21_9.tar.gz 3e4eca7ead088f080af1476007decf010a240a1eb4e1e78c54fa32fbcc347084 java.tar.gz
tar xzf java.tar.gz --strip-components=1
rm java.tar.gz
