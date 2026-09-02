import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ProfileProvider } from '../features/profile/ProfileProvider';
import { I18nProvider } from '../features/i18n/I18nContext';
import { benefitDefinition, benefitInstance, profileFixture } from '../test/fixtures';
import type { CardCatalogProduct, Profile } from '../types';
import { BenefitFormPage } from './BenefitFormPage';
import { BenefitsPage } from './BenefitsPage';
import { AccountsPage } from './AccountsPage';
import { DashboardPage } from './DashboardPage';
import { InstancePage } from './InstancePage';
import { SettingsPage } from './SettingsPage';

const api = vi.hoisted(() => ({
  createAccount: vi.fn(),
  createAccountWithTemplates: vi.fn(),
  createBenefit: vi.fn(),
  deleteAccount: vi.fn(),
  deleteBenefitDraft: vi.fn(),
  deleteRedemption: vi.fn(),
  editBenefit: vi.fn(),
  editRedemption: vi.fn(),
  getInstance: vi.fn(),
  getExportData: vi.fn(),
  importBackup: vi.fn(),
  listAccounts: vi.fn(),
  listCardCatalog: vi.fn(),
  listDefinitions: vi.fn(),
  listInstances: vi.fn(),
  listNotifications: vi.fn(),
  listRedemptions: vi.fn(),
  markBenefitEnrolled: vi.fn(),
  markUncappedComplete: vi.fn(),
  reopenUncappedComplete: vi.fn(),
  reopenConfirmedBenefitPeriod: vi.fn(),
  confirmBenefitPeriodUsed: vi.fn(),
  overrideInstance: vi.fn(),
  recordRedemption: vi.fn(),
  schedulerHealth: vi.fn(),
  setBenefitActive: vi.fn(),
  setRecurrenceEnabled: vi.fn(),
  updateAccount: vi.fn(),
  updateProfile: vi.fn(),
  updateProfileLanguage: vi.fn(),
}));

vi.mock('../services/api', () => api);

function renderRoute(
  path: string,
  route: string,
  element: React.ReactNode,
  profile = profileFixture(),
) {
  return render(
    <AuthProvider>
      <ProfileProvider initialProfile={profile}>
        <I18nProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={route} element={element} />
              <Route path="*" element={<p>Navigation complete</p>} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </ProfileProvider>
    </AuthProvider>,
  );
}

function catalogProduct(overrides: Partial<CardCatalogProduct> = {}): CardCatalogProduct {
  return {
    product_version_id: '10000000-0000-4000-8000-000000000004',
    product_stable_key: 'chase-sapphire-reserve',
    product_version: 1,
    issuer: 'Chase',
    product_name: 'Sapphire Reserve',
    aliases: ['CSR'],
    market_scope: 'US consumer',
    annual_fee: 795,
    annual_fee_currency: 'USD',
    official_url: 'https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve',
    verified_on: '2026-08-25',
    age_days: 0,
    templates: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  api.listAccounts.mockResolvedValue([]);
  api.listCardCatalog.mockResolvedValue([]);
  api.listDefinitions.mockResolvedValue([]);
  api.listInstances.mockResolvedValue([]);
  api.listNotifications.mockResolvedValue([]);
  api.listRedemptions.mockResolvedValue([]);
  api.schedulerHealth.mockResolvedValue({
    last_success_at: '2028-02-20T12:00:00Z',
    last_status: 'succeeded',
    next_expected_at: '2028-02-20T12:15:00Z',
    failed_count: 0,
    requires_review_count: 0,
    is_stale: false,
  });
  api.confirmBenefitPeriodUsed.mockResolvedValue({
    instance_id: '11111111-1111-4111-8111-111111111111',
    archived: false,
    generated_instances: 1,
    confirmation_redemption_id: '55555555-5555-4555-8555-555555555555',
  });
  api.reopenConfirmedBenefitPeriod.mockResolvedValue(undefined);
  api.createBenefit.mockResolvedValue({
    definition_id: '22222222-2222-4222-8222-222222222222',
    current_instance_id: null,
  });
  api.createAccountWithTemplates.mockResolvedValue({
    account_id: '44444444-4444-4444-8444-444444444444',
    definition_ids: ['22222222-2222-4222-8222-222222222222'],
    benefits_created: 1,
    catalog_verified_on: '2026-08-25',
  });
  api.editBenefit.mockResolvedValue({ revision_id: '33333333-3333-4333-8333-333333333333' });
  api.updateProfile.mockImplementation((input: Partial<Profile>) =>
    Promise.resolve({ ...profileFixture(), ...input }),
  );
  api.updateProfileLanguage.mockImplementation((language: Profile['language']) =>
    Promise.resolve({ ...profileFixture(), language }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe('authenticated core flows', () => {
  it('creates an exact catalog product bundle while allowing benefit deselection', async () => {
    const user = userEvent.setup();
    api.listCardCatalog.mockResolvedValue([
      {
        product_version_id: '10000000-0000-4000-8000-000000000004',
        product_stable_key: 'chase-sapphire-reserve',
        product_version: 1,
        issuer: 'Chase',
        product_name: 'Sapphire Reserve',
        aliases: ['CSR'],
        market_scope: 'US consumer',
        annual_fee: 795,
        annual_fee_currency: 'USD',
        official_url: 'https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve',
        verified_on: '2026-08-25',
        age_days: 0,
        templates: [
          {
            template_version_id: '20000000-0000-4000-8000-000000000011',
            template_stable_key: 'chase-csr-travel',
            template_version: 1,
            template_name: 'Annual Travel Credit',
            summary: '$300 each account benefit year.',
            payload: { enrollment_required: false, eligibility_notes: 'Issuer terms apply.' },
            date_strategy: 'account_anniversary',
            fixed_start: null,
            fixed_end: null,
            setup_field: 'benefit_anniversary_date',
            terms_timezone: 'America/New_York',
            default_selected: true,
            confidence: 'high',
            official_url: 'https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve',
            verified_on: '2026-08-25',
            age_days: 0,
          },
        ],
      },
    ]);
    renderRoute('/accounts', '/accounts', <AccountsPage />);

    await user.click(await screen.findByRole('button', { name: '+ Add account' }));
    await user.click(screen.getByRole('button', { name: /Chase Sapphire Reserve/i }));
    await user.click(screen.getByRole('button', { name: 'Continue to details' }));
    fireEvent.change(screen.getByLabelText(/Fee renewal date/), {
      target: { value: '2026-08-15' },
    });
    expect(screen.getByLabelText(/Benefit anniversary\/reset date/)).toHaveValue('2026-08-15');
    await user.click(screen.getByRole('button', { name: 'Preview benefits' }));
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    const source = screen.getByRole('link', { name: /Issuer source/i });
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(screen.getByRole('button', { name: 'Create account and 1 benefit' }));

    await waitFor(() =>
      expect(api.createAccountWithTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          productVersionId: '10000000-0000-4000-8000-000000000004',
          selections: [{ template_version_id: '20000000-0000-4000-8000-000000000011' }],
          account: expect.objectContaining({ benefit_anniversary_date: '2026-08-15' }),
        }),
      ),
    );
  });

  it('keeps the custom-account and manual-benefit paths available during catalog outage', async () => {
    const user = userEvent.setup();
    api.listCardCatalog.mockRejectedValue(new Error('catalog offline'));
    renderRoute('/accounts', '/accounts', <AccountsPage />);
    expect(screen.getByRole('link', { name: '+ Add custom benefit' })).toHaveAttribute(
      'href',
      '/benefits/new',
    );
    await user.click(screen.getByRole('button', { name: '+ Add account' }));
    expect(await screen.findByText(/catalog is unavailable/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Custom card, service, or portal/i }));
    await user.click(screen.getByRole('button', { name: 'Continue to details' }));
    await user.type(screen.getByLabelText('Display name'), 'Side offer account');
    await user.type(screen.getByLabelText('Issuer/provider'), 'Local Bank');
    await user.type(screen.getByLabelText('Card/service name'), 'Custom Card');
    await user.click(screen.getByRole('button', { name: 'Save account' }));
    await waitFor(() => expect(api.createAccount).toHaveBeenCalled());
    expect(api.createAccountWithTemplates).not.toHaveBeenCalled();
  });

  it('requires stale-catalog acknowledgement and surfaces a server catalog race', async () => {
    const user = userEvent.setup();
    api.listCardCatalog.mockResolvedValue([catalogProduct({ age_days: 181 })]);
    api.createAccountWithTemplates.mockRejectedValueOnce(
      new Error('CATALOG_CHANGED: selected product version is no longer current'),
    );
    renderRoute('/accounts', '/accounts', <AccountsPage />);

    await user.click(await screen.findByRole('button', { name: '+ Add account' }));
    await user.click(screen.getByRole('button', { name: /Chase Sapphire Reserve/i }));
    await user.click(screen.getByRole('button', { name: 'Continue to details' }));
    await user.click(screen.getByRole('button', { name: 'Preview benefits' }));
    const create = screen.getByRole('button', { name: 'Create account and 0 benefits' });
    expect(create).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I reviewed current issuer terms/i }));
    expect(create).toBeEnabled();
    await user.click(create);

    await waitFor(() =>
      expect(api.createAccountWithTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ staleCatalogAcknowledged: true }),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('CATALOG_CHANGED');
  });

  it('blocks a selected contingent template until its qualification setup is complete', async () => {
    const user = userEvent.setup();
    api.listCardCatalog.mockResolvedValue([
      catalogProduct({
        product_version_id: '10000000-0000-4000-8000-000000000007',
        product_stable_key: 'usbank-altitude-go',
        issuer: 'U.S. Bank',
        product_name: 'Altitude Go',
        annual_fee: 0,
        templates: [
          {
            template_version_id: '20000000-0000-4000-8000-00000000001e',
            template_stable_key: 'usbank-go-streaming',
            template_version: 1,
            template_name: 'Expected Streaming Qualification Credit',
            summary: 'Expected $15 after 11 qualifying months.',
            payload: { eligibility_notes: 'Confirm current issuer terms.' },
            date_strategy: 'qualification_cycle',
            fixed_start: null,
            fixed_end: null,
            setup_field: 'first_qualifying_month',
            terms_timezone: 'America/New_York',
            default_selected: false,
            confidence: 'contingent',
            official_url:
              'https://www.usbank.com/credit-cards/altitude-go-visa-signature-credit-card.html',
            verified_on: '2026-08-25',
            age_days: 0,
          },
        ],
      }),
    ]);
    renderRoute('/accounts', '/accounts', <AccountsPage />);

    await user.click(await screen.findByRole('button', { name: '+ Add account' }));
    await user.click(screen.getByRole('button', { name: /U\.S\. Bank Altitude Go/i }));
    await user.click(screen.getByRole('button', { name: 'Continue to details' }));
    await user.click(screen.getByRole('button', { name: 'Preview benefits' }));
    await user.click(
      screen.getByRole('checkbox', { name: /Expected Streaming Qualification Credit/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Create account and 1 benefit' }));
    expect(api.createAccountWithTemplates).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/First qualifying month/), {
      target: { value: '2026-08' },
    });
    await user.click(screen.getByRole('button', { name: 'Create account and 1 benefit' }));
    await waitFor(() =>
      expect(api.createAccountWithTemplates).toHaveBeenCalledWith(
        expect.objectContaining({
          selections: [
            {
              template_version_id: '20000000-0000-4000-8000-00000000001e',
              setup: { first_qualifying_month: '2026-08' },
            },
          ],
        }),
      ),
    );
  });

  it('creates a fixed benefit with the validated form payload', async () => {
    const user = userEvent.setup();
    renderRoute('/benefits/new', '/benefits/new', <BenefitFormPage />);

    await user.type(await screen.findByLabelText('Benefit name'), 'Annual hotel credit');
    await user.type(screen.getByLabelText('Benefit amount'), '100');
    fireEvent.change(screen.getByLabelText(/Expiration\/end date/i), {
      target: { value: '2099-12-31' },
    });
    await user.click(screen.getByRole('button', { name: 'Create benefit' }));

    await waitFor(() =>
      expect(api.createBenefit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Annual hotel credit',
          value_kind: 'money',
          amount: 100,
          currency: 'USD',
          recurrence_enabled: false,
          recurrence_type: 'one_time',
          end_date: '2099-12-31',
        }),
        0,
      ),
    );
  });

  it('edits a definition with an explicit current-and-future scope', async () => {
    const user = userEvent.setup();
    const definition = benefitDefinition();
    api.listDefinitions.mockResolvedValue([definition]);
    renderRoute(
      `/benefits/${definition.id}/edit`,
      '/benefits/:definitionId/edit',
      <BenefitFormPage />,
    );

    const name = await screen.findByLabelText('Benefit name');
    await waitFor(() => expect(name).toHaveValue(definition.name));
    expect(screen.getByLabelText(/Display reset date/i)).toHaveValue('2028-03-01');
    fireEvent.change(name, { target: { value: '$20 monthly rideshare credit' } });
    await user.click(screen.getByRole('radio', { name: /Current and future/i }));
    await user.click(screen.getByRole('button', { name: 'Save new revision' }));

    await waitFor(() =>
      expect(api.editBenefit).toHaveBeenCalledWith(
        definition.id,
        expect.objectContaining({ name: '$20 monthly rideshare credit' }),
        'current_and_future',
        '',
      ),
    );
  });

  it('deactivates a definition through the lifecycle API', async () => {
    const user = userEvent.setup();
    const definition = benefitDefinition();
    api.listDefinitions.mockResolvedValue([definition]);
    api.listInstances.mockResolvedValue([benefitInstance()]);
    renderRoute('/benefits', '/benefits', <BenefitsPage />);

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(api.setBenefitActive).toHaveBeenCalledWith(definition.id, false));
    expect(api.listInstances).toHaveBeenCalledWith({ includeAuditVersions: true });
    expect(window.confirm).toHaveBeenCalled();
  });

  it('records a partial redemption against the selected period', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance();
    api.getInstance.mockResolvedValue(instance);
    renderRoute(`/instances/${instance.instance_id}`, '/instances/:instanceId', <InstancePage />);

    const recordButtons = await screen.findAllByRole('button', { name: /Record usage/i });
    expect(screen.getByText('Display reset date')).toBeInTheDocument();
    expect(screen.getByText('Mar 1, 2028')).toBeInTheDocument();
    await user.click(recordButtons[0]!);
    await user.type(screen.getByLabelText('Benefit amount used'), '4.25');
    fireEvent.change(screen.getByLabelText('Date used'), { target: { value: '2028-02-20' } });
    await user.type(screen.getByLabelText('Merchant'), 'Rideshare Co');
    await user.click(screen.getByRole('button', { name: 'Save usage' }));

    await waitFor(() =>
      expect(api.recordRedemption).toHaveBeenCalledWith(instance.instance_id, {
        quantity: 4.25,
        used_on: '2028-02-20',
        merchant: 'Rideshare Co',
        transaction_description: null,
        notes: null,
      }),
    );
  });

  it('closes account dialogs with Escape and restores the opening focus', async () => {
    const user = userEvent.setup();
    renderRoute('/accounts', '/accounts', <AccountsPage />);

    const addAccount = await screen.findByRole('button', { name: '+ Add account' });
    await user.click(addAccount);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(addAccount).toHaveFocus();
  });

  it('traps focus in instance dialogs and restores focus after Escape', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance();
    api.getInstance.mockResolvedValue(instance);
    renderRoute(`/instances/${instance.instance_id}`, '/instances/:instanceId', <InstancePage />);

    const recordUsage = (await screen.findAllByRole('button', { name: /Record usage/i }))[0]!;
    await user.click(recordUsage);
    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, [href]'),
    ).filter((element) => !element.hasAttribute('disabled'));
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(recordUsage).toHaveFocus();

    const override = screen.getByRole('button', { name: 'Override this period' });
    await user.click(override);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(override).toHaveFocus();
  });

  it('hides period override for audit instances', async () => {
    const instance = benefitInstance({
      is_live: false,
      is_audit_version: true,
      lifecycle_status: 'void',
    });
    api.getInstance.mockResolvedValue(instance);
    renderRoute(`/instances/${instance.instance_id}`, '/instances/:instanceId', <InstancePage />);

    expect(
      await screen.findByRole('heading', { name: instance.benefit_name, level: 2 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Override this period' })).not.toBeInTheDocument();
  });

  it('closes the override dialog with Escape and restores its opening focus', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance();
    api.getInstance.mockResolvedValue(instance);
    renderRoute(`/instances/${instance.instance_id}`, '/instances/:instanceId', <InstancePage />);

    const override = await screen.findByRole('button', { name: 'Override this period' });
    await user.click(override);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(override).toHaveFocus();
  });

  it('reopens an archived one-time confirmation for explicit correction', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance({
      recurrence_type: 'one_time',
      recurrence_enabled: false,
      is_live: false,
      is_audit_version: true,
      lifecycle_status: 'void',
      voided_at: '2028-02-21T00:00:00Z',
      void_reason: 'Confirmed used; archived from dashboard',
    });
    api.getInstance.mockResolvedValue(instance);
    renderRoute(`/instances/${instance.instance_id}`, '/instances/:instanceId', <InstancePage />);

    await user.click(await screen.findByRole('button', { name: 'Correct confirmation' }));
    await waitFor(() =>
      expect(api.reopenConfirmedBenefitPeriod).toHaveBeenCalledWith(instance.instance_id),
    );
    expect(screen.getByRole('button', { name: 'Correct confirmation' })).toBeInTheDocument();
  });

  it('keeps archived redemption history read-only until correction reopens it', async () => {
    const instance = benefitInstance({
      recurrence_type: 'one_time',
      recurrence_enabled: false,
      is_live: false,
      is_audit_version: true,
      lifecycle_status: 'void',
      voided_at: '2028-02-21T00:00:00Z',
      void_reason: 'Confirmed used; archived from dashboard',
    });
    api.getInstance.mockResolvedValue(instance);
    api.listRedemptions.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        benefit_instance_id: instance.instance_id,
        user_id: '11111111-1111-4111-8111-111111111111',
        quantity: 10,
        used_on: '2028-02-20',
        merchant: null,
        transaction_description: null,
        notes: 'Confirmed in lifecycle test',
        created_at: '2028-02-20T00:00:00Z',
        updated_at: '2028-02-20T00:00:00Z',
      },
    ]);
    renderRoute(`/instances/${instance.instance_id}`, '/instances/:instanceId', <InstancePage />);

    expect(await screen.findByText('Confirmed in lifecycle test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('does not show reset reminders on the dashboard', async () => {
    api.listInstances.mockResolvedValue([
      benefitInstance({
        days_remaining: 20,
        expiring_7_days: false,
        expiring_30_days: true,
        recently_activated: false,
        reset_soon: true,
      }),
    ]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(
      await screen.findByRole('link', { name: '$15 monthly rideshare credit' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Resets soon/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Other reminders/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument();
  });

  it('confirms an expiring attention item without navigating away', async () => {
    const user = userEvent.setup();
    api.listInstances.mockResolvedValue([benefitInstance()]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(
      await screen.findByRole('link', { name: '$15 monthly rideshare credit' }),
    ).toBeInTheDocument();
    const button = await screen.findByRole('button', { name: 'Record usage' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Save usage' }));

    await waitFor(() =>
      expect(api.confirmBenefitPeriodUsed).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        expect.any(String),
        'Recorded from dashboard.',
      ),
    );
    expect(screen.queryByText('Navigation complete')).not.toBeInTheDocument();
  });

  it('confirms a finite benefit in one click and removes it immediately', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance({
      recurrence_type: 'one_time',
      recurrence_enabled: false,
    });
    api.confirmBenefitPeriodUsed.mockResolvedValueOnce({
      instance_id: instance.instance_id,
      archived: true,
      generated_instances: 0,
      confirmation_redemption_id: '55555555-5555-4555-8555-555555555555',
    });
    api.listInstances.mockResolvedValue([instance]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(await screen.findByRole('link', { name: instance.benefit_name })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm used' }));

    await waitFor(() =>
      expect(api.confirmBenefitPeriodUsed).toHaveBeenCalledWith(
        instance.instance_id,
        expect.any(String),
        'Confirmed used from dashboard.',
      ),
    );
    expect(screen.queryByRole('link', { name: instance.benefit_name })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open benefit details' })).toHaveAttribute(
      'href',
      `/instances/${instance.instance_id}`,
    );

    await user.click(screen.getByRole('button', { name: 'Undo usage' }));
    await waitFor(() =>
      expect(api.reopenConfirmedBenefitPeriod).toHaveBeenCalledWith(
        instance.instance_id,
        '55555555-5555-4555-8555-555555555555',
      ),
    );
    expect(await screen.findByRole('link', { name: instance.benefit_name })).toBeInTheDocument();
  });

  it('keeps dashboard undo for an archived manual confirmation without a redemption marker', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance({
      value_kind: 'percentage_cashback',
      available_quantity: 10,
      remaining_quantity: 10,
      recurrence_type: 'one_time',
      recurrence_enabled: false,
    });
    api.confirmBenefitPeriodUsed.mockResolvedValueOnce({
      instance_id: instance.instance_id,
      archived: true,
      generated_instances: 0,
      confirmation_redemption_id: null,
    });
    api.listInstances.mockResolvedValue([instance]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'Confirm used' }));
    expect(await screen.findByRole('button', { name: 'Undo usage' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo usage' }));

    await waitFor(() =>
      expect(api.reopenConfirmedBenefitPeriod).toHaveBeenCalledWith(instance.instance_id),
    );
    expect(api.deleteRedemption).not.toHaveBeenCalled();
  });

  it('completes an uncapped benefit, exposes undo, and refreshes outstanding data', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance({
      value_kind: 'percentage_cashback',
      available_quantity: null,
      remaining_quantity: null,
      redeemed_quantity: 0,
      usage_status: 'unused',
    });
    api.listInstances
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([instance]);
    let resolveCompletion: () => void = () => undefined;
    api.markUncappedComplete.mockImplementation(
      () => new Promise<void>((resolve) => (resolveCompletion = resolve)),
    );
    api.reopenUncappedComplete.mockResolvedValue(undefined);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    const completeButton = await screen.findByRole('button', { name: 'Mark complete' });
    await user.click(completeButton);
    await waitFor(() =>
      expect(api.markUncappedComplete).toHaveBeenCalledWith(
        instance.instance_id,
        'Marked complete from dashboard.',
      ),
    );
    expect(completeButton).toBeDisabled();
    resolveCompletion();
    expect(await screen.findByRole('button', { name: 'Undo completion' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo completion' }));
    await waitFor(() =>
      expect(api.reopenUncappedComplete).toHaveBeenCalledWith(instance.instance_id),
    );
  });

  it('records partial usage for an uncapped benefit without imposing a maximum', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance({
      value_kind: 'percentage_cashback',
      available_quantity: null,
      remaining_quantity: null,
      redeemed_quantity: 0,
      usage_status: 'unused',
    });
    api.listInstances.mockResolvedValueOnce([instance]).mockResolvedValueOnce([instance]);
    api.recordRedemption.mockResolvedValue(undefined);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'Record usage' }));
    const amountInput = screen.getByLabelText('Amount used');
    expect(amountInput).not.toHaveAttribute('max');
    fireEvent.change(amountInput, { target: { value: '2.5' } });
    await user.click(screen.getByRole('button', { name: 'Save usage' }));

    await waitFor(() =>
      expect(api.recordRedemption).toHaveBeenCalledWith(instance.instance_id, {
        quantity: 2.5,
        used_on: expect.any(String),
        merchant: instance.merchant,
        transaction_description: null,
        notes: 'Recorded from dashboard.',
      }),
    );
    expect(api.confirmBenefitPeriodUsed).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open benefit details' })).toHaveAttribute(
      'href',
      `/instances/${instance.instance_id}`,
    );
  });

  it('rejects quick usage above a finite benefit balance before calling the API', async () => {
    const user = userEvent.setup();
    const instance = benefitInstance();
    api.listInstances.mockResolvedValue([instance]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'Record usage' }));
    fireEvent.change(screen.getByLabelText('Amount used'), { target: { value: '10.01' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter an amount no greater than the remaining balance.',
    );
    expect(api.confirmBenefitPeriodUsed).not.toHaveBeenCalled();
    expect(api.recordRedemption).not.toHaveBeenCalled();
  });

  it('shows uncapped completion failures outside the usage dialog', async () => {
    const user = userEvent.setup();
    api.listInstances.mockResolvedValue([
      benefitInstance({
        value_kind: 'percentage_cashback',
        available_quantity: null,
        remaining_quantity: null,
        usage_status: 'unused',
      }),
    ]);
    api.markUncappedComplete.mockRejectedValue(new Error('server refused completion'));
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'Mark complete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('server refused completion');
  });

  it('opens an expiration highlight with compact card details and merchant guidance', async () => {
    const user = userEvent.setup();
    api.listAccounts.mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        display_name: 'American Express Gold Card — Personal',
        issuer: 'American Express',
        card_service_name: 'Gold Card',
        nickname: null,
        last_four: '1001',
      },
    ]);
    api.listInstances.mockResolvedValue([
      benefitInstance({
        benefit_name: 'Dining credit',
        merchant: null,
        merchant_category: 'Dining',
        eligibility_notes: 'Use at participating U.S. restaurants.',
        website: 'https://americanexpress.com',
        days_remaining: 20,
        expiring_7_days: false,
        expiring_30_days: true,
      }),
    ]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(await screen.findByRole('link', { name: 'Dining credit' })).toBeInTheDocument();
    expect(screen.getByText('Amex Gold · •••• 1001')).toBeInTheDocument();
    expect(screen.getByText('Feb 29')).toBeInTheDocument();
    expect(screen.queryByText('Use at participating U.S. restaurants.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resy' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dining' }));
    expect(screen.getByRole('dialog', { name: 'Condition' })).toHaveTextContent('Dining');
    expect(screen.getByRole('dialog', { name: 'Condition' })).toHaveTextContent(
      'Use at participating U.S. restaurants.',
    );
    expect(screen.getByRole('link', { name: 'https://americanexpress.com' })).toHaveAttribute(
      'href',
      'https://americanexpress.com',
    );
  });

  it('renders finite progress ratios and a compact uncapped value safely', async () => {
    api.listInstances.mockResolvedValue([
      benefitInstance({
        instance_id: 'partial-progress',
        benefit_name: 'Partial credit',
        available_quantity: 10,
        redeemed_quantity: 4,
        remaining_quantity: 6,
        usage_status: 'partial',
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
      benefitInstance({
        instance_id: 'unused-progress',
        benefit_name: 'Unused credit',
        available_quantity: 10,
        redeemed_quantity: 0,
        remaining_quantity: 10,
        usage_status: 'unused',
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
      benefitInstance({
        instance_id: 'exhausted-progress',
        benefit_name: 'Exhausted credit',
        available_quantity: 10,
        redeemed_quantity: 10,
        remaining_quantity: 0,
        usage_status: 'partial',
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
      benefitInstance({
        instance_id: 'zero-progress',
        benefit_name: 'Zero credit',
        available_quantity: 0,
        redeemed_quantity: 0,
        remaining_quantity: 0,
        usage_status: 'unused',
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
      benefitInstance({
        instance_id: 'negative-remaining-progress',
        benefit_name: 'Overused credit',
        available_quantity: 10,
        remaining_quantity: -2,
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
      benefitInstance({
        instance_id: 'above-total-progress',
        benefit_name: 'Overavailable credit',
        available_quantity: 10,
        remaining_quantity: 12,
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
      benefitInstance({
        instance_id: 'uncapped-progress',
        benefit_name: 'Uncapped cashback',
        available_quantity: null,
        redeemed_quantity: 0,
        remaining_quantity: null,
        usage_status: 'unused',
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
    ]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await screen.findByRole('link', { name: 'Partial credit' });
    const card = (name: string) =>
      screen.getByRole('link', { name }).closest('article') as HTMLElement;
    const partial = card('Partial credit');
    const unused = card('Unused credit');
    const exhausted = card('Exhausted credit');
    const zero = card('Zero credit');
    const overused = card('Overused credit');
    const overavailable = card('Overavailable credit');
    const uncapped = card('Uncapped cashback');

    expect(await within(partial).findByText('$6/$10')).toBeInTheDocument();
    const partialProgress = within(partial).getByRole('progressbar');
    expect(partialProgress).toHaveAttribute('value', '40');
    expect(partialProgress).toHaveAttribute('max', '100');
    expect(partialProgress).toHaveAccessibleName('Partial credit benefit usage progress');
    expect(partial.querySelector('time')).toHaveTextContent('Feb 29');
    expect(partial.querySelector('time')).toHaveAttribute('dateTime', '2028-02-29');
    expect(partial).not.toHaveTextContent('Partially used');
    expect(partial).not.toHaveTextContent('Available');
    expect(partial).not.toHaveTextContent('Ends');
    expect(partial).not.toHaveTextContent('Resets');

    expect(within(unused).getByText('$10/$10')).toBeInTheDocument();
    expect(within(unused).getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(within(exhausted).getByText('$0/$10')).toBeInTheDocument();
    expect(within(exhausted).getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(within(zero).getByText('$0/$0')).toBeInTheDocument();
    expect(within(zero).getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(within(overused).getByText('-$2/$10')).toBeInTheDocument();
    expect(within(overused).getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(within(overavailable).getByText('$12/$10')).toBeInTheDocument();
    expect(within(overavailable).getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(within(uncapped).getByText('Uncapped')).toBeInTheDocument();
    expect(within(uncapped).queryByText(/\//)).not.toBeInTheDocument();
    expect(within(uncapped).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(uncapped).queryByText('Track usage manually')).not.toBeInTheDocument();
  });

  it('uses an account nickname instead of the generated card name', async () => {
    api.listAccounts.mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        display_name: 'American Express Gold Card — Personal',
        issuer: 'American Express',
        card_service_name: 'Gold Card',
        nickname: 'Travel rewards card',
        last_four: null,
      },
    ]);
    api.listInstances.mockResolvedValue([benefitInstance({ merchant: null })]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(await screen.findByText('Travel rewards card')).toBeInTheDocument();
    expect(screen.queryByText('Amex Gold')).not.toBeInTheDocument();
  });

  it('does not show an empty eligible-merchants popover', async () => {
    api.listInstances.mockResolvedValue([
      benefitInstance({
        merchant: null,
        merchant_category: null,
        eligibility_notes: null,
        website: null,
      }),
    ]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(
      await screen.findByRole('link', { name: '$15 monthly rideshare credit' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eligible merchants' })).not.toBeInTheDocument();
  });

  it('keeps fixed-merchant credits compact while exposing broad merchant guidance', async () => {
    api.listInstances.mockResolvedValue([
      benefitInstance({
        instance_id: 'fixed-merchant',
        benefit_name: 'Dunkin credit',
        merchant: 'Dunkin',
        merchant_category: 'Dining',
        eligibility_notes: 'Eligible Dunkin purchases.',
      }),
      benefitInstance({
        instance_id: 'fixed-merchant-uber',
        benefit_name: 'Uber credit',
        merchant: 'Uber',
        merchant_category: 'Rideshare',
        eligibility_notes: 'Eligible Uber purchases.',
      }),
      benefitInstance({
        instance_id: 'broad-merchant',
        benefit_name: 'Dining credit',
        merchant: 'Participating airlines',
        merchant_category: 'Travel',
        eligibility_notes: 'Eligible airline purchases.',
      }),
      benefitInstance({
        instance_id: 'multi-merchant',
        benefit_name: 'Travel merchant credit',
        merchant: 'Dunkin, Uber',
        merchant_category: 'Travel',
        eligibility_notes: 'Eligible purchases.',
      }),
    ]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(await screen.findByRole('link', { name: 'Dunkin credit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dunkin' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Uber credit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uber' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Participating airlines' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dunkin, Uber' })).toBeInTheDocument();
  });

  it('uses the saved profile timezone for new benefit and redemption dates', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-01-01T10:30:00Z'));
    const pacificProfile = profileFixture({ timezone: 'Pacific/Kiritimati' });
    renderRoute('/benefits/new', '/benefits/new', <BenefitFormPage />, pacificProfile);
    expect(await screen.findByLabelText('Effective date')).toHaveValue('2028-01-02');
    now.mockRestore();
  });

  it('defaults quick usage to the saved profile timezone date', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-01-01T10:30:00Z'));
    const pacificProfile = profileFixture({ timezone: 'Pacific/Kiritimati' });
    const instance = benefitInstance({
      period_start: '2028-01-01',
      period_end: '2028-01-31',
      days_remaining: 30,
    });
    api.listInstances.mockResolvedValue([instance]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />, pacificProfile);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Record usage' }));
    expect(screen.getByLabelText('Date used')).toHaveValue('2028-01-02');
    now.mockRestore();
  });

  it('queries live periods by default and loads audit versions only when requested', async () => {
    api.listInstances.mockResolvedValue([benefitInstance()]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await screen.findByRole('link', { name: '$15 monthly rideshare credit' });
    expect(api.listInstances).toHaveBeenCalledWith({ includeAuditVersions: false });
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument();
  });

  it('does not show enrollment reminders on the dashboard', async () => {
    api.listInstances.mockResolvedValue([
      benefitInstance({
        instance_id: '10000000-0000-4000-8000-000000000001',
        benefit_name: 'Missed enrollment',
        enrollment_missed: true,
      }),
      benefitInstance({
        instance_id: '10000000-0000-4000-8000-000000000002',
        benefit_name: 'Urgent enrollment',
        enrollment_due_7_days: true,
      }),
      benefitInstance({
        instance_id: '10000000-0000-4000-8000-000000000003',
        benefit_name: 'Upcoming enrollment',
        enrollment_due_30_days: true,
      }),
    ]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    expect(await screen.findByRole('link', { name: 'Missed enrollment' })).toBeInTheDocument();
    expect(screen.queryByText(/Enrollment overdue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enrollment due within 7 days/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enrollment due in 8–30 days/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Other reminders/)).not.toBeInTheDocument();
  });

  it('labels superseded period versions without selecting a void row as current', async () => {
    const user = userEvent.setup();
    const definition = benefitDefinition();
    const liveId = '10000000-0000-4000-8000-000000000010';
    const auditId = '10000000-0000-4000-8000-000000000011';
    api.listDefinitions.mockResolvedValue([definition]);
    api.listInstances.mockResolvedValue([
      benefitInstance({
        instance_id: auditId,
        lifecycle_status: 'void',
        instance_version: 1,
        is_live: false,
        is_audit_version: true,
        superseded_by_instance_id: liveId,
        voided_at: '2028-02-10T12:00:00Z',
        void_reason: 'Corrected amount',
      }),
      benefitInstance({
        instance_id: liveId,
        instance_version: 2,
        supersedes_instance_id: auditId,
      }),
    ]);
    renderRoute('/benefits', '/benefits', <BenefitsPage />);

    const current = await screen.findByRole('link', { name: 'View current period' });
    expect(current).toHaveAttribute('href', `/instances/${liveId}`);
    await user.click(screen.getByText('Period history'));
    expect(screen.getByText('Void audit · version 1')).toBeInTheDocument();
    expect(screen.getByText(/Live · version 2 · supersedes prior/)).toBeInTheDocument();
    expect(screen.getByText(/superseded by replacement/)).toBeInTheDocument();
  });

  it('shows only the verified authentication email as the reminder recipient', async () => {
    const user = userEvent.setup();
    const profile = profileFixture({ email: 'Owner@Example.com', notification_email: null });
    api.updateProfile.mockResolvedValue({
      ...profile,
      email: 'owner@example.com',
      notification_email: 'owner@example.com',
    });
    renderRoute('/settings', '/settings', <SettingsPage />, profile);

    const recipient = await screen.findByLabelText('Verified notification recipient');
    expect(recipient).toHaveValue('owner@example.com');
    expect(recipient).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ notification_email: 'owner@example.com' }),
      ),
    );
  });

  it('preserves unsaved timezone and reminder edits when language persistence succeeds', async () => {
    const user = userEvent.setup();
    const timezone = 'America/Chicago';
    api.updateProfileLanguage.mockResolvedValue({ ...profileFixture(), language: 'zh-CN' });
    renderRoute('/settings', '/settings', <SettingsPage />);

    const timezoneInput = await screen.findByDisplayValue('America/New_York');
    const expirationReminders = screen.getByRole('checkbox', { name: /Expiration reminders/i });
    const language = screen.getByRole('combobox', { name: 'Language' });
    await user.clear(timezoneInput);
    await user.type(timezoneInput, timezone);
    await user.click(expirationReminders);
    await user.selectOptions(language, 'zh-CN');

    await waitFor(() => expect(api.updateProfileLanguage).toHaveBeenCalledWith('zh-CN'));
    expect(timezoneInput).toHaveValue(timezone);
    expect(expirationReminders).not.toBeChecked();
  });

  it('rolls back a failed language save and surfaces the error', async () => {
    const user = userEvent.setup();
    api.updateProfileLanguage.mockRejectedValueOnce(new Error('language persistence failed'));
    renderRoute('/settings', '/settings', <SettingsPage />);

    const language = await screen.findByRole('combobox', { name: 'Language' });
    await user.selectOptions(language, 'zh-CN');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('language persistence failed'),
    );
    expect(language).toHaveValue('en');
  });
});
