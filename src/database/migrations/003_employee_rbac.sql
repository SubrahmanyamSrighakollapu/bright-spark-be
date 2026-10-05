ALTER TABLE roles
  ADD COLUMN role_category ENUM('SYSTEM','NETWORK','EMPLOYEE') NOT NULL DEFAULT 'EMPLOYEE' AFTER description,
  ADD COLUMN created_by CHAR(36) NULL AFTER is_active,
  ADD CONSTRAINT fk_roles_creator FOREIGN KEY (created_by) REFERENCES users(id),
  ADD INDEX idx_roles_category_active (role_category, is_active);

UPDATE roles SET role_category = 'SYSTEM' WHERE code IN ('SUPER_ADMIN', 'ADMIN');
UPDATE roles SET role_category = 'NETWORK' WHERE code IN ('MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER');
UPDATE roles SET role_category = 'EMPLOYEE' WHERE code IN ('OPERATIONS', 'ACCOUNTS', 'KYC', 'SALES', 'SUPPORT');

CREATE TABLE employee_profiles (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL UNIQUE,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  department_code VARCHAR(100) NOT NULL,
  designation VARCHAR(120) NULL,
  manager_user_id CHAR(36) NULL,
  joining_date DATE NULL,
  employment_status ENUM('ACTIVE','INACTIVE','SUSPENDED','TERMINATED') NOT NULL DEFAULT 'ACTIVE',
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_employee_profiles_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_employee_profiles_manager FOREIGN KEY (manager_user_id) REFERENCES users(id),
  CONSTRAINT fk_employee_profiles_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_employee_department_status (department_code, employment_status)
) ENGINE=InnoDB;
