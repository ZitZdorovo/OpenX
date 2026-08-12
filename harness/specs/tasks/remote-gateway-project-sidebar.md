---
id: remote-gateway-project-sidebar
title: Remote Gateway client with project-organized chats
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Deliver OpenX as a remote-only OpenClaw Gateway client and replace workspace-first chat navigation with persisted projects, nested folders, pinned chats, and agent-callable organization operations.
touchedAreas:
  - AGENTS.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - PROJECT_STATUS.md
  - harness/**
  - electron/gateway/**
  - electron/extensions/**
  - electron/main/**
  - electron/services/**
  - electron/shared/**
  - electron/utils/store.ts
  - shared/host-api/**
  - shared/chat/**
  - shared/i18n/**
  - shared/types/**
  - src/**
  - tests/**
  - package.json
  - "*-extensions.json"
  - electron-builder.yml
  - index.html
  - resources/**
  - scripts/**
  - vite.config.ts
  - tailwind.config.js
expectedUserBehavior:
  - First launch asks only for a ws:// or wss:// Gateway URL, token/password authentication mode, and the matching secret.
  - The Gateway credential is encrypted by the operating-system-backed Electron safe storage and is never returned in settings snapshots or exported as plaintext.
  - The Main process owns the remote WebSocket handshake, authenticates with auth.token or auth.password, and reports unauthorized, unreachable, connecting, reconnecting, and connected states distinctly.
  - OpenX sends the stable https://openx.invalid WebSocket Origin so the Gateway can explicitly allow it without a wildcard; origin-policy failures are distinct from invalid credentials.
  - Disconnects retry with exponential backoff without spawning, supervising, restarting, repairing, or killing an OpenClaw process.
  - Chat navigation is projects -> nested folders -> chats, plus a separate collapsible pinned section; the legacy workspace-grouped tree is absent.
  - Projects select a local working directory through the native folder picker. Project/folder collapse, nesting, chat order, pin state, and moves persist across app launches.
  - Chats can be reordered and moved between folders and projects with drag and drop; pinned chats can also be reordered directly inside the pinned section. Deleting a non-empty folder or project requires confirmation.
  - Cron, Channels, and Skills require a connected remote Gateway and execute through Main-owned Gateway RPC rather than local OpenClaw config/files/processes.
  - The agent can invoke the same typed pin, rename, and move operations used by the UI.
  - OpenX registers a second role=node/client=node-host WebSocket so remote agents can discover the desktop client and invoke its declared openx.* commands through the official node.invoke protocol.
  - Existing visual tokens, typography, message styling, radii, shadows, and page composition remain unchanged; the compact sidebar header identifies the client as OpenX and arranges its project tree in the established visual language.
  - Blue keyboard and editing focus accents render inside control bounds without adding an external ring or shifting the visual grid.
  - Model variant suffixes are grouped into a separate Thinking selector, readable model names are derived automatically, user-corrected aliases and presets persist, and model plus Thinking selection is remembered per chat.
  - Long chats expose an animated turn navigator that previews the current user/assistant exchange and scrolls smoothly between turns.
  - Text selection and clipboard copying are enabled only inside the rendered message timeline, not the composer, header, sidebar, statistics, settings, or other UI chrome.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - sidebar-session-attention-authority
  - session-workspace-authority
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/remote-gateway-connection.test.ts
  - tests/unit/clipboard-policy.test.ts
  - tests/unit/chat-scroll-navigator.test.tsx
  - tests/unit/project-tree.test.ts
  - tests/unit/chat-organization-api.test.ts
  - tests/unit/model-display.test.ts
  - tests/unit/model-preferences.test.ts
  - tests/e2e/remote-gateway-setup.spec.ts
  - tests/e2e/project-sidebar.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Production startup and shutdown paths contain no OpenClaw Gateway child-process spawn, bundled binary preparation, orphan cleanup, supervisor, local doctor recovery, or lifecycle restart behavior.
  - The configured Gateway endpoint is a validated ws:// or wss:// URL and is passed unchanged to the Main-owned WebSocket transport.
  - The connect frame selects exactly one shared-secret field, auth.token or auth.password, and device signing binds the selected secret to the server challenge.
  - The WebSocket upgrade sends Origin https://openx.invalid and an origin-policy rejection is not reported as a bad token.
  - Close code 1008 with an authentication failure is terminal until credentials change; transient network failures and established-socket disconnects use bounded exponential backoff.
  - No Gateway credential is present in electron-store settings, renderer persistence, logs, diagnostics, exported settings, URLs, or RPC error messages.
  - Renderer code uses hostApi/api-client and typed host events only; it opens no direct Gateway WebSocket and calls no Gateway HTTP endpoint.
  - Electron Main opens a separate authenticated node-host socket with role=node, declares only supported commands, handles node.invoke.request, replies through node.invoke.result, and reconnects without affecting the operator UI socket.
  - The authenticated operator connection adds only declared openx.* commands to gateway.nodes.allowCommands and approves the matching node role for its own signed device identity.
  - Workspace-group sidebar rendering and its persisted recent-workspace/label authority are removed rather than displayed beside the project tree.
  - Organization writes are validated in Main, persisted atomically, exposed through the typed host contract, and used by both UI interactions and agent RPC dispatch.
  - Cron, Channels, and Skills return a typed disconnected failure rather than falling back to local files, local CLI processes, or local Gateway state.
  - New user-facing strings exist in en, zh, ja, and ru locales and the changed interactions have Electron E2E coverage.
  - Model display aliases, presets, usage counts, and per-chat model plus Thinking choices persist through the existing preference mechanism; intentional choices patch the remote session with sessions.patch.
  - The chat turn navigator uses 9x2 px resting marks, a 32/17/12/9 px hover cascade, a single question-plus-answer preview card, and no native duplicate tooltip.
  - Copy events whose actual selection is outside acp-chat-timeline are prevented, and non-message UI remains non-selectable.
docs:
  required: true
---

Use this spec for the remote-only OpenX client and its project-organized chat navigation.

The Gateway protocol source of truth is OpenClaw's challenge-based connect flow. The client waits for `connect.challenge`, signs that nonce with its device identity, and sends either `connect.params.auth.token` or `connect.params.auth.password` according to the selected mode. A remote URL is a client endpoint, not permission to mutate the remote host's local configuration directly.

The local project path remains client-side workspace context for ACP and file previews. Project membership and folder organization are OpenX client metadata; session content and Gateway-owned capabilities remain remote.
