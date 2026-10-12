-- Migration 009: Ledger Entries & Wallet Debit Requests
CREATE TABLE IF NOT EXISTS ledger_entries (
  id CHAR(36) PRIMARY KEY,
  wallet_id CHAR(36) NOT NULL,
  party_id CHAR(36) NOT NULL,
  entry_type ENUM('CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'FEE', 'COMMISSION', 'REVERSAL') NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  available_balance_before DECIMAL(19,4) NOT NULL,
  available_balance_after DECIMAL(19,4) NOT NULL,
  hold_balance_before DECIMAL(19,4) NOT NULL,
  hold_balance_after DECIMAL(19,4) NOT NULL,
  reference_type VARCHAR(50) NOT NULL DEFAULT 'MANUAL_ADJUSTMENT',
  reference_id VARCHAR(100) NULL,
  narration VARCHAR(500) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_ledger_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_ledger_party FOREIGN KEY (party_id) REFERENCES parties(id),
  INDEX idx_ledger_party_created (party_id, created_at),
  INDEX idx_ledger_wallet_created (wallet_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wallet_debit_requests (
  id CHAR(36) PRIMARY KEY,
  wallet_id CHAR(36) NOT NULL,
  party_id CHAR(36) NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_by_user_id CHAR(36) NOT NULL,
  reviewed_by_user_id CHAR(36) NULL,
  rejection_reason VARCHAR(500) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_debit_req_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_debit_req_party FOREIGN KEY (party_id) REFERENCES parties(id),
  INDEX idx_debit_req_status (status, created_at)
) ENGINE=InnoDB;
