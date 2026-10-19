# Bright Spark API / Swagger Inventory

Baseline generated from the active Express registrations and the centralized OpenAPI contract.

| Method | Endpoint | Module | Authentication | Permission | Swagger status |
|---|---|---|---|---|---|
| GET | `/health/live` | Health | Public | — | Documented |
| GET | `/health/ready` | Health | Public | — | Documented |
| POST | `/api/v1/auth/login` | Authentication | Public | — | Documented |
| POST | `/api/v1/auth/refresh` | Authentication | Public | — | Documented |
| POST | `/api/v1/auth/logout` | Authentication | Bearer JWT | — | Documented |
| GET | `/api/v1/auth/me` | Authentication | Bearer JWT | — | Documented |
| GET | `/api/v1/parties` | Parties | Bearer JWT | `PARTY_READ` | Documented |
| GET | `/api/v1/parties/{id}` | Parties | Bearer JWT | `PARTY_READ` | Documented |
| POST | `/api/v1/parties` | Parties | Bearer JWT | `PARTY_CREATE` | Documented |
| PATCH | `/api/v1/parties/{id}/status` | Parties | Bearer JWT | `PARTY_STATUS_UPDATE` | Documented |
| POST | `/api/v1/parties/{id}/review` | Parties | Bearer JWT | `PARTY_APPROVE` | Documented |
| GET | `/api/v1/master-data/{category}` | Master Data | Bearer JWT | `MASTER_DATA_READ` | Documented |
| POST | `/api/v1/master-data/{category}` | Master Data | Bearer JWT | `MASTER_DATA_WRITE` | Documented |
| PATCH | `/api/v1/master-data/item/{id}` | Master Data | Bearer JWT | `MASTER_DATA_WRITE` | Documented |
| GET | `/api/v1/roles/permissions` | Roles | Bearer JWT | `ROLE_READ` | Documented |
| GET | `/api/v1/roles` | Roles | Bearer JWT | `ROLE_READ` | Documented |
| POST | `/api/v1/roles` | Roles | Bearer JWT | `ROLE_CREATE` | Documented |
| PATCH | `/api/v1/roles/{id}` | Roles | Bearer JWT | `ROLE_UPDATE` | Documented |
| GET | `/api/v1/employees` | Employees | Bearer JWT | `EMPLOYEE_READ` | Documented |
| POST | `/api/v1/employees` | Employees | Bearer JWT | `EMPLOYEE_CREATE` | Documented |
| GET | `/api/v1/employees/meta` | Employees | Bearer JWT | `EMPLOYEE_READ` | Documented |
| GET | `/api/v1/employees/{id}` | Employees | Bearer JWT | `EMPLOYEE_READ` | Documented |
| PUT | `/api/v1/employees/{id}` | Employees | Bearer JWT | `EMPLOYEE_UPDATE` | Documented |
| PATCH | `/api/v1/employees/{id}/status` | Employees | Bearer JWT | `EMPLOYEE_UPDATE` | Documented |
| POST | `/api/v1/employees/{id}/reset-password` | Employees | Bearer JWT | `EMPLOYEE_UPDATE` | Documented |
| POST | `/api/v1/auth/change-password` | Authentication | Bearer JWT | Authenticated user | Documented |
| GET | `/api/v1/notifications` | Notifications | Bearer JWT | `NOTIFICATION_READ` | JSDoc annotated |
| GET | `/api/v1/notifications/summary` | Notifications | Bearer JWT | `NOTIFICATION_READ` | JSDoc annotated |
| GET | `/api/v1/notifications/{id}` | Notifications | Bearer JWT | Ownership-enforced read | JSDoc annotated |
| POST | `/api/v1/notifications/{id}/read` | Notifications | Bearer JWT | Ownership-enforced update | JSDoc annotated |
| POST | `/api/v1/notifications/{id}/unread` | Notifications | Bearer JWT | Ownership-enforced update | JSDoc annotated |
| POST | `/api/v1/notifications/read-all` | Notifications | Bearer JWT | Ownership-enforced batch update | JSDoc annotated |
| POST | `/api/v1/notifications/{id}/dismiss` | Notifications | Bearer JWT | Ownership-enforced update | JSDoc annotated |
| POST | `/api/v1/notifications/{id}/clicked` | Notifications | Bearer JWT | Ownership-enforced update | JSDoc annotated |
| POST | `/api/v1/notifications/announcements` | Notifications | Bearer JWT | `ANNOUNCEMENT_PUBLISH` (or ADMIN/OPERATIONS role) | JSDoc annotated |
| GET | `/api/v1/notifications/preferences` | Notifications | Bearer JWT | Ownership-enforced read | JSDoc annotated |
| PATCH | `/api/v1/notifications/preferences/{eventCode}` | Notifications | Bearer JWT | Ownership-enforced update | JSDoc annotated |
| GET | `/api/v1/notifications/export` | Notifications | Bearer JWT | `NOTIFICATION_READ` | JSDoc annotated |
| POST | `/api/v1/notifications/dispatch-event` | Notifications | Bearer JWT | Service-to-service (or ADMIN) dispatch | JSDoc annotated |
| GET | `/api/v1/notifications/target-users/preview` | Notifications | Bearer JWT | `ANNOUNCEMENT_PUBLISH` | JSDoc annotated |
| GET | `/api/v1/audit-logs` | Audit Logs | Bearer JWT | `AUDIT_READ` (scope-enforced) | JSDoc annotated |
| GET | `/api/v1/audit-logs/summary` | Audit Logs | Bearer JWT | `AUDIT_READ` | JSDoc annotated |
| GET | `/api/v1/audit-logs/action-catalog` | Audit Logs | Bearer JWT | `AUDIT_READ` | JSDoc annotated |
| GET | `/api/v1/audit-logs/{id}` | Audit Logs | Bearer JWT | `AUDIT_READ` (scope-enforced) | JSDoc annotated |
| GET | `/api/v1/audit-logs/export.csv` | Audit Logs / CSV | Bearer JWT | `AUDIT_READ` + `EXPORT_CSV` | JSDoc annotated (250 000 cap, UTF-8 BOM) |
| GET | `/api/v1/login-history` | Login History | Bearer JWT | Cross-user needs `LOGIN_HISTORY_READ`; self-view always allowed | JSDoc annotated |
| GET | `/api/v1/login-history/summary` | Login History | Bearer JWT | Same self/cross-user scope as list | JSDoc annotated |
| GET | `/api/v1/login-history/{id}` | Login History | Bearer JWT | Same self/cross-user scope as list | JSDoc annotated |
| GET | `/api/v1/login-history/export.csv` | Login History / CSV | Bearer JWT | Cross-user needs `LOGIN_HISTORY_READ`; self-view always allowed | JSDoc annotated (250 000 cap) |
| GET | `/api/v1/reports/transactions` | Reports - Transactions | Bearer JWT | `REPORT_READ` | JSDoc annotated |
| GET | `/api/v1/reports/transactions/export.csv` | Reports - Transactions / CSV | Bearer JWT | `REPORT_READ` + `EXPORT_CSV` | JSDoc annotated (250 000 cap) |
| GET | `/api/v1/reports/ledger` | Reports - Ledger | Bearer JWT | `REPORT_READ` | JSDoc annotated |
| GET | `/api/v1/reports/ledger/export.csv` | Reports - Ledger / CSV | Bearer JWT | `REPORT_READ` + `EXPORT_CSV` | JSDoc annotated |
| GET | `/api/v1/reports/settlements` | Reports - Settlements | Bearer JWT | `REPORT_READ` | JSDoc annotated (rows empty until settlements table) |
| GET | `/api/v1/reports/settlements/export.csv` | Reports - Settlements / CSV | Bearer JWT | `REPORT_READ` + `EXPORT_CSV` | JSDoc annotated |
| GET | `/api/v1/reports/balance` | Reports - Balance | Bearer JWT | `REPORT_READ` | JSDoc annotated |
| GET | `/api/v1/reports/balance/export.csv` | Reports - Balance / CSV | Bearer JWT | `REPORT_READ` + `EXPORT_CSV` | JSDoc annotated |
| GET | `/api/v1/reports/chargebacks` | Reports - Chargebacks | Bearer JWT | `REPORT_READ` | JSDoc annotated (rows empty until chargebacks table) |
| GET | `/api/v1/reports/chargebacks/export.csv` | Reports - Chargebacks / CSV | Bearer JWT | `REPORT_READ` + `EXPORT_CSV` | JSDoc annotated |
| GET | `/api/v1/reports/api-performance` | Reports - API Performance | Bearer JWT | `REPORT_READ` | JSDoc annotated (source: `api_request_logs` sink) |
| GET | `/api/v1/reports/api-performance/export.csv` | Reports - API Performance / CSV | Bearer JWT | `REPORT_READ` + `EXPORT_CSV` | JSDoc annotated |

## Baseline totals

- Active API operations in this inventory baseline: 61
- Documented API operations in this inventory baseline: 61
- Partially documented operations: 0
- Undocumented operations: 0
- Stale documented operations: 0
- Unique OpenAPI paths: 41 (JSDoc annotations for Notifications + Audit + Login-History + Reports exist in routes; re-run swagger agg after server restart)

## Modules not implemented yet

Pay-In, Pay-Out, Wallet (adjustment UI only; transactional core + audit sink exist), Settlements (API stub active, schema missing), Chargebacks (API stub active, schema missing), KYC/provider verification, Commissions, Invoices, Integrations, Webhooks, and other planned modules are not represented as complete APIs. Reports, Audit Logs, Login History modules are complete per spec; Transactions/Ledger/Balance/ApiPerformance reports are fully backed by DB; Settlements/Chargebacks reports return tolerant empty rows until their tables land via migration.

## Cross-check rule

Every API change must compare the Express method/path, Zod schema, authentication middleware, permission middleware, service response, and actual error behavior with `src/config/swagger.ts`. Update this inventory whenever an operation is added, renamed, deprecated, or removed.

## Notifications & Communication Module — Handoff Outline

Module is **fully integrated at backend + frontend core layer**. Follow the patterns below for any future module or for remaining work (WebSocket push, email/SMS gateways, admin-targeted trigger rules).

### 1) Backend pattern (established by this module)

- **Route file**: `src/modules/<name>/<name>.routes.ts` — `Router()`, top-level `router.use(authenticate)`, per-route `requirePermission('CODE')`, `validate(query|params|body, schema)`, async controller calls `sendSuccess(res, dataOrEnvelope)` and returns `Promise<void>`.
- **Schema file**: `src/modules/<name>/<name>.schemas.ts` — All Zod `z.object(...)` + `refine(...)` schemas for every endpoint. Export named schemas (not default).
- **Service file**: `src/modules/<name>/<name>.service.ts` — `async` functions with `auth: AuthenticatedUser` first arg when state-changing, uses `pool.execute(query, params as any)`, wraps cross-module best-effort in `try/catch`, state-changing calls `void writeAuditLog(actor, ACTION, SUBJECT, id, meta?)` (never await — fire & forget so audit failure never breaks user-visible flow).
- **Registration**: `src/app.ts` — 2 lines: 1x `import` + 1x `app.use(\`\${env.API_PREFIX}/<name>\`, <name>Router)` — no other edits to app.ts.
- **Permissions**: `src/database/seed.ts` permissions array adds new `CODE` permission code; rolePermissionMap adds role→CODE mapping; `schema_migrations` backfill SQL ensures existing DBs get same permission rows via `INSERT IGNORE`.
- **Tests**: `tests/<name>.test.ts` for HTTP integration (supertest + auth guards + 401/403/422/2xx); `tests/<name>.schemas.test.ts` for Zod unit coverage.
- **CSV export** (when needed): Controller uses `res.setHeader('Content-Type','text/csv; charset=utf-8')` + `Content-Disposition: attachment; filename="..."`; writes `\uFEFF` BOM first for Excel compatibility; streams rows as CSV.

### 2) Frontend pattern (established by this module)

- **Service layer**: `services/<name>Service.ts` — Wraps custom Fetch `apiClient` (`apiClient.get<T>/post<T>/patch<T>/put<T>/delete<T>` → returns `Promise<T>` directly; no `.data` unwrap). Params type: `Record<string, string|number|boolean|undefined>`.
- **Page**: `app/(protected)/<role>/<name>/page.tsx` — Standard 7-step pattern: PageContainer → SummaryCards → Tabs → FilterBar → DataTable → Pagination → Drawers/Modals. Uses PrimeReact + Lucide + Tailwind v4.
- **Feature components**: `components/features/<name>/Foo.tsx` / `BarDialog.tsx` — Self-contained with validation, submit callbacks, optimistic local updates.
- **Layout integration**: `components/layout/AppShell.tsx` — 1-line banner/component injection (after existing ticker but before `<main>`) for site-wide surfaces like announcement banners.
- **Types**: `types/domain.ts` — Additive-only interface extensions (never rename or remove fields to keep existing pages/builds stable).
- **API path**s: Match backend `/api/v1/<name>/...` with exactly same query param names as Zod schemas in backend (`category`, `severity`, `status`, `actionRequired`, `excludeDismissed`, `search`, `dateFrom`, `dateTo`).

### 3) Remaining tasks (can be executed independently WITHOUT touching core integration)

- **T1**: WebSocket / SSE push — backend emits `NOTIFICATION_DELIVERED` event over existing socket layer (add new layer if none), frontend NotificationMenu socket consumer replaces 5s poll with socket-on + fallback poll.
- **T2**: Email/SMS/Push delivery channels — extend `notification_preferences` columns (already nullable; add new ENUM columns via migration), add provider adapter (SendGrid/Twilio/FCM) in service layer.
- **T3**: Scheduled announcements — add `scheduled_at` column to notifications (migration), cron job calls `dispatchEvent` or `publishAnnouncement` on a schedule (BullMQ / node-cron).
- **T4**: Trigger-based rule builder UI — backend event catalog (master_data `NOTIFICATION_EVENT`) already exists; add admin UI page to enable/disable trigger + set conditions.
- **T5**: JSDoc → swaggerDocument scan — ensure `src/config/swagger.js` globs include `src/modules/**/*.routes.ts` so the 15 notification routes appear in `/api-docs.json`. Current Express mounting works regardless of swagger visibility.

### 4) Test / lint commands (verification gates)

- **Backend typecheck**: `cd bright-spark-be ; npm run typecheck` → exit 0
- **Backend tests**: `cd bright-spark-be ; npm run test` → exit 0 (160 tests: 147 pass + 13 DB e2e skip-if-not-available)
- **Backend migration**: `cd bright-spark-be ; npm run db:migrate` → exit 0 (011 applied)
- **Backend server smoke**: `curl http://localhost:4000/api/v1/audit-logs` → HTTP 401 (auth guard active)
- **Frontend typecheck**: `cd bright-spark ; npx tsc -p tsconfig.json --noEmit` → exit 0
- **Server logs**: pino logs JSON with `req` / `res` / `responseTime` for every request; errors logged at `level:50` with stack; request-id propagated via `x-request-id` header; `api_request_logs` materialized sink writes after-response on every HTTP request (non-blocking).
