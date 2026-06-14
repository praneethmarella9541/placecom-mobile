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
npx eas-cli build --platform "$PLATFORM" --profile "$PROFILE" --local "${@:3}"

if [ "$PLATFORM" = "android" ]; then
  LATEST_BUILD="$(ls -t "$ROOT"/build-*.apk 2>/dev/null | head -1 || true)"
  if [ -n "$LATEST_BUILD" ]; then
    APP_VERSION="$("$ROOT/scripts/read-app-version.sh")"
    OUTPUT_APK="$ROOT/thenucleus_${APP_VERSION}.apk"
    mv -f "$LATEST_BUILD" "$OUTPUT_APK"
    echo ""
    echo "Release APK: $OUTPUT_APK"
  fi
fi
