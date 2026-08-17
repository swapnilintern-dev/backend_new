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

    // Timeouts badha do — Render free tier weak hai aur invoice HTML bhaari
    // (base64 images). Default 30s kam padta tha ("Navigation timeout").
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);

    // "load" (not "networkidle0"): HTML self-contained hai (koi external
    // network request nahi, sab inline base64), toh network-idle ka wait
    // faltu tha aur Render pe hang/timeout kar raha tha. "load" images
    // decode hone tak wait karta hai — PDF ke liye kaafi.
    await page.setContent(html, { waitUntil: "load", timeout: 120000 });

    const pdfBuffer = await page.pdf({
      timeout: 120000,
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
