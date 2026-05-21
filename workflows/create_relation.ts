/**
 * workflows/create_relation.ts — V2 Create Data Relation Workflow
 *
 * Strict SOP for creating a data relation / 数据联动 between two forms.
 *
 * Flow:
 *   1. Validate application == 爱马仕
 *   2. Navigate to relation management
 *   3. Open create relation dialog
 *   4. Select source + target forms/fields
 *   5. Configure filter conditions (optional)
 *   6. Save relation
 *   7. Validate result
 */

import type { Page } from 'playwright';
import { chromium } from 'playwright';

import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { prepareEnvironment, recover, closeModal } from '../runtime/recovery';
import {
  validateWorkflowStart,
  validateWorkflowEnd,
} from '../runtime/validator';

import RELATION_SELECTORS from '../selectors/relation.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains';
  value: string;
}

export interface CreateRelationInput {
  sourceForm: string;
  sourceField: string;
  targetForm: string;
  targetField: string;
  filters?: FilterCondition[];
  baseUrl: string;
}

export interface CreateRelationOutput {
  success: boolean;
  sourceForm: string;
  targetForm: string;
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

async function navigateToRelationManagement(page: Page): Promise<void> {
  console.log('[WORKFLOW] navigating to relation management');

  const tab = await smartLocate(page, RELATION_SELECTORS.relation_management.tab);
  await tab.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] relation management page loaded');
}

async function openCreateDialog(page: Page): Promise<void> {
  console.log('[WORKFLOW] opening create relation dialog');

  const btn = await smartLocate(
    page,
    RELATION_SELECTORS.relation_management.new_relation_button
  );
  await btn.click();
  await waitForStableDOM(page);

  const dialog = await smartLocate(
    page,
    RELATION_SELECTORS.create_relation_dialog.dialog
  );
  const visible = await dialog.isVisible();
  if (!visible) {
    throw new Error('[WORKFLOW] create relation dialog did not appear');
  }
  console.log('[WORKFLOW] create relation dialog opened');
}

async function selectFormField(
  page: Page,
  selectors: string[],
  value: string
): Promise<void> {
  console.log(`[WORKFLOW] selecting: ${value}`);

  const select = await smartLocate(page, selectors);
  await select.click();
  await page.waitForTimeout(500);

  // Try to find and click the option
  const option = page.locator(`option:has-text("${value}"), [role="option"]:has-text("${value}"), text=${value}`).first();
  if ((await option.count()) > 0) {
    await option.click();
  } else {
    // Fallback: type and select
    await select.fill(value);
    await page.keyboard.press('Enter');
  }

  await waitForStableDOM(page);
}

async function configureRelation(
  input: CreateRelationInput,
  page: Page
): Promise<void> {
  console.log('[WORKFLOW] configuring relation');

  // Source form
  await selectFormField(
    page,
    RELATION_SELECTORS.create_relation_dialog.source_form_select,
    input.sourceForm
  );

  // Source field
  await selectFormField(
    page,
    RELATION_SELECTORS.create_relation_dialog.source_field_select,
    input.sourceField
  );

  // Target form
  await selectFormField(
    page,
    RELATION_SELECTORS.create_relation_dialog.target_form_select,
    input.targetForm
  );

  // Target field
  await selectFormField(
    page,
    RELATION_SELECTORS.create_relation_dialog.target_field_select,
    input.targetField
  );

  // Filter conditions (optional)
  if (input.filters && input.filters.length > 0) {
    console.log(`[WORKFLOW] adding ${input.filters.length} filter conditions`);

    for (const filter of input.filters) {
      const addBtn = await smartLocate(
        page,
        RELATION_SELECTORS.create_relation_dialog.filter_condition_add
      );
      await addBtn.click();
      await waitForStableDOM(page);

      await selectFormField(
        page,
        RELATION_SELECTORS.create_relation_dialog.filter_field_select,
        filter.field
      );

      await selectFormField(
        page,
        RELATION_SELECTORS.create_relation_dialog.filter_operator_select,
        filter.operator
      );

      const valueInput = await smartLocate(
        page,
        RELATION_SELECTORS.create_relation_dialog.filter_value_input
      );
      await valueInput.fill(filter.value);
    }
  }

  console.log('[WORKFLOW] relation configuration complete');
}

async function saveRelation(page: Page): Promise<void> {
  console.log('[WORKFLOW] saving relation');

  const confirmBtn = await smartLocate(
    page,
    RELATION_SELECTORS.create_relation_dialog.confirm_button
  );
  await confirmBtn.click();

  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForTimeout(800);

  console.log('[SAVE] relation saved');
}

async function verifyRelation(
  page: Page,
  sourceForm: string,
  targetForm: string
): Promise<void> {
  console.log(`[WORKFLOW] verifying relation: ${sourceForm} → ${targetForm}`);

  await waitForStableDOM(page);

  const list = await smartLocate(page, RELATION_SELECTORS.relation_list.container);
  const text = await getText(list);
  if (text.includes(sourceForm) && text.includes(targetForm)) {
    console.log('[WORKFLOW] relation verified in list');
  } else {
    console.warn('[WORKFLOW] relation not clearly visible in list');
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function createRelation(
  input: CreateRelationInput
): Promise<CreateRelationOutput> {
  console.log('[WORKFLOW] ======== create_relation start ========');
  console.log(`[WORKFLOW] ${input.sourceForm}.${input.sourceField} → ${input.targetForm}.${input.targetField}`);

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;

  try {
    const username = process.env.JDY_USERNAME;
    const password = process.env.JDY_PASSWORD;
    if (!username || !password) {
      throw new Error('[WORKFLOW] Missing credentials in .env');
    }

    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
    });
    page = await context.newPage();

    console.log('[WORKFLOW] logging in');
    await page.goto(input.baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    await waitForStableDOM(page);

    // Step 1: Validate
    await validateWorkflowStart(page);

    // Step 2: Navigate
    await retry(() => navigateToRelationManagement(page));

    // Step 3: Open dialog
    await retry(async () => {
      await prepareEnvironment(page);
      await openCreateDialog(page);
    });

    // Step 4: Configure
    await retry(() => configureRelation(input, page));

    // Step 5: Save
    await retry(() => saveRelation(page));

    // Step 6: Verify
    await retry(() => verifyRelation(page, input.sourceForm, input.targetForm));

    // Step 7: End validation
    await validateWorkflowEnd(page);

    const output: CreateRelationOutput = {
      success: true,
      sourceForm: input.sourceForm,
      targetForm: input.targetForm,
    };

    console.log('[WORKFLOW] ======== create_relation success ========');
    return output;
  } catch (error) {
    console.error('[WORKFLOW] ======== create_relation FAILED ========');
    console.error(error);

    if (page!) {
      try {
        const snapshot = await page.content();
        console.log(`[WORKFLOW] DOM snapshot captured (${snapshot.length} chars)`);
      } catch {
        // snapshot failed
      }
    }

    return { success: false, sourceForm: input.sourceForm, targetForm: input.targetForm };
  } finally {
    if (browser!) await browser.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 5) {
    console.error(
      'Usage: npx ts-node workflows/create_relation.ts <sourceForm> <sourceField> <targetForm> <targetField> <baseUrl>'
    );
    process.exit(1);
  }

  const input: CreateRelationInput = {
    sourceForm: args[0],
    sourceField: args[1],
    targetForm: args[2],
    targetField: args[3],
    baseUrl: args[4],
  };

  createRelation(input)
    .then((r) => {
      console.log('Result:', JSON.stringify(r, null, 2));
      process.exit(r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error('Fatal:', e);
      process.exit(1);
    });
}
