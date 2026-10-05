CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  module VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description VARCHAR(500) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_permission_module_action (module, action)
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE parties (
  id CHAR(36) PRIMARY KEY,
  party_type ENUM('PLATFORM','MASTER_DISTRIBUTOR','DISTRIBUTOR','RETAILER','EMPLOYEE') NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(160) NOT NULL,
  legal_name VARCHAR(200) NULL,
  email VARCHAR(254) NULL,
  mobile VARCHAR(20) NULL,
  parent_party_id CHAR(36) NULL,
  approval_status ENUM('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  account_status ENUM('PENDING','ACTIVE','INACTIVE','SUSPENDED','CLOSED') NOT NULL DEFAULT 'PENDING',
  kyc_status ENUM('NOT_STARTED','PENDING','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED') NOT NULL DEFAULT 'NOT_STARTED',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_parties_parent FOREIGN KEY (parent_party_id) REFERENCES parties(id),
  INDEX idx_parties_parent_type (parent_party_id, party_type),
  INDEX idx_parties_status (account_status, approval_status),
  INDEX idx_parties_email (email),
  INDEX idx_parties_mobile (mobile)
) ENGINE=InnoDB;

CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  mobile VARCHAR(20) NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  status ENUM('PENDING','ACTIVE','LOCKED','SUSPENDED','DISABLED') NOT NULL DEFAULT 'PENDING',
  failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until TIMESTAMP(6) NULL,
  password_changed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_login_at TIMESTAMP(6) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_users_party FOREIGN KEY (party_id) REFERENCES parties(id),
  INDEX idx_users_party (party_id),
  INDEX idx_users_status (status)
) ENGINE=InnoDB;

CREATE TABLE user_roles (
  user_id CHAR(36) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  assigned_by CHAR(36) NULL,
  assigned_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_user_roles_assigner FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP(6) NOT NULL,
  revoked_at TIMESTAMP(6) NULL,
  replaced_by_token_id CHAR(36) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_replacement FOREIGN KEY (replaced_by_token_id) REFERENCES refresh_tokens(id),
  INDEX idx_refresh_tokens_user_active (user_id, revoked_at, expires_at)
) ENGINE=InnoDB;

CREATE TABLE party_addresses (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  address_type ENUM('REGISTERED','BUSINESS','CORRESPONDENCE') NOT NULL,
  line1 VARCHAR(200) NOT NULL,
  line2 VARCHAR(200) NULL,
  city VARCHAR(100) NOT NULL,
  state_code VARCHAR(10) NOT NULL,
  postal_code VARCHAR(10) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'IN',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_party_addresses_party FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
  INDEX idx_party_addresses_party (party_id)
) ENGINE=InnoDB;

CREATE TABLE bank_accounts (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  account_holder_name VARCHAR(160) NOT NULL,
  account_number_ciphertext VARBINARY(1024) NOT NULL,
  account_number_hash CHAR(64) NOT NULL,
  account_number_last4 CHAR(4) NOT NULL,
  ifsc_code VARCHAR(20) NOT NULL,
  bank_name VARCHAR(160) NULL,
  account_type ENUM('SAVINGS','CURRENT','OTHER') NOT NULL DEFAULT 'CURRENT',
  verification_status ENUM('PENDING','VERIFIED','FAILED') NOT NULL DEFAULT 'PENDING',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_bank_accounts_party FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_bank_accounts_party_hash (party_id, account_number_hash),
  INDEX idx_bank_accounts_party (party_id)
) ENGINE=InnoDB;

CREATE TABLE onboarding_applications (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  application_reference VARCHAR(50) NOT NULL UNIQUE,
  status ENUM('DRAFT','SUBMITTED','UNDER_REVIEW','MORE_INFO_REQUIRED','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMP(6) NULL,
  decided_at TIMESTAMP(6) NULL,
  decided_by CHAR(36) NULL,
  decision_reason VARCHAR(1000) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_onboarding_party FOREIGN KEY (party_id) REFERENCES parties(id),
  CONSTRAINT fk_onboarding_decider FOREIGN KEY (decided_by) REFERENCES users(id),
  INDEX idx_onboarding_status (status, submitted_at)
) ENGINE=InnoDB;

CREATE TABLE kyc_documents (
  id CHAR(36) PRIMARY KEY,
  application_id CHAR(36) NOT NULL,
  document_type ENUM('PAN','AADHAAR','GST_CERTIFICATE','BUSINESS_REGISTRATION','ADDRESS_PROOF','BANK_PROOF','OTHER') NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  status ENUM('UPLOADED','UNDER_REVIEW','VERIFIED','REJECTED') NOT NULL DEFAULT 'UPLOADED',
  rejection_reason VARCHAR(1000) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_kyc_documents_application FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_kyc_documents_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_kyc_documents_application (application_id, status)
) ENGINE=InnoDB;

CREATE TABLE verification_requests (
  id CHAR(36) PRIMARY KEY,
  application_id CHAR(36) NULL,
  party_id CHAR(36) NOT NULL,
  provider_code VARCHAR(50) NOT NULL,
  verification_type ENUM('PAN','AADHAAR','GSTIN','BANK_ACCOUNT','IFSC','UPI_VPA','VIDEO_KYC','LIVENESS','OCR','OTHER') NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  provider_reference VARCHAR(150) NULL,
  status ENUM('CREATED','SUBMITTED','PENDING','VERIFIED','FAILED','EXPIRED','MANUAL_REVIEW') NOT NULL DEFAULT 'CREATED',
  normalized_result JSON NULL,
  provider_response_encrypted LONGBLOB NULL,
  error_code VARCHAR(100) NULL,
  error_message VARCHAR(1000) NULL,
  requested_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_verifications_application FOREIGN KEY (application_id) REFERENCES onboarding_applications(id),
  CONSTRAINT fk_verifications_party FOREIGN KEY (party_id) REFERENCES parties(id),
  UNIQUE KEY uq_verification_provider_idempotency (provider_code, idempotency_key),
  INDEX idx_verifications_party (party_id, verification_type, status)
) ENGINE=InnoDB;

CREATE TABLE approval_events (
  id CHAR(36) PRIMARY KEY,
  subject_type VARCHAR(50) NOT NULL,
  subject_id CHAR(36) NOT NULL,
  action ENUM('SUBMITTED','APPROVED','REJECTED','RETURNED','BLOCKED','UNBLOCKED') NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  reason_code VARCHAR(50) NULL,
  remarks VARCHAR(1000) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_approval_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  INDEX idx_approval_events_subject (subject_type, subject_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE master_data (
  id CHAR(36) PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  code VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL,
  description VARCHAR(1000) NULL,
  configuration JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMP(6) NULL,
  effective_to TIMESTAMP(6) NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_master_data_creator FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_master_data_category_code (category, code),
  INDEX idx_master_data_active (category, is_active, sort_order)
) ENGINE=InnoDB;

CREATE TABLE providers (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  provider_type ENUM('KYC','PAY_IN','PAY_OUT','NOTIFICATION','SETTLEMENT','MULTI_SERVICE') NOT NULL,
  environment ENUM('SANDBOX','PRODUCTION') NOT NULL DEFAULT 'SANDBOX',
  status ENUM('ACTIVE','INACTIVE','DEGRADED','MAINTENANCE') NOT NULL DEFAULT 'INACTIVE',
  base_url VARCHAR(500) NULL,
  credential_secret_reference VARCHAR(500) NULL,
  configuration JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE routing_rules (
  id CHAR(36) PRIMARY KEY,
  service_type VARCHAR(50) NOT NULL,
  payment_mode VARCHAR(30) NULL,
  provider_id CHAR(36) NOT NULL,
  fallback_provider_id CHAR(36) NULL,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  conditions JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  effective_to TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_routing_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
  CONSTRAINT fk_routing_fallback FOREIGN KEY (fallback_provider_id) REFERENCES providers(id),
  INDEX idx_routing_lookup (service_type, payment_mode, is_active, priority)
) ENGINE=InnoDB;

CREATE TABLE webhook_endpoints (
  id CHAR(36) PRIMARY KEY,
  owner_party_id CHAR(36) NULL,
  provider_id CHAR(36) NULL,
  name VARCHAR(160) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  signing_secret_reference VARCHAR(500) NOT NULL,
  subscribed_events JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_webhook_owner FOREIGN KEY (owner_party_id) REFERENCES parties(id),
  CONSTRAINT fk_webhook_provider FOREIGN KEY (provider_id) REFERENCES providers(id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id CHAR(36) PRIMARY KEY,
  recipient_user_id CHAR(36) NOT NULL,
  category VARCHAR(50) NOT NULL,
  notification_type VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  data JSON NULL,
  read_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_recipient (recipient_user_id, read_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE notification_preferences (
  user_id CHAR(36) NOT NULL,
  event_code VARCHAR(80) NOT NULL,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, event_code),
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(100) NULL,
  actor_user_id CHAR(36) NULL,
  actor_party_id CHAR(36) NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(100) NULL,
  outcome ENUM('SUCCESS','FAILURE') NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  metadata JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_audit_actor_user FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_audit_actor_party FOREIGN KEY (actor_party_id) REFERENCES parties(id),
  INDEX idx_audit_resource (resource_type, resource_id, created_at),
  INDEX idx_audit_actor (actor_user_id, created_at),
  INDEX idx_audit_request (request_id)
) ENGINE=InnoDB;
