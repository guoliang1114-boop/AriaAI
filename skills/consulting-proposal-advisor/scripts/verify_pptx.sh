#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/verify_pptx.sh deck.pptx [residue terms...]"
  exit 2
fi

deck="$1"
shift || true

if [[ ! -s "$deck" ]]; then
  echo "[ERROR] PPTX does not exist or is empty: $deck"
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -gt 0 ]]; then
  python3 "$script_dir/check_ppt_residue.py" "$deck" "$@"
fi

soffice_bin=""
if command -v soffice >/dev/null 2>&1; then
  soffice_bin="$(command -v soffice)"
elif [[ -x /opt/homebrew/bin/soffice ]]; then
  soffice_bin="/opt/homebrew/bin/soffice"
elif [[ -x /usr/bin/soffice ]]; then
  soffice_bin="/usr/bin/soffice"
elif [[ -x /usr/lib/libreoffice/program/soffice ]]; then
  soffice_bin="/usr/lib/libreoffice/program/soffice"
elif [[ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]]; then
  soffice_bin="/Applications/LibreOffice.app/Contents/MacOS/soffice"
fi

if [[ -n "$soffice_bin" ]]; then
  "$soffice_bin" --headless --convert-to pdf --outdir "$(dirname "$deck")" "$deck" >/dev/null
else
  echo "[WARN] LibreOffice/soffice not found; skipped PDF render verification. Install LibreOffice or add soffice to PATH."
fi

echo "[OK] PPTX verification completed: $deck"
