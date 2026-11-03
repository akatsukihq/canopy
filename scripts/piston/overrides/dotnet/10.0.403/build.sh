#!/usr/bin/env bash
set -euo pipefail
# .NET SDK for linux-arm64 (Microsoft's published SHA-512). Only the runtime, the reference assemblies and the
# Roslyn compiler are kept: `compile` calls csc directly, because `dotnet build` is too slow and too large for a run.
. /opt/piston-build/lib.sh
fetch https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-linux-arm64.tar.gz 0966aa2b70f4677b8319be9df447a78a0dcd6164836425b55a68fd714f4023feb87b4cac21b9a996b79472ad54487cd0adcd2a9dfd570e2b2a1d26423a2baa9b dotnet.tar.gz
tar xzf dotnet.tar.gz
rm dotnet.tar.gz
find sdk/10.0.403 -mindepth 1 -maxdepth 1 ! -name Roslyn -exec rm -rf {} +
find packs -mindepth 1 -maxdepth 1 ! -name Microsoft.NETCore.App.Ref -exec rm -rf {} +
rm -rf sdk-manifests templates metadata shared/Microsoft.AspNetCore.App
runtime=$(basename shared/Microsoft.NETCore.App/*)
# Compiler arguments shared by every run: references, defaults of `dotnet new console` (implicit usings, nullable).
{
  echo "-nologo -target:exe -langversion:latest -nullable:enable -out:main.dll"
  for dll in packs/Microsoft.NETCore.App.Ref/*/ref/net10.0/*.dll; do echo "-r:$PWD/$dll"; done
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
printf '{"runtimeOptions":{"tfm":"%s","framework":{"name":"Microsoft.NETCore.App","version":"%s"}}}\n' net10.0 "$runtime" > main.runtimeconfig.json
