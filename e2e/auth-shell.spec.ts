import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('unauthenticated production build is guarded and accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-screen')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Stop leaving credits on the table.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  const results = await new AxeBuilder({
    page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'],
  }).analyze();
  expect(results.violations).toEqual([]);
});

test('login screen remains usable at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.getByTestId('auth-screen')).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeInViewport();
  await expect(page.getByRole('button', { name: /secure sign-in link/i })).toBeInViewport();
});
