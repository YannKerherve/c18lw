const puppeteer = require("puppeteer");
const fs = require("fs");

console.log = (msg = "") => process.stdout.write(msg + "\n");

async function waitForPdfLoaded(page) {
  const maxRetries = 600; // max 10 minutes si nécessaire
  const interval = 1000; // 1 seconde

  for (let i = 0; i < maxRetries; i++) {
    const numPages = await page.evaluate(() => window.pdfDoc?.numPages || 0);
    if (numPages > 0) {
      console.log(`✅ PDF chargé avec ${numPages} pages`);
      return numPages;
    }
    console.log("⏳ PDF pas encore prêt, attente 1s...");
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error("Timeout : PDF non chargé après plusieurs minutes.");
}

async function run(pdfUrl) {
  const url = `file://${process.cwd()}/ocristeur.htm?pdf=${pdfUrl}`;
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    protocolTimeout: 0
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);

  console.log(`🌐 Ouverture: ${url}`);
  await page.goto(url);

  // Attendre que le PDF soit chargé
  const totalPages = await waitForPdfLoaded(page);

  // OCR page par page
  for (let i = 1; i <= totalPages; i++) {
    console.log(`➡️ OCR page ${i}/${totalPages}...`);
    await page.evaluate((num) => renderAndOcr(num, true), i);
  }

  console.log("⏳ Génération du CSV...");
  await page.evaluate(() => downloadCsv());

  await page.waitForFunction(() => window.downloadCsvBlob !== undefined, {
    timeout: 0,
  });

  const csvBuffer = await page.evaluate(() =>
    new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res(Array.from(new Uint8Array(reader.result)));
      reader.readAsArrayBuffer(window.downloadCsvBlob);
    })
  );

  const buffer = Buffer.from(csvBuffer);
  const outPath = `ocr_csv/${pdfUrl.split("/").pop().replace(/\.pdf$/i, ".csv")}`;
  fs.writeFileSync(outPath, buffer);
  console.log("✅ CSV généré:", outPath);

  await browser.close();
}

const pdfUrl = process.argv[2];
if (!pdfUrl) {
  console.error("❌ Usage: node ocr.js <PDF URL>");
  process.exit(1);
}

run(pdfUrl).catch((err) => {
  console.error("❌ Erreur OCR:", err);
  process.exit(1);
});
