CREATE TABLE IF NOT EXISTS retailer_beneficiaries (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  account_type ENUM('CURRENT','SAVINGS') NOT NULL,
  contact_mobile VARCHAR(10) NOT NULL,
  account_holder_name VARCHAR(160) NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  account_number_last4 CHAR(4) NOT NULL,
  account_fingerprint CHAR(64) NOT NULL,
  bank_name VARCHAR(160) NOT NULL,
  ifsc_code CHAR(11) NOT NULL,
  verification_status ENUM('VALIDATED','PROVIDER_PENDING','VERIFIED','FAILED') NOT NULL DEFAULT 'VALIDATED',
  provider_beneficiary_id VARCHAR(150) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_beneficiary_party FOREIGN KEY (party_id) REFERENCES parties(id),
  CONSTRAINT fk_beneficiary_creator FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_beneficiary_account (party_id, account_fingerprint, is_active),
  INDEX idx_beneficiary_party_mobile (party_id, contact_mobile, is_active)
) ENGINE=InnoDB COMMENT='Retailer-owned settlement beneficiary accounts; account numbers are application encrypted';

CREATE TABLE IF NOT EXISTS payout_settlement_details (
  transaction_id CHAR(36) PRIMARY KEY,
  beneficiary_id CHAR(36) NOT NULL,
  beneficiary_name VARCHAR(160) NOT NULL,
  beneficiary_mobile VARCHAR(10) NOT NULL,
  bank_name VARCHAR(160) NOT NULL,
  account_number_last4 CHAR(4) NOT NULL,
  ifsc_code CHAR(11) NOT NULL,
  transfer_mode ENUM('IMPS','NEFT','RTGS','UPI') NOT NULL,
  charge_rule_id CHAR(36) NOT NULL,
  provider_execution_status ENUM('NOT_SUBMITTED','SUBMITTED','CONFIRMED','FAILED') NOT NULL DEFAULT 'NOT_SUBMITTED',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_payout_detail_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_payout_detail_beneficiary FOREIGN KEY (beneficiary_id) REFERENCES retailer_beneficiaries(id),
  CONSTRAINT fk_payout_detail_charge_rule FOREIGN KEY (charge_rule_id) REFERENCES payout_charge_rules(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settlement_limit_upgrade_requests (
  id CHAR(36) PRIMARY KEY,
  party_id CHAR(36) NOT NULL,
  requested_limit DECIMAL(19,4) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_by CHAR(36) NOT NULL,
  reviewed_by CHAR(36) NULL,
  review_remarks VARCHAR(500) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_limit_request_party FOREIGN KEY (party_id) REFERENCES parties(id),
  CONSTRAINT fk_limit_request_user FOREIGN KEY (requested_by) REFERENCES users(id),
  INDEX idx_limit_request_party_status (party_id, status, created_at)
) ENGINE=InnoDB;
