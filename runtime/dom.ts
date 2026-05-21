/**
 * runtime/dom.ts — V2 DOM Runtime
 *
 * Responsibilities:
 *   - smartLocate: multi-selector fallback with first-match
 *   - waitForStableDOM: networkidle + render buffer
 *
 * All workflows MUST use these functions. Free-form DOM access is forbidden.
 */

import type { Page, Locator } from 'playwright';

/**
 * Multi-selector fallback. Tries each selector in order, returns the first
 * matching Locator. Throws if no selector matches.
 *
 * Required by V2 spec: selector fallback, semantic selector, first match.
 */
export async function smartLocate(
  page: Page,
  selectors: string[]
): Promise<Locator> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count > 0) {
      console.log(`[SELECTOR] matched: ${selector} (count=${count})`);
      return locator.first();
    }
  }
  throw new Error(
    `[SELECTOR] No matching selector found. Tried: ${selectors.join(', ')}`
  );
}

/**
 * Waits for the DOM to reach a stable state:
 *   1. networkidle — all pending requests settled
 *   2. 800ms render buffer — React / virtual-DOM paint delay
 *
 * Call after every navigation, save, dialog open/close.
 */
export async function waitForStableDOM(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.waitForTimeout(800);
}

/**
 * Convenience: locate + wait for stable in one call.
 */
export async function locateWhenStable(
  page: Page,
  selectors: string[]
): Promise<Locator> {
  await waitForStableDOM(page);
  return smartLocate(page, selectors);
}

/**
 * Shorthand: get visible text content from a locator, trimmed.
 */
export async function getText(locator: Locator): Promise<string> {
  const text = await locator.textContent();
  return (text ?? '').trim();
}

/**
 * Check if at least one element matching any of the selectors is visible.
 */
export async function isVisible(
  page: Page,
  selectors: string[]
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) {
      const visible = await locator.first().isVisible();
      if (visible) return true;
    }
  }
  return false;
}
