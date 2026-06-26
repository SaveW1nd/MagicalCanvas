# MagicalCanvas Multi-Tenant User + Admin System — Implementation Plan

> **Status:** Architecture plan, grounded in the current single-user codebase (Express + file-based persistence + React/Vite SPA). Today there is **zero auth**, **zero ownership**, and **8 hardcoded model lists**. This plan adds users/admin, per-owner data isolation, and a dynamic model registry that replaces every hardcoded list.

> **Decisions locked (2026-06-27):**
> - **Storage = SQLite (`better-sqlite3`)** for users / registry / ownership index, blobs on FS. Access收口到 `server/db` repo 层,留 Postgres 平滑切换后路(只在预期数百并发高频写时才换)。
> - **Scope = internal team** — admin-provisioned accounts, self-registration OFF (feature-flag later).
> - **Auth = JWT Bearer** (short access + refresh, logout denylist).
> - **Model access = global + per-entry `minRole`/`allowedRoles`** (default "all").
> - **Quotas/usage = deferred to P4** (reserve schema hooks now).

---

## 1. Scope & Decision Forks

Each fork has a **recommended default** for a small/internal team deployment, plus tradeoffs.

| # | Decision | Options | **Recommended** | Rationale / Tradeoff |
|---|----------|---------|-----------------|----------------------|
| a | **Storage backend** for users/ownership/registry | (1) Keep JSON files, add `users.json` + `registry.json` + `ownerId` fields; (2) Introduce `better-sqlite3` for users/registry/ownership index | **(2) SQLite (`better-sqlite3`) for users + registry + ownership index; keep large blobs (workflow JSON, media) on the filesystem** | JSON files are fine for blobs but bad for auth queries (lookup by email, list-by-owner, unique constraints, atomic updates). Findings flag race conditions (`Date.now()` collisions, unbounded scans, no atomicity). SQLite = single embedded file, no server, synchronous API. Tradeoff: migration script + mixed model. Fork (1) works for <10 users but hits the concurrency/scan problems. |
| b | **Deployment scope** | (1) Internal team, admin-provisioned accounts, no self-serve; (2) Public multi-user with self-registration | **(1) Internal team: admin creates accounts, self-registration OFF (feature-flag on later)** | Matches the documented reality (server behind a relay, single operator). Avoids email verification, captcha, abuse controls on day one. |
| c | **Auth mechanism** | (1) Session cookie (`express-session`); (2) Stateless JWT (Bearer) | **(2) JWT Bearer, short-lived access token + refresh** | Frontend is scattered raw `fetch()` with no central client and no cookie reliance, plus an SSE endpoint (`POST /api/chat`). Bearer threads cleanly through one `apiClient.ts` + SSE. Cookies would force CSRF on every mutating route. Tradeoff: JWT revocation needs short expiry + logout denylist. |
| d | **Per-user quotas / usage accounting** | (1) Now; (2) Later (P4) | **(2) Later — P4.** Land auth + isolation + registry first | `GEN_CONCURRENCY` exists but is never consumed; no usage table. Quotas are orthogonal to correctness. Reserve schema hooks now. |
| e | **Per-user model access** | (1) Global registry (all enabled visible to all); (2) Per-role/tier access per model | **(2-lite) Global registry + optional `minRole`/`allowedRoles` per entry, default "all"** | Costs nothing to add the field now; avoids painful migration later. Day-one = global; admin can later restrict premium models. |

**Data layout:** use **ownerId-filtering** (not per-user dirs) for metadata, but **namespace media/blob paths by ownerId** to prevent cross-user URL guessing.

---

## 2. Auth & Users

### 2.1 User record (SQLite `users` table)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | `crypto.randomUUID()` |
| `email` | TEXT UNIQUE NOT NULL | login identifier |
| `username` | TEXT | display name |
| `passwordHash` | TEXT NOT NULL | bcrypt |
| `role` | TEXT NOT NULL | `'admin'` \| `'user'` |
| `status` | TEXT NOT NULL | `'active'` \| `'disabled'` |
| `createdAt`/`updatedAt`/`lastLoginAt` | TEXT | ISO8601 |

### 2.2 Password hashing
- **`bcryptjs`** (pure-JS, avoids native build pain), cost 12. Never log/return `passwordHash`.

### 2.3 New deps (`package.json`)
`bcryptjs`, `jsonwebtoken`, `better-sqlite3`, `express-rate-limit`.

### 2.4 New backend files
| File | Role |
|------|------|
| `server/db/index.js` | Opens `better-sqlite3` at `CONFIG_DIR/magicalcanvas.db`; migrations on boot; repo functions. |
| `server/auth/passwords.js` | `hashPassword()`, `verifyPassword()`. |
| `server/auth/tokens.js` | `sign/verify` access + refresh; `JWT_SECRET` from env (never to client). |
| `server/auth/middleware.js` | `requireAuth`, `requireAdmin`, `optionalAuth`. |
| `server/routes/auth.js` | login / logout / refresh / me / register (gated). |
| `server/auth/bootstrap.js` | First-admin bootstrap. |

### 2.5 Endpoints
`POST /api/auth/login`, `/refresh`, `/logout` (jti denylist), `GET /api/auth/me`, `POST /api/auth/register` (disabled by default).

### 2.6 First-admin bootstrap
On boot, if `users` empty: use `BOOTSTRAP_ADMIN_EMAIL`+`BOOTSTRAP_ADMIN_PASSWORD` env, else generate `admin@local` + print a one-time random password. This admin id owns all pre-existing data (§6).

### 2.7 Wiring (`server/index.js`)
- Mount `authRoutes` before the guard.
- Apply `requireAuth` to `/api/*` **except** health, auth, public registry GET, `GET /api/public-workflows*`, SPA fallback (`index.js:1475-1485`).
- Tighten CORS (`index.js:43`) from open `cors()` to an origin allowlist.

---

## 3. Data Model / Ownership

**Strategy:** add `ownerId` to every owned entity, filter by `req.user.id` in every list/get/delete/save, namespace media by ownerId. Public workflows stay global/read-only.

### 3.1 Entity → ownership

| Entity | Current storage | Ownership change | Path strategy |
|--------|-----------------|------------------|---------------|
| **Workflows** | `library/workflows/{UUID}.json` (`index.js:554-743`) | `ownerId` in JSON + SQLite `workflow_index(id,ownerId)` | Flat dir, filter by ownerId; validate on GET/PUT/DELETE. |
| **Public workflows** | `public/workflows/` (`index.js:599-666`) | none (global read-only) | unchanged. |
| **Library assets** | `library/assets/{cat}/{file}` + `assets.json` + `categories.json` (`index.js:305-549`) | `ownerId` per entry | media → `library/assets/users/{ownerId}/{cat}/{file}`. |
| **Generated assets (img/vid history)** | dual-file `library/{images\|videos}/{id}.{ext}`+`.json` (`index.js:934-1119`) | `ownerId` in metadata | media → `library/users/{ownerId}/{images\|videos}/...`; `resultUrl` namespaced. |
| **Edit projects** | `library/edit-projects/{id}.json` (`index.js:1122-1199`) | `ownerId` | flat + filter. |
| **Chat sessions** | `library/chats/{sessionId}.json` (`agent/index.js:166-283`) | `ownerId`; **server-generated sessionId** | bind sessionId→ownerId, reject mismatches (fixes hijacking). |
| **Settings / API keys** | `twitcanva-config.json` | becomes **admin-only global** | secrets never to non-admins. |
| **Prompt templates** | `library/prompt-templates/` | built-ins global; custom get `ownerId` | filter custom. |
| **Local models** | `models/` + `config/model-registry.json` | global system inventory | gate generate route. |
| **Usage (new, P4)** | — | `usage(ownerId, model, type, count, tokens, period)` | DB only. |

### 3.2 Per-user dirs vs ownerId-filter
- **Metadata:** ownerId-filter (small counts).
- **Media blobs + curated assets:** per-owner subdirs (`library/users/{ownerId}/...`) — prevents URL-enumeration leak, clean per-user cleanup/quota.

### 3.3 Path-traversal & isolation safety
- `resolveOwnedPath(ownerId, kind, idOrName)`: validate `ownerId === req.user.id` (UUID), reject `..`/absolute/symlinks, confirm under `LIBRARY_DIR/users/{ownerId}/`.
- Every list/get/delete handler derives paths via this helper from `req.user.id` — never from client values.
- Server-generated **UUIDv4** for all new ids.

### 3.4 Per-handler scoping checklist
1. `requireAuth` sets `req.user.id`. 2. List → filter `ownerId===req.user.id` (+public). 3. Get/Update/Delete → `403` if `ownerId` mismatch. 4. Create → set `ownerId` server-side, ignore client value. 5. Media write → `resolveOwnedPath(...)`.

---

## 4. Dynamic Model Registry

Replaces **all 8 hardcoded lists** with one server-side source of truth (SQLite `models` table), exposed to clients **without secrets**.

### 4.1 Registry entry schema (`models` table)

| Field | Type | Notes |
|-------|------|-------|
| `id` | TEXT PK | canonical id (normalize `nana-`/`nano-` divergence) |
| `type` | TEXT | image \| video \| text \| vision \| asr |
| `displayName` | TEXT | UI label |
| `provider` | TEXT | gpt2api \| flow2api \| openai \| kling \| hailuo \| google \| local (replaces string-match detection) |
| `baseUrl` | TEXT | server-only |
| `apiKeyRef` | TEXT | **reference** to a secret key name (e.g. `IMAGE_API_KEY`), never raw key |
| `capabilities` | JSON | ratios/resolutions/durations/supports* (see below) |
| `enabled` / `isDefault` / `order` | INT | one default per type |
| `minRole`/`allowedRoles` | TEXT/JSON | fork e; default "all" |
| `providerModelName` | TEXT | upstream name (replaces `FP_IMAGE_BASE`/`toFpImageModel`) |
| `createdAt`/`updatedAt` | TEXT | |

**`capabilities`:** `{ supportsImageToImage, supportsMultiImage, supportsTextToVideo, supportsImageToVideo, supportsFirstLastFrame, ratios[], resolutions[], durations[], durationResolutionMap{}, ratioToSize{} }`.

### 4.2 Endpoints
- **Admin CRUD** (`requireAdmin`): `GET/POST/PUT/DELETE /api/admin/models` + `POST /api/admin/models/:id/test` (replaces `POST /api/settings/test`).
- **Public read** (`requireAuth`): `GET /api/models?type=image` → secrets stripped (only id/type/displayName/provider/capabilities/isDefault/order), filtered by enabled + role.

### 4.3 Hardcoded-list inventory (every list to replace)

| File | Artifact | Replacement |
|------|----------|-------------|
| `src/components/canvas/NodeControls.tsx` | `IMAGE_MODELS`/`VIDEO_MODELS` + ratio/res/duration consts | fetch `GET /api/models`; derive from selected model capabilities |
| `src/components/modals/imageEditor/imageEditor.types.ts` | `IMAGE_MODELS` | consume registry |
| `src/components/modals/StoryboardGeneratorModal.tsx` | `IMAGE_MODELS` | consume registry |
| `src/components/modals/StoryboardVideoModal.tsx` | `VIDEO_MODELS` | consume registry |
| `server/agent/tools/index.js` | image/video enums | build enums from registry per request |
| `server/agent/prompts/system.js` | model prose | inject available models per request (fixes staleness) |
| `server/services/gpt2api.js` | `GPT2API_*_MODELS`, `FP_IMAGE_BASE`, `toFpImageModel`, `RATIO_TO_SIZE`, `RES_TO_*_QUALITY` | provider/providerModelName/capabilities from registry |
| `server/services/flow2api.js` | `FLOW2API_*_MODELS` | provider detection via registry |
| `server/routes/generation.js` | `isGpt2apiImageModel`/`isFlow2apiVideoModel`/`isKlingModel` | provider factory on `model.provider` |
| `server/config.js` | `DEFAULTS` model names | become registry `isDefault` rows (seeded) |

### 4.4 Generation resolution (server-side, `generation.js` @28/@224)
1. Read `model` id (fallback to registry default). 2. `registry.get(model)` → 404/403 if missing/disabled/not allowed. 3. Validate request capabilities → 400 early. 4. Resolve `baseUrl=m.baseUrl`, `apiKey=getKey(m.apiKeyRef)`. 5. `providerFactory(m.provider).generate(...)`. 6. Save via `resolveOwnedPath(req.user.id, ...)` + `ownerId` metadata.

### 4.5 Migration / seed
`server/db/seedRegistry.js` (once if empty): seed from `config.js DEFAULTS` + current lists — DeepSeek v4-pro (text), MiMo v2.5 (vision), fp Flow image/video + Veo tiers. `apiKeyRef` points at existing `SETTINGS_KEYS` so live keys keep working.

---

## 5. Admin Panel (Frontend)

### 5.1 Auth context + login gate
- `src/contexts/AuthContext.tsx`: `{ user, role, isAdmin, token, login, logout, checkSession }`.
- `src/utils/apiClient.ts`: `apiFetch()` injects Bearer, handles 401/403. **Refactor scattered `fetch()`** in `services/generationService.ts`, `services/assetService.ts`, `hooks/useWorkflow.ts`, `hooks/useChatAgent.ts` (+ SSE).
- `src/index.tsx`: wrap in `<AuthProvider>`; `!user` → `LoginPage`, else `App`; on mount `GET /api/auth/me`.
- On logout clear token + `mc_last_workflow_id`.

### 5.2 New frontend files
`auth/LoginPage.tsx`, `contexts/AuthContext.tsx`, `utils/apiClient.ts`, `admin/AdminPanel.tsx`, `admin/UserManagement.tsx`, `admin/ModelRegistryManager.tsx`.

### 5.3 TopBar + guarding
User menu (logout) + **Admin** button (admins only). Backend `requireAdmin` is the real gate.

### 5.4 SettingsModal
Split: model/provider/baseUrl/key config → `ModelRegistryManager` (admin-only, keys masked). Global settings (concurrency) stay admin-only. Regular users get slimmed prefs (theme) or none at MVP.

---

## 6. Migration & Backward-Compat
1. DB init + idempotent migrations on boot. 2. First-admin bootstrap → `BOOTSTRAP_ADMIN_ID`. 3. `server/db/migrate-ownership.js` (idempotent): set `ownerId` on all existing entities; move media into `library/users/{id}/...` + rewrite `resultUrl`/`coverUrl`/chat URLs (or compat resolver accepting old + new paths during transition); build SQLite indexes. 4. Registry seed. 5. Compat path resolver for old saved workflows. 6. Legacy model-id mapping → "model unavailable" node error instead of silent failure.

---

## 7. Security
- Secrets never to non-admin clients (`/api/models` + `/api/settings` strip keys; admin sees masked, write-only). Fixes documented `/api/settings` leak.
- Tenant isolation: ownerId filter + `403` on every get/update/delete; media namespaced; `resolveOwnedPath` blocks `..`/symlinks.
- bcrypt(12); server-generated UUIDv4 sessionId bound to ownerId (fixes chat hijacking).
- JWT short access TTL + refresh + logout denylist; `JWT_SECRET` env-only.
- `express-rate-limit` on `/api/auth/login`, `/api/generate-*`, `/api/chat`, video-studio.
- CORS origin allowlist (`index.js:43`). CSRF N/A for Bearer.
- Restrict `twitcanva-config.json` perms (0600); prefer env-injected prod keys.
- Validate `nodes.resultUrl` (block `file:` injection) and ids in delete routes.

---

## 8. Phased Rollout
Effort: **S** ≈ 1–2d, **M** ≈ 3–5d, **L** ≈ 1–2wk. Each phase independently shippable.

### P0 — Auth + Users (M)
Login required; admin exists; behavior otherwise unchanged.
- Deps + `server/db/index.js` (`users` migration) + `server/auth/*` + `server/routes/auth.js`.
- `requireAuth` global (allowlist health/auth/public/SPA); tighten CORS.
- Frontend: `AuthContext`, `apiClient`, `LoginPage`, gate in `index.tsx`, refactor services/hooks to `apiFetch`; TopBar logout.
- First-admin bootstrap.

### P1 — Ownership + Scoping (L)
True multi-user isolation.
- `ownerId` on all schemas; `resolveOwnedPath()`.
- Scope every list/get/delete/save in `index.js`, `routes/generation.js`, `agent/index.js`.
- Server UUIDv4 ids + sessionId→ownerId binding.
- Namespace media under `library/users/{ownerId}/...`; update `resultUrl`/`coverUrl`/chat writes.
- Backfill `migrate-ownership.js` + compat resolver.
- Rate limiting.

### P2 — Dynamic Model Registry (L)
Hardcoded lists gone; admin-managed models drive generation.
- `models` table + `seedRegistry.js`; registry repo.
- `GET /api/models` (sanitized) + admin CRUD + `/test`.
- Provider factory; refactor `generation.js`, `gpt2api.js`, `flow2api.js`.
- Dynamic agent enums + prompt.
- Frontend: replace the 4 frontend lists with `GET /api/models`; capability-driven UI.
- Legacy model-id mapping.

### P3 — Admin UI (M)
- `AdminPanel`, `UserManagement`, `ModelRegistryManager`; `/api/admin/users` CRUD/disable/reset.
- Split SettingsModal (admin system settings vs user prefs).
- TopBar Admin button.

### P4 — Quotas & Usage (M)
- `usage` table; intercept in `generation.js` + chat for counting + `429`.
- **Actually consume `GEN_CONCURRENCY`** (currently unused) via per-user limiter.
- Admin quota config + usage dashboard.

---

## 9. Risks & Open Questions

**Risks**
- **Media path migration** (P1/§6) is riskiest — moving blobs + rewriting URLs can break saved content. Mitigate: dual-path compat resolver + dry-run backfill.
- **SSE auth** (`POST /api/chat`): Bearer over `EventSource` needs fetch-based SSE or token-via-query.
- **better-sqlite3 native build** in Electron/deploy env — fallback to JSON storage (fork 1) if it fails.
- **Legacy model ids** in old workflows — explicit "model unavailable" errors; inventory wild data first.
- **In-memory session cache + JWT denylist** are per-process; multi-process needs shared store (Redis). Out of scope for single-relay.

**Open questions**
1. Strictly internal (no self-registration) or external self-serve?
2. Curated library assets / prompt templates: per-user, shared, or admin-curated-global + per-user custom?
3. Per-tenant API keys (each user brings own keys) or one shared pool + quotas?
4. Soft-delete + audit log (current code hard-`unlinkSync` with no recovery)?
5. Refresh-token storage (DB row vs stateless) + exact TTLs?
6. Local models: admin-approval gating before exposure (code-execution trust)?

---

*Generated grounded in a 5-agent codebase exploration + architect synthesis (2026-06-27).*
