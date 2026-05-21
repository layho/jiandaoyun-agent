/**
 * runtime/retry.ts — V2 Retry Runtime
 *
 * All workflow actions that touch the browser MUST be wrapped in retry().
 * Default: 2 attempts. Callers may override for known-flaky steps.
 */

export async function retry<T>(
  fn: () => Promise<T>,
  times: number = 2
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < times; i++) {
    try {
      const result = await fn();
      if (i > 0) {
        console.log(`[RECOVERY] retry succeeded on attempt ${i + 1}/${times}`);
      }
      return result;
    } catch (e) {
      lastError = e;
      if (i < times - 1) {
        console.warn(
          `[RECOVERY] retry attempt ${i + 1}/${times} failed, retrying...`
        );
        // Small backoff before retry to let the DOM settle
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  throw lastError;
}
