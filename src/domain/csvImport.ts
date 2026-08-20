import { accountInputSchema, benefitInputSchema } from './validation';
import {
  BACKUP_SCHEMA_VERSION,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type BackupData,
} from './portability';

interface ParsedRow {
  line: number;
  cells: string[];
}

const CSV_HEADERS = [
  'record_type',
  'source_id',
  'account_source_id',
  'display_name',
  'issuer',
  'card_service_name',
  'nickname',
  'last_four',
  'annual_fee',
  'annual_fee_currency',
  'renewal_date',
  'name',
  'category',
  'description',
  'notes',
  'value_kind',
  'benefit_amount',
  'currency',
  'unit_label',
  'minimum_spend',
  'cashback_percentage',
  'cashback_cap',
  'merchant',
  'merchant_category',
  'website',
  'tags',
  'eligibility_notes',
  'enrollment_required',
  'enrollment_deadline',
  'enrolled_at',
  'effective_date',
  'end_date',
  'display_reset_date',
  'recurrence_type',
  'recurrence_basis',
  'anchor_date',
  'interval_months',
  'active',
  'recurrence_enabled',
  'expiration_reminder_enabled',
  'reactivation_reminder_enabled',
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];
type CsvRecord = Record<CsvHeader, string>;

function parseRows(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;

  const finishField = () => {
    cells.push(field);
    field = '';
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (cells.some((cell) => cell.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
        if (character === '\n') line += 1;
      }
      continue;
    }

    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n')
      throw new Error(`CSV line ${line}: unexpected text after a closing quote.`);
    if (character === '"') {
      if (field.length > 0) throw new Error(`CSV line ${line}: quote starts inside a field.`);
      quoted = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRow();
      line += 1;
      rowLine = line;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error(`CSV line ${rowLine}: quoted field is not closed.`);
  if (field.length > 0 || cells.length > 0) finishRow();
  return rows;
}

function parseBoolean(value: string, fallback: boolean, label: string): boolean {
  if (!value) return fallback;
  if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(value.toLowerCase())) return false;
  throw new Error(`${label} must be true or false.`);
}

function parseNumber(value: string, label: string): number | null {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  return number;
}

function rowRecord(headers: string[], row: ParsedRow): CsvRecord {
  const output = Object.fromEntries(CSV_HEADERS.map((header) => [header, ''])) as CsvRecord;
  headers.forEach((header, index) => {
    if (CSV_HEADERS.includes(header as CsvHeader))
      output[header as CsvHeader] = (row.cells[index] ?? '').trim();
  });
  return output;
}

function required(value: string, label: string) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const templateRows: CsvRecord[] = [
  {
    ...Object.fromEntries(CSV_HEADERS.map((header) => [header, ''])),
    record_type: 'account',
    source_id: 'travel-card',
    display_name: 'Travel Card — Personal',
    issuer: 'Example Bank',
    card_service_name: 'Travel Card',
    annual_fee: '95',
    annual_fee_currency: 'USD',
    active: 'true',
  } as CsvRecord,
  {
    ...Object.fromEntries(CSV_HEADERS.map((header) => [header, ''])),
    record_type: 'definition',
    source_id: 'monthly-rideshare',
    account_source_id: 'travel-card',
    name: '$15 monthly rideshare credit',
    category: 'Transportation',
    description: 'Monthly eligible rideshare credit',
    value_kind: 'money',
    benefit_amount: '15',
    currency: 'USD',
    merchant: 'Rideshare Co',
    tags: 'rideshare|transportation',
    effective_date: '2028-01-01',
    display_reset_date: '2028-02-01',
    recurrence_type: 'monthly',
    recurrence_basis: 'calendar',
    active: 'true',
    recurrence_enabled: 'true',
    expiration_reminder_enabled: 'true',
    reactivation_reminder_enabled: 'true',
  } as CsvRecord,
];

export const CSV_IMPORT_TEMPLATE = [
  CSV_HEADERS.join(','),
  ...templateRows.map((row) => CSV_HEADERS.map((header) => csvCell(row[header])).join(',')),
].join('\r\n');

export function parseCsvImport(
  text: string,
  timezone: string,
  idFactory: () => string = () => crypto.randomUUID(),
): BackupData {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw new Error('Import exceeds the 5 MiB safety limit.');
  const rows = parseRows(text);
  const headerRow = rows[0];
  if (!headerRow) throw new Error('CSV is empty.');
  const headers = headerRow.cells.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim().toLowerCase(),
  );
  if (!headers.includes('record_type')) throw new Error('CSV requires a record_type column.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate columns.');
  const unknownHeaders = headers.filter((header) => !CSV_HEADERS.includes(header as CsvHeader));
  if (unknownHeaders.length)
    throw new Error(`CSV contains unsupported columns: ${unknownHeaders.join(', ')}.`);

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) throw new Error('CSV contains no account or definition rows.');
  if (dataRows.length > MAX_IMPORT_ROWS)
    throw new Error('Import exceeds the 5,000-row safety limit.');

  const records = dataRows.map((row) => ({ row, value: rowRecord(headers, row) }));
  const errors: string[] = [];
  const accounts: Array<Record<string, unknown>> = [];
  const definitions: Array<Record<string, unknown>> = [];
  const accountIds = new Map<string, string>();
  const definitionSources = new Set<string>();

  for (const { row, value } of records.filter(({ value }) => value.record_type === 'account')) {
    try {
      const sourceId = required(value.source_id, 'source_id');
      if (accountIds.has(sourceId)) throw new Error(`duplicate account source_id ${sourceId}.`);
      const parsed = accountInputSchema.safeParse({
        display_name: required(value.display_name, 'display_name'),
        issuer: required(value.issuer, 'issuer'),
        card_service_name: value.card_service_name || value.display_name,
        nickname: value.nickname || null,
        last_four: value.last_four || null,
        annual_fee: parseNumber(value.annual_fee, 'annual_fee'),
        annual_fee_currency: value.annual_fee_currency.toUpperCase() || null,
        renewal_date: value.renewal_date || null,
        notes: value.notes || null,
        is_active: parseBoolean(value.active, true, 'active'),
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues.map((issue) => issue.message).join(' '));
      const id = idFactory();
      accountIds.set(sourceId, id);
      const { is_active, ...input } = parsed.data;
      accounts.push({ id, ...input, active: is_active });
    } catch (caught) {
      errors.push(
        `CSV line ${row.line}: ${caught instanceof Error ? caught.message : 'invalid account'}`,
      );
    }
  }

  for (const { row, value } of records.filter(({ value }) => value.record_type === 'definition')) {
    try {
      const sourceId = required(value.source_id, 'source_id');
      if (definitionSources.has(sourceId))
        throw new Error(`duplicate definition source_id ${sourceId}.`);
      definitionSources.add(sourceId);
      const accountId = value.account_source_id
        ? accountIds.get(value.account_source_id)
        : undefined;
      if (value.account_source_id && !accountId)
        throw new Error(`account_source_id ${value.account_source_id} was not found in this file.`);
      const recurrenceType = value.recurrence_type || 'one_time';
      const parsed = benefitInputSchema.safeParse({
        account_id: accountId ?? null,
        name: required(value.name, 'name'),
        category: required(value.category, 'category'),
        description: value.description,
        notes: value.notes,
        value_kind: required(value.value_kind, 'value_kind'),
        amount: parseNumber(value.benefit_amount, 'benefit_amount'),
        currency: value.currency.toUpperCase() || null,
        unit_label: value.unit_label || null,
        minimum_spend: parseNumber(value.minimum_spend, 'minimum_spend'),
        cashback_percentage: parseNumber(value.cashback_percentage, 'cashback_percentage'),
        cashback_cap: parseNumber(value.cashback_cap, 'cashback_cap'),
        merchant: value.merchant || null,
        merchant_category: value.merchant_category || null,
        website: value.website || null,
        tags: value.tags
          ? value.tags
              .split('|')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
        eligibility_notes: value.eligibility_notes,
        enrollment_required: parseBoolean(value.enrollment_required, false, 'enrollment_required'),
        enrollment_deadline: value.enrollment_deadline || null,
        enrolled_at: value.enrolled_at || null,
        effective_date: required(value.effective_date, 'effective_date'),
        end_date: value.end_date || null,
        display_reset_date: value.display_reset_date || null,
        recurrence_enabled: parseBoolean(
          value.recurrence_enabled,
          recurrenceType !== 'one_time',
          'recurrence_enabled',
        ),
        recurrence_type: recurrenceType,
        recurrence_basis: value.recurrence_basis || 'calendar',
        anchor_date: value.anchor_date || null,
        interval_months: parseNumber(value.interval_months, 'interval_months'),
        expiration_email_enabled: parseBoolean(
          value.expiration_reminder_enabled,
          true,
          'expiration_reminder_enabled',
        ),
        reactivation_email_enabled: parseBoolean(
          value.reactivation_reminder_enabled,
          true,
          'reactivation_reminder_enabled',
        ),
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
        );
      const input = parsed.data;
      definitions.push({
        id: idFactory(),
        account_id: input.account_id,
        name: input.name,
        category: input.category,
        description: input.description,
        notes: input.notes,
        active: parseBoolean(value.active, true, 'active'),
        recurrence_enabled: input.recurrence_enabled,
        value_kind: input.value_kind,
        benefit_amount: input.amount,
        currency: input.currency,
        unit_label: input.unit_label,
        minimum_spend: input.minimum_spend,
        cashback_percentage: input.cashback_percentage,
        cashback_cap: input.cashback_cap,
        merchant: input.merchant,
        merchant_category: input.merchant_category,
        website: input.website,
        tags: input.tags,
        eligibility_notes: input.eligibility_notes,
        enrollment_required: input.enrollment_required,
        enrollment_deadline: input.enrollment_deadline,
        enrolled_at: input.enrolled_at,
        effective_date: input.effective_date,
        end_date: input.end_date,
        display_reset_date: input.display_reset_date,
        recurrence_type: input.recurrence_type,
        recurrence_basis: input.recurrence_type === 'one_time' ? 'none' : input.recurrence_basis,
        anchor_date: input.recurrence_type === 'one_time' ? null : input.anchor_date,
        interval_months: input.interval_months,
        current_revision_no: 1,
        expiration_reminder_enabled: input.expiration_email_enabled,
        reactivation_reminder_enabled: input.reactivation_email_enabled,
      });
    } catch (caught) {
      errors.push(
        `CSV line ${row.line}: ${caught instanceof Error ? caught.message : 'invalid definition'}`,
      );
    }
  }

  for (const { row, value } of records) {
    if (!['account', 'definition'].includes(value.record_type))
      errors.push(`CSV line ${row.line}: record_type must be account or definition.`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    timezone,
    accounts,
    definitions,
    revisions: [],
    instances: [],
    redemptions: [],
  };
}
