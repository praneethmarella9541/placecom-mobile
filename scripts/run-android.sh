#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=resolve-java.sh
source "$ROOT/scripts/resolve-java.sh"

resolve_java_home || exit 1
echo "Using JAVA_HOME=$JAVA_HOME"
exec npx expo run:android "$@"
