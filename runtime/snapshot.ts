/**
 * runtime/snapshot.ts — V2 Snapshot Capture (Verification Phase)
 *
 * Three-level snapshot system to prevent DOM OOM with DeepSeek.
 *
 * Level 1: screenshot only (always safe)
 * Level 2: partial DOM — queried by semantic selector (capped at 5KB)
 * Level 3: full DOM — debugging only, capped at 50KB
 *
 * NEVER use page.content() raw — 简道云 React DOM is massive.
 */

import type { Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SNAPSHOT_DIR = resolve(__dirname, '..', 'snapshots');
try { mkdirSync(SNAPSHOT_DIR, { recursive: true }); } catch { /* exists */ }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotResult {
  level: 1 | 2 | 3;
  screenshotPath?: string;
  domText?: string;
  domLength: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Level 1: Screenshot
// ---------------------------------------------------------------------------

export async function captureScreenshot(
  page: Page,
  label: string = 'snapshot'
): Promise<string | null> {
  try {
    const ts = Date.now();
    const filename = `${label}_${ts}.png`;
    const filepath = resolve(SNAPSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`[SNAPSHOT] screenshot saved: ${filename}`);
    return filepath;
  } catch (e) {
    console.warn('[SNAPSHOT] screenshot failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Level 2: Partial DOM (SAFE — use for patch loops)
// ---------------------------------------------------------------------------

const PARTIAL_DOM_SELECTORS = [
  '[data-form-panel]',
  '[data-form-designer]',
  '[role="main"]',
  '[role="dialog"]',
  'main',
];

/**
 * Capture partial DOM from a semantically relevant container.
 * Capped at 5KB to prevent context explosion.
 */
export async function capturePartialDOM(page: Page): Promise<string> {
  for (const selector of PARTIAL_DOM_SELECTORS) {
    try {
      const html = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerHTML : null;
      }, selector);

      if (html && html.length > 50) {
        const trimmed = html.slice(0, 5_000);
        console.log(`[SNAPSHOT] partial DOM captured via "${selector}": ${trimmed.length} chars`);
        return trimmed;
      }
    } catch {
      // try next selector
    }
  }

  // Last resort: capture body innerText (way smaller than innerHTML)
  try {
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3_000) ?? '');
    console.log(`[SNAPSHOT] fallback body text: ${text.length} chars`);
    return text;
  } catch {
    console.warn('[SNAPSHOT] all DOM capture methods failed');
    return '';
  }
}

// ---------------------------------------------------------------------------
// Level 3: Full DOM (DEBUGGING ONLY — capped at 50KB)
// ---------------------------------------------------------------------------

export async function captureFullDOM(page: Page): Promise<string> {
  try {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const capped = html.slice(0, 50_000);
    console.warn(`[SNAPSHOT] FULL DOM captured: ${capped.length} chars (original: ${html.length})`);
    return capped;
  } catch (e) {
    console.error('[SNAPSHOT] full DOM capture failed:', e);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Unified capture for patch loop
// ---------------------------------------------------------------------------

export async function captureForPatch(
  page: Page,
  label: string = 'error'
): Promise<SnapshotResult> {
  const screenshotPath = await captureScreenshot(page, label);
  const domText = await capturePartialDOM(page);

  return {
    level: screenshotPath ? 1 : 2,
    screenshotPath: screenshotPath ?? undefined,
    domText,
    domLength: domText.length,
    timestamp: Date.now(),
  };
}
