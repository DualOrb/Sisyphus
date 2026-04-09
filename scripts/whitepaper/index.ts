#!/usr/bin/env tsx
// scripts/whitepaper/index.ts
// Generates a styled PDF whitepaper for Project Sisyphus
// Usage: npx tsx scripts/whitepaper/index.ts

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { styles } from './styles.js';
import { loadCoverImage, loadIconsAsBase64 } from './assets.js';
import { coverPage } from './sections/cover.js';
import { epigraphPage } from './sections/epigraph.js';
import { tocPage } from './sections/toc.js';
import { challengeSection } from './sections/challenge.js';
import { proofOfConceptSection } from './sections/proof-of-concept.js';
import { proposalSection } from './sections/proposal.js';
import { projectionsSection } from './sections/projections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'reports', 'whitepaper');
const OUTPUT_PDF = path.join(OUTPUT_DIR, 'project-sisyphus.pdf');
const OUTPUT_HTML = path.join(OUTPUT_DIR, 'project-sisyphus.html');

function buildHTML(coverImageUri: string | null, icons: Record<string, string>): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Sisyphus — Whitepaper</title>
  <style>${styles()}</style>
</head>
<body>
  ${coverPage(coverImageUri)}
  ${epigraphPage()}
  ${tocPage()}
  ${challengeSection()}
  ${proofOfConceptSection()}
  ${proposalSection(icons)}
  ${projectionsSection()}
</body>
</html>`;
}

async function main() {
  console.log('\n  Project Sisyphus — Whitepaper Generator\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const coverImageUri = loadCoverImage(OUTPUT_DIR);
  const icons = loadIconsAsBase64(OUTPUT_DIR);
  console.log(`  ✓ AWS icons loaded: ${Object.keys(icons).join(', ')}`);

  console.log('  Building HTML...');
  const html = buildHTML(coverImageUri, icons);
  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`  ✓ HTML saved: ${OUTPUT_HTML}`);

  console.log('  Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('  Generating PDF...');
  await page.pdf({
    path: OUTPUT_PDF,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  await browser.close();

  const pdfSize = fs.statSync(OUTPUT_PDF).size;
  console.log(`  ✓ PDF generated: ${OUTPUT_PDF} (${(pdfSize / 1024).toFixed(0)} KB)`);
  console.log('');
}

main().catch((err) => {
  console.error('Failed to generate whitepaper:', err);
  process.exit(1);
});
