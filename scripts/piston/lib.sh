# Sourced by every override build.sh. fetch URL HASH OUTFILE: download and verify; retry up to 3 times.
# HASH is SHA-256 (64 hex) or SHA-512 (128 hex, as Microsoft publishes for .NET).
fetch() {
  local i sum=sha256sum
  ((${#2} == 128)) && sum=sha512sum
  for i in 1 2 3; do
    if curl -fsSL --retry 3 --retry-all-errors -o "$3" "$1" && echo "$2  $3" | $sum -c -; then
      return 0
    fi
    echo "fetch attempt $i failed for $1" >&2
  done
  return 1
}
