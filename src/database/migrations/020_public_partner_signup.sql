ALTER TABLE parties
  ADD COLUMN signup_source ENUM('ADMIN_CREATED','NETWORK_CREATED','PUBLIC_SELF_SERVICE') NOT NULL DEFAULT 'ADMIN_CREATED' AFTER created_by_user_id,
  ADD COLUMN assigned_by_user_id CHAR(36) NULL AFTER signup_source,
  ADD COLUMN assigned_at TIMESTAMP(6) NULL AFTER assigned_by_user_id,
  ADD CONSTRAINT fk_parties_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users(id),
  ADD INDEX idx_parties_signup_queue (signup_source, assigned_at, approval_status);

ALTER TABLE onboarding_applications
  ADD COLUMN applicant_email VARCHAR(254) NULL AFTER application_reference,
  ADD COLUMN applicant_mobile VARCHAR(20) NULL AFTER applicant_email;
