export interface IdempotencyKeyLease {
  readonly key: string;
  resolve(): void;
}

const activeKeys = new Map<string, string>();

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function acquireIdempotencyKey(approvalId: string): IdempotencyKeyLease {
  const key = activeKeys.get(approvalId) ?? randomKey();
  activeKeys.set(approvalId, key);
  let resolved = false;
  return {
    key,
    resolve() {
      if (!resolved && activeKeys.get(approvalId) === key) activeKeys.delete(approvalId);
      resolved = true;
    },
  };
}
