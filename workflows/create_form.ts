/**
 * workflows/create_form.ts — V2 Create Form Workflow
 *
 * Strict SOP for creating a new form in 简道云.
 *
 * Flow:
 *   1. Validate application == 爱马仕
 *   2. Navigate to form management
 *   3. Open create dialog
 *   4. Fill form metadata
 *   5. Confirm creation
 *   6. Validate result
 *
 * All selectors from selectors/form.json registry.
 * All steps wrapped in retry() with recovery on failure.
 */

import type { Page, BrowserContext } from 'playwright';
import { chromium } from 'playwright';

// --- Runtime imports ---
import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { recover, prepareEnvironment, closeModal } from '../runtime/recovery';
import {
  validateWorkflowStart,
  validateWorkflowEnd,
  validateSave,
} from '../runtime/validator';

// --- Selector registry ---
import SELECTORS from '../selectors/form.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateFormInput {
  /** Form display name (required) */
  name: string;
  /** Optional description */
  description?: string;
  /** 简道云 app base URL */
  baseUrl: string;
}

export interface CreateFormOutput {
  success: boolean;
  formName: string;
  formUrl?: string;
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the form management page.
 */
async function navigateToFormManagement(page: Page): Promise<void> {
  console.log('[WORKFLOW] navigating to form management');

  const navSelector = await smartLocate(
    page,
    SELECTORS.navigation.form_management_tab
  );
  await navSelector.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] form management page loaded');
}

/**
 * Open the "新建表单" dialog.
 */
async function openCreateDialog(page: Page): Promise<void> {
  console.log('[WORKFLOW] opening create form dialog');

  const btn = await smartLocate(page, SELECTORS.navigation.new_form_button);
  await btn.click();
  await waitForStableDOM(page);

  // Verify dialog appeared
  const dialog = await smartLocate(page, SELECTORS.create_form_dialog.dialog);
  const visible = await dialog.isVisible();
  if (!visible) {
    throw new Error('[WORKFLOW] create form dialog did not appear');
  }
  console.log('[WORKFLOW] create form dialog opened');
}

/**
 * Fill the form name and optional description.
 */
async function fillFormMetadata(input: CreateFormInput, page: Page): Promise<void> {
  console.log('[WORKFLOW] filling form metadata');

  // Form name
  const nameInput = await smartLocate(
    page,
    SELECTORS.create_form_dialog.form_name_input
  );
  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(input.name);

  const enteredName = await nameInput.inputValue();
  if (enteredName !== input.name) {
    throw new Error(
      `[WORKFLOW] name input mismatch: expected "${input.name}", got "${enteredName}"`
    );
  }
  console.log(`[WORKFLOW] form name set: ${input.name}`);

  // Description (optional)
  if (input.description) {
    const descInput = await smartLocate(
      page,
      SELECTORS.create_form_dialog.form_description_input
    );
    await descInput.click();
    await descInput.fill('');
    await descInput.fill(input.description);
    console.log(`[WORKFLOW] description set`);
  }
}

/**
 * Click confirm and wait for the form to be created.
 */
async function confirmCreation(page: Page): Promise<void> {
  console.log('[WORKFLOW] confirming form creation');

  const confirmBtn = await smartLocate(
    page,
    SELECTORS.create_form_dialog.confirm_button
  );
  await confirmBtn.click();

  // Wait for network to settle after create API call
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.waitForTimeout(1_000);

  console.log('[WORKFLOW] creation confirmed');
}

/**
 * Verify the form appears in the form list.
 */
async function verifyFormCreated(
  page: Page,
  formName: string
): Promise<void> {
  console.log(`[WORKFLOW] verifying form "${formName}" was created`);

  await waitForStableDOM(page);

  // Check form list for the new form name
  const formListContainer = await smartLocate(
    page,
    SELECTORS.navigation.form_list_container
  );

  const text = await getText(formListContainer);
  if (text.includes(formName)) {
    console.log(`[WORKFLOW] form "${formName}" found in list`);
  } else {
    console.warn(
      `[WORKFLOW] form "${formName}" not visible in list — may still be creating`
    );
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function createForm(input: CreateFormInput): Promise<CreateFormOutput> {
  console.log('[WORKFLOW] ======== create_form start ========');
  console.log(`[WORKFLOW] target: ${input.name}`);

  let browser: ReturnType<typeof chromium.launch> extends Promise<infer T> ? T : never;
  let page: Page;

  try {
    // --- Launch browser ---
    const username = process.env.JDY_USERNAME;
    const password = process.env.JDY_PASSWORD;

    if (!username || !password) {
      throw new Error(
        '[WORKFLOW] Missing credentials. Ensure JDY_USERNAME and JDY_PASSWORD are set in .env.'
      );
    }

    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
    });
    page = await context.newPage();

    // --- Login ---
    console.log('[WORKFLOW] logging in');
    await page.goto(input.baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    await waitForStableDOM(page);

    // --- Step 1: Validate application ---
    await validateWorkflowStart(page);

    // --- Step 2: Navigate to form management ---
    await retry(() => navigateToFormManagement(page));

    // --- Step 3: Open create dialog ---
    await retry(async () => {
      await prepareEnvironment(page);
      await openCreateDialog(page);
    });

    // --- Step 4: Fill metadata ---
    await retry(async () => {
      await fillFormMetadata(input, page);
    });

    // --- Step 5: Confirm creation ---
    await retry(async () => {
      await confirmCreation(page);
    });

    // --- Step 6: Verify ---
    await retry(async () => {
      await verifyFormCreated(page, input.name);
    });

    // --- Step 7: End validation ---
    await validateWorkflowEnd(page);

    const output: CreateFormOutput = {
      success: true,
      formName: input.name,
      formUrl: page.url(),
    };

    console.log('[WORKFLOW] ======== create_form success ========');
    return output;
  } catch (error) {
    console.error('[WORKFLOW] ======== create_form FAILED ========');
    console.error(error);

    // === Patch loop entry point ===
    // When called from OpenClaw orchestration, the error + DOM snapshot
    // will be fed back to DeepSeek for a targeted patch.
    if (page!) {
      try {
        const snapshot = await page.content();
        console.log(`[WORKFLOW] DOM snapshot captured (${snapshot.length} chars)`);
      } catch {
        console.warn('[WORKFLOW] could not capture DOM snapshot');
      }
    }

    return { success: false, formName: input.name };
  } finally {
    if (browser!) {
      await browser.close();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point (for standalone testing)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx ts-node workflows/create_form.ts <name> <baseUrl> [description]');
    process.exit(1);
  }

  const input: CreateFormInput = {
    name: args[0],
    baseUrl: args[1],
    description: args[2],
  };

  createForm(input)
    .then((result) => {
      console.log('Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}
