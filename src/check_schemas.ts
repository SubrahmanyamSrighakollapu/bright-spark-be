import { pool } from './database/pool.js';

async function main() {
  const tables = ['providers', 'routing_rules', 'webhook_endpoints', 'pricing_plans', 'master_data'];
  for (const t of tables) {
    const [cols] = await pool.query(`DESCRIBE ${t}`);
    console.log(`\n--- SCHEMAS FOR ${t} ---`);
    console.log(cols);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
