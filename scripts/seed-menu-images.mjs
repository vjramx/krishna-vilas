// Seeds premium, brand-cohesive dish artwork for every menu item.
//
// Why generated artwork: the restaurant has no photographs yet; the storage
// bucket only accepts raster images. These PNGs are real, uploadable files
// (no hotlinked stock, no licensing risk) and the admin can replace any item
// with a real photo at any time via Admin -> Menu -> Upload image.
//
// Usage:
//   SB_TOKEN=sbp_... node scripts/seed-menu-images.mjs [--dry-run]
//
// Requires a Supabase personal access token (fetches the project service key
// to upload into the public `food-images` bucket and update menu_items).

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const REF = process.env.SB_REF ?? 'reodbsfxkorpgzimqijn';
const TOKEN = process.env.SB_TOKEN ?? '';
const DRY = process.argv.includes('--dry-run');
if (!TOKEN) {
  console.error('SB_TOKEN env missing');
  process.exit(1);
}

const mgmt = (path) => `https://api.supabase.com/v1/projects/${REF}${path}`;
const authHeaders = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const keys = await (await fetch(mgmt('/api-keys'), { headers: authHeaders })).json();
const serviceKey = keys.find((k) => k.id === 'service_role' || k.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('no service_role key available');
const PROJECT_URL = `https://${REF}.supabase.co`;

// ---------------------------------------------------------------- artwork
const W = 1200;
const H = 900;

const shadow = (cx, cy, rx, ry) =>
  `<ellipse cx="${cx}" cy="${cy + 26}" rx="${rx}" ry="${ry}" fill="#3A130A" opacity="0.28"/>`;

const plate = (cx = 600, cy = 545, rx = 395, ry = 300) => `
  ${shadow(cx, cy, rx * 0.95, ry * 0.9)}
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#F6E6D2"/>
  <ellipse cx="${cx}" cy="${cy - 6}" rx="${rx - 8}" ry="${ry - 8}" fill="#FFFBF3"/>
  <ellipse cx="${cx}" cy="${cy - 6}" rx="${rx - 44}" ry="${ry - 40}" fill="none" stroke="#EBD6BC" stroke-width="8" opacity="0.85"/>`;

const bowl = (cx, cy, rx, ry, rim = '#FFFBF3', body = '#F3E4D0') => `
  ${shadow(cx, cy, rx * 0.9, ry * 0.8)}
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${body}"/>
  <ellipse cx="${cx}" cy="${cy - 8}" rx="${rx}" ry="${ry}" fill="${rim}"/>
  <ellipse cx="${cx}" cy="${cy - 8}" rx="${rx - 12}" ry="${ry - 10}" fill="none" stroke="#EBD6BC" stroke-width="6"/>`;

const steam = (cx, cy, n = 3) =>
  Array.from({ length: n }, (_, i) => {
    const dx = (i - (n - 1) / 2) * 78;
    return `<path d="M${cx + dx},${cy} c -26,-46 26,-70 0,-116 c -20,-36 18,-54 0,-84"
      fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="9" stroke-linecap="round"/>`;
  }).join('');

const garnish = (cx, cy, spread = 90) => {
  const dots = [];
  const pts = [
    [-0.8, 0.1], [-0.4, -0.5], [0.05, 0.35], [0.45, -0.25], [0.8, 0.15],
    [-0.2, 0.75], [0.6, 0.65], [0.2, -0.8], [-0.65, -0.55],
  ];
  for (const [x, y] of pts) {
    dots.push(
      `<circle cx="${cx + x * spread}" cy="${cy + y * spread * 0.7}" r="${6 + ((x + 2) % 1) * 4}" fill="#3F7D3A" opacity="0.9"/>`,
    );
  }
  return dots.join('');
};

function backdrop(tone = 0) {
  const stops = [
    ['#6C1D10', '#B93A1F', '#F07A33'],
    ['#5E1B0E', '#A8341B', '#E9963F'],
    ['#74210F', '#C4441F', '#F58A3C'],
  ][tone % 3];
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${stops[0]}"/>
      <stop offset="0.55" stop-color="${stops[1]}"/>
      <stop offset="1" stop-color="${stops[2]}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.14" r="0.95">
      <stop offset="0" stop-color="#FFE3BC" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#FFE3BC" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.52" r="0.78">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#3A0F05" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g opacity="0.13" stroke="#FFF3E2" fill="none" stroke-width="3">
    <circle cx="1010" cy="170" r="120"/><circle cx="1010" cy="170" r="70"/>
    <circle cx="170" cy="760" r="150"/><circle cx="170" cy="760" r="96"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>`;
}

const svg = (body, tone = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${backdrop(tone)}${body}</svg>`;

const ART = {
  'Masala Dosa': () =>
    svg(
      `${plate()}${steam(600, 300, 3)}
       <g transform="rotate(-9 600 540)">
         <ellipse cx="600" cy="575" rx="318" ry="150" fill="#B7741F" opacity="0.55"/>
         <ellipse cx="600" cy="556" rx="308" ry="143" fill="#D99433"/>
         <ellipse cx="600" cy="540" rx="292" ry="132" fill="#EFB657"/>
         <ellipse cx="590" cy="526" rx="238" ry="104" fill="#F7CC7E"/>
         <ellipse cx="600" cy="548" rx="150" ry="72" fill="#D0802A"/>
         <ellipse cx="600" cy="544" rx="132" ry="60" fill="#E89A3C"/>
       </g>${garnish(600, 490, 120)}`,
      0,
    ),
  'Plain Dosa': () =>
    svg(
      `${plate()}${steam(600, 290, 4)}
       <g transform="rotate(7 600 540)">
         <ellipse cx="600" cy="566" rx="330" ry="170" fill="#C07C22" opacity="0.5"/>
         <ellipse cx="600" cy="548" rx="322" ry="162" fill="#DCA039"/>
         <ellipse cx="600" cy="530" rx="306" ry="150" fill="#F3BF63"/>
         <ellipse cx="596" cy="514" rx="262" ry="122" fill="#FAD18A"/>
         <ellipse cx="640" cy="560" rx="120" ry="58" fill="#E7A94A" opacity="0.55"/>
       </g>${garnish(520, 470, 80)}`,
      1,
    ),
  'Set Dosa': () =>
    svg(
      `${plate()}${steam(600, 300, 3)}
       <g>
         <ellipse cx="600" cy="600" rx="250" ry="120" fill="#C0802A" opacity="0.4"/>
         <ellipse cx="600" cy="560" rx="240" ry="112" fill="#E9AE56"/>
         <ellipse cx="600" cy="526" rx="222" ry="102" fill="#F5C778"/>
         <ellipse cx="600" cy="486" rx="196" ry="90" fill="#FBDC9F"/>
       </g>
       <g fill="#FFFBF2" opacity="0.95">
         <circle cx="470" cy="470" r="16"/><circle cx="600" cy="446" r="14"/><circle cx="716" cy="474" r="15"/>
       </g>${garnish(600, 500, 140)}`,
      2,
    ),
  'Idli (2 pcs)': () =>
    svg(
      `${plate()}${steam(600, 300, 3)}
       <g>
         <ellipse cx="480" cy="572" rx="165" ry="128" fill="#DFD2BE"/>
         <ellipse cx="480" cy="552" rx="158" ry="120" fill="#FFFDF7"/>
         <ellipse cx="452" cy="520" rx="82" ry="52" fill="#FFFFFF" opacity="0.9"/>
         <ellipse cx="700" cy="590" rx="165" ry="128" fill="#DFD2BE"/>
         <ellipse cx="700" cy="570" rx="158" ry="120" fill="#FFFDF7"/>
         <ellipse cx="672" cy="538" rx="82" ry="52" fill="#FFFFFF" opacity="0.9"/>
       </g>${garnish(600, 470, 130)}`,
      0,
    ),
  'Idli-Vada Combo': () =>
    svg(
      `${plate()}${steam(600, 290, 3)}
       <ellipse cx="470" cy="560" rx="150" ry="118" fill="#DFD2BE"/>
       <ellipse cx="470" cy="542" rx="143" ry="110" fill="#FFFDF7"/>
       <g>
         <circle cx="742" cy="566" r="140" fill="#E3B266"/>
         <circle cx="742" cy="556" r="134" fill="#C98B33"/>
         <circle cx="742" cy="556" r="52" fill="#FFFBF3"/>
         <circle cx="742" cy="556" r="52" fill="none" stroke="#A9701F" stroke-width="8"/>
       </g>${garnish(650, 460, 120)}`,
      1,
    ),
  'Medu Vada': () =>
    svg(
      `${plate()}${steam(600, 300, 2)}
       <circle cx="600" cy="560" r="205" fill="#C6892F"/>
       <circle cx="600" cy="548" r="198" fill="#DDA847"/>
       <circle cx="600" cy="548" r="84" fill="#FFFBF3"/>
       <circle cx="600" cy="548" r="92" fill="none" stroke="#B37A22" stroke-width="10"/>
       <circle cx="600" cy="548" r="92" fill="none" stroke="#F3C97F" stroke-width="4" opacity="0.7"/>
       ${garnish(600, 440, 160)}`,
      2,
    ),
  'Maddur Vada': () =>
    svg(
      `${plate()}
       <g>
         <ellipse cx="500" cy="580" rx="175" ry="110" fill="#B87C2A" opacity="0.5"/>
         <ellipse cx="500" cy="556" rx="172" ry="106" fill="#D19A3F"/>
         <ellipse cx="500" cy="544" rx="160" ry="96" fill="#E4B160"/>
         <ellipse cx="700" cy="590" rx="165" ry="104" fill="#B87C2A" opacity="0.45"/>
         <ellipse cx="700" cy="568" rx="162" ry="100" fill="#CF9740"/>
         <ellipse cx="700" cy="556" rx="150" ry="90" fill="#E2AE5B"/>
       </g>
       <g fill="#FFF2D8" opacity="0.85">
         <circle cx="450" cy="536" r="8"/><circle cx="530" cy="566" r="7"/><circle cx="480" cy="590" r="6"/>
         <circle cx="655" cy="548" r="8"/><circle cx="735" cy="580" r="7"/><circle cx="690" cy="606" r="6"/>
       </g>${garnish(600, 460, 110)}`,
      0,
    ),
  Biryani: () =>
    svg(
      `${plate()}${steam(600, 290, 3)}
       ${bowl(600, 560, 290, 210, '#FFF9EE', '#F2E0C9')}
       <ellipse cx="600" cy="520" rx="252" ry="150" fill="#E9B761"/>
       <g fill="#F6D79A">
         ${Array.from({ length: 46 }, (_, i) => {
           const a = (i * 137.5) % 360;
           const r = 40 + (i % 9) * 22;
           const x = 600 + Math.cos((a * Math.PI) / 180) * r * 1.4;
           const y = 510 + Math.sin((a * Math.PI) / 180) * r * 0.72;
           return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="13" ry="6" transform="rotate(${a % 60} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
         }).join('')}
       </g>
       <g stroke="#8C4A1B" stroke-width="6" stroke-linecap="round" opacity="0.85">
         <path d="M500,470 q60,-34 130,-10"/><path d="M600,440 q70,-22 120,6"/><path d="M520,540 q70,-22 140,2"/>
       </g>${garnish(600, 470, 130)}`,
      1,
    ),
  'Bisi Bele Bath': () =>
    svg(
      `${plate()}${steam(600, 290, 3)}
       ${bowl(600, 560, 280, 205, '#FFF9EE', '#F2E0C9')}
       <ellipse cx="600" cy="524" rx="240" ry="142" fill="#C96E2A"/>
       <ellipse cx="600" cy="508" rx="222" ry="126" fill="#DE8C3C"/>
       <g fill="#F7CE7C" opacity="0.9">
         ${Array.from({ length: 30 }, (_, i) => {
           const a = (i * 149) % 360;
           const r = 26 + (i % 7) * 24;
           return `<circle cx="${(600 + Math.cos((a * Math.PI) / 180) * r * 1.3).toFixed(1)}" cy="${(512 + Math.sin((a * Math.PI) / 180) * r * 0.66).toFixed(1)}" r="9"/>`;
         }).join('')}
       </g>${garnish(600, 480, 120)}`,
      2,
    ),
  Upma: () =>
    svg(
      `${plate()}${steam(600, 300, 2)}
       ${bowl(600, 560, 270, 196, '#FFF9EE', '#F2E0C9')}
       <ellipse cx="600" cy="528" rx="228" ry="132" fill="#E7C05E"/>
       <g fill="#F6DE9A">
         ${Array.from({ length: 40 }, (_, i) => {
           const a = (i * 131) % 360;
           const r = 20 + (i % 8) * 22;
           const x = 600 + Math.cos((a * Math.PI) / 180) * r * 1.35;
           const y = 518 + Math.sin((a * Math.PI) / 180) * r * 0.68;
           return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="14" height="10" rx="4" transform="rotate(${a} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
         }).join('')}
       </g>${garnish(600, 486, 110)}`,
      0,
    ),
  'Chapati & Curry': () =>
    svg(
      `${plate()}
       <g>
         <ellipse cx="470" cy="580" rx="210" ry="150" fill="#C79A55"/>
         <ellipse cx="470" cy="560" rx="204" ry="144" fill="#E1BC7C"/>
         <ellipse cx="470" cy="542" rx="190" ry="132" fill="#F0D59C"/>
         <ellipse cx="466" cy="526" rx="172" ry="116" fill="#F8E5BC"/>
         <g stroke="#D9B478" stroke-width="6" fill="none" opacity="0.8">
           <path d="M380,540 q90,-52 178,-8"/><path d="M392,582 q92,-40 172,-4"/>
         </g>
       </g>
       ${bowl(790, 590, 175, 128, '#FFF9EE', '#F2E0C9')}
       <ellipse cx="790" cy="566" rx="150" ry="96" fill="#D9872F"/>
       <ellipse cx="790" cy="556" rx="136" ry="84" fill="#EBA24A"/>
       ${garnish(790, 556, 80)}${steam(780, 400, 2)}`,
      1,
    ),
  'South Indian Meals': () =>
    svg(
      `${plate(600, 545, 420, 320)}
       ${bowl(420, 460, 118, 86, '#FFFDF7', '#EFE0CB')}
       <ellipse cx="420" cy="452" rx="92" ry="58" fill="#D9872F"/>
       ${bowl(770, 450, 118, 86, '#FFFDF7', '#EFE0CB')}
       <ellipse cx="770" cy="442" rx="92" ry="58" fill="#4E7A45"/>
       ${bowl(430, 660, 118, 86, '#FFFDF7', '#EFE0CB')}
       <ellipse cx="430" cy="652" rx="92" ry="58" fill="#E9C15B"/>
       ${bowl(760, 668, 118, 86, '#FFFDF7', '#EFE0CB')}
       <ellipse cx="760" cy="660" rx="92" ry="58" fill="#B4552A"/>
       <ellipse cx="600" cy="560" rx="150" ry="118" fill="#F2E9DA"/>
       <ellipse cx="600" cy="548" rx="138" ry="106" fill="#FFFDF7"/>
       <ellipse cx="600" cy="540" rx="112" ry="82" fill="#FBF3E3"/>
       ${steam(600, 380, 2)}`,
      2,
    ),
  'Filter Coffee': () =>
    svg(
      `${plate(600, 640, 380, 240)}
       <ellipse cx="600" cy="660" rx="280" ry="150" fill="#E9D8BF"/>
       <ellipse cx="600" cy="648" rx="272" ry="142" fill="#FFFBF3"/>
       <path d="M430,380 h340 v190 q0,96 -96,96 h-148 q-96,0 -96,-96 z" fill="#F4E8D6"/>
       <path d="M770,430 q96,26 96,104 q0,74 -96,86" fill="none" stroke="#EBD9BF" stroke-width="34"/>
       <path d="M770,430 q96,26 96,104 q0,74 -96,86" fill="none" stroke="#C98B4E" stroke-width="12" opacity="0.5"/>
       <ellipse cx="600" cy="392" rx="170" ry="34" fill="#6B3A20"/>
       <ellipse cx="600" cy="388" rx="150" ry="26" fill="#8A4E2A"/>
       <ellipse cx="600" cy="386" rx="120" ry="18" fill="#C08A57" opacity="0.85"/>
       ${steam(600, 250, 3)}`,
      0,
    ),
  Puri: () =>
    svg(
      `${plate()}
       <g>
         <circle cx="470" cy="540" r="150" fill="#C98A2C"/>
         <circle cx="470" cy="528" r="142" fill="#EDB257"/>
         <circle cx="446" cy="500" r="62" fill="#F8D089" opacity="0.9"/>
         <circle cx="690" cy="560" r="146" fill="#C98A2C"/>
         <circle cx="690" cy="548" r="138" fill="#EDB257"/>
         <circle cx="666" cy="520" r="60" fill="#F8D089" opacity="0.9"/>
         <circle cx="578" cy="470" r="122" fill="#C98A2C"/>
         <circle cx="578" cy="460" r="114" fill="#F0BB67"/>
         <circle cx="558" cy="438" r="48" fill="#FBDC9F" opacity="0.9"/>
       </g>
       ${bowl(880, 690, 120, 84, '#FFF9EE', '#F2E0C9')}
       <ellipse cx="880" cy="676" rx="92" ry="58" fill="#D9872F"/>
       ${garnish(880, 676, 60)}${steam(600, 280, 2)}`,
      1,
    ),
  'Ragi Mudde (Village Style)': () =>
    svg(
      `${plate()}${steam(600, 290, 2)}
       <g>
         <circle cx="520" cy="560" r="140" fill="#4A2A18"/>
         <circle cx="520" cy="546" r="134" fill="#5C3520"/>
         <circle cx="498" cy="518" r="52" fill="#7A4A2C" opacity="0.85"/>
         <circle cx="720" cy="590" r="120" fill="#4A2A18"/>
         <circle cx="720" cy="578" r="114" fill="#5C3520"/>
         <circle cx="702" cy="552" r="44" fill="#7A4A2C" opacity="0.85"/>
       </g>
       <path d="M600,470 q34,52 0,88 q-34,-36 0,-88" fill="#F2C14E" opacity="0.95"/>
       ${bowl(860, 690, 118, 82, '#FFF9EE', '#F2E0C9')}
       <ellipse cx="860" cy="676" rx="90" ry="56" fill="#C9662A"/>
       ${garnish(860, 676, 56)}`,
      2,
    ),
  Tea: () =>
    svg(
      `${plate(600, 640, 330, 220)}
       <ellipse cx="600" cy="664" rx="230" ry="120" fill="#E9D8BF"/>
       <ellipse cx="600" cy="652" rx="222" ry="112" fill="#FFFBF3"/>
       <path d="M480,330 h240 l-26,220 q-8,66 -94,66 q-86,0 -94,-66 z" fill="#FCF4E6" opacity="0.92"/>
       <path d="M496,392 h208 l-18,158 q-6,50 -86,50 q-80,0 -86,-50 z" fill="#C0692A"/>
       <path d="M500,392 h200 l-8,66 h-184 z" fill="#E29A55" opacity="0.75"/>
       <ellipse cx="600" cy="392" rx="104" ry="18" fill="#F0C08A"/>
       ${steam(600, 250, 3)}`,
      1,
    ),
};

// ---------------------------------------------------------------- dish slugs
const DISHES = [
  ['Biryani', 'biryani'],
  ['Bisi Bele Bath', 'bisi-bele-bath'],
  ['Chapati & Curry', 'chapati-curry'],
  ['Filter Coffee', 'filter-coffee'],
  ['Idli (2 pcs)', 'idli'],
  ['Idli-Vada Combo', 'idli-vada'],
  ['Maddur Vada', 'maddur-vada'],
  ['Masala Dosa', 'masala-dosa'],
  ['Medu Vada', 'medu-vada'],
  ['Plain Dosa', 'plain-dosa'],
  ['Set Dosa', 'set-dosa'],
  ['South Indian Meals', 'south-indian-meals'],
  ['Tea', 'tea'],
  ['Upma', 'upma'],
  ['Puri', 'puri'],
  ['Ragi Mudde (Village Style)', 'ragi-mudde'],
];

async function upload(path, buffer) {
  let last = '';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`${PROJECT_URL}/storage/v1/object/food-images/${path}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (res.ok) return;
    last = `${res.status} ${(await res.text()).slice(0, 120)}`;
    // Transient edge/storage errors (52x/5xx): back off and retry.
    if (res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`upload ${path}: ${last}`);
}

async function setImagePath(name, path) {
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
      body: JSON.stringify({ image_path: path }),
    },
  );
  if (!res.ok) throw new Error(`update ${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return rows.length;
}

let created = 0;
for (const [name, slug] of DISHES) {
  const make = ART[name];
  if (!make) {
    console.warn(`skip (no artwork): ${name}`);
    continue;
  }
  // Cards render these at 96–160 CSS px; 800×600 is plenty and keeps the menu
  // light (the first paint loads a handful of thumbnails on mobile data).
  const png = await sharp(Buffer.from(make()))
    .resize(800, 600)
    .png({ compressionLevel: 9, palette: true, colours: 96, effort: 8 })
    .toBuffer();
  const path = `seed/${slug}.png`;
  if (!DRY) {
    await upload(path, png);
    const n = await setImagePath(name, path);
    if (!n) console.warn(`warning: no DB row updated for "${name}"`);
  }
  created += 1;
  console.log(`${DRY ? 'would create' : 'seeded'} ${path} (${(png.length / 1024).toFixed(1)} KB) → ${name}`);
}

console.log(`\n${DRY ? 'Dry run' : 'Done'}: ${created} dish images.`);
