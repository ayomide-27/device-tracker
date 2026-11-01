import { createRequire } from 'node:module';

// Playwright is a big download, so it is not a dependency. Point PLAYWRIGHT_PATH at an install if
// `import 'playwright'` does not resolve on its own.
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright', process.env.PLAYWRIGHT_PATH].filter(Boolean)) {
    try {
      return require(id);
    } catch {
      /* try the next */
    }
  }
  return null;
}

export async function until(fn, { timeout = 15000, interval = 150, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// A real JPEG made by the browser itself (so the app's photo compressor has something to decode).
export async function makeJpeg(browser, path) {
  const page = await browser.newPage();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 1600, 1200);
    g.addColorStop(0, '#2563eb');
    g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1600, 1200);
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  await page.close();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, Buffer.from(base64, 'base64'));
}
