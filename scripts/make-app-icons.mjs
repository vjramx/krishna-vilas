/**
 * Rasterises the Android/PWA app icons from one vector source so the launcher
 * icon, install prompt and splash all match the in-app brand mark.
 *
 *   node scripts/make-app-icons.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = 'public';

/** Full-bleed maskable source: brand plate + monogram inside the 80% safe zone. */
function svg({ rounded = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#E0521F"/>
        <stop offset="1" stop-color="#A83318"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#g)"/>
    <circle cx="256" cy="256" r="150" fill="#FFF4E7" opacity="0.14"/>
    <text x="256" y="308" text-anchor="middle"
      font-family="Georgia, 'Times New Roman', serif" font-size="176" font-weight="bold"
      fill="#FFF4E7" letter-spacing="2">KV</text>
  </svg>`;
}

await mkdir(OUT, { recursive: true });

const jobs = [
  { file: 'icon-192.png', size: 192, rounded: false },
  { file: 'icon-512.png', size: 512, rounded: false },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  { file: 'icon-180.png', size: 180, rounded: true },
];

for (const job of jobs) {
  await sharp(Buffer.from(svg({ rounded: job.rounded })))
    .resize(job.size, job.size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${job.file}`);
  console.log(`✓ ${OUT}/${job.file} (${job.size}×${job.size})`);
}
