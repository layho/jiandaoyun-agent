/**
 * runtime/recovery.ts — V2 Recovery Runtime
 *
 * Handles common recovery scenarios:
 *   - Modal dismissal
 *   - Stale locator re-acquisition
 *   - Rerender recovery (enhanced for field drag/create operations)
 *   - Drag-drop failure recovery
 *
 * All recoveries are non-destructive — they never delete or mutate data.
 */

import type { Page } from 'playwright';
import { smartLocate, waitForStableDOM, isVisible } from './dom';
import { retry } from './retry';

/**
 * Attempt to close any open modal dialog.
 * Safe to call even if no modal is present.
 */
export async function closeModal(page: Page): Promise<void> {
  const closeSelectors = [
    '[aria-label="关闭"]',
    '[data-testid="modal-close"]',
    'button:has-text("关闭")',
    '[aria-label="取消"]',
    'button:has-text("取消")',
  ];

  for (const selector of closeSelectors) {
    const closeBtn = page.locator(selector);
    if ((await closeBtn.count()) > 0 && (await closeBtn.first().isVisible())) {
      console.log(`[RECOVERY] closing modal via: ${selector}`);
      await closeBtn.first().click();
      await waitForStableDOM(page);
      return;
    }
  }
}

/**
 * Ensure we have a fresh locator for an element that may have rerendered.
 * Re-queries the page after waiting for DOM stability.
 */
export async function reacquireLocator(
  page: Page,
  selectors: string[]
): Promise<ReturnType<typeof smartLocate>> {
  console.log('[RECOVERY] re-acquiring locator after potential rerender');
  await waitForStableDOM(page);
  return smartLocate(page, selectors);
}

/**
 * Full recovery sequence: modal check → DOM stabilise → reacquire.
 * Returns a fresh locator for the given selectors.
 */
export async function recover(
  page: Page,
  selectors: string[]
): Promise<ReturnType<typeof smartLocate>> {
  console.log('[RECOVERY] running recovery sequence');

  await closeModal(page);
  await waitForStableDOM(page);

  const locator = await retry(() => smartLocate(page, selectors));

  console.log('[RECOVERY] recovery complete');
  return locator;
}

/**
 * Dismiss any toast notifications that might block interaction.
 */
export async function dismissToasts(page: Page): Promise<void> {
  const toastCloseSelectors = [
    '[aria-label="关闭"]',
    '[data-testid="toast-close"]',
  ];

  for (const selector of toastCloseSelectors) {
    const btn = page.locator(selector);
    if ((await btn.count()) > 0 && (await btn.first().isVisible())) {
      await btn.first().click();
    }
  }
}

/**
 * Run full environment prep: dismiss toasts, close modals, wait stable.
 * Call at the start of every workflow.
 */
export async function prepareEnvironment(page: Page): Promise<void> {
  console.log('[RECOVERY] preparing environment');
  await dismissToasts(page);
  await closeModal(page);
  await waitForStableDOM(page);
  console.log('[RECOVERY] environment ready');
}

// ---------------------------------------------------------------------------
// Enhanced: Rerender recovery for field operations
// ---------------------------------------------------------------------------

/**
 * Execute an action that may trigger a React rerender, then recover.
 *
 * Pattern:
 *   1. Perform action (click, drag, etc.)
 *   2. Wait for networkidle + render buffer
 *   3. Re-acquire locator (stale element guard)
 *   4. Validate the locator is still usable
 *
 * Use this when interacting with the form designer canvas,
 * field config panel, or any React-controlled region.
 */
export async function withRerenderRecovery<T>(
  page: Page,
  action: () => Promise<T>,
  recoverySelectors: string[]
): Promise<{ result: T; locator: Awaited<ReturnType<typeof smartLocate>> }> {
  console.log('[RECOVERY] executing action with rerender recovery');

  // Step 1: Perform the action
  const result = await action();

  // Step 2: Wait for DOM to settle after potential rerender
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
    console.warn('[RECOVERY] networkidle wait exceeded, continuing');
  });
  await page.waitForTimeout(800);

  // Step 3: Re-acquire locator fresh after rerender
  const locator = await retry(() => smartLocate(page, recoverySelectors));

  // Step 4: Verify the locator is usable (not stale)
  try {
    await locator.first().isVisible();
    console.log('[RECOVERY] locator re-acquired and usable');
  } catch {
    console.warn('[RECOVERY] locator may be stale after rerender, retrying once more');
    await page.waitForTimeout(1_000);
    const freshLocator = await smartLocate(page, recoverySelectors);
    await freshLocator.first().isVisible();
    return { result, locator: freshLocator };
  }

  return { result, locator };
}

/**
 * Recover specifically from a drag-and-drop failure.
 * Waits for canvas to stabilise, dismisses any errors, reacquires elements.
 */
export async function recoverFromDragFailure(
  page: Page,
  fieldSelectors: string[]
): Promise<void> {
  console.log('[RECOVERY] recovering from drag failure');

  await closeModal(page);
  await dismissToasts(page);

  // Wait extra long after drag failure — React may be mid-rerender
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  // Verify field palette is still available
  const palette = await smartLocate(page, [
    "[data-testid='field-palette']",
    "[aria-label='字段面板']",
  ]);
  const paletteVisible = await palette.first().isVisible();
  if (!paletteVisible) {
    throw new Error('[RECOVERY] field palette not visible after drag failure');
  }

  console.log('[RECOVERY] drag failure recovered, ready to retry');
}

/**
 * Verify the canvas state is healthy after field operations.
 * Returns true if the canvas is in a workable state.
 */
export async function verifyCanvasHealth(page: Page): Promise<boolean> {
  console.log('[RECOVERY] verifying canvas health');

  try {
    await waitForStableDOM(page);
    const canvas = await smartLocate(page, [
      "[data-testid='form-designer-canvas']",
      "[aria-label='表单设计区']",
    ]);
    await canvas.first().isVisible();

    console.log('[RECOVERY] canvas healthy');
    return true;
  } catch {
    console.warn('[RECOVERY] canvas health check failed');
    return false;
  }
}
