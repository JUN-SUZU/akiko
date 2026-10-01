#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { echo 'Node.js 22.12以降をインストールしてください。' >&2; exit 1; }
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) process.exit(1)' || { echo 'Node.js 22.12以降が必要です。' >&2; exit 1; }
export BASE_PATH="${BASE_PATH:-}"
npm ci
npm run check
npm run build
npm run test:server
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
exec npm start
