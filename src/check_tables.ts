import { pool } from './database/pool.js';

async function main() {
  const [tables] = await pool.query('SHOW TABLES');
  console.log('TABLES IN DB:', tables);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
