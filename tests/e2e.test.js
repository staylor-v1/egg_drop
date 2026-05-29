import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  chromium = null;
}

const mimeTypes = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
]);

async function withStaticServer(run) {
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const filePath = join(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolveServer) => server.close(resolveServer));
  }
}

async function canvasPoint(page, selector, x, y) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `Expected ${selector} to be visible`);
  return {
    x: box.x + (x / 64) * box.width,
    y: box.y + (y / 256) * box.height,
  };
}

async function dragDesignCanvas(page, from, to) {
  const start = await canvasPoint(page, '#designerCanvas', from.x, from.y);
  const end = await canvasPoint(page, '#designerCanvas', to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function clickDesignCanvas(page, point) {
  const target = await canvasPoint(page, '#designerCanvas', point.x, point.y);
  await page.mouse.click(target.x, target.y);
}

async function visibleDesignerPixelCount(page) {
  return page.locator('#designerCanvas').evaluate((canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 16) count += 1;
    }
    return count;
  });
}


async function expectCanvasHasImpactZoom(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#simCanvas');
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let orangePixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a > 120 && r > 180 && g > 90 && g < 190 && b < 120) orangePixels += 1;
    }
    return orangePixels > Math.min(80, width * height * 0.0004);
  }, { timeout: 2500 });
}

async function openApp(page, url) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(url);
  await page.getByRole('heading', { name: 'Design mode' }).waitFor();
}

async function runCreateEditSimulateFlow(page, url) {
  await openApp(page, url);

  await page.getByTitle('Box tool').click();
  await page.locator('#boxFilled').uncheck();
  await page.locator('#boxThickness').fill('3');
  await dragDesignCanvas(page, { x: 15, y: 120 }, { x: 49, y: 210 });

  await page.getByRole('button', { name: /Foam/ }).click();
  await page.getByTitle('Lattice tool').click();
  await page.locator('#latticePattern').selectOption('triangle');
  await page.locator('#latticeSpacing').fill('8');
  await page.locator('#latticeThickness').fill('2');
  await dragDesignCanvas(page, { x: 18, y: 128 }, { x: 46, y: 202 });

  await page.getByRole('button', { name: /Toothpicks/ }).click();
  await page.getByTitle('Line tool').click();
  await clickDesignCanvas(page, { x: 15, y: 210 });
  await clickDesignCanvas(page, { x: 49, y: 120 });

  await page.getByRole('button', { name: 'Apply design' }).click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.locator('input[name="displaySpeed"]').fill('2.5');
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expectCanvasHasImpactZoom(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  const firstScore = await page.locator('.metric', { hasText: 'Score' }).textContent();
  assert.match(firstScore ?? '', /Score\d+\/100/);

  await page.getByRole('button', { name: 'Design' }).click();
  await clickDesignCanvas(page, { x: 30, y: 184 });
  await page.locator('#selectedElementParameters').waitFor();
  const handle = await canvasPoint(page, '#designerCanvas', 46, 202);
  const resized = await canvasPoint(page, '#designerCanvas', 54, 218);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(resized.x, resized.y, { steps: 5 });
  await page.mouse.up();
  await page.locator('[data-element-field="rect.width"]').fill('42');
  await page.getByRole('button', { name: 'Apply design' }).click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.getByRole('button', { name: 'Run simulation' }).click();
  const secondScore = await page.locator('.metric', { hasText: 'Score' }).textContent();
  assert.match(secondScore ?? '', /Score\d+\/100/);
}

test('user creates, simulates, edits, and reruns a multi-material protection structure', { skip: !chromium }, async () => {
  await withStaticServer(async (baseUrl) => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await runCreateEditSimulateFlow(page, baseUrl);
    } finally {
      await browser.close();
    }
  });
});

test('direct file-open app remains responsive in Chrome-family browsers', { skip: !chromium }, async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await runCreateEditSimulateFlow(page, pathToFileURL(resolve('index.html')).href);
  } finally {
    await browser.close();
  }
});

test('drawing tools show previews before the shape is committed', { skip: !chromium }, async () => {
  await withStaticServer(async (baseUrl) => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await openApp(page, baseUrl);
      await page.getByRole('button', { name: 'Clear' }).click();
      const blankCount = await visibleDesignerPixelCount(page);

      await page.getByTitle('Line tool').click();
      await clickDesignCanvas(page, { x: 8, y: 220 });
      const startOnlyCount = await visibleDesignerPixelCount(page);
      const lineEnd = await canvasPoint(page, '#designerCanvas', 56, 122);
      await page.mouse.move(lineEnd.x, lineEnd.y, { steps: 8 });
      const linePreviewCount = await visibleDesignerPixelCount(page);
      assert.ok(linePreviewCount > startOnlyCount + 20, 'line preview should add visible pixels while choosing the second point');
      await page.mouse.click(lineEnd.x, lineEnd.y);

      await page.getByTitle('Box tool').click();
      const boxStart = await canvasPoint(page, '#designerCanvas', 12, 130);
      const boxEnd = await canvasPoint(page, '#designerCanvas', 42, 190);
      const beforeBoxCount = await visibleDesignerPixelCount(page);
      await page.mouse.move(boxStart.x, boxStart.y);
      await page.mouse.down();
      await page.mouse.move(boxEnd.x, boxEnd.y, { steps: 8 });
      const boxPreviewCount = await visibleDesignerPixelCount(page);
      assert.ok(boxPreviewCount > beforeBoxCount + 100, 'box preview should add visible pixels while dragging');
      await page.mouse.up();

      assert.ok(blankCount < startOnlyCount, 'first line click should show a start handle');
    } finally {
      await browser.close();
    }
  });
});
