#!/usr/bin/env bash
# Download the official Rust 1.99.1 aarch64 tarball and verify it against the pinned hash AND the
# hash published next to it. Usage: fetch-rust.sh <output-dir>   (then: docker build --build-context rust-dist=<dir>)
set -euo pipefail
out=${1:?usage: fetch-rust.sh <output-dir>}
name=rust-1.99.1-aarch64-unknown-linux-gnu.tar.xz
pinned=a48fb1e853be56ce9b8e2751f5464dbd5e16440cd81e237920f3a5e7e806333e
url=https://static.rust-lang.org/dist/2026-10-15/$name
mkdir -p "$out"
curl -fsSL --retry 10 --retry-all-errors -C - -o "$out/$name" "$url"
published=$(curl -fsSL --retry 10 --retry-all-errors "$url.sha256" | awk '{print $1}')
[[ $published == "$pinned" ]] || { echo "published hash $published != pinned $pinned" >&2; exit 1; }
echo "$pinned  $out/$name" | sha256sum -c -
