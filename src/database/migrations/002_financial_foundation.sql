CREATE TABLE pricing_plans (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  version INT UNSIGNED NOT NULL,
  status ENUM('DRAFT','ACTIVE','RETIRED') NOT NULL DEFAULT 'DRAFT',
  effective_from TIMESTAMP(6) NULL,
  effective_to TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_pricing_plan_version (code, version)
) ENGINE=InnoDB;

CREATE TABLE party_plan_assignments (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  effective_from TIMESTAMP(6) NOT NULL,
  effective_to TIMESTAMP(6) NULL,
  assigned_by CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_plan_assignment_party FOREIGN KEY (party_id) REFERENCES parties(id),
  CONSTRAINT fk_plan_assignment_plan FOREIGN KEY (plan_id) REFERENCES pricing_plans(id),
  CONSTRAINT fk_plan_assignment_actor FOREIGN KEY (assigned_by) REFERENCES users(id),
  INDEX idx_plan_assignment_effective (party_id, effective_from, effective_to)
) ENGINE=InnoDB;

CREATE TABLE pricing_rules (
  id CHAR(36) PRIMARY KEY,
  plan_id CHAR(36) NOT NULL,
  transaction_type ENUM('PAY_IN','PAY_OUT') NOT NULL,
  payment_mode VARCHAR(30) NULL,
  rule_type ENUM('CUSTOMER_CHARGE','PLATFORM_FEE','COMMISSION','TAX','LIMIT','MINIMUM_BALANCE') NOT NULL,
  beneficiary_level ENUM('PLATFORM','MASTER_DISTRIBUTOR','DISTRIBUTOR','RETAILER','CUSTOMER') NULL,
  calculation_type ENUM('FLAT','PERCENTAGE','SLAB') NOT NULL,
  value DECIMAL(20,8) NOT NULL,
  minimum_amount DECIMAL(19,4) NULL,
  maximum_amount DECIMAL(19,4) NULL,
  slab_from DECIMAL(19,4) NULL,
  slab_to DECIMAL(19,4) NULL,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_pricing_rules_plan FOREIGN KEY (plan_id) REFERENCES pricing_plans(id),
  INDEX idx_pricing_rules_lookup (plan_id, transaction_type, payment_mode, rule_type, is_active)
) ENGINE=InnoDB;

CREATE TABLE wallets (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('ACTIVE','FROZEN','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  available_balance DECIMAL(19,4) NOT NULL DEFAULT 0,
  hold_balance DECIMAL(19,4) NOT NULL DEFAULT 0,
  ledger_balance DECIMAL(19,4) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_wallets_party FOREIGN KEY (party_id) REFERENCES parties(id),
  UNIQUE KEY uq_wallet_party_currency (party_id, currency)
) ENGINE=InnoDB;

CREATE TABLE transactions (
  id CHAR(36) PRIMARY KEY,
  internal_reference VARCHAR(50) NOT NULL UNIQUE,
  idempotency_key VARCHAR(100) NOT NULL,
  party_id CHAR(36) NOT NULL,
  transaction_type ENUM('PAY_IN','PAY_OUT') NOT NULL,
  payment_mode VARCHAR(30) NOT NULL,
  client_order_id VARCHAR(100) NULL,
  provider_id CHAR(36) NULL,
  provider_reference VARCHAR(150) NULL,
  bank_reference VARCHAR(150) NULL,
  status ENUM('CREATED','VALIDATING','PENDING','PROCESSING','SUCCESS','FAILED','EXPIRED','CANCELLED','REVERSED') NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  gross_amount DECIMAL(19,4) NOT NULL,
  charge_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
  final_credit_amount DECIMAL(19,4) NULL,
  total_debit_amount DECIMAL(19,4) NULL,
  calculation_snapshot JSON NOT NULL,
  provider_payload_encrypted LONGBLOB NULL,
  failure_code VARCHAR(100) NULL,
  failure_message VARCHAR(1000) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_transactions_party FOREIGN KEY (party_id) REFERENCES parties(id),
  CONSTRAINT fk_transactions_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
  UNIQUE KEY uq_transactions_party_idempotency (party_id, idempotency_key),
  INDEX idx_transactions_party_created (party_id, created_at),
  INDEX idx_transactions_status_created (status, created_at),
  INDEX idx_transactions_provider_reference (provider_reference),
  INDEX idx_transactions_client_order (client_order_id)
) ENGINE=InnoDB;

CREATE TABLE transaction_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id CHAR(36) NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  source ENUM('SYSTEM','USER','PROVIDER_CALLBACK','PROVIDER_REQUERY','RECONCILIATION') NOT NULL,
  reason_code VARCHAR(100) NULL,
  description VARCHAR(1000) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_transaction_history_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  INDEX idx_transaction_history_tx (transaction_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE journal_entries (
  id CHAR(36) PRIMARY KEY,
  reference_type VARCHAR(50) NOT NULL,
  reference_id CHAR(36) NOT NULL,
  reference_number VARCHAR(100) NOT NULL,
  status ENUM('PENDING','POSTED','REVERSED') NOT NULL DEFAULT 'PENDING',
  description VARCHAR(1000) NULL,
  posted_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_journal_reference (reference_type, reference_id, reference_number)
) ENGINE=InnoDB;

CREATE TABLE journal_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  journal_entry_id CHAR(36) NOT NULL,
  wallet_id CHAR(36) NULL,
  account_code VARCHAR(50) NOT NULL,
  direction ENUM('DEBIT','CREDIT') NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_journal_line_amount CHECK (amount > 0),
  CONSTRAINT fk_journal_lines_entry FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id),
  CONSTRAINT fk_journal_lines_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  INDEX idx_journal_lines_wallet (wallet_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE wallet_holds (
  id CHAR(36) PRIMARY KEY,
  wallet_id CHAR(36) NOT NULL,
  transaction_id CHAR(36) NULL,
  amount DECIMAL(19,4) NOT NULL,
  status ENUM('ACTIVE','CAPTURED','RELEASED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_wallet_hold_amount CHECK (amount > 0),
  CONSTRAINT fk_wallet_holds_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_holds_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  INDEX idx_wallet_holds_active (wallet_id, status, expires_at)
) ENGINE=InnoDB;

CREATE TABLE provider_callbacks (
  id CHAR(36) PRIMARY KEY,
  provider_id CHAR(36) NOT NULL,
  event_id VARCHAR(150) NOT NULL,
  transaction_id CHAR(36) NULL,
  signature_valid BOOLEAN NOT NULL,
  payload_encrypted LONGBLOB NOT NULL,
  processing_status ENUM('RECEIVED','PROCESSED','IGNORED','FAILED') NOT NULL DEFAULT 'RECEIVED',
  processing_error VARCHAR(1000) NULL,
  received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_callbacks_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
  CONSTRAINT fk_callbacks_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  UNIQUE KEY uq_callbacks_provider_event (provider_id, event_id),
  INDEX idx_callbacks_processing (processing_status, received_at)
) ENGINE=InnoDB;

CREATE TABLE settlement_batches (
  id CHAR(36) PRIMARY KEY,
  batch_reference VARCHAR(50) NOT NULL UNIQUE,
  provider_id CHAR(36) NOT NULL,
  settlement_date DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  expected_amount DECIMAL(19,4) NOT NULL,
  received_amount DECIMAL(19,4) NULL,
  status ENUM('OPEN','PROCESSING','RECONCILED','PARTIALLY_RECONCILED','FAILED','CLOSED') NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_settlement_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
  INDEX idx_settlement_date_status (settlement_date, status)
) ENGINE=InnoDB;

CREATE TABLE settlement_items (
  id CHAR(36) PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  expected_amount DECIMAL(19,4) NOT NULL,
  settled_amount DECIMAL(19,4) NULL,
  variance_amount DECIMAL(19,4) NULL,
  status ENUM('PENDING','MATCHED','MISMATCH','MISSING','ADJUSTED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_settlement_items_batch FOREIGN KEY (batch_id) REFERENCES settlement_batches(id),
  CONSTRAINT fk_settlement_items_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  UNIQUE KEY uq_settlement_batch_transaction (batch_id, transaction_id)
) ENGINE=InnoDB;
