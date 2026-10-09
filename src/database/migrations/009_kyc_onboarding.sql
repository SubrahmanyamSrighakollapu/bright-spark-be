-- Every statement is restart-safe because MariaDB/MySQL DDL implicitly commits.
-- This matters when a local database service is interrupted between statements.
ALTER TABLE kyc_documents MODIFY document_type VARCHAR(100) NOT NULL;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'kyc_documents' AND column_name = 'document_number_masked'),
  'SELECT 1',
  'ALTER TABLE kyc_documents ADD COLUMN document_number_masked VARCHAR(100) NULL AFTER document_type'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'kyc_documents' AND column_name = 'updated_at'),
  'SELECT 1',
  'ALTER TABLE kyc_documents ADD COLUMN updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) AFTER created_at'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'kyc_documents' AND index_name = 'uq_kyc_application_document_type'),
  'SELECT 1',
  'ALTER TABLE kyc_documents ADD UNIQUE KEY uq_kyc_application_document_type (application_id, document_type)'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'onboarding_applications' AND index_name = 'uq_onboarding_party'),
  'SELECT 1',
  'ALTER TABLE onboarding_applications ADD UNIQUE KEY uq_onboarding_party (party_id)'
);
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
