import type { DeliveryOutcome, DeliveryResult, MailTransport } from './types.ts';

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
const MAX_PROVIDER_ERROR_BYTES = 8_192;

interface ResendTransportOptions {
  apiKey: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  endpoint?: string;
}

function safeProviderCategory(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value)) return value.toLowerCase();
  return fallback;
}

async function parseProviderErrorCategory(response: Response): Promise<string> {
  let text = '';
  try {
    text = (await response.text()).slice(0, MAX_PROVIDER_ERROR_BYTES);
    const body = JSON.parse(text) as { name?: unknown; code?: unknown };
    return safeProviderCategory(body.name ?? body.code, `http_${response.status}`);
  } catch {
    return `http_${response.status}`;
  }
}

function httpFailureOutcome(status: number): DeliveryOutcome {
  if (status === 408) return 'ambiguous';
  if (status === 429 || status >= 500) return 'retryable_failed';
  return 'definitive_failed';
}

export function validateFrozenResendPayload(payloadText: string, expectedFrom?: string): boolean {
  if (payloadText.length > 100_000) return false;
  try {
    const value = JSON.parse(payloadText) as Record<string, unknown>;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

    const allowedKeys = new Set(['from', 'to', 'subject', 'text', 'html']);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
    if (typeof value.from !== 'string' || value.from.length === 0 || value.from.length > 320) {
      return false;
    }
    if (expectedFrom !== undefined && value.from !== expectedFrom) return false;
    if (
      typeof value.subject !== 'string' ||
      value.subject.length === 0 ||
      value.subject.length > 500
    ) {
      return false;
    }

    const recipients = typeof value.to === 'string' ? [value.to] : value.to;
    if (
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      recipients.length > 5 ||
      recipients.some(
        (recipient) =>
          typeof recipient !== 'string' || recipient.length === 0 || recipient.length > 320,
      )
    ) {
      return false;
    }

    if (
      value.text !== undefined &&
      (typeof value.text !== 'string' || value.text.length === 0 || value.text.length > 50_000)
    ) {
      return false;
    }
    if (
      value.html !== undefined &&
      (typeof value.html !== 'string' || value.html.length === 0 || value.html.length > 50_000)
    ) {
      return false;
    }
    const hasText = typeof value.text === 'string';
    const hasHtml = typeof value.html === 'string';
    return hasText || hasHtml;
  } catch {
    return false;
  }
}

export class ResendTransport implements MailTransport {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly endpoint: string;

  constructor(options: ResendTransportOptions) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.endpoint = options.endpoint ?? RESEND_EMAIL_ENDPOINT;
  }

  async send(payloadText: string, idempotencyKey: string): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'benefits-tracker-process-notifications/1.0',
        },
        body: payloadText,
        signal: controller.signal,
      });

      if (response.ok) {
        try {
          const body = (await response.json()) as { id?: unknown };
          if (typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 200) {
            return { outcome: 'provider_accepted', providerMessageId: body.id };
          }
        } catch {
          // A 2xx without the documented provider ID is accepted-but-unrecordable.
          // Keep it ambiguous so recovery uses the same provider idempotency key.
        }
        return {
          outcome: 'ambiguous',
          errorCategory: 'invalid_provider_response',
          errorMessage: 'Resend accepted the request but returned no usable message ID.',
        };
      }

      const errorCategory = await parseProviderErrorCategory(response);
      const outcome = httpFailureOutcome(response.status);
      return {
        outcome,
        errorCategory,
        errorMessage: `Resend request failed with HTTP ${response.status}.`,
      };
    } catch (error) {
      const timeoutOrAbort = error instanceof DOMException && error.name === 'AbortError';
      return {
        outcome: 'ambiguous',
        errorCategory: timeoutOrAbort ? 'transport_timeout' : 'transport_unavailable',
        errorMessage: timeoutOrAbort
          ? 'Resend request timed out; provider acceptance is unknown.'
          : 'Resend transport failed; provider acceptance is unknown.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FakeMailTransport implements MailTransport {
  readonly deliveries: Array<{ payloadText: string; idempotencyKey: string }> = [];

  constructor(private readonly outcome: DeliveryOutcome = 'provider_accepted') {}

  send(payloadText: string, idempotencyKey: string): Promise<DeliveryResult> {
    this.deliveries.push({ payloadText, idempotencyKey });
    if (this.outcome === 'provider_accepted') {
      return Promise.resolve({
        outcome: this.outcome,
        providerMessageId: `fake-${idempotencyKey}`,
      });
    }
    return Promise.resolve({
      outcome: this.outcome,
      errorCategory: `fake_${this.outcome}`,
      errorMessage: 'Fake transport produced the configured test outcome.',
    });
  }
}
