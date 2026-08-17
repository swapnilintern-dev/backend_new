const { join } = require("path");

/**
 * Puppeteer config — Render fix.
 *
 * Default cache (~/.cache/puppeteer = /opt/render/.cache/puppeteer) build ke
 * baad runtime pe available nahi rehta, isliye "Could not find Chrome" aata
 * tha. Cache ko project folder ke ANDAR rakhne se build me download hua Chrome
 * runtime pe bhi milta hai.
 *
 * Render Build Command (dashboard me) ye rakhna zaroori hai:
 *   npm install && npx puppeteer browsers install chrome
 */
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
