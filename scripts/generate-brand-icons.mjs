// Regenerates every brand icon from the master emblem.
// Source of truth (kept outside the repo):
//   C:/Users/vijay/Downloads/Krishna Vilas/public/Krishna Vilas Royal Restaurant Emblem.png
// A copy is archived to docs/logos/ so the source is recoverable.
import { mkdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const EMBLEM = 'C:/Users/vijay/Downloads/Krishna Vilas/public/Krishna Vilas Royal Restaurant Emblem.png';
const publicDir = path.resolve('public');
const archiveDir = path.resolve('docs/logos');

// Emblem is painted on a cream parchment ground (#fdf6e4); maskable padding
// reuses that exact color so the pad seams invisibly.
const CREAM = { r: 0xfd, g: 0xf6, b: 0xe4 };

const outputs = [
  { file: 'icon-180.png', size: 180 }, // apple-touch-icon
  { file: 'icon-192.png', size: 192 }, // favicon + BrandLogo + boot splash
  { file: 'icon-512.png', size: 512 }, // manifest "any"
  { file: 'icon-maskable-512.png', size: 512, maskable: true }, // manifest "maskable"
];

mkdirSync(archiveDir, { recursive: true });
copyFileSync(EMBLEM, path.join(archiveDir, path.basename(EMBLEM)));

for (const { file, size, maskable } of outputs) {
  const emblem = sharp(EMBLEM);
  const png = { palette: true, quality: 92, compressionLevel: 9 };
  const pipeline = maskable
    ? // Inner ~68% safe zone (spec wants content inside the 80% circle), on cream.
      sharp({
        create: { width: size, height: size, channels: 3, background: CREAM },
      }).composite([
        {
          input: await sharp(EMBLEM)
            .resize(Math.round(size * 0.68), Math.round(size * 0.68))
            .png()
            .toBuffer(),
          left: Math.round((size * 0.32) / 2),
          top: Math.round((size * 0.32) / 2),
        },
      ])
    : sharp(EMBLEM);
  const out = path.join(publicDir, file);
  const info = await (maskable ? pipeline : emblem.resize(size, size)).png(png).toFile(out);
  console.log(`${file}: ${info.width}x${info.height}, ${(statSync(out).size / 1024).toFixed(1)} KB`);
}

console.log('icons regenerated from emblem');
