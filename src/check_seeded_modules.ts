import { pool } from './database/pool.js';

async function main() {
  const [providers] = await pool.query('SELECT * FROM providers');
  console.log('PROVIDERS:', providers);

  const [routing] = await pool.query('SELECT * FROM routing_rules');
  console.log('ROUTING RULES:', routing);

  const [plans] = await pool.query('SELECT * FROM pricing_plans');
  console.log('PRICING PLANS:', plans);

  const [master] = await pool.query('SELECT DISTINCT category FROM master_data');
  console.log('MASTER DATA CATEGORIES:', master);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
