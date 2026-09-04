#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-.}"
PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
# Apply the unified diff relative to the project root.
patch -p0 -d "$ROOT" < "$PATCH_DIR/ARINA_XRAY_V102_ALL_ISSUES.patch"
echo "ARINA X-RAY v102 patch applied. Run: node scripts/patch-v102-security-precision-regression.mjs"
