# Code execution (Piston) runbook

Canopy's online compilers run user code on a self-hosted [Piston](https://github.com/engineer-man/piston) engine.
It lives on a dedicated, secret-free Oracle Ampere (arm64) VM in a private subnet, in front of Caddy.
Design: `openspec/changes/add-online-compilers/design.md` (sections 1, 1a, 2).

Files: `.github/workflows/piston-image.yml`, `scripts/piston/` (`Dockerfile`, `overrides/`, `lib.sh`,
`finish-package.sh`, `provision.sh`, `abuse-fixtures.sh`).

## Packages in the image

All packages are built for linux/arm64 from `scripts/piston/overrides/<lang>/<version>/` (plus upstream
`packages/<lang>/<version>/` at the pinned Piston commit where upstream ships that version: python 3.12.0, bash 5.2.0).
Every download is verified against a hash in the override script (the build fails on mismatch). Source builds compile on
the arm64 runner. Each page offers the versions listed in its `lib/code-execution/languages.ts` entry; the first is the default.

| Tool | Piston language | Versions (default first) | Source (arm64) | License |
| --- | --- | --- | --- | --- |
| python-compiler | python | 3.15.2, 3.14.10, 3.13.18, 3.12.0 | python.org source tarballs, SHA-256 from python.org's release API | PSF |
| javascript-compiler | javascript (node package) | 26.13.0, 24.22.2, 22.23.4 (all LTS) | nodejs.org linux-arm64, SHA-256 from SHASUMS256.txt | MIT |
| typescript-compiler | typescript | 7.0.2, 6.0.3, 5.9.3 | npm `typescript@<v>` + `@types/node@24.19.2`, each on Node 24.22.2 | Apache-2.0 / MIT |
| java-compiler | java | 25.0.5, 21.0.13, 17.0.21 (all LTS) | Eclipse Temurin aarch64 JDKs, SHA-256 from the Adoptium API | GPLv2 + Classpath |
| c-compiler | c17, c23, c11 (`gcc` package) | 12.2.0 | Debian bookworm gcc 12.2.0 (wrapper; the language picks `-std`, C23 is `-std=c2x`) | GPL-3.0 + GCC Runtime Exception |
| cpp-compiler | c++20, c++23, c++17 (`gcc` package) | 12.2.0 | as above (C++23 is `-std=c++2b`, partial in GCC 12) | GPL-3.0 + GCC Runtime Exception |
| csharp-compiler | csharp (`dotnet` package) | 10.0.403 (C# 14), 8.0.427 (C# 12) | Microsoft .NET SDK linux-arm64, SHA-512 from releases.json; only runtime, reference packs and Roslyn kept | MIT |
| go-compiler | go | 1.27.3 | dl.google.com linux-arm64, SHA-256 from go.dev | BSD-3-Clause |
| rust-compiler | rust | 1.99.1 (2024 edition) | static.rust-lang.org aarch64 `.tar.xz`, `a48fb1e8...333e` (matches the published `.sha256`) | MIT OR Apache-2.0 |
| php-compiler | php | 8.5.12 | php.net source, SHA-256 from php.net's release API | PHP License 3.01 |
| ruby-compiler | ruby | 4.0.9, 3.4.12 | ruby-lang.org source, SHA-256 from releases.yml | Ruby / BSD-2-Clause |
| kotlin-compiler | kotlin | 2.4.21 | JetBrains zip (GitHub release digest) on Temurin 21.0.13 JRE aarch64 | Apache-2.0 / GPLv2 + CPE |
| bash-compiler | bash | 5.2.0 | ftp.gnu.org source, `a139c166...32fb` | GPL-3.0-or-later |

Adding a version: add `overrides/<lang>/<version>/` (`metadata.json`, `run`, `environment`, `build.sh`, and `compile`
for compiled languages), a `pkg-<lang>-<version>` stage plus its `COPY` line in the Dockerfile, and a `versions` entry in
the registry. Ship the image before the registry change; a version missing from the engine answers "not installed".

Full hashes are in each `scripts/piston/overrides/<lang>/<version>/build.sh` (Rust: `fetch-rust.sh`). All hashes were
taken from the vendors' own published checksums on 3 Nov 2026, not computed by us.

gcc decision: compiling GCC from source needs `download_prerequisites` (gmp from gcc.gnu.org), which timed out after
18 min, so the Piston `gcc` package is a thin wrapper over the system gcc 12.2.0. Each C/C++ standard is its own Piston
language (`c11`, `c17`, `c23`, `c++17`, `c++20`, `c++23`) provided by that one package, and `compile` maps it to `-std`.
`c` and `c++` stay as aliases of `c17` and `c++20`. Isolate already exposes `/usr` and `/lib`, but the package `environment`
must export an explicit `PATH`, or the driver cannot find `cc1`. Compiler errors name the file `main.c.c` / `main.cpp.cpp`
(upstream `rename` behaviour) and end with a harmless `chmod` line. A newer GCC needs a newer Debian base or a source build.

C# decision: Mono (C# 7) is replaced by .NET. `compile` runs Roslyn (`csc.dll`) directly with a response file of the
reference assemblies, the console template's implicit usings and nullable setting, instead of `dotnet build`, which needs
MSBuild, NuGet restore and far more time and memory than a run allows.

TypeScript: every version compiles with the same explicit options (`--target es2022 --module nodenext --strict`, Node
types), because TypeScript 6 changed the defaults and 7 removed node10 resolution.

Rust download: the tarball failed TLS verification inside `docker build`, so it is fetched on the host/runner by
`scripts/piston/fetch-rust.sh <dir>` (curl with retries, checked against both the pinned SHA-256 and the published `.sha256`) and
passed as the named build context: `docker build --build-context rust-dist=<dir> scripts/piston`. The package build checks the
hash again. The tarball is never committed.

Notes:

- Python omits upstream's pip extras (numpy, scipy, pandas and so on) to keep the image small.
- Older releases removed on 3 Nov 2026: Node 20, TypeScript 5.0, Java 15, Go 1.16, Rust 1.68, Ruby 3.0, PHP 8.2, Kotlin 1.8 and Mono. Python 3.12 stays
  (security support until 2028) and is already built. The sandbox is still the main control: no network, no secrets on the
  VM, disposable container.
- Debian bookworm base libraries come from the pinned base image digests in the Dockerfile; rebuilding picks up
  nothing new until those digests are bumped.

## 1. Build and publish the image

1. Actions, "Build Piston image", Run workflow. The default input is the pinned upstream commit
   `de2b365ac759670a3a0d13ea208a0869a92c7e64`. It runs on `ubuntu-24.04-arm`; expect roughly 1 to 2 hours
   (GCC and Python compile from source). Re-runs reuse the GitHub Actions layer cache.
2. The job pushes `ghcr.io/akatsukihq/canopy-piston:latest` and `ghcr.io/akatsukihq/canopy-piston:<sha7>-<YYYYMMDD>` (e.g. `de2b365-20261102`) with an SBOM and max-mode provenance
   attestation, and prints the digest in the job summary.
3. First publish only: the package is created private. In GitHub, Packages, `canopy-piston`, Package settings:
   link it to the repository and set visibility to Public. The image holds no secrets and the VM pulls without credentials.
   Never add tokens, the Caddy config or environment secrets to the image or build args.
4. Record the dated tag and digest in the table below, and commit that change (the dated tag is the rollback handle).

| Date | Tag | Digest | Notes |
| --- | --- | --- | --- |
| (none published yet) | | | |

Fallback: build on an Apple Silicon Mac with
`scripts/piston/fetch-rust.sh <dir>` then `docker buildx build --build-context rust-dist=<dir> --platform linux/arm64 --build-arg PISTON_SHA=<sha> -t ghcr.io/akatsukihq/canopy-piston:latest -t ghcr.io/akatsukihq/canopy-piston:<sha7>-<YYYYMMDD> --push scripts/piston`.

## 2. Provision the VM

Prereqs: Ubuntu 24.04 arm64, pure cgroup v2 (the default), private subnet, NSG allowing the Caddy port only from the
app VM's NSG, SSH via OCI Bastion, no instance IAM policy. The VM needs egress only until the image is pulled and
Docker/Caddy are installed; remove the egress route afterwards.

```sh
sudo ./scripts/piston/provision.sh            # pulls :latest
```

It checks arm64 and cgroup v2, installs Docker, Caddy, jq and curl if missing, creates `/etc/canopy/piston.env`
(root-only, `PISTON_API_TOKEN=...`) when absent, pulls `ghcr.io/akatsukihq/canopy-piston:latest` (or the tag or `sha256:` digest passed as the first argument or `PISTON_IMAGE`), replaces the `canopy-piston` container
(`--privileged --restart unless-stopped -p 127.0.0.1:2000:2000`, no volume on `/piston`, the design section 2
`PISTON_*` env), writes the Caddy config (private IP, bearer auth, only `GET /api/v2/runtimes` and
`POST /api/v2/execute`, 256 KiB body cap), and verifies: every registry language is listed by `/api/v2/runtimes`,
401 without or with a wrong token, 404 for `/api/v2/packages` and `/api/v2/connect`, 413 for a 300 KB body.
It is safe to re-run. Set `PISTON_REQUIRED_LANGUAGES` if a language was dropped. Read the token once with
`sudo grep PISTON_API_TOKEN /etc/canopy/piston.env` and store it as the app's `PISTON_API_TOKEN` secret (see
`.env.example`).

## 3. Rotate the token

1. On the VM: `sudo sed -i "s/^PISTON_API_TOKEN=.*/PISTON_API_TOKEN=$(openssl rand -hex 32)/" /etc/canopy/piston.env && sudo systemctl restart caddy`.
2. Read the new value, update the app's `PISTON_API_TOKEN` secret, redeploy or restart the app.
3. Runs fail closed ("unavailable") between steps 1 and 2; do them back to back. The token is never in the image, the
   Caddyfile or the container environment.

## 4. Upgrade (by digest) and roll back

- Upgrade: build a new image (section 1), run `provision.sh` (pulls `:latest` and replaces the container), and run
  `PISTON_API_TOKEN=... ./scripts/piston/abuse-fixtures.sh http://<private-ip>:8080`.
- Roll back: run `provision.sh <previous dated tag>` (or its `sha256:` digest) from the table above. The container is
  stateless; nothing to restore.
- `latest` moves on every build; pass a dated tag or digest when you need a reproducible deploy.

## 5. Rebuild after a suspected compromise

Treat a sandbox escape as a host compromise. The VM holds no secrets except the Caddy token.

1. Block inbound traffic to the VM (NSG) and capture anything you need for the investigation.
2. Terminate the instance and its boot volume; do not repair in place.
3. Create a new instance (design task 1.1 and 1.2), run `provision.sh` with a known-good dated tag.
4. Rotate the token (section 3). Rotate nothing else unless the app VM showed signs of access: the Piston VM has no
   path to app secrets by design.
5. Re-run the abuse fixtures. Rebuild the image from scratch (clear the Actions cache) if the image itself is in doubt.

## 6. What to monitor

- `docker ps` shows `canopy-piston` up and not restarting; `docker logs canopy-piston` for engine errors.
- Caddy: `journalctl -u caddy` status codes: 401 spikes (bad token or probing), 413 (oversized bodies), 5xx or
  upstream-unreachable (engine down).
- `GET /api/v2/runtimes` returns every registry language (the app already checks this every 60 s).
- Host: load average, memory, `docker stats`, disk free, and a stuck-job signal (runs hitting the `busy` outcome).
- App side: rate of `busy`, `unavailable`, time-limit and output-limit outcomes per language.
- Alert on: container restart, runtimes list missing a language, sustained 5xx, VM CPU above 90 percent for 10 minutes.

## 7. Abuse fixtures (task 2.4)

`scripts/piston/abuse-fixtures.sh <base-url>` sends each program and asserts the outcome, then a healthy hello-world:

| Fixture | Expected |
| --- | --- |
| Fork bomb (bash) | Request returns; host stays healthy |
| Infinite loop (python) | `run.status == "TO"` |
| Memory balloon (python) | Killed, non-zero code, no output |
| 10 MB output flood (python) | `run.status == "OL"`, output at most about 64 KiB |
| Socket open (python connect to 1.1.1.1:53) | Never prints `CONNECTED` |
| Filesystem escape (python writes outside the box, reads engine files) | Prints `CONTAINED` |
| Healthy afterwards | Hello world returns `ok`, exit 0 |

Run it through Caddy (`PISTON_API_TOKEN=... ./abuse-fixtures.sh http://<private-ip>:8080`) or directly on the VM
(`./abuse-fixtures.sh http://127.0.0.1:2000`). While it runs, watch `free -m` and `docker stats`; the fixture
asserts API outcomes, you confirm the host stayed responsive. Also run it after every image change.

## 8. Verification status of this runbook

Done on an Apple Silicon Mac (Docker via OrbStack, linux/arm64), 2 Nov 2026:

- Built the image (Isolate on bookworm, Piston API on node 20, packages python, node, typescript, java, mono, go, php, ruby,
  kotlin, bash baked in) and tagged it locally `canopy-piston:de2b365-20261102`.
- Ran it `--privileged`: the engine started, listed all 13 runtimes (incl. c, c++, rust), executed hello-world in each of them, and
  `abuse-fixtures.sh` passed all 7 cases against it directly (port 2000).

Not done (no access or time):

- The GitHub workflow was not run and nothing was pushed to GHCR; no digest exists yet. YAML parses; actionlint was not available.
- `provision.sh` was syntax-checked (`bash -n`) only. shellcheck was not available, and the script was not run on a VM, so the Caddy
  config, systemd drop-in and the 401/404/413 checks are untested.
- `PISTON_LIMIT_OVERRIDES`, cold-start timings and CPU fixtures (task 2.3) are not measured.
