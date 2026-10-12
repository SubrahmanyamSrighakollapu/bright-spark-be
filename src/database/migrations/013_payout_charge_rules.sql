CREATE TABLE IF NOT EXISTS payout_charge_rules (
  id CHAR(36) PRIMARY KEY,
  payout_mode ENUM('IMPS','NEFT','RTGS','UPI') NOT NULL,
  min_amount DECIMAL(15,2) NOT NULL,
  max_amount DECIMAL(15,2) NOT NULL,
  flat_charge DECIMAL(15,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_payout_charge_range CHECK (min_amount >= 0 AND max_amount > min_amount),
  CONSTRAINT chk_payout_flat_charge CHECK (flat_charge >= 0),
  INDEX idx_payout_charge_resolve (payout_mode, is_active, min_amount, max_amount),
  CONSTRAINT fk_payout_charge_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payout_charge_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Admin-configured flat payout charges resolved by transfer mode and inclusive amount range';

INSERT INTO payout_charge_rules (id, payout_mode, min_amount, max_amount, flat_charge)
SELECT UUID(), 'IMPS', 1.00, 25000.00, 5.00
WHERE NOT EXISTS (SELECT 1 FROM payout_charge_rules WHERE payout_mode = 'IMPS');
INSERT INTO payout_charge_rules (id, payout_mode, min_amount, max_amount, flat_charge)
SELECT UUID(), 'IMPS', 25000.01, 200000.00, 10.00
WHERE NOT EXISTS (SELECT 1 FROM payout_charge_rules WHERE payout_mode = 'IMPS' AND min_amount > 25000);
INSERT INTO payout_charge_rules (id, payout_mode, min_amount, max_amount, flat_charge)
SELECT UUID(), 'NEFT', 1.00, 500000.00, 3.50
WHERE NOT EXISTS (SELECT 1 FROM payout_charge_rules WHERE payout_mode = 'NEFT');
INSERT INTO payout_charge_rules (id, payout_mode, min_amount, max_amount, flat_charge)
SELECT UUID(), 'RTGS', 200000.00, 2000000.00, 25.00
WHERE NOT EXISTS (SELECT 1 FROM payout_charge_rules WHERE payout_mode = 'RTGS');
INSERT INTO payout_charge_rules (id, payout_mode, min_amount, max_amount, flat_charge)
SELECT UUID(), 'UPI', 1.00, 100000.00, 2.00
WHERE NOT EXISTS (SELECT 1 FROM payout_charge_rules WHERE payout_mode = 'UPI');
