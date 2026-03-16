# CLAUDE.md

## Critical Rules (Read First)

**NEVER**:
- Use `as` type casting in ANY context including test code (explain the problem to the user instead)
- Use raw `fetch` or bypass TanStack Query for API calls
- Run `pnpm dev` or `pnpm start` (dev servers)
- Use `node:fs`, `node:path`, etc. directly (use Effect-TS equivalents)

**ALWAYS**:
- Use Effect-TS for all backend side effects
- Use Hono RPC + TanStack Query for all API calls
- Follow TDD: write tests first, then implement
- Run `pnpm typecheck` and `pnpm fix` before committing

## Project Overview

TSK Dashboard is a web UI to monitor, spawn, and observe tsk agent environments. It provides
terminal access, service iframe views, and a 3-up comparison layout for parallel agents.

**Core Architecture**:
- Frontend: Vite + TanStack Router + React 19 + TanStack Query
- Backend: Hono (standalone server) + Effect-TS (all business logic)
- Terminal: xterm.js + node-pty via WebSocket
- Single route: `/tsk` — the dashboard

## Development Workflow

### Quality Checks

```bash
# Type checking (mandatory before commits)
pnpm typecheck

# Auto-fix linting and formatting (Biome)
pnpm fix
```

After `pnpm fix`, manually address any remaining issues.

### Testing

```bash
# Run unit tests
pnpm test
```

**TDD Workflow**: Write tests → Run tests → Implement → Verify → Quality checks

## Key Directory Patterns

- `src/server/hono/route.ts` - Hono API routes definition (config, tsk, terminal only)
- `src/server/core/tsk/` - TSK task management (spawn, stop, continue, rename)
- `src/server/core/terminal/` - Terminal sessions (WebSocket, node-pty)
- `src/server/core/platform/` - Platform services (config, env, options)
- `src/app/tsk/` - TSK dashboard UI components
- `src/routes/` - TanStack Router routes (only `/tsk`)

## Coding Standards

### Backend: Effect-TS

**Prioritize Pure Functions**:
- Extract logic into pure, testable functions whenever possible
- Only use Effect-TS when side effects or state management is required

**Use Effect-TS for Side Effects and State**:
- Mandatory for I/O operations, async code, and stateful logic
- Reference: https://effect.website/llms.txt

**Avoid Node.js Built-ins**:
- Use `FileSystem.FileSystem` instead of `node:fs`
- Use `Path.Path` instead of `node:path`
- Use `Command.string` instead of `child_process`

**Type Safety - NO `as` Casting**:
- `as` casting is **strictly prohibited**
- Valid alternatives: type guards, assertion functions, Zod schema validation

### Frontend: API Access

**Hono RPC + TanStack Query Only**:
```typescript
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

const { data } = useQuery({
  queryKey: ["example"],
  queryFn: () => api.endpoint.$get().then(res => res.json())
})
```

Raw `fetch` and direct requests are prohibited.

### Tech Standards

- **Linter/Formatter**: Biome (not ESLint/Prettier)
- **Type Config**: `@tsconfig/strictest`
- **Path Alias**: `@/*` maps to `./src/*`

## Architecture Details

### API Routes (Hono)

All routes in `src/server/hono/route.ts`:
- `GET/PUT /api/config` — user config (theme, etc.)
- `GET /api/version` — package version
- `GET/POST/DELETE /api/tsk/tasks` — task CRUD
- `POST /api/tsk/tasks/:id/stop|continue` — task lifecycle
- `PATCH /api/tsk/tasks/:id/rename` — rename task
- `POST /api/tsk/tasks/:id/suggest-name` — AI name suggestion
- `POST /api/tsk/open` — open path in explorer/vscode
- `GET/PUT /api/tsk/service-config` — service display settings
- `POST/GET/DELETE /api/tsk/tasks/:id/terminals` — terminal CRUD
- `GET /api/tsk/tasks/:id/terminals/:name/ws` — terminal WebSocket

### Effect-TS Layers (Bottom-up DI)

```
Platform: UserConfigService, EnvService, CcvOptionsService
Domain:   TskService, ServiceDisplayConfigService, TerminalCleanupService, TerminalSessionService
Present:  TskController, TerminalController
```

## Development Tips

1. **Effect-TS Help**: https://effect.website/llms.txt
2. **Terminal debugging**: Check WebSocket connection in browser devtools Network tab
3. **Service views**: Configured via `GET/PUT /api/tsk/service-config`, persisted per project path
