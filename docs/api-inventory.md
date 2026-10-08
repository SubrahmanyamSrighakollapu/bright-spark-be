# Qin Star Pay API / Swagger Inventory

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

## Baseline totals

- Active API operations in this inventory baseline: 25
- Documented API operations in this inventory baseline: 25
- Partially documented operations: 0
- Undocumented operations: 0
- Stale documented operations: 0
- Unique OpenAPI paths: 20

## Modules not implemented yet

Pay-In, Pay-Out, Wallet, Ledger, KYC/provider verification, Settlements, Commissions, Reports, Chargebacks, Invoices, Notifications, Integrations, Webhooks, and other planned modules are not represented as active APIs. They must be added to both Express and OpenAPI together when implemented. In particular, no Pay-In provider contract, SprintVerify adapter, or Vidual adapter is claimed by the current documentation.

## Cross-check rule

Every API change must compare the Express method/path, Zod schema, authentication middleware, permission middleware, service response, and actual error behavior with `src/config/swagger.ts`. Update this inventory whenever an operation is added, renamed, deprecated, or removed.
