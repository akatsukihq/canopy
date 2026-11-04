#!/usr/bin/env bash
# Build one package in place and write what Piston's `ppman install` would leave behind:
# pkg-info.json (Makefile step), .env (package.js "Caching environment"), .ppman-installed.
set -euo pipefail
lang=$1 ver=$2
dir=/piston/packages/$lang/$ver
cd "$dir"
chmod +x ./build.sh
./build.sh
jq '.build_platform="docker-debian"' metadata.json > pkg-info.json
env -i bash -c "cd '$dir'; source environment; env" \
  | grep -vE '^(PWD|OLDPWD|_|SHLVL)=' > .env
date +%s%3N | tr -d '\n' > .ppman-installed
