import { readFileSync } from 'node:fs';

const TOKEN = process.env.SB_TOKEN ?? '';
const REF = 'reodbsfxkorpgzimqijn';
const sql = process.argv[2] === '--file' ? readFileSync(process.argv[3], 'utf8') : process.argv[2];

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log(`${res.status} ${text.slice(0, 4000)}`);
