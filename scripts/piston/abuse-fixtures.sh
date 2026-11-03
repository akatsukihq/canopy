#!/usr/bin/env bash
# Task 2.4 abuse fixtures. POSTs hostile programs to a Piston endpoint and asserts each ends in the
# expected outcome, then checks the engine still serves a normal run.
#
#   PISTON_API_TOKEN=... ./abuse-fixtures.sh http://10.0.1.5:8080     # via Caddy (token required)
#   ./abuse-fixtures.sh http://127.0.0.1:2000                          # direct, on the VM (no token)
#
# Run on a quiet engine: the fork bomb and memory balloon briefly load the host. Also watch the host
# (docker stats, free -m) while it runs; "host stays healthy" is a human check as well as the last case.
set -euo pipefail

BASE=${1:?usage: abuse-fixtures.sh <base-url>}
BASE=${BASE%/}
AUTH=()
[[ -z ${PISTON_API_TOKEN:-} ]] || AUTH=(-H "Authorization: Bearer $PISTON_API_TOKEN")
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }
FAILED=0

# run NAME LANGUAGE VERSION FILENAME SOURCE JQ_ASSERTION
# JQ_ASSERTION is evaluated against the whole Piston response; it must print true.
run() {
  local name=$1 lang=$2 ver=$3 file=$4 src=$5 assert=$6 body resp
  body=$(jq -n --arg l "$lang" --arg v "$ver" --arg f "$file" --arg c "$src" \
    '{language:$l, version:$v, files:[{name:$f, content:$c}]}')
  if ! resp=$(curl -sS --max-time 60 ${AUTH[@]+"${AUTH[@]}"} -H 'Content-Type: application/json' -d "$body" "$BASE/api/v2/execute"); then
    echo "FAIL  $name: request failed or exceeded 60 s"; FAILED=1; return
  fi
  if [[ $(jq -r "$assert" <<<"$resp" 2>/dev/null) == true ]]; then
    echo "PASS  $name  ($(jq -c '{status:.run.status,code:.run.code,signal:.run.signal}' <<<"$resp" 2>/dev/null))"
  else
    echo "FAIL  $name  response: $(head -c 600 <<<"$resp")"; FAILED=1
  fi
}

PY=$(curl -sS ${AUTH[@]+"${AUTH[@]}"} "$BASE/api/v2/runtimes" | jq -r '[.[]|select(.language=="python")][0].version')
SH=$(curl -sS ${AUTH[@]+"${AUTH[@]}"} "$BASE/api/v2/runtimes" | jq -r '[.[]|select(.language=="bash")][0].version')
[[ -n $PY && $PY != null && -n $SH && $SH != null ]] || { echo "python and bash runtimes required" >&2; exit 1; }

# 1. Fork bomb: process cap must hold; the request must return, not hang the host.
run "fork bomb" bash "$SH" main.sh ':(){ :|:& };:' '.run != null'

# 2. Infinite loop: killed by the time limit.
run "infinite loop" python "$PY" main.py $'while True:\n    pass' '.run.status == "TO"'

# 3. Memory balloon: killed at the memory limit, never completes.
run "memory balloon" python "$PY" main.py $'x = []\nwhile True:\n    x.append(bytearray(10_000_000))' \
  '.run.code != 0 and (.run.stdout // "") == ""'

# 4. 10 MB output flood: truncated and flagged, not returned in full.
run "output flood (10 MB)" python "$PY" main.py $'import sys\nwhile True:\n    sys.stdout.write("A" * 65536)' \
  '.run.status == "OL" and ((.run.output // "") | length) <= 70000'

# 5. Socket open: no network reachable from the sandbox.
run "socket open" python "$PY" main.py $'import socket\ns = socket.socket()\ns.settimeout(2)\ntry:\n    s.connect(("1.1.1.1", 53))\n    print("CONNECTED")\nexcept Exception as e:\n    print("BLOCKED", e)' \
  '((.run.stdout // "") | contains("CONNECTED") | not)'

# 6. Filesystem escape: no write outside the sandbox, no read of the engine's own files.
run "filesystem escape" python "$PY" main.py $'import os\nhit = []\nfor p in ("/etc/canopy-escape", "/piston/packages/escape", "/usr/escape"):\n    try:\n        open(p, "w").write("x"); hit.append(p)\n    except Exception:\n        pass\nfor p in ("/piston_api/src/config.js", "/etc/shadow", "/sys/fs/cgroup/cgroup.procs"):\n    try:\n        open(p).read(1); hit.append(p)\n    except Exception:\n        pass\nprint("ESCAPED" if hit else "CONTAINED", hit)' \
  '((.run.stdout // "") | contains("CONTAINED"))'

# 7. The engine is still healthy and answers a normal run.
run "healthy afterwards" python "$PY" main.py 'print("ok")' '.run.stdout == "ok\n" and .run.code == 0'

((FAILED == 0)) && echo "all fixtures passed" || { echo "SOME FIXTURES FAILED" >&2; exit 1; }
