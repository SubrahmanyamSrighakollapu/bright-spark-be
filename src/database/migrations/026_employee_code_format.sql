-- Preserve employee identity and relationships; only change the displayed code.
-- The unique constraint aborts the migration if normalized codes collide.
UPDATE employee_profiles
SET employee_code = REPLACE(employee_code, '_', '')
WHERE employee_code LIKE 'EMP%' AND INSTR(employee_code, '_') > 0;
