CREATE TABLE IF NOT EXISTS pricing_plans (
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

CREATE TABLE IF NOT EXISTS wallets (
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

CREATE TABLE IF NOT EXISTS transactions (
  id CHAR(36) PRIMARY KEY,
  internal_reference VARCHAR(50) NOT NULL UNIQUE,
  idempotency_key VARCHAR(100) NOT NULL,
  party_id CHAR(36) NOT NULL,
  transaction_type ENUM('PAY_IN','PAY_OUT') NOT NULL,
  payment_mode VARCHAR(30) NOT NULL,
  client_order_id VARCHAR(100) NULL,
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
  failure_code VARCHAR(100) NULL,
  failure_message VARCHAR(1000) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_transactions_party FOREIGN KEY (party_id) REFERENCES parties(id),
  UNIQUE KEY uq_transactions_party_idempotency (party_id, idempotency_key),
  INDEX idx_transactions_party_created (party_id, created_at),
  INDEX idx_transactions_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaction_status_history (
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
