/**
 * workflows/create_aggregate.ts — V2 Create Aggregate Table Workflow
 *
 * Strict SOP for creating a V10.4.0+ aggregate table / 聚合表.
 * ⚠️ Must use NEW version aggregator (V10.4.0+). Old version removed May 2026.
 *
 * Flow:
 *   1. Validate application == 爱马仕
 *   2. Navigate to aggregate management
 *   3. Open create aggregate dialog
 *   4. Configure name + source form
 *   5. Configure row/column dimensions
 *   6. Configure indicators
 *   7. Save aggregate table
 *   8. Validate result
 */

import type { Page } from 'playwright';
import { chromium } from 'playwright';

import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { prepareEnvironment, recover } from '../runtime/recovery';
import {
  validateWorkflowStart,
  validateWorkflowEnd,
} from '../runtime/validator';

import AGG_SELECTORS from '../selectors/aggregate.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AggregateIndicatorType = 'count' | 'sum' | 'avg' | 'max' | 'min' | 'distinct';

export interface AggregateDimension {
  field: string;
}

export interface AggregateIndicator {
  field: string;
  type: AggregateIndicatorType;
}

export interface CreateAggregateInput {
  name: string;
  sourceForm: string;
  rowDimensions: AggregateDimension[];
  columnDimensions?: AggregateDimension[];
  indicators: AggregateIndicator[];
  baseUrl: string;
}

export interface CreateAggregateOutput {
  success: boolean;
  name: string;
  sourceForm: string;
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

async function navigateToAggregateManagement(page: Page): Promise<void> {
  console.log('[WORKFLOW] navigating to aggregate management');

  const tab = await smartLocate(page, AGG_SELECTORS.aggregate_management.tab);
  await tab.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] aggregate management page loaded');
}

async function openCreateDialog(page: Page): Promise<void> {
  console.log('[WORKFLOW] opening create aggregate dialog');

  const btn = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_management.new_aggregate_button
  );
  await btn.click();
  await waitForStableDOM(page);

  const dialog = await smartLocate(
    page,
    AGG_SELECTORS.create_aggregate_dialog.dialog
  );
  const visible = await dialog.isVisible();
  if (!visible) {
    throw new Error('[WORKFLOW] create aggregate dialog did not appear');
  }
  console.log('[WORKFLOW] create aggregate dialog opened');
}

async function configureBasicInfo(
  input: CreateAggregateInput,
  page: Page
): Promise<void> {
  console.log('[WORKFLOW] configuring aggregate basic info');

  // Name
  const nameInput = await smartLocate(
    page,
    AGG_SELECTORS.create_aggregate_dialog.name_input
  );
  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(input.name);

  const entered = await nameInput.inputValue();
  if (entered !== input.name) {
    throw new Error(`[WORKFLOW] name mismatch: expected "${input.name}", got "${entered}"`);
  }
  console.log(`[WORKFLOW] aggregate name: ${input.name}`);

  // Source form
  const sourceSelect = await smartLocate(
    page,
    AGG_SELECTORS.create_aggregate_dialog.source_form_select
  );
  await sourceSelect.click();
  await page.waitForTimeout(500);

  const option = page.locator(`option:has-text("${input.sourceForm}"), [role="option"]:has-text("${input.sourceForm}"), text=${input.sourceForm}`).first();
  if ((await option.count()) > 0) {
    await option.click();
  } else {
    await sourceSelect.fill(input.sourceForm);
    await page.keyboard.press('Enter');
  }
  await waitForStableDOM(page);
  console.log(`[WORKFLOW] source form: ${input.sourceForm}`);

  // Confirm to enter config panel
  const confirmBtn = await smartLocate(
    page,
    AGG_SELECTORS.create_aggregate_dialog.confirm_button
  );
  await confirmBtn.click();
  await waitForStableDOM(page);

  console.log('[WORKFLOW] aggregate basic info configured, config panel opened');
}

async function addRowDimension(
  page: Page,
  field: string
): Promise<void> {
  console.log(`[WORKFLOW] adding row dimension: ${field}`);

  const addBtn = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_config.row_dimension_add
  );
  await addBtn.click();
  await waitForStableDOM(page);

  const select = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_config.row_dimension_select
  );
  await select.click();
  await page.waitForTimeout(300);

  const option = page.locator(`text=${field}`).first();
  if ((await option.count()) > 0) {
    await option.click();
  }
  await waitForStableDOM(page);
}

async function addIndicator(
  page: Page,
  indicator: AggregateIndicator
): Promise<void> {
  console.log(`[WORKFLOW] adding indicator: ${indicator.field} (${indicator.type})`);

  const addBtn = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_config.indicator_add
  );
  await addBtn.click();
  await waitForStableDOM(page);

  // Select field
  const fieldSelect = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_config.indicator_field_select
  );
  await fieldSelect.click();
  await page.waitForTimeout(300);
  const fieldOption = page.locator(`text=${indicator.field}`).first();
  if ((await fieldOption.count()) > 0) {
    await fieldOption.click();
  }
  await waitForStableDOM(page);

  // Select type
  const typeSelect = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_config.indicator_type_select
  );
  await typeSelect.click();
  await page.waitForTimeout(300);

  const typeLabel: Record<AggregateIndicatorType, string> = {
    count: '计数',
    sum: '求和',
    avg: '平均值',
    max: '最大值',
    min: '最小值',
    distinct: '去重计数',
  };

  const typeOption = page.locator(`text=${typeLabel[indicator.type]}`).first();
  if ((await typeOption.count()) > 0) {
    await typeOption.click();
  }
  await waitForStableDOM(page);
}

async function saveAggregate(page: Page): Promise<void> {
  console.log('[WORKFLOW] saving aggregate table');

  const saveBtn = await smartLocate(
    page,
    AGG_SELECTORS.aggregate_config.save_button
  );
  await saveBtn.click();

  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForTimeout(1_000);

  console.log('[SAVE] aggregate table saved');
}

async function verifyAggregate(
  page: Page,
  name: string
): Promise<void> {
  console.log(`[WORKFLOW] verifying aggregate: ${name}`);

  await waitForStableDOM(page);

  const list = await smartLocate(page, AGG_SELECTORS.aggregate_list.container);
  const text = await getText(list);
  if (text.includes(name)) {
    console.log(`[WORKFLOW] aggregate "${name}" verified in list`);
  } else {
    console.warn(`[WORKFLOW] aggregate "${name}" not clearly visible in list`);
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function createAggregate(
  input: CreateAggregateInput
): Promise<CreateAggregateOutput> {
  console.log('[WORKFLOW] ======== create_aggregate start ========');
  console.log(`[WORKFLOW] name: ${input.name}, source: ${input.sourceForm}`);
  console.log(`[WORKFLOW] rows: ${input.rowDimensions.map(d=>d.field).join(', ')}`);
  console.log(`[WORKFLOW] indicators: ${input.indicators.map(i=>`${i.field}(${i.type})`).join(', ')}`);

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
    await retry(() => navigateToAggregateManagement(page));

    // Step 3: Open dialog + basic info
    await retry(async () => {
      await prepareEnvironment(page);
      await openCreateDialog(page);
    });

    // Step 4: Configure basic info → opens config panel
    await retry(() => configureBasicInfo(input, page));

    // Step 5: Add row dimensions
    for (const dim of input.rowDimensions) {
      await retry(() => addRowDimension(page, dim.field));
    }

    // Step 6: Add column dimensions (optional)
    if (input.columnDimensions) {
      for (const dim of input.columnDimensions) {
        await retry(() => addRowDimension(page, dim.field)); // Reuse same pattern
      }
    }

    // Step 7: Add indicators
    for (const indicator of input.indicators) {
      await retry(() => addIndicator(page, indicator));
    }

    // Step 8: Save
    await retry(() => saveAggregate(page));

    // Step 9: Verify
    await retry(() => verifyAggregate(page, input.name));

    // Step 10: End validation
    await validateWorkflowEnd(page);

    const output: CreateAggregateOutput = {
      success: true,
      name: input.name,
      sourceForm: input.sourceForm,
    };

    console.log('[WORKFLOW] ======== create_aggregate success ========');
    return output;
  } catch (error) {
    console.error('[WORKFLOW] ======== create_aggregate FAILED ========');
    console.error(error);

    if (page!) {
      try {
        const snapshot = await page.content();
        console.log(`[WORKFLOW] DOM snapshot captured (${snapshot.length} chars)`);
      } catch {
        // snapshot failed
      }
    }

    return { success: false, name: input.name, sourceForm: input.sourceForm };
  } finally {
    if (browser!) await browser.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const input: CreateAggregateInput = {
    name: process.argv[2] || '',
    sourceForm: process.argv[3] || '',
    rowDimensions: [{ field: process.argv[4] || '' }],
    indicators: [{ field: process.argv[5] || '', type: (process.argv[6] || 'count') as AggregateIndicatorType }],
    baseUrl: process.argv[7] || '',
  };

  if (!input.name || !input.sourceForm) {
    console.error(
      'Usage: npx ts-node workflows/create_aggregate.ts <name> <sourceForm> <rowField> <indicatorField> <indicatorType> <baseUrl>'
    );
    process.exit(1);
  }

  createAggregate(input)
    .then((r) => {
      console.log('Result:', JSON.stringify(r, null, 2));
      process.exit(r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error('Fatal:', e);
      process.exit(1);
    });
}
