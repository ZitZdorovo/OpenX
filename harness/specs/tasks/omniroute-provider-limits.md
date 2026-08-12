---
id: omniroute-provider-limits
title: Display OmniRoute subscription quota windows
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Read OmniRoute's cached provider-limit snapshots through Electron Main and show real 5-hour and weekly remaining percentages without exposing the management credential to Renderer.
touchedAreas:
  - harness/specs/tasks/omniroute-provider-limits.md
  - shared/host-api/contract.ts
  - electron/services/usage-api.ts
  - electron/services/omniroute-usage.ts
  - electron/services/secrets/omniroute-credential-store.ts
  - src/stores/provider-usage.ts
  - src/lib/provider-quota.ts
  - src/pages/Chat/RequestStats.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - tests/unit/omniroute-usage.test.ts
  - tests/unit/provider-quota.test.ts
  - tests/unit/request-stats.test.tsx
  - tests/e2e/omniroute-limits-settings.spec.ts
expectedUserBehavior:
  - Settings accepts an OmniRoute management URL and a manage-scoped token without displaying the stored token again.
  - The request-statistics panel shows only the active model family's account limits and only for the upstream account used by the latest successful request for that model.
  - Gemini model rows are collapsed into one shared model pool per active account; Claude pools stay separate from Gemini, while account-wide 5-hour and weekly windows remain visible for the matching account family.
  - When OmniRoute has several upstream connections for the same named account, the account label is shown once and duplicate quota rows are collapsed.
  - Manual refresh asks OmniRoute to update its upstream quota cache; automatic chat refresh reads the cache without repeatedly polling OAuth providers.
  - A slow active-account lookup does not discard quota windows already returned by OmniRoute, and a slow forced refresh falls back to the last cached snapshot.
  - When the active account exposes only one of the expected 5-hour or weekly windows, the available window remains visible and the missing window is identified as not returned by OmniRoute.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
  - ui-i18n-design-tokens
requiredTests:
  - tests/unit/omniroute-usage.test.ts
  - tests/unit/provider-quota.test.ts
  - tests/unit/request-stats.test.tsx
  - tests/e2e/omniroute-limits-settings.spec.ts
acceptance:
  - OmniRoute management credentials are encrypted with Electron safeStorage and are never returned to Renderer.
  - Renderer obtains normalized quota snapshots only through the typed host-api usage service.
  - Cached limits use GET /api/usage/provider-limits and manual refresh uses POST /api/usage/provider-limits.
  - The active upstream account is resolved from the latest matching structured `/api/usage/call-logs` row, never from provider ordering or a guessed default.
  - Codex session and weekly quota rows display their real remaining percentage and reset timestamp.
  - Claude OAuth and Antigravity family quotas preserve distinct 5-hour and weekly periods even when the upstream display name omits the period.
  - Codex/OpenAI OAuth windows are labelled as ChatGPT account limits; model IDs with the `cx/` prefix are classified as ChatGPT/Codex models.
  - Gemini and Claude quota rows never appear while a model from another family is active.
  - Cached limits whose provider connection was deleted are ignored, and internal connection ids are never used as visible account names.
  - Multiple OmniRoute provider accounts remain distinguishable without repeating identical account/quota rows.
  - Unsupported or silent quota payloads do not produce fabricated limits.
  - Provider-limit, provider-catalog, and active-account requests use independent timeouts so an optional lookup cannot abort the core quota response.
docs:
  required: true
---

## Scope

- Configure an OmniRoute management URL and a `manage`-scoped token in Settings.
- Store the token in the existing OS-backed encrypted secrets store.
- Fetch OmniRoute provider-limit caches from Electron Main and merge them with the Gateway's native `usage.status` response.
- Normalize percentage windows, account labels, plans, and reset timestamps for the existing request-statistics panel.
- Refresh cached values after successful chat usage and request a live OmniRoute sync only after explicit user refresh.

## Out of scope

- Exposing an OmniRoute management endpoint automatically over the public Internet.
- Guessing a subscription quota from request counts, token history, or local rate-limit queue state.
- Installing or configuring OmniRoute itself.
