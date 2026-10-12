-- ============================================================
-- 010 — Notifications & Communication Module Schema Extension
-- ============================================================
-- Prerequisites: migrations 001–009 applied (notifications +
-- notification_preferences tables exist in prior migrations)

-- ---------------------------------------------------------------
-- 1. Add missing columns to the existing `notifications` table
-- ---------------------------------------------------------------

ALTER TABLE notifications
  ADD COLUMN severity ENUM('INFO','SUCCESS','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO'
    COMMENT 'Notification severity aligned with FE NotificationSeverity enum',
  ADD COLUMN action_required BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Whether user action is required to resolve this event',
  ADD COLUMN entity_type VARCHAR(50) NULL
    COMMENT 'Optional related domain entity kind: TRANSACTION / SETTLEMENT / CHARGEBACK / INVOICE / KYC / WALLET / PROVIDER / SYSTEM',
  ADD COLUMN entity_id VARCHAR(100) NULL
    COMMENT 'Optional ID of the related entity within its module',
  ADD COLUMN related_entity VARCHAR(200) NULL
    COMMENT 'Optional display label / secondary reference for human context',
  ADD COLUMN source_module VARCHAR(80) NULL
    COMMENT 'Originating module, e.g. WALLETS, KYC, SETTLEMENTS, INTEGRATIONS',
  ADD COLUMN dismissed_at TIMESTAMP(6) NULL
    COMMENT 'Timestamp of user-initiated dismiss (bell menu / announcement banner); does NOT mark as read',
  ADD COLUMN is_announcement BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Whether this is a manually published admin/system announcement',
  ADD COLUMN announcement_audience JSON NULL
    COMMENT 'Resolved audience selector snapshot of the announcement (target kind + params)',
  ADD COLUMN created_by_user_id CHAR(36) NULL
    COMMENT 'User who manually published this announcement (NULL for automated events)',
  ADD COLUMN expires_at TIMESTAMP(6) NULL
    COMMENT 'Optional timestamp after which the notification/announcement auto-expires',
  ADD COLUMN delivered_at TIMESTAMP(6) NULL
    COMMENT 'Timestamp when the in-app notification was recorded as delivered',
  ADD COLUMN clicked_at TIMESTAMP(6) NULL
    COMMENT 'Timestamp of first user click-through (analytics)';

-- Foreign key from announcement publisher -> users
ALTER TABLE notifications
  ADD CONSTRAINT fk_notifications_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------
-- 2. New indexes to support the queries used by the FE
-- ---------------------------------------------------------------

CREATE INDEX idx_notifications_severity
  ON notifications (recipient_user_id, severity, created_at);

CREATE INDEX idx_notifications_category
  ON notifications (recipient_user_id, category, created_at);

CREATE INDEX idx_notifications_announcements
  ON notifications (is_announcement, created_at);

CREATE INDEX idx_notifications_unread_action
  ON notifications (recipient_user_id, read_at, action_required);

CREATE INDEX idx_notifications_created
  ON notifications (created_at);

-- ---------------------------------------------------------------
-- 3. Seed `master_data` with NOTIFICATION_EVENT catalog (37 events)
-- ---------------------------------------------------------------
-- Each row: category='NOTIFICATION_EVENT', code=event_code (NotificationType)
-- configuration JSON stores { category, severity, inAppMandatory }
-- UNIQUE KEY uq_master_data_category_code (category, code) protects duplicates

INSERT INTO master_data (id, category, code, label, description, configuration, sort_order, is_active) VALUES
(UUID(), 'NOTIFICATION_EVENT', 'TRANSACTION_FAILED', 'Transaction Failed', 'A transaction could not be processed successfully', JSON_OBJECT('category','TRANSACTION','severity','WARNING','inAppMandatory',FALSE), 10, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'HIGH_VALUE_TRANSACTION', 'High Value Transaction', 'A transaction exceeding the high-value threshold was processed', JSON_OBJECT('category','TRANSACTION','severity','INFO','inAppMandatory',FALSE), 20, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'PAYOUT_FAILED', 'Payout Failed', 'A payout transaction failed at the provider stage', JSON_OBJECT('category','TRANSACTION','severity','CRITICAL','inAppMandatory',FALSE), 30, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'PAYIN_SUCCESS', 'Pay-In Successful', 'A pay-in transaction was confirmed successfully', JSON_OBJECT('category','TRANSACTION','severity','SUCCESS','inAppMandatory',FALSE), 40, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'SETTLEMENT_PROCESSED', 'Settlement Processed', 'A settlement batch completed successfully', JSON_OBJECT('category','SETTLEMENT','severity','SUCCESS','inAppMandatory',FALSE), 100, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'SETTLEMENT_FAILED', 'Settlement Failed', 'A settlement batch failed during processing or payout', JSON_OBJECT('category','SETTLEMENT','severity','CRITICAL','inAppMandatory',FALSE), 110, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'CHARGEBACK_FILED', 'Chargeback Filed', 'A new chargeback / dispute case was filed against the merchant', JSON_OBJECT('category','CHARGEBACK','severity','WARNING','inAppMandatory',FALSE), 200, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'CHARGEBACK_EVIDENCE_REQUIRED', 'Chargeback Evidence Required', 'Chargeback response is due before the evidence deadline', JSON_OBJECT('category','CHARGEBACK','severity','CRITICAL','inAppMandatory',FALSE), 210, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'CHARGEBACK_WON', 'Chargeback Won', 'Chargeback case was resolved in our favour', JSON_OBJECT('category','CHARGEBACK','severity','SUCCESS','inAppMandatory',FALSE), 220, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'CHARGEBACK_LOST', 'Chargeback Lost', 'Chargeback case was resolved against the merchant', JSON_OBJECT('category','CHARGEBACK','severity','CRITICAL','inAppMandatory',FALSE), 230, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'RECONCILIATION_MISMATCH', 'Reconciliation Mismatch', 'A mismatch was detected during bank statement reconciliation', JSON_OBJECT('category','RECONCILIATION','severity','CRITICAL','inAppMandatory',FALSE), 300, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'KYC_SUBMITTED', 'KYC Documents Submitted', 'User submitted KYC documents for review', JSON_OBJECT('category','KYC','severity','INFO','inAppMandatory',FALSE), 400, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'KYC_APPROVED', 'KYC Approved', 'User KYC application was approved', JSON_OBJECT('category','KYC','severity','SUCCESS','inAppMandatory',TRUE), 410, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'KYC_REJECTED', 'KYC Rejected', 'User KYC application was rejected', JSON_OBJECT('category','KYC','severity','CRITICAL','inAppMandatory',TRUE), 420, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'KYC_REVIEW_REQUIRED', 'KYC Review Required', 'A KYC application was assigned to the KYC reviewer queue', JSON_OBJECT('category','KYC','severity','WARNING','inAppMandatory',FALSE), 430, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'WALLET_CREDITED', 'Wallet Credited', 'User wallet balance was credited', JSON_OBJECT('category','WALLET','severity','SUCCESS','inAppMandatory',FALSE), 500, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'WALLET_DEBITED', 'Wallet Debited', 'User wallet balance was debited', JSON_OBJECT('category','WALLET','severity','INFO','inAppMandatory',FALSE), 510, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'LOW_BALANCE_ALERT', 'Low Wallet Balance', 'Wallet balance dropped below the configured minimum threshold', JSON_OBJECT('category','WALLET','severity','WARNING','inAppMandatory',FALSE), 520, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'HOLD_PLACED', 'Hold Placed on Wallet', 'A hold was placed on wallet funds', JSON_OBJECT('category','WALLET','severity','WARNING','inAppMandatory',FALSE), 530, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'HOLD_RELEASED', 'Hold Released from Wallet', 'A previously placed wallet hold was released', JSON_OBJECT('category','WALLET','severity','INFO','inAppMandatory',FALSE), 540, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'DEBIT_REQUESTED', 'Wallet Debit Requested', 'A new wallet debit-withdrawal request has been submitted', JSON_OBJECT('category','WALLET','severity','WARNING','inAppMandatory',FALSE), 550, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'DEBIT_APPROVED', 'Wallet Debit Approved', 'Wallet debit-withdrawal request was approved and processed', JSON_OBJECT('category','WALLET','severity','SUCCESS','inAppMandatory',FALSE), 560, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'DEBIT_REJECTED', 'Wallet Debit Rejected', 'Wallet debit-withdrawal request was rejected', JSON_OBJECT('category','WALLET','severity','WARNING','inAppMandatory',FALSE), 570, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'USER_ONBOARDED', 'New User Onboarded', 'A new user was activated in the network hierarchy', JSON_OBJECT('category','USER','severity','INFO','inAppMandatory',FALSE), 600, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'USER_SUSPENDED', 'User Suspended', 'A user account has been suspended', JSON_OBJECT('category','USER','severity','WARNING','inAppMandatory',TRUE), 610, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'USER_BLOCKED', 'User Blocked', 'A user account has been blocked', JSON_OBJECT('category','USER','severity','CRITICAL','inAppMandatory',TRUE), 620, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'APPROVAL_REQUIRED', 'Approval Required', 'An entity in the hierarchy requires approval before activation', JSON_OBJECT('category','APPROVAL','severity','WARNING','inAppMandatory',FALSE), 700, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'APPROVAL_GRANTED', 'Approval Granted', 'Pending approval was granted', JSON_OBJECT('category','APPROVAL','severity','SUCCESS','inAppMandatory',FALSE), 710, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'INVOICE_GENERATED', 'Invoice Generated', 'A new invoice has been generated', JSON_OBJECT('category','INVOICE','severity','INFO','inAppMandatory',FALSE), 800, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'INVOICE_PAID', 'Invoice Paid', 'Invoice has been marked as paid', JSON_OBJECT('category','INVOICE','severity','SUCCESS','inAppMandatory',FALSE), 810, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'INVOICE_OVERDUE', 'Invoice Overdue', 'Invoice is past its due date and remains unpaid', JSON_OBJECT('category','INVOICE','severity','WARNING','inAppMandatory',FALSE), 820, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'PROVIDER_DEGRADED', 'Provider Service Degraded', 'A provider integration has been marked as DEGRADED', JSON_OBJECT('category','PROVIDER','severity','WARNING','inAppMandatory',FALSE), 900, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'PROVIDER_RESTORED', 'Provider Service Restored', 'A previously degraded provider has been restored to ACTIVE', JSON_OBJECT('category','PROVIDER','severity','SUCCESS','inAppMandatory',FALSE), 910, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'LOGIN_NEW_DEVICE', 'Login From New Device', 'A login was detected from an unrecognised device or browser', JSON_OBJECT('category','SECURITY','severity','WARNING','inAppMandatory',TRUE), 1000, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'PASSWORD_CHANGED', 'Password Changed', 'Account password was changed successfully', JSON_OBJECT('category','SECURITY','severity','INFO','inAppMandatory',TRUE), 1010, TRUE),
(UUID(), 'NOTIFICATION_EVENT', 'SECURITY_ALERT', 'Security Alert', 'Anomaly detected that may affect account security', JSON_OBJECT('category','SECURITY','severity','CRITICAL','inAppMandatory',TRUE), 1020, TRUE),

(UUID(), 'NOTIFICATION_EVENT', 'SYSTEM_ANNOUNCEMENT', 'System Announcement', 'Manually published platform announcement', JSON_OBJECT('category','SYSTEM','severity','INFO','inAppMandatory',FALSE), 1100, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  configuration = VALUES(configuration),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

-- ---------------------------------------------------------------
-- 4. Permission bootstrap: ensure ANNOUNCEMENT_PUBLISH permission
--    exists + is assigned to OPERATIONS role. ADMIN already gets
--    all permissions via CROSS JOIN strategy in seed.ts.
-- ---------------------------------------------------------------

INSERT INTO permissions (id, code, module, action)
VALUES (UUID(), 'ANNOUNCEMENT_PUBLISH', 'NOTIFICATION', 'ANNOUNCEMENT_PUBLISH')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action);

-- Grant NOTIFICATION_READ to RETAILER / DISTRIBUTOR / MD / OPERATIONS / ACCOUNTS / KYC / SALES
-- (ADMIN already has CROSS JOIN; existing DBs that ran seed before this migration are backfilled here)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'NOTIFICATION_READ'
WHERE r.code IN ('MASTER_DISTRIBUTOR','DISTRIBUTOR','RETAILER','OPERATIONS','ACCOUNTS','KYC','SALES');

-- Grant ANNOUNCEMENT_PUBLISH to OPERATIONS role
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'ANNOUNCEMENT_PUBLISH'
WHERE r.code = 'OPERATIONS';
