import { buildBackup, MAX_IMPORT_BYTES, parseBackup, toCsv } from './portability';

const id = '11111111-1111-4111-8111-111111111111';

describe('portable backup validation', () => {
  it('strips ownership and round-trips canonical records', () => {
    const backup = buildBackup({
      timezone: 'America/New_York',
      accounts: [
        {
          id,
          user_id: 'owner',
          display_name: 'Travel Card',
          issuer: 'Example Bank',
          card_service_name: 'Travel',
          nickname: null,
          last_four: null,
          annual_fee: null,
          annual_fee_currency: null,
          renewal_date: null,
          notes: null,
          active: true,
        },
      ],
      definitions: [],
      revisions: [],
      instances: [],
      redemptions: [],
    });
    expect(backup.accounts[0]).not.toHaveProperty('user_id');
    expect(parseBackup(JSON.stringify(backup)).accounts).toHaveLength(1);
  });

  it('rejects malformed, oversized, and unsupported backups', () => {
    expect(() => parseBackup('{')).toThrow('not valid JSON');
    expect(() => parseBackup(JSON.stringify({ schema_version: 3 }))).toThrow();
    expect(() => parseBackup(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow('5 MiB');
  });

  it('quotes CSV cells without formula evaluation or delimiter corruption', () => {
    const csv = toCsv([{ name: 'Offer, special', notes: 'Line 1\n"Line 2"' }]);
    expect(csv).toBe('name,notes\r\n"Offer, special","Line 1\n""Line 2"""');
  });

  it('neutralizes spreadsheet formula prefixes while preserving numeric negatives', () => {
    const csv = toCsv([
      { equals: '=1+1', plus: '+SUM(A1:A2)', minus: '-2+3', at: '@cmd', amount: -12.5 },
    ]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+SUM(A1:A2)");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain(',-12.5');
  });
});
