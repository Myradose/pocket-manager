# Pocket Manager

> Fork of [d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer)

> **Experimental.** This is not production-ready and may have bugs.

Web UI for monitoring and spawning [tsk](https://github.com/Myradose/tsk) agent environments. Provides terminal access to running containers, service iframe views, and a 3-up comparison layout for observing parallel agents working simultaneously.

## Stack

Vite, React 19, Hono, Effect-TS, TanStack Router/Query, xterm.js

## Key Locations

| Path | Purpose |
|------|---------|
| `src/server/hono/route.ts` | API routes |
| `src/app/tsk/` | Dashboard UI components |
| `src/server/core/tsk/` | Task management (spawn, stop, continue) |
| `src/server/core/terminal/` | Terminal sessions (WebSocket + node-pty) |
| `src/server/core/platform/` | Platform services (config, env) |

## Prerequisites

Requires a running tsk server:

```bash
tsk server start --http-port 7354
```

## Development

```bash
bun install
bun run dev         # Start dev server (frontend + backend)
bun run typecheck   # Type checking
bun run fix         # Lint and format (Biome)
bun run test        # Unit tests
```
