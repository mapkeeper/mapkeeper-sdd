export interface IdempotencyKeyLease {
  readonly key: string;
  /**
   * @deprecated Always releases the key regardless of outcome. Prefer
   * {@link IdempotencyKeyLease.settleDefinitive} / {@link IdempotencyKeyLease.retainOnAmbiguous}
   * so ambiguous network failures keep the key for retry (API Contract §7 approval idempotency).
   */
  resolve(): void;
  /** Call after a definitive result (success or a definitive server error) frees the key for the next approval attempt. */
  settleDefinitive(): void;
  /** Call after an ambiguous failure (e.g. network error, timeout) so a retry reuses the same key. */
  retainOnAmbiguous(): void;
}

const activeKeys = new Map<string, string>();

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Acquires (or reuses) an idempotency key for the given identity. Pass a stable identity
 * that changes only when the approval content changes (e.g. `${proposalId}:${contentHash}`
 * or `${generationId}:${revision}`) so an ambiguous failure followed by a retry with the
 * same content reuses the same key, while a genuinely new approval acquires a new one.
 */
export function acquireIdempotencyKey(identity: string): IdempotencyKeyLease {
  const key = activeKeys.get(identity) ?? randomKey();
  activeKeys.set(identity, key);
  let settled = false;

  function release(): void {
    if (activeKeys.get(identity) === key) activeKeys.delete(identity);
  }

  return {
    key,
    resolve() {
      if (settled) return;
      settled = true;
      release();
    },
    settleDefinitive() {
      if (settled) return;
      settled = true;
      release();
    },
    retainOnAmbiguous() {
      if (settled) return;
      settled = true;
      // Intentionally do not release: the key stays reserved for `identity` so the next
      // attempt with the same content reuses it instead of minting a new one.
    },
  };
}
