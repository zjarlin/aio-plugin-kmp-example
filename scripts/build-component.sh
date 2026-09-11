#!/bin/sh

set -eu

KOTLIN_CLI_NO_WELCOME_BANNER=1 ./kotlin build -m component -p wasmWasi -v release

CORE=build/artifacts/CompiledWebArtifact/componentwasmWasirelease/kotlin-output/component.wasm
EMBEDDED=build/component-embedded.wasm
ADAPTER=${WASI_ADAPTER:-build/wasi_snapshot_preview1.reactor.wasm}
OUTPUT=dist/plugin.wasm

mkdir -p build dist
if [ ! -f "$ADAPTER" ]; then
  curl --fail --location --retry 3 https://github.com/bytecodealliance/wasmtime/releases/download/v43.0.2/wasi_snapshot_preview1.reactor.wasm -o "$ADAPTER"
fi
ACTUAL=$(shasum -a 256 "$ADAPTER" | cut -d ' ' -f 1)
test "$ACTUAL" = eb4a4fccf1a2446e2c7606d2d90b7a9ca24d15d9161e363e4b34ce87bc18d173
wasm-tools validate --features all "$ADAPTER"
wasm-tools component embed "${AIO_PLATFORM:-../aio-platform}/lib/plugin/contract/wit/plugin.wit" --world plugin "$CORE" -o "$EMBEDDED"
wasm-tools component new "$EMBEDDED" \
  --adapt "wasi_snapshot_preview1=$ADAPTER" \
  -o "$OUTPUT"
wasm-tools validate --features component-model "$OUTPUT"

echo "$OUTPUT"
