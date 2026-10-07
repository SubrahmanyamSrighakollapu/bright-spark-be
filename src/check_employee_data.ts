import { pool } from './database/pool.js';

async function main() {
  const [roles] = await pool.query('SELECT * FROM roles WHERE role_category = "EMPLOYEE"');
  console.log('EMPLOYEE ROLES:', roles);
  
  const [depts] = await pool.query('SELECT * FROM master_data WHERE category = "EMPLOYEE_DEPARTMENT"');
  console.log('EMPLOYEE DEPTS:', depts);
  
  const [emps] = await pool.query(`
    SELECT ep.*, u.email, u.full_name, r.name as role_name 
    FROM employee_profiles ep 
    JOIN users u ON u.id = ep.user_id 
    JOIN user_roles ur ON ur.user_id = u.id 
    JOIN roles r ON r.id = ur.role_id
  `);
  console.log('EMPLOYEES:', emps);
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
