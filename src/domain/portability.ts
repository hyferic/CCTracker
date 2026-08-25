import { z } from 'zod';

export const BACKUP_SCHEMA_VERSION = 2;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;

const id = z.string().uuid();
const accountBackupSchema = z.object({
  id,
  display_name: z.string().min(1).max(160),
  issuer: z.string().min(1).max(160),
  card_service_name: z.string().max(160).nullable(),
  nickname: z.string().max(100).nullable(),
  last_four: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  annual_fee: z.number().min(0).nullable(),
  annual_fee_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  renewal_date: z.string().date().nullable(),
  benefit_anniversary_date: z.string().date().nullable().optional(),
  origin_product_version_id: id.nullable().optional(),
  origin_product_stable_key: z.string().nullable().optional(),
  origin_product_version: z.number().int().positive().nullable().optional(),
  origin_product_hash: z.string().nullable().optional(),
  notes: z.string().max(10000).nullable(),
  active: z.boolean(),
});

const backupSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(BACKUP_SCHEMA_VERSION)]),
  exported_at: z.string().datetime(),
  timezone: z.string().min(1),
  accounts: z.array(accountBackupSchema),
  definitions: z.array(z.record(z.unknown())),
  revisions: z.array(z.record(z.unknown())),
  instances: z.array(z.record(z.unknown())),
  redemptions: z.array(z.record(z.unknown())),
  notification_audit: z.array(z.record(z.unknown())).optional(),
});

export interface BackupData {
  schema_version: 1 | 2;
  exported_at: string;
  timezone: string;
  accounts: Array<Record<string, unknown>>;
  definitions: Array<Record<string, unknown>>;
  revisions: Array<Record<string, unknown>>;
  instances: Array<Record<string, unknown>>;
  redemptions: Array<Record<string, unknown>>;
  notification_audit?: Array<Record<string, unknown>>;
}

export function buildBackup(input: {
  timezone: string;
  accounts: Array<Record<string, unknown>>;
  definitions: Array<Record<string, unknown>>;
  revisions?: Array<Record<string, unknown>>;
  instances: Array<Record<string, unknown>>;
  redemptions: Array<Record<string, unknown>>;
  notificationAudit?: Array<Record<string, unknown>>;
}): BackupData {
  const stripOwnership = (record: object) => {
    const copy = { ...record } as Record<string, unknown>;
    delete copy.user_id;
    return copy;
  };
  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    timezone: input.timezone,
    accounts: input.accounts.map(stripOwnership),
    definitions: input.definitions.map(stripOwnership),
    revisions: (input.revisions ?? []).map(stripOwnership),
    instances: input.instances.map(stripOwnership),
    redemptions: input.redemptions.map(stripOwnership),
    notification_audit: input.notificationAudit?.map(stripOwnership),
  };
}

export function parseBackup(text: string): BackupData {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw new Error('Import exceeds the 5 MiB safety limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  const result = backupSchema.safeParse(parsed);
  if (!result.success)
    throw new Error(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
    );
  const rowCount =
    result.data.accounts.length +
    result.data.definitions.length +
    result.data.revisions.length +
    result.data.instances.length +
    result.data.redemptions.length;
  if (rowCount > MAX_IMPORT_ROWS) throw new Error('Import exceeds the 5,000-row safety limit.');
  return result.data as BackupData;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object'
      ? (JSON.stringify(value) ?? '')
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
          ? value.toString()
          : '';
  const safeText = typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText;
}

export function toCsv<T extends object>(records: T[]): string {
  if (records.length === 0) return '';
  const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  return [
    headers.map(csvCell).join(','),
    ...records.map((record) => {
      const row = record as Record<string, unknown>;
      return headers.map((header) => csvCell(row[header])).join(',');
    }),
  ].join('\r\n');
}

export function downloadText(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
