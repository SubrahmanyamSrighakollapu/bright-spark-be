-- Collapse the earlier product-scoped design into one template per service category.
-- If multiple mappings already exist, retain the most recently updated template.
DELETE older
FROM service_invoice_templates older
JOIN service_invoice_templates newer
  ON newer.service_category_id = older.service_category_id
 AND (newer.updated_at > older.updated_at OR (newer.updated_at = older.updated_at AND newer.id > older.id));

ALTER TABLE service_invoice_templates
  DROP INDEX uq_invoice_template_scope,
  DROP INDEX idx_invoice_template_lookup,
  DROP FOREIGN KEY fk_invoice_template_product,
  DROP COLUMN service_product_id,
  DROP COLUMN product_scope_key,
  ADD UNIQUE KEY uq_invoice_template_service (service_category_id),
  ADD INDEX idx_invoice_template_lookup (service_category_id, is_active);
