import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ProfileProvider } from '../features/profile/ProfileProvider';
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
  overrideInstance: vi.fn(),
  recordRedemption: vi.fn(),
  schedulerHealth: vi.fn(),
  setBenefitActive: vi.fn(),
  setRecurrenceEnabled: vi.fn(),
  updateAccount: vi.fn(),
  updateProfile: vi.fn(),
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
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={element} />
            <Route path="*" element={<p>Navigation complete</p>} />
          </Routes>
        </MemoryRouter>
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
    fireEvent.change(screen.getByLabelText(/Benefit anniversary\/reset date/), {
      target: { value: '2026-08-15' },
    });
    await user.click(screen.getByRole('button', { name: 'Preview benefits' }));
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

  it('labels an upcoming recurring reset as actionable', async () => {
    const user = userEvent.setup();
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

    expect(await screen.findByText(/Resets soon/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByLabelText('Merchant')).toBeInTheDocument();
    expect(screen.getByLabelText('Definition status')).toHaveValue('active');
  });

  it('uses the saved profile timezone for new benefit and redemption dates', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-01-01T10:30:00Z'));
    const pacificProfile = profileFixture({ timezone: 'Pacific/Kiritimati' });
    renderRoute('/benefits/new', '/benefits/new', <BenefitFormPage />, pacificProfile);
    expect(await screen.findByLabelText('Effective date')).toHaveValue('2028-01-02');
    now.mockRestore();
  });

  it('queries live periods by default and loads audit versions only when requested', async () => {
    const user = userEvent.setup();
    api.listInstances.mockResolvedValue([benefitInstance()]);
    renderRoute('/dashboard', '/dashboard', <DashboardPage />);

    await screen.findByRole('link', { name: '$15 monthly rideshare credit' });
    expect(api.listInstances).toHaveBeenCalledWith({ includeAuditVersions: false });
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.selectOptions(screen.getByLabelText('Period versions'), 'all');
    await waitFor(() =>
      expect(api.listInstances).toHaveBeenCalledWith({ includeAuditVersions: true }),
    );
  });

  it('distinguishes missed, seven-day, and thirty-day enrollment attention', async () => {
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

    expect(await screen.findByText(/Enrollment overdue/)).toBeInTheDocument();
    expect(screen.getByText(/Enrollment due within 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/Enrollment due in 8–30 days/)).toBeInTheDocument();
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
});
