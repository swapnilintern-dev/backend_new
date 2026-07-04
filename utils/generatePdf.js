import puppeteer from "puppeteer";

// A single shared browser is reused across invoices — launching Chromium per
// request is slow and quickly exhausts memory on small dynos (Render/Railway).
let browserPromise = null;

// Flags that let Chromium run inside restricted PaaS/Docker sandboxes where the
// default setuid sandbox isn't permitted (this is what makes it work on Render).
const launchOptions = {
  headless: "new",
  // NOTE: do NOT add --single-process / --no-zygote here — they crash
  // Chromium's printToPDF ("Target closed"). These flags are what's needed and
  // sufficient to run in restricted PaaS/Docker sandboxes (Render).
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ],
  // Optional override when the host provides its own Chrome build.
  ...(process.env.PUPPETEER_EXECUTABLE_PATH
    ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
    : {}),
};

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(launchOptions).catch((err) => {
      // Let the next call retry a fresh launch instead of caching the failure.
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Renders an HTML string to a PDF Buffer (A4). Never leaks a page, and
 * transparently relaunches the browser if a previous one died.
 */
export const generatePDF = async (html) => {
  let browser = await getBrowser();
  let page;
  try {
    page = await browser.newPage();
  } catch (_) {
    // The cached browser is dead — drop it and relaunch once.
    browserPromise = null;
    browser = await getBrowser();
    page = await browser.newPage();
  }

  try {
    // Images are inlined as base64 data URIs, so nothing is fetched over the
    // network — "networkidle0" resolves as soon as the layout settles.
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        right: "5mm",
        bottom: "10mm",
        left: "5mm",
      },
    });
    return pdfBuffer;
  } finally {
    if (page) await page.close().catch(() => {});
  }
};
