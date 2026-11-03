#!/usr/bin/env bash
set -euo pipefail
# arm64 override. The tarball is downloaded and verified OUTSIDE the build (scripts/piston/fetch-rust.sh)
# and mounted at /rust-dist; check the pinned hash again here so a wrong file can never be installed.
tar=/rust-dist/rust-1.99.1-aarch64-unknown-linux-gnu.tar.xz
echo "a48fb1e853be56ce9b8e2751f5464dbd5e16440cd81e237920f3a5e7e806333e  $tar" | sha256sum -c -
tar xJf "$tar"
# Only rustc + rust-std are used by `compile`; drop cargo, docs, analyzers, etc. to keep the image small.
cd rust-1.99.1-aarch64-unknown-linux-gnu
find . -mindepth 1 -maxdepth 1 -type d ! -name rustc ! -name 'rust-std-*' -exec rm -rf {} +
