ALTER TABLE parties
  ADD COLUMN created_by_user_id CHAR(36) NULL AFTER parent_party_id,
  ADD CONSTRAINT fk_parties_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  ADD INDEX idx_parties_creator (created_by_user_id);

UPDATE parties p
JOIN users u ON u.party_id = p.parent_party_id
SET p.created_by_user_id = u.id
WHERE p.created_by_user_id IS NULL
  AND p.party_type IN ('MASTER_DISTRIBUTOR','DISTRIBUTOR','RETAILER');
