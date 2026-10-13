-- Legacy and demo parties created before wallet auto-provisioning need a
-- zero-balance INR wallet before they can use Top-Up, Pay-In, or Pay-Out.
INSERT INTO wallets
  (id, party_id, currency, status, available_balance, hold_balance, ledger_balance)
SELECT UUID(), p.id, 'INR', 'ACTIVE', 0, 0, 0
  FROM parties p
  LEFT JOIN wallets w ON w.party_id = p.id AND w.currency = 'INR'
 WHERE p.party_type IN ('MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER')
   AND p.deleted_at IS NULL
   AND w.id IS NULL;
