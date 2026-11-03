#!/usr/bin/env bash
set -euo pipefail
# arm64 override of upstream build.sh. Runs inside the package directory.
. /opt/piston-build/lib.sh
fetch https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.13_9.tar.gz b1734db7ade49c3f6acc6ae06233b8c2dd90e3e2f00f67000ae1c972aaa64d8c jre.tar.gz
tar xzf jre.tar.gz --strip-components=1
rm jre.tar.gz
fetch https://github.com/JetBrains/kotlin/releases/download/v2.4.21/kotlin-compiler-2.4.21.zip 7cc140e76daf416a0424a5557f99afd7ca89ebd463ea1101261e3e01c33e75cd kotlin.zip
unzip -q kotlin.zip
rm kotlin.zip
cp -r kotlinc/* .
rm -rf kotlinc
