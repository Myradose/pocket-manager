#!/usr/bin/env bash

set -euxo pipefail

if [ -d "dist" ]; then
  rm -rf dist
fi

pnpm build:frontend
pnpm build:backend
