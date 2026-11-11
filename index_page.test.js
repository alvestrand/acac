// A check that the ACAC page loads and starts in a real browser. It
// drives an installed Chrome with puppeteer-core, serving the repository
// from a local HTTP server. The Geni SDK is replaced by a stub, and all
// other requests outside the local server are blocked, so the test needs
// no network and no Geni login.
//
// Chrome is looked for in CHROME_PATH and then in the usual places; the
// test is skipped if none is found.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('.', import.meta.url));

const chromePath = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path));

const geniSdkUrl = 'https://geni.com/jsdk.js';

// Just enough of the Geni SDK for the page to start.
const geniSdkStub = 'window.Geni = { init() {} };';

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

// Serve the files of the repository, and nothing outside it.
function startServer() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || file.split(sep).includes('node_modules')) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(file)] ?? 'text/plain',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const browserTest = chromePath ? test : test.skip;
if (!chromePath) {
  console.log('No Chrome found; set CHROME_PATH to run the browser test');
}

let server;
let browser;

beforeAll(async () => {
  if (!chromePath) {
    return;
  }
  server = await startServer();
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
  });
}, 30000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

browserTest(
  'the index page loads and starts without errors',
  async () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url() === geniSdkUrl) {
        request.respond({ contentType: 'text/javascript', body: geniSdkStub });
      } else if (request.url().startsWith(origin + '/')) {
        request.continue();
      } else {
        request.abort();
      }
    });

    await page.goto(origin + '/index.html');
    // The group list is filled in when the page has finished starting.
    try {
      await page.waitForSelector('#group-select option', { timeout: 10000 });
    } catch (error) {
      throw new Error(
        `The page did not finish starting (${error.message}). ` +
          `Errors on the page: ${JSON.stringify(errors)}`,
      );
    }

    expect(await page.$eval('h1', (h1) => h1.textContent)).toBe(
      'All Common Ancestors Considered',
    );
    for (const selector of ['#add-profile', '#build-tree', '#group-select']) {
      expect(await page.$(selector)).not.toBeNull();
    }
    expect(errors).toEqual([]);
    await page.close();
  },
  30000,
);
