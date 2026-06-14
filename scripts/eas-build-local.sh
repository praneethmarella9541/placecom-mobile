#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=resolve-java.sh
source "$ROOT/scripts/resolve-java.sh"
# shellcheck source=resolve-android-sdk.sh
source "$ROOT/scripts/resolve-android-sdk.sh"

PROFILE="${1:-production}"
PLATFORM="${2:-android}"

resolve_java_home || exit 1
echo "Using JAVA_HOME=$JAVA_HOME"
java -version

if [ "$PLATFORM" = "android" ]; then
  resolve_android_sdk || exit 1
  echo "Using ANDROID_HOME=$ANDROID_HOME"
fi

cd "$ROOT"
exec npx eas-cli build --platform "$PLATFORM" --profile "$PROFILE" --local "${@:3}"
