// scripts/whitepaper/assets.ts
// Cover image and icon loading

import * as fs from 'fs';
import * as path from 'path';

export function loadCoverImage(outputDir: string): string | null {
  const cacheFile = path.join(outputDir, '.cover-cache.jpg');
  if (!fs.existsSync(cacheFile)) {
    console.warn('  ⚠ No cover image at .cover-cache.jpg — using gradient fallback');
    return null;
  }
  const buffer = fs.readFileSync(cacheFile);
  console.log(`  ✓ Cover image (${(buffer.length / 1024).toFixed(0)} KB)`);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

export function loadIconsAsBase64(outputDir: string): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const name of ['dynamodb', 'eventbridge', 'kinesis', 'lambda']) {
    const iconPath = path.join(outputDir, 'icons', `${name}.svg`);
    if (fs.existsSync(iconPath)) {
      const svg = fs.readFileSync(iconPath);
      icons[name] = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    }
  }
  return icons;
}
