---
id: github-release-auto-updates
title: Deliver prompt-first updates from OpenX GitHub Releases
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Detect new OpenX releases in the background, present an unobtrusive sidebar action, and install only after explicit user confirmation.
touchedAreas:
  - electron/main/updater.ts
  - electron-builder.yml
  - shared/update-channel.ts
  - shared/i18n/**
  - src/stores/update.ts
  - src/components/update/**
  - src/components/layout/Sidebar.tsx
  - tests/unit/update-*.test.ts
  - tests/unit/sidebar-project-pinning.test.tsx
  - tests/e2e/sidebar-update-indicator.spec.ts
  - .github/workflows/release.yml
  - harness/specs/tasks/github-release-auto-updates.md
  - package.json
  - README.md
expectedUserBehavior:
  - OpenX checks for a new release shortly after startup, again when connectivity returns, and every six hours.
  - A failed background check does not show an update action or interrupt the user.
  - The sidebar update action is absent until a release is available, downloading, or ready to install.
  - Selecting the sidebar action opens the Updates settings section.
  - Downloads and installation require an explicit user action.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm exec vitest run tests/unit/update-store.test.ts tests/unit/update-channel.test.ts tests/unit/sidebar-project-pinning.test.tsx tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/sidebar-update-indicator.spec.ts
  - pnpm run build:vite
  - pnpm harness validate --spec harness/specs/tasks/github-release-auto-updates.md
acceptance:
  - Stable builds read the electron-updater latest feed, beta builds read beta, and dev builds read alpha.
  - Background checks never enable implicit download or installation.
  - Only actionable update states produce the sidebar icon.
  - New user-facing strings exist in English and Russian.
docs:
  required: true
---

The GitHub Release and its platform update manifests are the only update source. Gateway connectivity and OpenClaw runtime state do not influence application update availability.
