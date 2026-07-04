import puppeteer from "puppeteer";

export const generatePDF = async (html) => {

  const browser = await puppeteer.launch({
    headless: true
  });

  const page = await browser.newPage();

  await page.setContent(html);

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

  await browser.close();

  return pdfBuffer;
};