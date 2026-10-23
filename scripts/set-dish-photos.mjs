// Sets real dish photos for four menu items, using the PNGs already present
// in public/. Each photo is re-encoded with sharp (shipped for the design
// pipeline) to a ~1200px JPEG so the menu stays light on mobile data while
// the item-detail hero still gets a full-resolution plate.
//
//   Biryani          -> public/Steaming Copper Bowl Chicken Biryani.png
//   Masala Dosa      -> public/Crispy Masala Dosa Thali on Banana Leaf.png
//   Chapati & Curry  -> public/Rustic Indian Curry and Roti Feast.png
//   Idli (2 pcs)     -> public/South Indian Breakfast Platter.png
//
// Usage (SB_TOKEN in .env or environment):
//   node scripts/set-dish-photos.mjs [--dry-run]

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const REF = process.env.SB_REF ?? 'reodbsfxkorpgzimqijn';
const TOKEN = process.env.SB_TOKEN ?? readTokenFromEnvFile();
const DRY = process.argv.includes('--dry-run');
if (!TOKEN) {
  console.error('SB_TOKEN missing — put it in .env or export it');
  process.exit(1);
}

function readTokenFromEnvFile() {
  if (!existsSync('.env')) return '';
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('SB_TOKEN='));
  return line ? line.slice('SB_TOKEN='.length).trim() : '';
}

const mgmt = (p) => `https://api.supabase.com/v1/projects/${REF}${p}`;
const authHeaders = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const keys = await (await fetch(mgmt('/api-keys'), { headers: authHeaders })).json();
const serviceKey = keys.find((k) => k.id === 'service_role' || k.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('no service_role key available');
const PROJECT_URL = `https://${REF}.supabase.co`;

// name_en on menu_items -> source PNG in public/ -> storage object to keep.
const DISHES = [
  ['Biryani', 'Steaming Copper Bowl Chicken Biryani.png', 'photos/biryani.jpg'],
  ['Masala Dosa', 'Crispy Masala Dosa Thali on Banana Leaf.png', 'photos/masala-dosa.jpg'],
  ['Chapati & Curry', 'Rustic Indian Curry and Roti Feast.png', 'photos/chapati-curry.jpg'],
  ['Idli (2 pcs)', 'South Indian Breakfast Platter.png', 'photos/idli.jpg'],
  ['Puri', 'Golden Puri Thali with Curry and Chutney.png', 'photos/puri.jpg'],
  ['Plain Dosa', 'Crispy Rolled Dosa with Sambar and Chutney.png', 'photos/plain-dosa.jpg'],
];

async function encodePhotograph(source) {
  return sharp(path.join('public', source))
    .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

async function upload(storagePath, buffer) {
  let last = '';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`${PROJECT_URL}/storage/v1/object/food-images/${storagePath}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (res.ok) return;
    last = `${res.status} ${(await res.text()).slice(0, 120)}`;
    if (res.status < 500) break; // non-transient: report and stop
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`upload ${storagePath}: ${last}`);
}

async function setImagePath(name, storagePath) {
  const res = await fetch(
    `${PROJECT_URL}/rest/v1/menu_items?name_en=eq.${encodeURIComponent(name)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ image_path: storagePath }),
    },
  );
  if (!res.ok) throw new Error(`update ${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).length;
}

for (const [name, source, storagePath] of DISHES) {
  const jpg = await encodePhotograph(source);
  if (!DRY) {
    await upload(storagePath, jpg);
    const updated = await setImagePath(name, storagePath);
    if (!updated) console.warn(`warning: no menu_items row matched "${name}" — check name_en`);
  }
  console.log(`${DRY ? 'would set' : 'set'} ${storagePath} (${(jpg.length / 1024).toFixed(0)} KB) → ${name} ← ${source}`);
}

console.log(`\n${DRY ? 'Dry run' : 'Done'}: ${DISHES.length} dish photos.`);
