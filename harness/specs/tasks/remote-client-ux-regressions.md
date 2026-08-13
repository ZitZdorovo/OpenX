---
id: remote-client-ux-regressions
title: Fix remote-client onboarding, workspace, attachment, and navigation regressions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep remote Gateway paths remote, deliver desktop attachments by value, and make the reported first-run, settings, chat, model, and agent interactions behave consistently.
touchedAreas:
  - electron/main/**
  - electron/services/**
  - shared/host-api/**
  - shared/i18n/**
  - src/components/layout/**
  - src/pages/Agents/**
  - src/pages/Chat/**
  - src/pages/Settings/**
  - src/pages/Setup/**
  - src/styles/globals.css
  - tests/unit/**
  - tests/e2e/**
  - README.md
expectedUserBehavior:
  - Pairing approval is an amber waiting state rather than a red connection failure.
  - Editable fields expose the native spelling and clipboard context menu.
  - Remote session cwd values are passed to ACP without requiring the same directory on the OpenX desktop.
  - Regular desktop attachments are embedded in the ACP prompt so a remote Gateway never receives an unusable client-local staging path.
  - Files dropped anywhere over the chat show a full-window attachment target.
  - Settings show only the selected section, Gateway shortcuts open the Gateway section, and search results identify individual settings.
  - Search result keyboard hints select search results rather than navigating primary pages.
  - Native model options remain readable in dark mode, and agent settings expose the remote SOUL.md personality.
  - Composer spacing matches the approved 15 px outer and footer offsets and 5 px footer inset.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - session-workspace-authority
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm exec vitest run tests/unit/acp-session-access-registry.test.ts tests/unit/acp-chat-service.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/chat-input.test.tsx tests/unit/agents-page.test.tsx tests/unit/editing-context-menu.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/remote-gateway-setup.spec.ts tests/e2e/main-navigation.spec.ts tests/e2e/chat-workspace-context.spec.ts tests/e2e/scrollbar-visibility.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
acceptance:
  - A remote cwd is never canonicalized, statted, or rejected against the client filesystem before ACP load or prompt.
  - A remote-session grant cannot authorize arbitrary client-local attachment paths; only explicitly staged desktop files can cross the boundary.
  - Non-image staged files use an embedded ACP resource block with bytes, MIME type, safe filename, and staging identity.
  - Native editing menus, settings navigation/search, drag overlay, agent personality, model option colors, and composer spacing have regression coverage.
  - New user-facing strings exist in en, ru, zh, and ja.
docs:
  required: true
---

Remote Gateway workspace paths describe the Gateway host. OpenX may use a matching local path for an explicitly available preview, but local absence must not block opening or sending to a remote chat.

Desktop attachments cross the remote boundary by content. A local staging path is authorization evidence inside Electron Main, not a path that the remote agent is expected to open.
