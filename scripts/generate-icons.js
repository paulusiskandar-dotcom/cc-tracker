const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '../public/logo512.png');
const OUT_DIR = path.join(__dirname, '../public/icons');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const sizes = [
  { name: 'icon-192.png',         size: 192, padding: 0  },
  { name: 'icon-512.png',         size: 512, padding: 0  },
  { name: 'icon-maskable-512.png', size: 512, padding: 51 }, // ~10% safe zone
  { name: 'apple-touch-icon.png', size: 180, padding: 0  },
];

async function generate() {
  for (const { name, size, padding } of sizes) {
    const inner = size - padding * 2;
    await sharp(SOURCE)
      .resize(inner, inner, { fit: 'contain', background: { r: 30, g: 37, b: 99, alpha: 1 } })
      .extend({
        top: padding, bottom: padding, left: padding, right: padding,
        background: { r: 30, g: 37, b: 99, alpha: 1 },
      })
      .png()
      .toFile(path.join(OUT_DIR, name));
    console.log('Generated', name);
  }
}

generate().catch(console.error);
