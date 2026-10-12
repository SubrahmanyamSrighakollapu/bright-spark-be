-- ============================================================
-- 011 — Audit Logs & Operational Reports Schema Extension
-- ============================================================
-- Prerequisites: migrations 001–010 applied (audit_logs table
-- from 001/007 restored; users/parties/permissions exist).
--
-- Target: MariaDB 10.5+ / MySQL 8. Executed via mysql2 with
-- `multipleStatements: true` so semicolons separate statements.
-- DELIMITER client directive is NOT valid server-side SQL and
-- has been removed; triggers use single-statement bodies (no
-- BEGIN/END compound blocks) so no re-delimiting is needed.
--
-- Additive-only: no destructive ALTERs on pre-existing columns
-- of business tables. No row data is modified except safe
-- idempotent permission inserts and a one-time backfill for
-- any pre-existing notification audit rows with NULL resource_*
-- that were written by the old buggy inline helper.

-- ---------------------------------------------------------------
-- 1. Login History (per FR-02.1 + AC-A1)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS login_history (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id               CHAR(36)         NULL COMMENT 'Nullable for LOGIN_FAILED where identifier was not found',
  session_id            VARCHAR(120)     NULL COMMENT 'Optional browser session/device fingerprint hash for deduplication',
  result                ENUM('SUCCESS','FAILED','LOCKED','LOGGED_OUT','REFRESH') NOT NULL,
  ip_address            VARCHAR(45)      NULL COMMENT 'IPv4 or IPv6 (max 45 chars)',
  user_agent            VARCHAR(500)     NULL,
  device_fingerprint    VARCHAR(120)     NULL COMMENT 'Optional client-side computed device hash for new-device alerts',
  fail_reason           VARCHAR(80)      NULL COMMENT 'BAD_PASSWORD / LOCKED / UNVERIFIED / NOT_FOUND / TOKEN_EXPIRED / TAMPERED / REVOKED',
  login_method          ENUM('PASSWORD','REFRESH_TOKEN','OTP','SSO') NOT NULL DEFAULT 'PASSWORD',
  refresh_jti           VARCHAR(120)     NULL COMMENT 'JWT jti claim of refresh token (for REFRESH/LOGGED_OUT)',
  metadata              JSON             NULL COMMENT 'Structured extras: grant_scopes, mfa_method_used, geo_approx, etc.',
  created_at            TIMESTAMP(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at            TIMESTAMP(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  CONSTRAINT fk_login_history_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_login_history_user_created   (user_id, created_at DESC),
  INDEX idx_login_history_result_created (result, created_at DESC, ip_address),
  INDEX idx_login_history_ip_created     (ip_address, created_at DESC),
  INDEX idx_login_history_created        (created_at DESC)
) ENGINE=InnoDB
  COMMENT='Every authentication event (login/fail/lock/logout/refresh) for AC-A1 + security audits (retention 2yrs default)';

-- ---------------------------------------------------------------
-- 2. Materialized API Request Logs (per AC-A7 api-performance)
-- ---------------------------------------------------------------
-- Non-blocking after-response hook writes a summary row.
-- status_class is written at INSERT-time by the sink middleware
-- (derived from status_code) to avoid generated-column dialect
-- differences between MySQL 8 / MariaDB 10.x VIRTUAL/PERSISTENT.
-- retention for this materialized table = 90 days (operational).

CREATE TABLE IF NOT EXISTS api_request_logs (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id         VARCHAR(100)     NULL COMMENT 'From x-request-id / request.requestId',
  actor_user_id      CHAR(36)         NULL COMMENT 'Nullable for unauthenticated endpoints (401/login/etc.)',
  actor_party_id     CHAR(36)         NULL,
  method             ENUM('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD') NOT NULL,
  route_template     VARCHAR(200)     NULL COMMENT 'e.g. /api/v1/users/:id/status — UUID segments replaced with :id for groupable aggregation',
  full_url           VARCHAR(1000)    NULL COMMENT 'Full request URL including query, up to 1000 chars',
  status_code        SMALLINT UNSIGNED NOT NULL,
  status_class       ENUM('2XX','3XX','4XX','5XX') NOT NULL COMMENT 'Written by sink middleware at insert-time; grouping key for perf report',
  response_time_ms   INT UNSIGNED     NOT NULL COMMENT 'End-to-end handler time in ms (from request start to res.finish)',
  ip_address         VARCHAR(45)      NULL,
  user_agent         VARCHAR(500)     NULL,
  error_code         VARCHAR(80)      NULL COMMENT 'e.g. VALIDATION_ERROR, UNIQUE_CONSTRAINT, AUTH_REQUIRED for 422/401/409 etc.',
  created_at         TIMESTAMP(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  CONSTRAINT fk_api_req_log_actor_user  FOREIGN KEY (actor_user_id)  REFERENCES users(id)   ON DELETE SET NULL,
  CONSTRAINT fk_api_req_log_actor_party FOREIGN KEY (actor_party_id) REFERENCES parties(id) ON DELETE SET NULL,

  INDEX idx_api_req_created_route  (created_at DESC, route_template, status_class),
  INDEX idx_api_req_actor_created  (actor_user_id, created_at DESC),
  INDEX idx_api_req_status_created (status_class, created_at DESC)
) ENGINE=InnoDB
  COMMENT='Materialized HTTP request summaries (90-day operational retention) powering /reports/api-performance';

-- ---------------------------------------------------------------
-- 3. Audit Log Immutability — database-level enforcement (NFR-01)
-- ---------------------------------------------------------------
-- Even if a SUPER privilege DB user tries to edit/censor, these
-- triggers raise. The app DB user should also not hold UPDATE/
-- DELETE grants on audit_logs (enforced outside migration via
-- DBA-run GRANT SELECT,INSERT). Triggers are belt-and-suspenders.
--
-- NOTE: Uses single-statement bodies (no BEGIN/END) so this file
-- works with mysql2 `multipleStatements: true` (which splits on
-- semicolons, so compound blocks would be torn apart).

DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Audit log rows are immutable (trg_audit_logs_no_update)';

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Audit log rows are immutable (trg_audit_logs_no_delete)';

-- ---------------------------------------------------------------
-- 4. Additional audit_logs indexes (additive, NFR-02)
-- ---------------------------------------------------------------
-- 001 already has: idx_audit_resource, idx_audit_actor, idx_audit_request.
-- We add compound indexes to support the 90% case queries:
-- date-range + filter by action/resource_type, and outcome filter.
-- Idempotent INFORMATION_SCHEMA guards prevent duplicate key errors
-- on re-run / partial-apply (CREATE INDEX has no IF NOT EXISTS in
-- MariaDB < 10.6 / MySQL < 8.0.23 so we use a dynamic statement).

SET @idx_exists_01 = (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'audit_logs'
     AND INDEX_NAME   = 'idx_audit_created_action_resource'
);
SET @sql_01 = IF(
  @idx_exists_01 = 0,
  'CREATE INDEX idx_audit_created_action_resource ON audit_logs (created_at, action, resource_type)',
  'SELECT 1'
);
PREPARE stmt_01 FROM @sql_01; EXECUTE stmt_01; DEALLOCATE PREPARE stmt_01;

SET @idx_exists_02 = (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'audit_logs'
     AND INDEX_NAME   = 'idx_audit_outcome_created'
);
SET @sql_02 = IF(
  @idx_exists_02 = 0,
  'CREATE INDEX idx_audit_outcome_created ON audit_logs (outcome, created_at DESC)',
  'SELECT 1'
);
PREPARE stmt_02 FROM @sql_02; EXECUTE stmt_02; DEALLOCATE PREPARE stmt_02;

SET @idx_exists_03 = (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'audit_logs'
     AND INDEX_NAME   = 'idx_audit_actor_created_desc'
);
SET @sql_03 = IF(
  @idx_exists_03 = 0,
  'CREATE INDEX idx_audit_actor_created_desc ON audit_logs (actor_user_id, created_at DESC)',
  'SELECT 1'
);
PREPARE stmt_03 FROM @sql_03; EXECUTE stmt_03; DEALLOCATE PREPARE stmt_03;

SET @idx_exists_04 = (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'audit_logs'
     AND INDEX_NAME   = 'idx_audit_resource_created_desc'
);
SET @sql_04 = IF(
  @idx_exists_04 = 0,
  'CREATE INDEX idx_audit_resource_created_desc ON audit_logs (resource_type, resource_id, created_at DESC)',
  'SELECT 1'
);
PREPARE stmt_04 FROM @sql_04; EXECUTE stmt_04; DEALLOCATE PREPARE stmt_04;

-- ---------------------------------------------------------------
-- 5. Idempotent permission + role_permission backfill (AC-A9)
-- ---------------------------------------------------------------
-- Matches exactly the Task 02 seed.ts additions so seed/migration
-- converge on the same truth (run either, no duplicates).
-- AUDIT_READ and REPORT_READ were added in migration 010 already.

INSERT IGNORE INTO permissions (id, code, module, action)
VALUES
  (UUID(), 'EXPORT_CSV',         'AUDIT', 'EXPORT'),
  (UUID(), 'LOGIN_HISTORY_READ', 'AUDIT', 'READ');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('EXPORT_CSV','LOGIN_HISTORY_READ')
 WHERE r.code IN ('SUPER_ADMIN','ADMIN','ACCOUNTS');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'LOGIN_HISTORY_READ'
 WHERE r.code = 'OPERATIONS';

-- ---------------------------------------------------------------
-- 6. One-time backfill of notification audit rows (safe, idempotent)
-- ---------------------------------------------------------------
-- The old inline writeAuditLog in notification.service.ts
-- (pre-Task-03 refactor) referenced non-canonical columns.
-- With our actual schema (no subject_* columns) those INSERTs
-- either failed or produced rows where resource_type /
-- resource_id were left NULL while action had NOTIFICATION_% or
-- ANNOUNCEMENT_% prefixes. We reconcile orphan rows here by a
-- safe WHERE-guarded UPDATE that only touches NULL resource_*
-- rows; zero side-effects on rows already populated correctly.

UPDATE audit_logs
   SET resource_type = CASE
                         WHEN action = 'NOTIFICATION_MARK_ALL_READ'     THEN 'NOTIFICATION_BATCH'
                         WHEN action = 'ANNOUNCEMENT_PUBLISH'           THEN 'ANNOUNCEMENT'
                         WHEN action = 'NOTIFICATION_PREFERENCE_UPDATE' THEN 'NOTIFICATION_PREFERENCE'
                         ELSE                                                'NOTIFICATION'
                       END,
       resource_id   = NULL
 WHERE resource_type IS NULL
   AND resource_id IS NULL
   AND (action LIKE 'NOTIFICATION_%' OR action LIKE 'ANNOUNCEMENT_%');

-- End of migration 011
