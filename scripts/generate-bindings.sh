#!/bin/sh

set -eu

WIT_BINDGEN=${WIT_BINDGEN:-wit-bindgen}
OUTPUT=backend/component/src/site/addzero/aio/example/bindings

"$WIT_BINDGEN" kotlin \
  --kotlin-package-name site.addzero.aio.example.bindings \
  --kotlin-imports site.addzero.aio.example.counter.PluginRootFunctionsExportsImpl \
  --declaration-visibility internal \
  --cabi-realloc-freeing-strategy free-all \
  --out-dir "$OUTPUT" \
  "$@" \
  "${AIO_PLATFORM:-../aio-platform}/lib/plugin/contract/wit/plugin.wit"
perl -pi -e 's/[ \t]+$//g' "$OUTPUT"/*.kt
