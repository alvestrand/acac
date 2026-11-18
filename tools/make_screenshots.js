#!/usr/bin/env node
// Regenerate the ACAC screenshots in doc/ from the invented family in
// tools/sample-group.json. Serves the repository from a local HTTP
// server, opens index.html in headless Chrome with a fresh profile,
// loads the group with the page's "Load group" button, and takes two
// screenshots of the group part of the page: one with "Show" set to "No
// path" and one with it set to "Tree". The Geni SDK is replaced by a
// stub and all other requests outside the local server are blocked, so
// no network or Geni login is needed.
//
// Usage: node tools/make_screenshots.js
// Chrome is looked for in CHROME_PATH and then in the usual places.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const groupFile = join(root, 'tools', 'sample-group.json');

const chromePath = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path));

const geniSdkUrl = 'https://geni.com/jsdk.js';
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

async function main() {
  if (!chromePath) {
    throw new Error('No Chrome found; set CHROME_PATH');
  }
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage();
    await page.setViewport({ width: 1330, height: 800 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
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

    // Settings are read from sessionStorage when the page starts, and
    // kept there when the tab is reloaded. The family is invented, so
    // the members' names need not be hidden.
    await page.goto(origin + '/index.html');
    await page.evaluate(() => {
      sessionStorage.setItem('initialsOnly', 'false');
      sessionStorage.setItem('displayPath', 'none');
    });
    await page.reload();
    await page.waitForSelector('#group-select option', { timeout: 10000 });

    const input = await page.$('#load-group-input');
    await input.uploadFile(groupFile);
    await page.waitForFunction(
      () =>
        document
          .getElementById('group-file-message')
          .innerText.startsWith('Loaded'),
      { timeout: 10000 },
    );
    console.log(
      await page.$eval('#group-file-message', (element) => element.innerText),
    );
    // The load message is not part of what the screenshots show.
    await page.$eval('#group-file-message', (element) => {
      element.innerText = '';
    });

    // Only the group part of the page, below the settings and the
    // "Not logged in" notice.
    const layout = await page.$('#layout');
    await layout.screenshot({ path: join(root, 'doc', 'acac-result.png') });
    await page.select('#display-path', 'tree');
    await layout.screenshot({
      path: join(root, 'doc', 'acac-result-expanded.png'),
    });
    if (errors.length > 0) {
      throw new Error('Errors on the page: ' + JSON.stringify(errors));
    }
    console.log('Wrote doc/acac-result.png and doc/acac-result-expanded.png');
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
