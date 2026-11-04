#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jdk_aarch64_linux_hotspot_25.0.5_8.tar.gz bb5b2ded252f21c6090cf780b0a408ad0d83bbb557e702955643557f13231880 java.tar.gz
tar xzf java.tar.gz --strip-components=1
rm java.tar.gz
