ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gateway_id CHAR(36) NULL AFTER payment_mode,
  ADD COLUMN IF NOT EXISTS payment_method_id CHAR(36) NULL AFTER gateway_id,
  ADD COLUMN IF NOT EXISTS payment_option_id CHAR(36) NULL AFTER payment_method_id,
  ADD COLUMN IF NOT EXISTS service_category_id CHAR(36) NULL AFTER payment_option_id,
  ADD COLUMN IF NOT EXISTS service_product_id CHAR(36) NULL AFTER service_category_id,
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(160) NULL AFTER client_order_id,
  ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(20) NULL AFTER customer_name,
  ADD COLUMN IF NOT EXISTS remarks VARCHAR(500) NULL AFTER customer_mobile;

ALTER TABLE transactions
  ADD CONSTRAINT fk_tx_gateway FOREIGN KEY (gateway_id) REFERENCES payment_gateways(id),
  ADD CONSTRAINT fk_tx_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
  ADD CONSTRAINT fk_tx_payment_option FOREIGN KEY (payment_option_id) REFERENCES payment_method_options(id),
  ADD CONSTRAINT fk_tx_service_category FOREIGN KEY (service_category_id) REFERENCES service_catalog_categories(id),
  ADD CONSTRAINT fk_tx_service_product FOREIGN KEY (service_product_id) REFERENCES service_catalog_products(id);

CREATE INDEX idx_transactions_type_created ON transactions (transaction_type, created_at);
CREATE INDEX idx_transactions_customer_mobile ON transactions (customer_mobile);
