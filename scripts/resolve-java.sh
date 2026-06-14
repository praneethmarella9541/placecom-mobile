# Source from other scripts:  source "$(dirname "$0")/resolve-java.sh"

_java_major_version() {
  local java_bin="${1:-java}"
  "$java_bin" -version 2>&1 | awk -F\" '/version/ {split($2, parts, "."); print (parts[1] == 1 ? parts[2] : parts[1]); exit}'
}

_java_is_usable() {
  local home="$1"
  [ -n "$home" ] && [ -x "$home/bin/java" ] || return 1
  local major
  major="$(_java_major_version "$home/bin/java")"
  [ -n "$major" ] && [ "$major" -ge 17 ]
}

resolve_java_home() {
  local candidate=""

  if [ -n "${JAVA_HOME:-}" ] && _java_is_usable "$JAVA_HOME"; then
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi

  if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    candidate="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif [ -d "/Applications/Android Studio.app/Contents/jbr" ]; then
    candidate="/Applications/Android Studio.app/Contents/jbr"
  elif command -v brew >/dev/null 2>&1; then
    candidate="$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
  fi

  if [ -n "$candidate" ] && _java_is_usable "$candidate"; then
    export JAVA_HOME="$candidate"
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi

  if /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    candidate="$(/usr/libexec/java_home -v 17)"
    if _java_is_usable "$candidate"; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      return 0
    fi
  fi

  echo "Java 17+ is required for Android builds (Expo SDK 54)."
  if [ -n "${JAVA_HOME:-}" ]; then
    echo "JAVA_HOME is set to $JAVA_HOME but that JDK is too old or invalid."
  fi
  echo "Install with: brew install openjdk@17"
  echo "Then rerun: npm run build:local:apk:android"
  return 1
}
