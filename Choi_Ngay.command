#!/bin/bash
set -e

cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' 'Choi_Ngay.command needs Python 3.12 or newer.' >&2
    exit 1
fi

exec python3 -I -B -X utf8 server/portable_launcher.py "$@"
