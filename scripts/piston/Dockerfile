# syntax=docker/dockerfile:1
# Canopy's arm64 Piston image. Build context: scripts/piston/ (see docs/code-execution.md).
# Upstream api/Dockerfile (buster + node 15, both EOL) is replaced by this file; packages are
# built from overrides/<lang>/<ver>/ (plus upstream packages/<lang>/<ver>/ where upstream has that version).
# Pin: bump the digests deliberately and record them in docs/code-execution.md.
ARG PISTON_SHA=de2b365ac759670a3a0d13ea208a0869a92c7e64

# ---- upstream source (checked out at an exact commit; nothing runs from it directly) ----
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS piston-src
ARG PISTON_SHA
RUN printf 'Acquire::Retries "5";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/99canopy && apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git init -q /src && cd /src \
 && git fetch -q --depth 1 https://github.com/engineer-man/piston.git "$PISTON_SHA" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "$PISTON_SHA"

# ---- Isolate (envicutor fork, same commit as upstream api/Dockerfile) on bookworm ----
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS isolate
RUN printf 'Acquire::Retries "5";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/99canopy && apt-get update && apt-get install -y --no-install-recommends \
      build-essential git ca-certificates pkg-config libcap-dev libsystemd-dev \
 && rm -rf /var/lib/apt/lists/* \
 && git clone -q https://github.com/envicutor/isolate.git /tmp/isolate \
 && cd /tmp/isolate \
 && git checkout -q af6db68042c3aa0ded80787fbb78bc0846ea2114 \
 && make -j"$(nproc)" install

# ---- Piston API node_modules on node 20 (upstream uses EOL node 15) ----
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS api-deps
RUN printf 'Acquire::Retries "5";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/99canopy && apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /piston_api
COPY --from=piston-src /src/api/package.json /src/api/package-lock.json ./
RUN npm ci --omit=dev

# ---- package builder base: packages must be built at their final path (PREFIX is baked in) ----
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS pkg-base
RUN printf 'Acquire::Retries "5";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/99canopy && apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates jq unzip xz-utils bzip2 file pkg-config python3 m4 \
      libssl-dev libffi-dev zlib1g-dev libbz2-dev liblzma-dev libreadline-dev libsqlite3-dev \
      libncurses-dev libexpat1-dev libxml2-dev libyaml-dev libgdbm-dev uuid-dev \
 && rm -rf /var/lib/apt/lists/*
COPY lib.sh /opt/piston-build/lib.sh
COPY finish-package.sh /opt/piston-build/finish-package.sh

FROM pkg-base AS pkg-python-3.12.0
COPY --from=piston-src /src/packages/python/3.12.0 /piston/packages/python/3.12.0
COPY overrides/python/3.12.0 /piston/packages/python/3.12.0
RUN /opt/piston-build/finish-package.sh python 3.12.0

FROM pkg-base AS pkg-python-3.13.18
COPY overrides/python/3.13.18 /piston/packages/python/3.13.18
RUN /opt/piston-build/finish-package.sh python 3.13.18

FROM pkg-base AS pkg-python-3.14.10
COPY overrides/python/3.14.10 /piston/packages/python/3.14.10
RUN /opt/piston-build/finish-package.sh python 3.14.10

FROM pkg-base AS pkg-python-3.15.2
COPY overrides/python/3.15.2 /piston/packages/python/3.15.2
RUN /opt/piston-build/finish-package.sh python 3.15.2

FROM pkg-base AS pkg-node-26.13.0
COPY overrides/node/26.13.0 /piston/packages/node/26.13.0
RUN /opt/piston-build/finish-package.sh node 26.13.0

FROM pkg-base AS pkg-node-24.22.2
COPY overrides/node/24.22.2 /piston/packages/node/24.22.2
RUN /opt/piston-build/finish-package.sh node 24.22.2

FROM pkg-base AS pkg-node-22.23.4
COPY overrides/node/22.23.4 /piston/packages/node/22.23.4
RUN /opt/piston-build/finish-package.sh node 22.23.4

FROM pkg-base AS pkg-typescript-7.0.2
COPY overrides/typescript/7.0.2 /piston/packages/typescript/7.0.2
RUN /opt/piston-build/finish-package.sh typescript 7.0.2

FROM pkg-base AS pkg-typescript-6.0.3
COPY overrides/typescript/6.0.3 /piston/packages/typescript/6.0.3
RUN /opt/piston-build/finish-package.sh typescript 6.0.3

FROM pkg-base AS pkg-typescript-5.9.3
COPY overrides/typescript/5.9.3 /piston/packages/typescript/5.9.3
RUN /opt/piston-build/finish-package.sh typescript 5.9.3

FROM pkg-base AS pkg-java-25.0.5
COPY overrides/java/25.0.5 /piston/packages/java/25.0.5
RUN /opt/piston-build/finish-package.sh java 25.0.5

FROM pkg-base AS pkg-java-21.0.13
COPY overrides/java/21.0.13 /piston/packages/java/21.0.13
RUN /opt/piston-build/finish-package.sh java 21.0.13

FROM pkg-base AS pkg-java-17.0.21
COPY overrides/java/17.0.21 /piston/packages/java/17.0.21
RUN /opt/piston-build/finish-package.sh java 17.0.21

# Thin wrapper over the system gcc 12.2.0 (no upstream files; see docs/code-execution.md).
FROM pkg-base AS pkg-gcc-12.2.0
COPY overrides/gcc/12.2.0 /piston/packages/gcc/12.2.0
RUN /opt/piston-build/finish-package.sh gcc 12.2.0

FROM pkg-base AS pkg-dotnet-10.0.403
COPY overrides/dotnet/10.0.403 /piston/packages/dotnet/10.0.403
RUN /opt/piston-build/finish-package.sh dotnet 10.0.403

FROM pkg-base AS pkg-dotnet-8.0.427
COPY overrides/dotnet/8.0.427 /piston/packages/dotnet/8.0.427
RUN /opt/piston-build/finish-package.sh dotnet 8.0.427

FROM pkg-base AS pkg-go-1.27.3
COPY overrides/go/1.27.3 /piston/packages/go/1.27.3
RUN /opt/piston-build/finish-package.sh go 1.27.3

FROM pkg-base AS pkg-rust-1.99.1
COPY overrides/rust/1.99.1 /piston/packages/rust/1.99.1
# The verified tarball comes from the named build context `rust-dist` (scripts/piston/fetch-rust.sh).
RUN --mount=type=bind,from=rust-dist,target=/rust-dist /opt/piston-build/finish-package.sh rust 1.99.1

FROM pkg-base AS pkg-php-8.5.12
COPY overrides/php/8.5.12 /piston/packages/php/8.5.12
RUN /opt/piston-build/finish-package.sh php 8.5.12

FROM pkg-base AS pkg-ruby-4.0.9
COPY overrides/ruby/4.0.9 /piston/packages/ruby/4.0.9
RUN /opt/piston-build/finish-package.sh ruby 4.0.9

FROM pkg-base AS pkg-ruby-3.4.12
COPY overrides/ruby/3.4.12 /piston/packages/ruby/3.4.12
RUN /opt/piston-build/finish-package.sh ruby 3.4.12

FROM pkg-base AS pkg-kotlin-2.4.21
COPY overrides/kotlin/2.4.21 /piston/packages/kotlin/2.4.21
RUN /opt/piston-build/finish-package.sh kotlin 2.4.21

FROM pkg-base AS pkg-bash-5.2.0
COPY --from=piston-src /src/packages/bash/5.2.0 /piston/packages/bash/5.2.0
COPY overrides/bash/5.2.0 /piston/packages/bash/5.2.0
RUN /opt/piston-build/finish-package.sh bash 5.2.0

# ---- final image ----
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
ENV DEBIAN_FRONTEND=noninteractive
RUN printf 'Acquire::Retries "5";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/99canopy && apt-get update && apt-get install -y --no-install-recommends \
      build-essential coreutils util-linux procps locales binutils tar gnupg rename \
      libcap2 libseccomp2 libsystemd0 libxml2 libsqlite3-0 libreadline8 libffi8 libyaml-0-2 \
      libssl3 libicu72 zlib1g libbz2-1.0 liblzma5 libexpat1 libncurses6 libgdbm6 libuuid1 \
 && rm -rf /var/lib/apt/lists/* \
 && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen \
 && useradd -M piston
COPY --from=isolate /usr/local/bin/isolate /usr/local/bin/
COPY --from=isolate /usr/local/etc/isolate /usr/local/etc/isolate

WORKDIR /piston_api
COPY --from=api-deps /piston_api/node_modules ./node_modules
COPY --from=piston-src /src/api/package.json /src/api/package-lock.json ./
COPY --from=piston-src /src/api/src ./src
# Packages are owned by piston at build time, so drop the entrypoint's recursive chown
# (on overlayfs it would copy every package file into the writable layer on each start).
RUN sed -i '/chown -R piston:piston \/piston/d' src/docker-entrypoint.sh \
 && ! grep -q 'chown -R' src/docker-entrypoint.sh \
 && mkdir -p /piston/jobs && chown piston:piston /piston /piston/jobs
COPY --from=pkg-python-3.12.0 --chown=piston:piston /piston/packages/python/3.12.0 /piston/packages/python/3.12.0
COPY --from=pkg-python-3.13.18 --chown=piston:piston /piston/packages/python/3.13.18 /piston/packages/python/3.13.18
COPY --from=pkg-python-3.14.10 --chown=piston:piston /piston/packages/python/3.14.10 /piston/packages/python/3.14.10
COPY --from=pkg-python-3.15.2 --chown=piston:piston /piston/packages/python/3.15.2 /piston/packages/python/3.15.2
COPY --from=pkg-node-26.13.0 --chown=piston:piston /piston/packages/node/26.13.0 /piston/packages/node/26.13.0
COPY --from=pkg-node-24.22.2 --chown=piston:piston /piston/packages/node/24.22.2 /piston/packages/node/24.22.2
COPY --from=pkg-node-22.23.4 --chown=piston:piston /piston/packages/node/22.23.4 /piston/packages/node/22.23.4
COPY --from=pkg-typescript-7.0.2 --chown=piston:piston /piston/packages/typescript/7.0.2 /piston/packages/typescript/7.0.2
COPY --from=pkg-typescript-6.0.3 --chown=piston:piston /piston/packages/typescript/6.0.3 /piston/packages/typescript/6.0.3
COPY --from=pkg-typescript-5.9.3 --chown=piston:piston /piston/packages/typescript/5.9.3 /piston/packages/typescript/5.9.3
COPY --from=pkg-java-25.0.5 --chown=piston:piston /piston/packages/java/25.0.5 /piston/packages/java/25.0.5
COPY --from=pkg-java-21.0.13 --chown=piston:piston /piston/packages/java/21.0.13 /piston/packages/java/21.0.13
COPY --from=pkg-java-17.0.21 --chown=piston:piston /piston/packages/java/17.0.21 /piston/packages/java/17.0.21
COPY --from=pkg-gcc-12.2.0 --chown=piston:piston /piston/packages/gcc/12.2.0 /piston/packages/gcc/12.2.0
COPY --from=pkg-dotnet-10.0.403 --chown=piston:piston /piston/packages/dotnet/10.0.403 /piston/packages/dotnet/10.0.403
COPY --from=pkg-dotnet-8.0.427 --chown=piston:piston /piston/packages/dotnet/8.0.427 /piston/packages/dotnet/8.0.427
COPY --from=pkg-go-1.27.3 --chown=piston:piston /piston/packages/go/1.27.3 /piston/packages/go/1.27.3
COPY --from=pkg-rust-1.99.1 --chown=piston:piston /piston/packages/rust/1.99.1 /piston/packages/rust/1.99.1
COPY --from=pkg-php-8.5.12 --chown=piston:piston /piston/packages/php/8.5.12 /piston/packages/php/8.5.12
COPY --from=pkg-ruby-4.0.9 --chown=piston:piston /piston/packages/ruby/4.0.9 /piston/packages/ruby/4.0.9
COPY --from=pkg-ruby-3.4.12 --chown=piston:piston /piston/packages/ruby/3.4.12 /piston/packages/ruby/3.4.12
COPY --from=pkg-kotlin-2.4.21 --chown=piston:piston /piston/packages/kotlin/2.4.21 /piston/packages/kotlin/2.4.21
COPY --from=pkg-bash-5.2.0 --chown=piston:piston /piston/packages/bash/5.2.0 /piston/packages/bash/5.2.0

CMD ["/piston_api/src/docker-entrypoint.sh"]
EXPOSE 2000/tcp
