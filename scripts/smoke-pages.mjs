import { chromium } from '@playwright/test';

const pageUrl = process.env.PAGES_URL;
if (!pageUrl) {
  console.error('PAGES_URL is required.');
  process.exit(2);
}

const root = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`;
const response = await fetch(root, { redirect: 'follow' });
if (!response.ok) throw new Error(`Pages root returned HTTP ${response.status}.`);
const html = await response.text();
if (!/<div\s+id=["']root["']/.test(html)) throw new Error('Pages response is not the app shell.');

const assetReferences = [...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi)]
  .map((match) => match[1])
  .filter((value) => !value.startsWith('data:'));
if (assetReferences.length === 0)
  throw new Error('No built assets were referenced by the app shell.');

for (const reference of assetReferences.slice(0, 20)) {
  const assetUrl = new URL(reference, root);
  const assetResponse = await fetch(assetUrl);
  if (!assetResponse.ok) {
    throw new Error(`Built asset ${assetUrl.pathname} returned HTTP ${assetResponse.status}.`);
  }
  const assetText = await assetResponse.text();
  if (/\bre_[A-Za-z0-9]{24,}\b|\bsbp_[A-Za-z0-9]{20,}\b/.test(assetText)) {
    throw new Error(`Built asset ${assetUrl.pathname} appears to contain a server credential.`);
  }
}

const browser = await chromium.launch();
try {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${root}#/dashboard`, { waitUntil: 'networkidle' });
    await page.getByTestId('auth-screen').waitFor({ state: 'visible', timeout: 15_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) throw new Error(`Horizontal overflow at ${viewport.width}px.`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`Pages assets and unauthenticated responsive auth guard passed at ${root}.`);
