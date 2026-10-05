# Qin Star Pay Backend

Node.js 22, Express 5, TypeScript, and MySQL 8 backend foundation for Qin Star Pay.

## Implemented foundation

- Versioned MySQL migrations for identity/RBAC, party hierarchy, onboarding/KYC, providers, notifications, audit, pricing, wallets, transactions, journals, callbacks, and settlements.
- JWT access tokens and rotating, hashed refresh tokens.
- Account lockout after repeated failed sign-in attempts.
- Permission middleware and SUPER_ADMIN bypass.
- Hierarchy-aware party APIs with optimistic concurrency.
- Audited account status and approval actions.
- Generic master-data APIs.
- Security headers, CORS allowlist, request limits, rate limits, structured logs, request IDs, validation, and normalized error responses.
- Liveness and database-readiness probes.
- Environment-controlled OpenAPI 3.1 documentation for every active endpoint.

Payment creation/posting APIs are intentionally not enabled yet. The frontend audit found conflicting Pay-In final-credit and Pay-Out charge rules. The schema stores explicit gross, charge, tax, final-credit, and total-debit values so the approved policy can be snapshotted later.

## Local setup

1. Copy `.env.example` to `.env` and change every secret/password.
2. In phpMyAdmin, create an empty database named `qin_star_pay` with `utf8mb4_0900_ai_ci` collation (or `utf8mb4_unicode_ci` when the server does not offer MySQL 8 collations).
3. Create or select a MySQL user that has `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, and `DROP` permissions only on `qin_star_pay`.
4. Put that database host, port, name, username, and password in `.env`.
5. Install dependencies: `npm install`.
6. Apply and track all tables: `npm run db:migrate`.
7. Seed roles, permissions, and the first admin: `npm run db:seed`.
8. Start the API: `npm run dev`.

Default API address: `http://localhost:4000/api/v1`.

## Swagger / OpenAPI

Swagger is enabled by default in development and test environments. Set `SWAGGER_ENABLED=true` explicitly where documentation is required, and leave it disabled in production unless access is separately protected.

- Interactive UI: `http://localhost:4000/api-docs`
- Raw OpenAPI JSON: `http://localhost:4000/api-docs.json`
- Authentication: call `POST /api/v1/auth/login`, copy the returned access token, and use Swagger's **Authorize** button. Never store real tokens or credentials in documentation examples.

For every new or modified API, update the centralized contract in `src/config/swagger.ts` in the same change. Document the implemented route, method, validation constraints, authentication, permission, request, success response, actual errors, and safe examples. Cross-check it against the route, Zod schema, middleware, service response, and error behavior before considering the endpoint complete.

Definition of done: implementation, validation, security/RBAC, business behavior, error handling, tests, Swagger documentation, and route-to-contract verification must all be complete.

Never use the example database, JWT, or admin passwords outside local development. Do not grant the application MySQL user global privileges.

### phpMyAdmin configuration example

After creating the database and database user in phpMyAdmin, configure `.env`:

```dotenv
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_NAME=qin_star_pay
DATABASE_USER=qin_star_pay
DATABASE_PASSWORD=your_actual_mysql_password
```

If phpMyAdmin is connected to a remote MySQL server, use that MySQL server's hostname. The value is not necessarily the URL used to open phpMyAdmin.

Use `npm run db:migrate` as the normal table-creation method. It executes migration files in order and records each applied file in `schema_migrations`. Avoid manually importing the migration SQL and then running the migration command, because that bypasses migration tracking.

## Available endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Database readiness |
| POST | `/api/v1/auth/login` | Authenticate |
| POST | `/api/v1/auth/refresh` | Rotate refresh token |
| POST | `/api/v1/auth/logout` | Revoke refresh token |
| GET | `/api/v1/auth/me` | Current token identity |
| GET | `/api/v1/parties` | Filtered/paginated hierarchy list |
| GET | `/api/v1/parties/:id` | Party details |
| POST | `/api/v1/parties` | Create hierarchy party |
| PATCH | `/api/v1/parties/:id/status` | Status change with version check |
| POST | `/api/v1/parties/:id/review` | Approve/reject pending party |
| GET | `/api/v1/master-data/:category` | List master data |
| POST | `/api/v1/master-data/:category` | Create master data |
| PATCH | `/api/v1/master-data/item/:id` | Update master data |
| GET | `/api/v1/roles/permissions` | List assignable permissions |
| GET | `/api/v1/roles` | List system, network, and employee roles |
| POST | `/api/v1/roles` | Create a configurable employee role |
| PATCH | `/api/v1/roles/:id` | Update a configurable employee role |
| GET | `/api/v1/employees` | Search and paginate employees |
| POST | `/api/v1/employees` | Atomically create an employee account and profile |

See `/api-docs` or `/api-docs.json` for the authoritative request and response contract.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Database migrations must additionally be tested against MySQL before deployment. Migrations are never run automatically by the HTTP server.
