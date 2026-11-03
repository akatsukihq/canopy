#!/usr/bin/env bash
set -euo pipefail
# .NET SDK for linux-arm64 (Microsoft's published SHA-512). Only the runtime, the reference assemblies and the
# Roslyn compiler are kept: `compile` calls csc directly, because `dotnet build` is too slow and too large for a run.
. /opt/piston-build/lib.sh
fetch https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.427/dotnet-sdk-8.0.427-linux-arm64.tar.gz 2b851de08e94922b382d1d2754df112cd167f6e9b6f3d15d2cfe143fded1d5b05d6b196b545941d22c97db62bb426d71a4fe6e131a92e482c6ea1a7337ffedab dotnet.tar.gz
tar xzf dotnet.tar.gz
rm dotnet.tar.gz
find sdk/8.0.427 -mindepth 1 -maxdepth 1 ! -name Roslyn -exec rm -rf {} +
find packs -mindepth 1 -maxdepth 1 ! -name Microsoft.NETCore.App.Ref -exec rm -rf {} +
rm -rf sdk-manifests templates metadata shared/Microsoft.AspNetCore.App
runtime=$(basename shared/Microsoft.NETCore.App/*)
# Compiler arguments shared by every run: references, defaults of `dotnet new console` (implicit usings, nullable).
{
  echo "-nologo -target:exe -langversion:latest -nullable:enable -out:main.dll"
  for dll in packs/Microsoft.NETCore.App.Ref/*/ref/net8.0/*.dll; do echo "-r:$PWD/$dll"; done
} > csc.rsp
cat > GlobalUsings.cs <<'CS'
global using System;
global using System.Collections.Generic;
global using System.IO;
global using System.Linq;
global using System.Net.Http;
global using System.Threading;
global using System.Threading.Tasks;
CS
printf '{"runtimeOptions":{"tfm":"%s","framework":{"name":"Microsoft.NETCore.App","version":"%s"}}}\n' net8.0 "$runtime" > main.runtimeconfig.json
