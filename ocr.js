import puppeteer from 'puppeteer-core';
import fs from 'fs';

const pdfFile = process.argv[2];

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`https://yannkerherve.github.io/secretaires/ocristeur.htm?pdf=${pdfFile}`, { waitUntil: 'networkidle0', timeout: 0 });

  // Attendre que le CSV soit prêt
  await page.waitForFunction(() => window.downloadCsvBlob !== undefined, { timeout: 36000000 });

  const buffer = await page.evaluate(async () => {
    const arr = await window.downloadCsvBlob.arrayBuffer();
    return Array.from(new Uint8Array(arr));
  });

  const path = `downloads/${pdfFile.replace(/\.pdf$/i, '.csv')}`;
  fs.writeFileSync(path, Buffer.from(buffer));
  console.log(`✅ CSV créé: ${path}`);

  await browser.close();
})();
