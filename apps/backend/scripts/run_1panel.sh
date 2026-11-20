#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if (( EUID == 0 )); then
    printf '%s\n' 'The 1Panel backend must run as a non-root user.' >&2
    exit 1
fi

if [[ ! ${RELEASE_VERSION:-} =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'RELEASE_VERSION must be a full Git commit SHA.' >&2
    exit 1
fi

export UV_PROJECT_ENVIRONMENT=/runtime/.venv
export UV_CACHE_DIR=/runtime/uv-cache
export UV_LINK_MODE=copy

uv_sync=(/deploy-bin/uv sync --locked --no-dev --no-build --no-python-downloads --python /usr/local/bin/python)

case "${1:-}" in
    prepare)
        exec "${uv_sync[@]}"
        ;;
    serve)
        "${uv_sync[@]}" --check --offline
        exec /runtime/.venv/bin/python -m uvicorn app.main:app \
            --host 0.0.0.0 --port 18168 --no-proxy-headers
        ;;
    *)
        printf '%s\n' 'Usage: run_1panel.sh {prepare|serve}' >&2
        exit 2
        ;;
esac
