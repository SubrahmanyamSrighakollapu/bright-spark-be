CREATE TABLE IF NOT EXISTS help_desk_tickets (
  id CHAR(36) PRIMARY KEY,
  ticket_number VARCHAR(40) NOT NULL UNIQUE,
  raised_by_user_id CHAR(36) NOT NULL,
  raised_by_party_id CHAR(36) NULL,
  category VARCHAR(100) NOT NULL,
  subcategory VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  status ENUM('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','REOPENED') NOT NULL DEFAULT 'OPEN',
  assigned_employee_id CHAR(36) NULL,
  assignment_method ENUM('AUTO_WORKLOAD_ROUND_ROBIN','ADMIN_MANUAL','ADMIN_REASSIGNMENT') NULL,
  assigned_at TIMESTAMP(6) NULL,
  resolved_at TIMESTAMP(6) NULL,
  closed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_help_ticket_raiser FOREIGN KEY (raised_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_help_ticket_party FOREIGN KEY (raised_by_party_id) REFERENCES parties(id),
  CONSTRAINT fk_help_ticket_assignee FOREIGN KEY (assigned_employee_id) REFERENCES employee_profiles(id),
  INDEX idx_help_ticket_raiser_created (raised_by_user_id, created_at),
  INDEX idx_help_ticket_assignee_status (assigned_employee_id, status),
  INDEX idx_help_ticket_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS help_desk_ticket_assignments (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  from_employee_id CHAR(36) NULL,
  to_employee_id CHAR(36) NULL,
  assignment_method ENUM('AUTO_WORKLOAD_ROUND_ROBIN','ADMIN_MANUAL','ADMIN_REASSIGNMENT','RETURNED_UNASSIGNED') NOT NULL,
  reason VARCHAR(500) NULL,
  assigned_by_user_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_help_assignment_ticket FOREIGN KEY (ticket_id) REFERENCES help_desk_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_help_assignment_from FOREIGN KEY (from_employee_id) REFERENCES employee_profiles(id),
  CONSTRAINT fk_help_assignment_to FOREIGN KEY (to_employee_id) REFERENCES employee_profiles(id),
  CONSTRAINT fk_help_assignment_actor FOREIGN KEY (assigned_by_user_id) REFERENCES users(id),
  INDEX idx_help_assignment_ticket_created (ticket_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS help_desk_ticket_status_history (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  remarks VARCHAR(1000) NULL,
  changed_by_user_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_help_status_ticket FOREIGN KEY (ticket_id) REFERENCES help_desk_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_help_status_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
  INDEX idx_help_status_ticket_created (ticket_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS help_desk_assignment_state (
  state_key VARCHAR(40) PRIMARY KEY,
  last_assigned_employee_id CHAR(36) NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_help_state_employee FOREIGN KEY (last_assigned_employee_id) REFERENCES employee_profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO help_desk_assignment_state (state_key, last_assigned_employee_id)
VALUES ('OPERATIONS_DEFAULT', NULL)
ON DUPLICATE KEY UPDATE state_key = VALUES(state_key);
