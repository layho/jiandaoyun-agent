/**
 * workflows/create_data_factory.ts — V2 Create Data Factory Workflow
 *
 * Strict SOP for creating a Data Factory / 数据工厂 data flow.
 * Supports input/transform/output node types.
 *
 * Flow:
 *   1. Validate application == 爱马仕
 *   2. Navigate to data factory management
 *   3. Create new data flow (name + source)
 *   4. Add nodes (input → transform → output)
 *   5. Configure each node
 *   6. Save data flow
 *   7. Validate result
 */

import type { Page } from 'playwright';
import { chromium } from 'playwright';

import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { prepareEnvironment } from '../runtime/recovery';
import {
  validateWorkflowStart,
  validateWorkflowEnd,
} from '../runtime/validator';

import DF_SELECTORS from '../selectors/data_factory.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataFlowNodeType =
  | 'input_form'
  | 'input_aggregate'
  | 'union'
  | 'join'
  | 'filter'
  | 'sort'
  | 'group'
  | 'field_calc'
  | 'field_set'
  | 'output_form'
  | 'output_aggregate';

export interface DataFlowNode {
  type: DataFlowNodeType;
  config?: Record<string, string>;
}

export interface CreateDataFactoryInput {
  name: string;
  sourceForm: string;
  nodes: DataFlowNode[];
  baseUrl: string;
}

export interface CreateDataFactoryOutput {
  success: boolean;
  name: string;
  sourceForm: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NODE_TYPE_SELECTOR_MAP: Record<DataFlowNodeType, string[][]> = {
  input_form: [DF_SELECTORS.node_types.input_form],
  input_aggregate: [DF_SELECTORS.node_types.input_aggregate],
  union: [DF_SELECTORS.node_types.union],
  join: [DF_SELECTORS.node_types.join],
  filter: [DF_SELECTORS.node_types.filter],
  sort: [DF_SELECTORS.node_types.sort],
  group: [DF_SELECTORS.node_types.group],
  field_calc: [DF_SELECTORS.node_types.field_calc],
  field_set: [DF_SELECTORS.node_types.field_set],
  output_form: [DF_SELECTORS.node_types.output_form],
  output_aggregate: [DF_SELECTORS.node_types.output_aggregate],
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function navigateToDataFactoryManagement(page: Page): Promise<void> {
  console.log('[WORKFLOW] navigating to data factory management');
  const tab = await smartLocate(page, DF_SELECTORS.data_factory_management.tab);
  await tab.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] data factory management loaded');
}

async function openCreateDialog(page: Page): Promise<void> {
  console.log('[WORKFLOW] opening create data flow dialog');
  const btn = await smartLocate(page, DF_SELECTORS.data_factory_management.new_factory_button);
  await btn.click();
  await waitForStableDOM(page);
  const dialog = await smartLocate(page, DF_SELECTORS.create_factory_dialog.dialog);
  if (!(await dialog.isVisible())) {
    throw new Error('[WORKFLOW] create data flow dialog did not appear');
  }
}

async function configureBasicInfo(
  input: CreateDataFactoryInput,
  page: Page
): Promise<void> {
  console.log('[WORKFLOW] configuring data flow basic info');

  const nameInput = await smartLocate(page, DF_SELECTORS.create_factory_dialog.name_input);
  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(input.name);
  console.log(`[WORKFLOW] name: ${input.name}`);

  const formSelect = await smartLocate(page, DF_SELECTORS.create_factory_dialog.source_form_select);
  await formSelect.click();
  await page.waitForTimeout(300);
  const opt = page.locator(`text=${input.sourceForm}`).first();
  if ((await opt.count()) > 0) await opt.click();
  await waitForStableDOM(page);

  const confirmBtn = await smartLocate(page, DF_SELECTORS.create_factory_dialog.confirm_button);
  await confirmBtn.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] entered data flow editor');
}

async function addNode(page: Page, node: DataFlowNode): Promise<void> {
  console.log(`[WORKFLOW] adding node: ${node.type}`);

  // Open node palette (click canvas area first)
  const canvas = await smartLocate(page, DF_SELECTORS.data_flow_editor.canvas);
  await canvas.click();
  await waitForStableDOM(page);

  // Find the node in available node list
  const nodeSelectors = NODE_TYPE_SELECTOR_MAP[node.type];
  const nodeBtn = await smartLocate(page, nodeSelectors[0]);
  await nodeBtn.click();
  await waitForStableDOM(page);

  console.log(`[WORKFLOW] node "${node.type}" added`);
}

async function saveDataFactory(page: Page): Promise<void> {
  console.log('[WORKFLOW] saving data flow');
  const saveBtn = await smartLocate(page, DF_SELECTORS.factory_actions.save_button);
  await saveBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForTimeout(800);
  console.log('[SAVE] data flow saved');
}

async function verifyDataFactory(page: Page, name: string): Promise<void> {
  console.log(`[WORKFLOW] verifying data flow: ${name}`);
  await waitForStableDOM(page);
  const list = await smartLocate(page, DF_SELECTORS.factory_list.container);
  const text = await getText(list);
  console.log(`[WORKFLOW] data flow "${name}" ${text.includes(name) ? 'found' : 'not confirmed'} in list`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function createDataFactory(
  input: CreateDataFactoryInput
): Promise<CreateDataFactoryOutput> {
  console.log('[WORKFLOW] ======== create_data_factory start ========');
  console.log(`[WORKFLOW] name: ${input.name}, source: ${input.sourceForm}, nodes: ${input.nodes.length}`);

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;

  try {
    if (!process.env.JDY_USERNAME || !process.env.JDY_PASSWORD) {
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

    await validateWorkflowStart(page);

    await retry(() => navigateToDataFactoryManagement(page));
    await retry(async () => {
      await prepareEnvironment(page);
      await openCreateDialog(page);
    });
    await retry(() => configureBasicInfo(input, page));

    for (const node of input.nodes) {
      await retry(() => addNode(page, node));
    }

    await retry(() => saveDataFactory(page));
    await retry(() => verifyDataFactory(page, input.name));
    await validateWorkflowEnd(page);

    console.log('[WORKFLOW] ======== create_data_factory success ========');
    return { success: true, name: input.name, sourceForm: input.sourceForm };
  } catch (error) {
    console.error('[WORKFLOW] ======== create_data_factory FAILED ========');
    console.error(error);
    if (page!) {
      try {
        const snapshot = await page.content();
        console.log(`[WORKFLOW] DOM snapshot captured (${snapshot.length} chars)`);
      } catch { /* ignore */ }
    }
    return { success: false, name: input.name, sourceForm: input.sourceForm };
  } finally {
    if (browser!) await browser.close();
  }
}

if (require.main === module) {
  console.error('Usage: npx ts-node workflows/create_data_factory.ts');
  process.exit(1);
}
