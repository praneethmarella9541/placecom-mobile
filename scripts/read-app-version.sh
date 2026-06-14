#!/usr/bin/env bash
# Reads APP_VERSION from constants/app-version.ts (single source of truth for releases).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node -e "
  const fs = require('fs');
  const text = fs.readFileSync('${ROOT}/constants/app-version.ts', 'utf8');
  const m = text.match(/APP_VERSION\\s*=\\s*['\\\"]([^'\\\"]+)['\\\"]/);
  if (!m) {
    console.error('APP_VERSION not found in constants/app-version.ts');
    process.exit(1);
  }
  process.stdout.write(m[1]);
"
