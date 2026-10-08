ALTER TABLE employee_profiles
  ADD COLUMN shift_code ENUM('MORNING','EVENING','NIGHT') NOT NULL DEFAULT 'MORNING' AFTER joining_date,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER employment_status;

ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER password_changed_at;

UPDATE users u
JOIN employee_profiles ep ON ep.user_id = u.id
SET u.must_change_password = TRUE
WHERE u.password_changed_at IS NULL;
