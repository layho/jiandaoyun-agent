/**
 * workflows/create_form.ts — V2 Create Form Workflow (Verification Phase)
 *
 * Verification phase adjustments:
 *   - Snapshot uses partial DOM (NEVER full page.content)
 *   - Watchdog enabled (10min hard timeout)
 *   - Networkidle timeout shortened (5s fallback)
 *   - Retry capped at 2, recovery at 1
 *   - Browser ALWAYS closed in finally
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { startWatchdog, stopWatchdog } from '../runtime/watchdog';
import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { prepareEnvironment } from '../runtime/recovery';
import { captureForPatch } from '../runtime/snapshot';
import {
  validateWorkflowStart,
  validateWorkflowEnd,
} from '../runtime/validator';
import SELECTORS from '../selectors/form.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateFormInput {
  name: string;
  description?: string;
  baseUrl: string;
}

export interface CreateFormOutput {
  success: boolean;
  formName: string;
  formUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Steps (modular — not chained)
// ---------------------------------------------------------------------------

async function login(page: Page, baseUrl: string): Promise<void> {
  console.log('[WORKFLOW] step: login');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

async function navigateToFormManagement(page: Page): Promise<void> {
  console.log('[WORKFLOW] step: navigate to form management');
  await prepareEnvironment(page);
  const nav = await smartLocate(page, SELECTORS.navigation.form_management_tab);
  await nav.click();
  await waitForStableDOM(page);
}

async function openCreateDialog(page: Page): Promise<void> {
  console.log('[WORKFLOW] step: open create dialog');
  const btn = await smartLocate(page, SELECTORS.navigation.new_form_button);
  await btn.click();
  await waitForStableDOM(page);
}

async function fillFormName(page: Page, name: string): Promise<void> {
  console.log(`[WORKFLOW] step: fill name "${name}"`);
  const input = await smartLocate(page, SELECTORS.create_form_dialog.form_name_input);
  await input.click();
  await input.fill('');
  await input.fill(name);
}

async function confirmCreation(page: Page): Promise<void> {
  console.log('[WORKFLOW] step: confirm');
  const btn = await smartLocate(page, SELECTORS.create_form_dialog.confirm_button);
  await btn.click();
  await waitForStableDOM(page);
}

async function verifyFormInList(page: Page, name: string): Promise<boolean> {
  console.log(`[WORKFLOW] step: verify "${name}" in list`);
  await waitForStableDOM(page);
  const list = await smartLocate(page, SELECTORS.navigation.form_list_container);
  const text = await getText(list);
  return text.includes(name);
}

// ---------------------------------------------------------------------------
// Main workflow (fixed-chain execution for verification)
// ---------------------------------------------------------------------------

export async function createForm(input: CreateFormInput): Promise<CreateFormOutput> {
  console.log('[WORKFLOW] ======== create_form start ========');
  console.log(`[WORKFLOW] target: ${input.name}`);

  startWatchdog();

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
    });
    page = await context.newPage();

    // Step 1: Login
    await retry(() => login(page!, input.baseUrl));

    // Step 2: Validate application
    await retry(() => validateWorkflowStart(page!));

    // Step 3: Navigate to form management
    await retry(() => navigateToFormManagement(page!));

    // Step 4: Open create dialog
    await retry(() => openCreateDialog(page!));

    // Step 5: Fill form name
    await retry(() => fillFormName(page!, input.name));

    // Step 6: Confirm creation
    await retry(() => confirmCreation(page!));

    // Step 7: Verify
    const verified = await retry(() => verifyFormInList(page!, input.name));

    // Step 8: Validate end
    await retry(() => validateWorkflowEnd(page!));

    const output: CreateFormOutput = {
      success: verified,
      formName: input.name,
      formUrl: page.url(),
    };

    console.log('[WORKFLOW] ======== create_form success ========');
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[WORKFLOW] ======== create_form FAILED ========');
    console.error(message);

    // Capture partial snapshot for patch loop (level 2 — NOT full DOM)
    if (page) {
      try {
        const snapshot = await captureForPatch(page, `error_${input.name}`);
        console.log(`[WORKFLOW] snapshot: level=${snapshot.level}, dom=${snapshot.domLength} chars`);
      } catch {
        console.warn('[WORKFLOW] snapshot capture failed');
      }
    }

    return { success: false, formName: input.name, error: message };
  } finally {
    stopWatchdog();

    // ALWAYS close browser — prevent memory leak
    if (page) {
      try { await page.close(); } catch { /* already closed */ }
    }
    if (context) {
      try { await context.close(); } catch { /* already closed */ }
    }
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }

    console.log('[WORKFLOW] browser closed');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx ts-node workflows/create_form.ts <name> <baseUrl> [description]');
    process.exit(1);
  }

  createForm({ name: args[0], baseUrl: args[1], description: args[2] })
    .then((r) => {
      console.log('Result:', JSON.stringify(r, null, 2));
      process.exit(r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error('Fatal:', e);
      process.exit(1);
    });
}
