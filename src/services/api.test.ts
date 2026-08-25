import { beforeEach, vi } from 'vitest';
import type { BenefitInput } from '../types';
import {
  createBenefit,
  editBenefit,
  listInstances,
  recordRedemption,
  setBenefitActive,
} from './api';

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('./supabase', () => ({ requireSupabase: () => client }));

const benefit: BenefitInput = {
  account_id: '44444444-4444-4444-8444-444444444444',
  name: '$15 monthly rideshare credit',
  category: 'Transportation',
  description: 'Monthly eligible rideshare credit.',
  notes: '',
  value_kind: 'money',
  amount: 15,
  currency: 'USD',
  unit_label: null,
  minimum_spend: 25,
  cashback_percentage: null,
  cashback_cap: null,
  merchant: 'Rideshare Co',
  merchant_category: 'Transportation',
  website: 'https://example.com',
  tags: ['rideshare'],
  eligibility_notes: 'Eligible purchases only.',
  enrollment_required: false,
  enrollment_deadline: null,
  enrolled_at: null,
  effective_date: '2028-01-01',
  end_date: null,
  display_reset_date: '2028-02-01',
  recurrence_enabled: true,
  recurrence_type: 'monthly',
  recurrence_basis: 'calendar',
  anchor_date: null,
  interval_months: null,
  expiration_email_enabled: true,
  reactivation_email_enabled: true,
  terms_timezone: 'America/New_York',
  period_value_rules: [],
};

beforeEach(() => vi.clearAllMocks());

describe('Supabase API contracts', () => {
  it('uses the live-only period view unless audit history is explicitly requested', async () => {
    const query = {
      select: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    query.select.mockReturnValue(query);
    client.from.mockReturnValue(query);

    await listInstances();
    await listInstances({ includeAuditVersions: true });

    expect(client.from).toHaveBeenNthCalledWith(1, 'benefit_instance_overview');
    expect(client.from).toHaveBeenNthCalledWith(2, 'benefit_instance_dashboard');
  });

  it('maps create and edit form names to lifecycle RPC payload names', async () => {
    client.rpc
      .mockResolvedValueOnce({
        data: { definition_id: 'definition', current_instance_id: 'instance' },
        error: null,
      })
      .mockResolvedValueOnce({ data: { revision_id: 'revision' }, error: null });

    await createBenefit(benefit, 3);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'create_benefit', {
      p_benefit: expect.objectContaining({
        account_id: benefit.account_id,
        benefit_amount: 15,
        recurrence_type: 'monthly',
        recurrence_basis: 'calendar',
        display_reset_date: '2028-02-01',
        expiration_reminder_enabled: true,
        reactivation_reminder_enabled: true,
      }),
      p_backfill_months: 3,
    });

    await editBenefit('definition', { ...benefit, name: 'Updated benefit' }, 'future', null);
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'edit_benefit', {
      p_definition_id: 'definition',
      p_changes: expect.objectContaining({
        name: 'Updated benefit',
        benefit_amount: 15,
        display_reset_date: '2028-02-01',
      }),
      p_scope: 'future_periods',
      p_effective_from: null,
    });
  });

  it('uses dedicated lifecycle and locked redemption RPC signatures', async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({
      data: {
        id: 'redemption',
        benefit_instance_id: 'instance',
        redeemed_quantity: 4.25,
        used_date: '2028-02-20',
      },
      error: null,
    });

    await setBenefitActive('definition', false);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'set_benefit_active', {
      p_definition_id: 'definition',
      p_active: false,
    });

    await recordRedemption('instance', {
      quantity: 4.25,
      used_on: '2028-02-20',
      merchant: 'Rideshare Co',
      transaction_description: 'Trip',
      notes: null,
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'record_redemption', {
      p_instance_id: 'instance',
      p_redeemed_quantity: 4.25,
      p_used_date: '2028-02-20',
      p_merchant: 'Rideshare Co',
      p_transaction_description: 'Trip',
      p_notes: null,
    });
  });
});
