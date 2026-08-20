import { Temporal } from '@js-temporal/polyfill';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ownerEmail = 'owner@example.test';
const ownerPassword = 'local-test-password';
const authenticatedEnabled = process.env.E2E_AUTHENTICATED === 'true';

function requiredEnvironment(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for authenticated E2E tests.`);
  return value;
}

interface LocalSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: Record<string, unknown>;
}

async function installAuthenticatedSession(request: APIRequestContext, page: Page) {
  const supabaseUrl = requiredEnvironment('VITE_SUPABASE_URL');
  const publishableKey = requiredEnvironment('VITE_SUPABASE_PUBLISHABLE_KEY');
  const response = await request.post(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token`, {
    params: { grant_type: 'password' },
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
    },
    data: { email: ownerEmail, password: ownerPassword },
  });
  const responseText = await response.text();
  expect(response.ok(), `Local Supabase password grant failed: ${responseText}`).toBeTruthy();
  const tokenResponse = JSON.parse(responseText) as LocalSession;
  expect(tokenResponse.access_token).toBeTruthy();
  expect(tokenResponse.refresh_token).toBeTruthy();
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__PERKLEDGER_E2E_SET_SESSION__ === 'function');
  await page.evaluate(
    async ({ accessToken, refreshToken }) => {
      await window.__PERKLEDGER_E2E_SET_SESSION__?.(accessToken, refreshToken);
    },
    {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
    },
  );
  return { session: tokenResponse, supabaseUrl, publishableKey };
}

function localDate(days = 0) {
  return Temporal.Now.zonedDateTimeISO('America/New_York').toPlainDate().add({ days }).toString();
}

function accountCard(page: Page, name: string) {
  return page.locator('article.account-card').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

function benefitCard(page: Page, name: string) {
  return page.locator('article.definition-card').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

test('authenticated owner completes core UI, RPC, persistence, and rollback flows', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !authenticatedEnabled,
    'Set E2E_AUTHENTICATED=true with a running local Supabase stack.',
  );
  const { session, supabaseUrl, publishableKey } = await installAuthenticatedSession(request, page);
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now().toString(36)}`;
  const accountName = `E2E Contract Card ${suffix}`;
  const editedAccountName = `${accountName} Edited`;
  const benefitName = `E2E Hotel Credit ${suffix}`;
  const editedBenefitName = `${benefitName} Revised`;
  const merchantName = `E2E Hotel ${suffix}`;

  await page.goto('/#/dashboard');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByText(ownerEmail, { exact: true })).toBeVisible();

  await page.goto('/#/accounts');
  await page.getByRole('button', { name: '+ Add account' }).click();
  await page.getByLabel('Display name').fill(accountName);
  await page.getByLabel('Issuer/provider').fill('E2E Bank');
  await page.getByLabel('Card/service name').fill('Integration Card');
  await page.getByLabel('Last four').fill('8181');
  await page.getByLabel('Notes').fill('Created through the authenticated browser contract test.');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(page.getByRole('status')).toContainText('Account saved.');
  await expect(accountCard(page, accountName)).toBeVisible();

  await accountCard(page, accountName).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Display name').fill(editedAccountName);
  await page.getByLabel('Nickname').fill('Contract');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(accountCard(page, editedAccountName)).toBeVisible();

  await page.goto('/#/benefits/new');
  await page.getByLabel('Benefit name').fill(benefitName);
  await page.getByLabel('Card, account, or provider').selectOption({ label: editedAccountName });
  await page.getByLabel('Description').fill('A real frontend-to-RPC-to-database contract fixture.');
  await page.getByLabel('Benefit amount').fill('100');
  await page.getByLabel('Merchant', { exact: true }).fill(merchantName);
  await page.getByLabel('Effective date').fill(localDate(-1));
  await page.getByLabel(/Expiration\/end date/i).fill(localDate(60));
  await page.getByLabel('Recurrence').selectOption('monthly');
  await page.getByRole('button', { name: 'Create benefit' }).click();
  const creationFailure = await Promise.race([
    page.waitForURL(/#\/instances\/[0-9a-f-]+$/i).then(() => null),
    page
      .getByRole('alert')
      .waitFor({ state: 'visible' })
      .then(() => page.getByRole('alert').innerText()),
  ]);
  expect(creationFailure, `Benefit creation failed: ${creationFailure ?? ''}`).toBeNull();
  await expect(page.getByRole('heading', { name: benefitName, exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Edit rules' }).click();
  const benefitNameInput = page.getByLabel('Benefit name');
  await expect(benefitNameInput).toHaveValue(benefitName);
  await benefitNameInput.fill(editedBenefitName);
  await page.getByRole('radio', { name: /Current and future/i }).check();
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page).toHaveURL(/#\/benefits$/);
  await expect(page.getByRole('status')).toContainText('Historical periods were preserved.');

  const editedBenefitCard = benefitCard(page, editedBenefitName);
  await expect(editedBenefitCard).toBeVisible();
  await expect(editedBenefitCard.locator('.definition-stats')).toContainText(
    /[2-9]\d* live periods/,
  );
  const periodHistory = editedBenefitCard.locator('details.period-history');
  await periodHistory.locator('summary').click();
  await expect(periodHistory.locator('.period-history-list a').first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await editedBenefitCard.getByRole('button', { name: 'Disable recurrence' }).click();
  await expect(
    editedBenefitCard.getByRole('button', { name: 'Re-enable recurrence' }),
  ).toBeVisible();
  await expect(editedBenefitCard.locator('.definition-stats')).toContainText('1 live period');
  await editedBenefitCard.getByRole('button', { name: 'Re-enable recurrence' }).click();
  await expect(editedBenefitCard.getByRole('button', { name: 'Disable recurrence' })).toBeVisible();
  await expect(editedBenefitCard.locator('.definition-stats')).toContainText(
    /[2-9]\d* live periods/,
  );

  await editedBenefitCard.getByRole('link', { name: 'View current period' }).click();
  await page.getByRole('button', { name: '+ Record usage' }).click();
  const usageDialog = page.getByRole('dialog', { name: 'Record usage' });
  await usageDialog.getByLabel('Benefit amount used').fill('40');
  await usageDialog.getByLabel('Date used').fill(localDate());
  await usageDialog.getByLabel('Merchant').fill(merchantName);
  await usageDialog.getByRole('button', { name: 'Save usage' }).click();
  await expect(page.getByRole('status')).toContainText('Remaining value was recalculated.');
  await expect(page.locator('.detail-balance')).toContainText('Remaining');
  await expect(page.locator('.detail-balance')).toContainText('$60');
  await expect(page.locator('.detail-balance')).toContainText('$40 used of $100');
  await expect(page.getByText('Partially Used', { exact: true })).toBeVisible();

  await page.goto('/#/dashboard');
  await page.getByLabel('Search benefits').fill(editedBenefitName);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByLabel('Merchant', { exact: true }).fill(merchantName);
  await page.getByLabel('Usage').selectOption('partial');
  const dashboardRow = page.locator('tbody tr').filter({
    has: page.getByRole('link', { name: editedBenefitName, exact: true }),
  });
  await expect(dashboardRow).toHaveCount(1);
  await expect(dashboardRow).toContainText('$60');
  await expect(dashboardRow).toContainText('Partially Used');

  await page.goto('/#/benefits');
  const activeBenefitCard = benefitCard(page, editedBenefitName);
  page.once('dialog', (dialog) => dialog.accept());
  await activeBenefitCard.getByRole('button', { name: 'Deactivate' }).click();
  await expect(activeBenefitCard.getByText('Inactive', { exact: true })).toBeVisible();

  await page.goto('/#/dashboard');
  await page.getByLabel('Search benefits').fill(editedBenefitName);
  await expect(page.getByRole('link', { name: editedBenefitName, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByLabel('Definition status').selectOption('inactive');
  await expect(page.getByRole('link', { name: editedBenefitName, exact: true })).toBeVisible();

  await page.goto('/#/accounts');
  const activeAccountCard = accountCard(page, editedAccountName);
  await activeAccountCard.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Active account').uncheck();
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(
    accountCard(page, editedAccountName).getByText('Inactive', { exact: true }),
  ).toBeVisible();

  const rollbackAccountName = `Must Roll Back ${suffix}`;
  const rollbackAccountId = crypto.randomUUID();
  const missingAccountId = crypto.randomUUID();
  const malformedBackup = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    timezone: 'America/New_York',
    accounts: [
      {
        id: rollbackAccountId,
        display_name: rollbackAccountName,
        issuer: 'Rollback Bank',
        card_service_name: 'Rollback Card',
        nickname: null,
        last_four: null,
        annual_fee: null,
        annual_fee_currency: null,
        renewal_date: null,
        notes: null,
        active: true,
      },
    ],
    definitions: [
      {
        id: crypto.randomUUID(),
        account_id: missingAccountId,
        name: `Broken import ${suffix}`,
        category: 'Testing',
        description: '',
        notes: '',
        active: true,
        recurrence_enabled: false,
        value_kind: 'money',
        benefit_amount: 25,
        currency: 'USD',
        unit_label: null,
        minimum_spend: null,
        cashback_percentage: null,
        cashback_cap: null,
        merchant: null,
        merchant_category: null,
        website: null,
        tags: [],
        eligibility_notes: '',
        enrollment_required: false,
        enrollment_deadline: null,
        enrolled_at: null,
        effective_date: localDate(),
        end_date: localDate(30),
        recurrence_type: 'one_time',
        recurrence_basis: 'none',
        anchor_date: null,
        interval_months: null,
        current_revision_no: 1,
        expiration_reminder_enabled: true,
        reactivation_reminder_enabled: true,
      },
    ],
    revisions: [],
    instances: [],
    redemptions: [],
  };

  await page.goto('/#/settings');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'malformed-transactional-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(malformedBackup)),
  });
  await expect(
    page.getByRole('heading', { name: /Validation preview · JSON backup/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restore validated backup' }).click();
  await expect(page.getByRole('alert')).toContainText('definition references an unknown account');

  const accountQuery = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/accounts`);
  accountQuery.searchParams.set('select', 'id');
  accountQuery.searchParams.set('display_name', `eq.${rollbackAccountName}`);
  const rollbackCheck = await request.get(accountQuery.toString(), {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  expect(rollbackCheck.ok(), await rollbackCheck.text()).toBeTruthy();
  expect(await rollbackCheck.json()).toEqual([]);
});
