import { acquireIdempotencyKey } from '@/services/idempotency';

describe('idempotency key lease', () => {
  test('reusing the same identity before settling returns the same key', () => {
    const first = acquireIdempotencyKey('store-change:proposal-1:hash-a');
    const second = acquireIdempotencyKey('store-change:proposal-1:hash-a');
    expect(second.key).toBe(first.key);
  });

  test('settleDefinitive releases the key so the next acquire mints a new one', () => {
    const lease = acquireIdempotencyKey('store-change:proposal-2:hash-a');
    lease.settleDefinitive();
    const next = acquireIdempotencyKey('store-change:proposal-2:hash-a');
    expect(next.key).not.toBe(lease.key);
  });

  test('an ambiguous network failure retains the key for the next attempt with the same content', () => {
    const lease = acquireIdempotencyKey('store-change:proposal-3:hash-a');
    lease.retainOnAmbiguous();
    const retry = acquireIdempotencyKey('store-change:proposal-3:hash-a');
    expect(retry.key).toBe(lease.key);
  });

  test('a retry after an ambiguous failure eventually releases on a definitive result', () => {
    const first = acquireIdempotencyKey('seo-generation:gen-1:rev-1');
    first.retainOnAmbiguous();
    const retry = acquireIdempotencyKey('seo-generation:gen-1:rev-1');
    expect(retry.key).toBe(first.key);
    retry.settleDefinitive();
    const after = acquireIdempotencyKey('seo-generation:gen-1:rev-1');
    expect(after.key).not.toBe(retry.key);
  });

  test('content changes (a new identity) acquire a new key even while the old one is still ambiguous', () => {
    const lease = acquireIdempotencyKey('seo-generation:gen-1:rev-1');
    lease.retainOnAmbiguous();
    const revised = acquireIdempotencyKey('seo-generation:gen-1:rev-2');
    expect(revised.key).not.toBe(lease.key);
  });

  test('settle is one-shot: calling settleDefinitive after retainOnAmbiguous has no effect', () => {
    const lease = acquireIdempotencyKey('store-change:proposal-4:hash-a');
    lease.retainOnAmbiguous();
    lease.settleDefinitive();
    const retry = acquireIdempotencyKey('store-change:proposal-4:hash-a');
    expect(retry.key).toBe(lease.key);
  });

  test('legacy resolve() still releases the key (backward compatibility)', () => {
    const lease = acquireIdempotencyKey('store-change:proposal-5:hash-a');
    lease.resolve();
    const next = acquireIdempotencyKey('store-change:proposal-5:hash-a');
    expect(next.key).not.toBe(lease.key);
  });
});
