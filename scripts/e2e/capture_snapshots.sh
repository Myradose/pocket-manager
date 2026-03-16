#!/usr/bin/env bash

set -euo pipefail

export GLOBAL_CLAUDE_DIR=$(git rev-parse --show-toplevel)/mock-global-claude-dir

bun ./e2e/captureSnapshot/index.ts
