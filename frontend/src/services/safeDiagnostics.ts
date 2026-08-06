const SENSITIVE_KEYS = /recognizedText|bodyMasked|review|authorization|idempotency|phone|address|token|secret|apiKey/i;

function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEYS.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, item]) => [entryKey, redact(item, entryKey)]));
  }
  return value;
}

export function safeDiagnostic(event: string, context: Readonly<Record<string, unknown>> = {}): void {
  if (!import.meta.env.DEV) return;
  console.info(`[Mapkeeper] ${event}`, redact(context));
}
