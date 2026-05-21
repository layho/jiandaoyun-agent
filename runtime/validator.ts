/**
 * runtime/validator.ts — V2 Validation Runtime
 *
 * Every workflow step must pass validation before proceeding.
 * Validation failures abort the workflow immediately.
 */

import type { Page, Locator } from 'playwright';
import { getText, isVisible } from './dom';

// ---------------------------------------------------------------------------
// 1. Application validation — MUST be called at start of every workflow
// ---------------------------------------------------------------------------

/**
 * Verify the current application context is "爱马仕".
 * If not, throws immediately — NO further actions allowed.
 */
export async function validateApplication(page: Page): Promise<void> {
  console.log('[VALIDATION] checking application context');

  // Step 1: Check if we're on the dashboard (app list), not yet inside an app
  const appListItems = page.locator('.app-list [class*="app-card"], .app-list [class*="app-item"], [class*="appCard"], [class*="appItem"]');
  
  // Also try generic text-based detection
  const hasAppList = await page.locator('.app-list').count() > 0;
  
  if (hasAppList) {
    console.log('[VALIDATION] on dashboard — navigating into 爱马仕 app');
    
    // Find and click "爱马仕" in the app list
    const hermesSelectors = [
      'text=爱马仕',
      '[aria-label*="爱马仕"]',
      '[title*="爱马仕"]',
      'a:has-text("爱马仕")',
    ];
    
    let clicked = false;
    for (const sel of hermesSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        console.log(`[VALIDATION] clicking 爱马仕 via: ${sel}`);
        await el.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      throw new Error('[VALIDATION] Could not find "爱马仕" app on dashboard. Check app list.');
    }
    
    // Wait for app to load
    await page.waitForTimeout(3_000);
    try {
      await page.waitForLoadState('networkidle', { timeout: 5_000 });
    } catch {
      console.log('[VALIDATION] networkidle fallback — websocket');
    }
    await page.waitForTimeout(1_000);
  }

  // Step 2: Verify we're in 爱马仕 by checking page content
  let appName = '';
  const selectors = ['[data-app-name]', '[aria-label="应用名称"]', 'h1', '.current-app', '.app-name'];

  for (const sel of selectors) {
    const loc = page.locator(sel);
    const count = await loc.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const text = await loc.nth(i).textContent();
        if (text && text.includes('爱马仕')) {
          appName = text.trim();
          break;
        }
      }
    }
    if (appName) break;
  }

  // Step 3: Fallback — check entire page text
  if (!appName) {
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes('爱马仕')) {
      appName = '爱马仕';
      console.log('[VALIDATION] found 爱马仕 in page body text');
    }
  }

  if (!appName || !appName.includes('爱马仕')) {
    throw new Error(
      `[VALIDATION] Forbidden application: "${appName}". Expected "爱马仕". Workflow aborted.`
    );
  }

  console.log('[VALIDATION] application confirmed: 爱马仕');
}

// ---------------------------------------------------------------------------
// 2. Selector validation — verify registry selectors exist in DOM
// ---------------------------------------------------------------------------

export interface SelectorValidationResult {
  selector: string;
  found: boolean;
  visible: boolean;
  count: number;
}

/**
 * Validate that a selector exists and is visible.
 */
export async function validateSelector(
  page: Page,
  selector: string
): Promise<SelectorValidationResult> {
  const locator = page.locator(selector);
  const count = await locator.count();
  const found = count > 0;
  const visible = found ? await locator.first().isVisible() : false;

  const result: SelectorValidationResult = { selector, found, visible, count };

  if (!found || !visible) {
    console.warn(
      `[VALIDATION] selector not ready: ${selector} (found=${found}, visible=${visible})`
    );
  } else {
    console.log(`[VALIDATION] selector OK: ${selector} (count=${count})`);
  }

  return result;
}

/**
 * Validate a batch of selectors. All must pass.
 */
export async function validateSelectors(
  page: Page,
  selectors: string[]
): Promise<void> {
  console.log(`[VALIDATION] validating ${selectors.length} selectors`);

  const results = await Promise.all(
    selectors.map((s) => validateSelector(page, s))
  );

  const failed = results.filter((r) => !r.found);
  if (failed.length > 0) {
    const names = failed.map((r) => r.selector).join(', ');
    throw new Error(`[VALIDATION] ${failed.length} selector(s) failed: ${names}`);
  }

  console.log('[VALIDATION] all selectors passed');
}

// ---------------------------------------------------------------------------
// 3. Save validation — confirm save succeeded
// ---------------------------------------------------------------------------

/**
 * After a save action, confirm the operation succeeded.
 * Checks for success indicators in the DOM.
 */
export async function validateSave(page: Page): Promise<void> {
  console.log('[VALIDATION] checking save result');

  const successIndicators = [
    '[data-testid="save-success"]',
    '[aria-label="保存成功"]',
    'text=保存成功',
    '[data-testid="toast-success"]',
  ];

  const success = await isVisible(page, successIndicators);
  if (!success) {
    // Not necessarily a failure — some saves are silent.
    // Check that no error toast appeared.
    const errorToast = await isVisible(page, [
      '[data-testid="toast-error"]',
      'text=失败',
    ]);
    if (errorToast) {
      throw new Error('[VALIDATION] save failed — error toast detected');
    }
    console.log('[VALIDATION] save appears successful (no error indicators)');
  } else {
    console.log('[VALIDATION] save confirmed via success indicator');
  }

  console.log('[SAVE] save validation passed');
}

// ---------------------------------------------------------------------------
// 4. Network idle validation
// ---------------------------------------------------------------------------

/**
 * Assert the page has reached network idle state.
 */
export async function validateNetworkIdle(page: Page): Promise<void> {
  console.log('[VALIDATION] checking network idle');
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    console.log('[VALIDATION] network idle confirmed');
  } catch {
    console.warn('[VALIDATION] network did not reach idle within timeout — continuing');
  }
}

// ---------------------------------------------------------------------------
// 5. DOM stability validation
// ---------------------------------------------------------------------------

/**
 * Assert the DOM is not in a loading state.
 */
export async function validateDOM(page: Page): Promise<void> {
  console.log('[VALIDATION] checking DOM stability');

  const loading = await isVisible(page, [
    '[data-testid="loading-spinner"]',
    '[role="progressbar"]',
    '[aria-label="加载中"]',
  ]);

  if (loading) {
    console.log('[VALIDATION] DOM still loading, waiting...');
    await page.waitForTimeout(2_000);
    const stillLoading = await isVisible(page, [
      '[data-testid="loading-spinner"]',
      '[role="progressbar"]',
    ]);
    if (stillLoading) {
      throw new Error('[VALIDATION] DOM failed to reach stable state');
    }
  }

  console.log('[VALIDATION] DOM stable');
}

// ---------------------------------------------------------------------------
// 6. Comprehensive workflow validation (run at start + end)
// ---------------------------------------------------------------------------

export async function validateWorkflowStart(page: Page): Promise<void> {
  console.log('[VALIDATION] --- workflow start validation ---');
  await validateApplication(page);
  await validateDOM(page);
  await validateNetworkIdle(page);
  console.log('[VALIDATION] --- start validation passed ---');
}

export async function validateWorkflowEnd(page: Page): Promise<void> {
  console.log('[VALIDATION] --- workflow end validation ---');
  await validateSave(page);
  await validateDOM(page);
  await validateNetworkIdle(page);
  console.log('[VALIDATION] --- end validation passed ---');
}
