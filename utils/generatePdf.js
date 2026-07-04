import puppeteer from "puppeteer";

export const generatePDF = async (html) => {

  const browser = await puppeteer.launch({
    headless: true,
    // Render/Docker jaisi restricted environments me Chrome bina in flags ke
    // launch nahi hota ("No usable sandbox"). Local pe bhi safe hain.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ],
    // Agar host apna Chrome path de (env var), toh wahi use karo.
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {})
  });

  try {
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,

      margin: {
        top: "10mm",
        right: "5mm",
        bottom: "10mm",
        left: "5mm"
      }
    });

    return pdfBuffer;
  } finally {
    // Browser hamesha band ho — error aane par bhi memory leak na ho.
    await browser.close();
  }
};
