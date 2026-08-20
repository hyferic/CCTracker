import { CSV_IMPORT_TEMPLATE, parseCsvImport } from './csvImport';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const definitionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function ids() {
  const values = [accountId, definitionId];
  return () => values.shift() ?? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
}

describe('CSV account and definition import', () => {
  it('maps the documented template into one transactional backup payload', () => {
    const result = parseCsvImport(CSV_IMPORT_TEMPLATE, 'America/New_York', ids());
    expect(result.accounts).toHaveLength(1);
    expect(result.definitions).toHaveLength(1);
    expect(result.instances).toEqual([]);
    expect(result.accounts[0]).toMatchObject({
      id: accountId,
      display_name: 'Travel Card — Personal',
      active: true,
    });
    expect(result.definitions[0]).toMatchObject({
      id: definitionId,
      account_id: accountId,
      name: '$15 monthly rideshare credit',
      benefit_amount: 15,
      recurrence_type: 'monthly',
      recurrence_basis: 'calendar',
      display_reset_date: '2028-02-01',
    });
  });

  it('supports quoted commas, escaped quotes, and embedded newlines', () => {
    const csv = [
      'record_type,source_id,account_source_id,display_name,issuer,card_service_name,name,category,description,value_kind,benefit_amount,currency,effective_date,end_date,recurrence_type',
      'account,card,,Travel Card,Example Bank,Travel Card,,,,,,,,,',
      'definition,benefit,card,,,,Hotel credit,Travel,"Credit, with ""fine print""\nand a second line",money,100,USD,2028-01-01,2028-12-31,one_time',
    ].join('\r\n');
    const result = parseCsvImport(csv, 'America/New_York', ids());
    expect(result.definitions[0]?.description).toBe('Credit, with "fine print"\nand a second line');
  });

  it('rejects malformed quoting, invalid values, and missing references before any RPC call', () => {
    expect(() => parseCsvImport('record_type,source_id\ndefinition,"open', 'UTC', ids())).toThrow(
      /not closed/i,
    );

    const invalidValue = [
      'record_type,source_id,name,category,value_kind,benefit_amount,currency,effective_date,end_date,recurrence_type',
      'definition,benefit,Zero credit,Travel,money,0,USD,2028-01-01,2028-12-31,one_time',
    ].join('\n');
    expect(() => parseCsvImport(invalidValue, 'UTC', ids())).toThrow(/greater than 0/i);

    const missingAccount = [
      'record_type,source_id,account_source_id,name,category,value_kind,benefit_amount,currency,effective_date,end_date,recurrence_type',
      'definition,benefit,missing,Hotel credit,Travel,money,100,USD,2028-01-01,2028-12-31,one_time',
    ].join('\n');
    expect(() => parseCsvImport(missingAccount, 'UTC', ids())).toThrow(
      /account_source_id missing was not found/i,
    );
    expect(() => parseCsvImport('record_type,sourceid\naccount,card', 'UTC', ids())).toThrow(
      /unsupported columns: sourceid/i,
    );
  });
});
