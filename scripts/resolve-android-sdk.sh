# Source from other scripts:  source "$(dirname "$0")/resolve-android-sdk.sh"

_android_sdk_is_usable() {
  local sdk="$1"
  [ -n "$sdk" ] && [ -d "$sdk/platform-tools" ]
}

resolve_android_sdk() {
  local candidate=""

  if [ -n "${ANDROID_HOME:-}" ] && _android_sdk_is_usable "$ANDROID_HOME"; then
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    if [ -d "$ANDROID_HOME/ndk" ]; then
      export ANDROID_NDK_HOME="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
    fi
    return 0
  fi
  if [ -n "${ANDROID_SDK_ROOT:-}" ] && _android_sdk_is_usable "$ANDROID_SDK_ROOT"; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
    return 0
  fi

  for candidate in \
    "$HOME/Library/Android/sdk" \
    "/opt/homebrew/share/android-commandlinetools" \
    "/usr/local/share/android-commandlinetools"; do
    if _android_sdk_is_usable "$candidate"; then
      export ANDROID_HOME="$candidate"
      export ANDROID_SDK_ROOT="$candidate"
      if [ -d "$ANDROID_HOME/ndk" ]; then
        export ANDROID_NDK_HOME="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
      fi
      return 0
    fi
  done

  echo "Android SDK not found. Install with:"
  echo "  brew install --cask android-commandlinetools android-platform-tools"
  echo "Then rerun: npm run build:local:apk:android"
  return 1
}
