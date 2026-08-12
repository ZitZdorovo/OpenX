# AGENTS.md

## Overview

OpenX is a cross-platform Electron desktop client for an existing OpenClaw Gateway. The renderer uses React 19, Vite, TypeScript, Zustand, and the typed host-api boundary. OpenX does not start, supervise, repair, restart, or stop a Gateway process.

## Quick reference

| Task | Command |
|---|---|
| Install dependencies and bundled tools | `pnpm run init` |
| Start Vite and Electron | `pnpm dev` |
| Lint without modifying files | `pnpm run lint:check` |
| Lint and fix | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests | `pnpm test` |
| Electron E2E tests | `pnpm run test:e2e` |
| Build Electron Main and renderer | `pnpm run build:vite` |
| Harness checks | `pnpm run harness:ci` |

## Architecture rules

- The user supplies a remote `ws://` or `wss://` Gateway URL and token/password. Secrets stay in Main and are encrypted through Electron `safeStorage`.
- Renderer code must call `src/lib/host-api.ts`. Do not add direct IPC calls in pages/components and do not call Gateway HTTP or WebSocket endpoints from Renderer.
- Electron Main owns the Gateway WebSocket, authentication, reconnect/backoff, RPC, config delivery, and Node registration.
- Cron, Channels, Skills, sessions, agents, models, and configuration are remote-Gateway features. Do not introduce local fallbacks that make them appear functional while disconnected.
- The bundled OpenClaw runtime exists only for the ACP stdio-to-WebSocket bridge and packaged helper commands. It must never be used to host a local Gateway.
- OpenX registers a restricted `node-host` connection. New node commands must be explicitly declared, validated, and routed through the same service used by the UI; never expose arbitrary shell execution.
- Chat organization is Project -> nested folders -> chats, plus a separate pinned section. Do not restore the legacy workspace-first sidebar.
- Moving a chat into a project/folder updates its remote session working directory. Moving it back to the session list restores the default OpenClaw workspace.

## UI and code conventions

- New user-facing text must use `react-i18next` in all four locales: `en`, `ru`, `zh`, and `ja`.
- Use the surface, selection, and status tokens documented in `src/styles/globals.css`.
- Keep the established OpenX layout and visual language. Do not redesign page structure unless the task explicitly requires it.
- User-visible UI changes require a matching Electron Playwright scenario.
- Use strict TypeScript types; do not introduce `any`.

## Validation

- Communication changes: run `pnpm run comms:replay` and `pnpm run comms:compare`.
- Functional or architecture changes: update relevant README and harness documentation.
- Gateway/host-api changes require a task spec under `harness/specs/tasks/` referencing `gateway-backend-communication` and a harness validation run.
- Before handoff, run typecheck, lint, relevant unit tests, the affected E2E specs, and `build:vite`.

## Environment notes

- The exact pnpm version is pinned in `package.json`.
- Optional native messaging dependencies may emit harmless ignored-build warnings during install.
- Windows symlink security tests require Developer Mode or an elevated process; an `EPERM` from those cases is an environment limitation, not a product assertion failure.
- OpenX can be developed and navigated without provider credentials, but remote features require a reachable authenticated Gateway.
