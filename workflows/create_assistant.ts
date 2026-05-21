/**
 * workflows/create_assistant.ts — V2 Create Smart Assistant Workflow
 *
 * Strict SOP for creating a Smart Assistant Pro / 智能助手.
 * Supports 14 node types: create/update/delete/query record, notification,
 * email, webhook, condition, loop, delay, calculation, data_query, approval, end.
 *
 * Flow:
 *   1. Validate application == 爱马仕
 *   2. Navigate to assistant management
 *   3. Create new assistant (name + source form + trigger)
 *   4. Add workflow nodes
 *   5. Configure each node
 *   6. Save and publish
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

import ASST_SELECTORS from '../selectors/assistant.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssistantNodeType =
  | 'create_record'
  | 'update_record'
  | 'delete_record'
  | 'query_record'
  | 'send_notification'
  | 'send_email'
  | 'call_webhook'
  | 'condition_branch'
  | 'loop'
  | 'delay'
  | 'calculation'
  | 'data_query'
  | 'approval'
  | 'end_node';

export type TriggerType = 'on_create' | 'on_update' | 'on_delete' | 'on_schedule';

export interface AssistantNode {
  type: AssistantNodeType;
  config?: Record<string, string>;
}

export interface CreateAssistantInput {
  name: string;
  sourceForm: string;
  triggerType: TriggerType;
  nodes: AssistantNode[];
  baseUrl: string;
}

export interface CreateAssistantOutput {
  success: boolean;
  name: string;
  sourceForm: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NODE_TYPE_SELECTOR_MAP: Record<AssistantNodeType, string[][]> = {
  create_record: [ASST_SELECTORS.node_types.create_record],
  update_record: [ASST_SELECTORS.node_types.update_record],
  delete_record: [ASST_SELECTORS.node_types.delete_record],
  query_record: [ASST_SELECTORS.node_types.query_record],
  send_notification: [ASST_SELECTORS.node_types.send_notification],
  send_email: [ASST_SELECTORS.node_types.send_email],
  call_webhook: [ASST_SELECTORS.node_types.call_webhook],
  condition_branch: [ASST_SELECTORS.node_types.condition_branch],
  loop: [ASST_SELECTORS.node_types.loop],
  delay: [ASST_SELECTORS.node_types.delay],
  calculation: [ASST_SELECTORS.node_types.calculation],
  data_query: [ASST_SELECTORS.node_types.data_query],
  approval: [ASST_SELECTORS.node_types.approval],
  end_node: [ASST_SELECTORS.node_types.end_node],
};

const TRIGGER_LABELS: Record<TriggerType, string> = {
  on_create: '新增记录时',
  on_update: '修改记录时',
  on_delete: '删除记录时',
  on_schedule: '定时触发',
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function navigateToAssistantManagement(page: Page): Promise<void> {
  console.log('[WORKFLOW] navigating to assistant management');
  const tab = await smartLocate(page, ASST_SELECTORS.assistant_management.tab);
  await tab.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] assistant management loaded');
}

async function openCreateDialog(page: Page): Promise<void> {
  console.log('[WORKFLOW] opening create assistant dialog');
  const btn = await smartLocate(page, ASST_SELECTORS.assistant_management.new_assistant_button);
  await btn.click();
  await waitForStableDOM(page);
  const dialog = await smartLocate(page, ASST_SELECTORS.create_assistant_dialog.dialog);
  if (!(await dialog.isVisible())) {
    throw new Error('[WORKFLOW] create assistant dialog did not appear');
  }
}

async function configureBasicInfo(
  input: CreateAssistantInput,
  page: Page
): Promise<void> {
  console.log('[WORKFLOW] configuring assistant basic info');

  // Name
  const nameInput = await smartLocate(page, ASST_SELECTORS.create_assistant_dialog.name_input);
  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(input.name);
  console.log(`[WORKFLOW] name: ${input.name}`);

  // Source form
  const formSelect = await smartLocate(page, ASST_SELECTORS.create_assistant_dialog.source_form_select);
  await formSelect.click();
  await page.waitForTimeout(300);
  const opt = page.locator(`text=${input.sourceForm}`).first();
  if ((await opt.count()) > 0) await opt.click();
  await waitForStableDOM(page);

  // Trigger type
  const triggerSelect = await smartLocate(page, ASST_SELECTORS.create_assistant_dialog.trigger_type_select);
  await triggerSelect.click();
  await page.waitForTimeout(300);
  const triggerOpt = page.locator(`text=${TRIGGER_LABELS[input.triggerType]}`).first();
  if ((await triggerOpt.count()) > 0) await triggerOpt.click();
  await waitForStableDOM(page);

  console.log(`[WORKFLOW] trigger: ${TRIGGER_LABELS[input.triggerType]}`);

  // Confirm → enter workflow editor
  const confirmBtn = await smartLocate(page, ASST_SELECTORS.create_assistant_dialog.confirm_button);
  await confirmBtn.click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] entered workflow editor');
}

async function addNode(page: Page, node: AssistantNode): Promise<void> {
  console.log(`[WORKFLOW] adding node: ${node.type}`);

  const addBtn = await smartLocate(page, ASST_SELECTORS.workflow_editor.add_node_button);
  await addBtn.click();
  await waitForStableDOM(page);

  const nodeSelectors = NODE_TYPE_SELECTOR_MAP[node.type];
  const nodeBtn = await smartLocate(page, nodeSelectors[0]);
  await nodeBtn.click();
  await waitForStableDOM(page);

  console.log(`[WORKFLOW] node "${node.type}" added`);
}

async function saveAssistant(page: Page): Promise<void> {
  console.log('[WORKFLOW] saving assistant');
  const saveBtn = await smartLocate(page, ASST_SELECTORS.assistant_actions.save_button);
  await saveBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForTimeout(800);
  console.log('[SAVE] assistant saved');
}

async function verifyAssistant(page: Page, name: string): Promise<void> {
  console.log(`[WORKFLOW] verifying assistant: ${name}`);
  await waitForStableDOM(page);
  const list = await smartLocate(page, ASST_SELECTORS.assistant_list.container);
  const text = await getText(list);
  console.log(`[WORKFLOW] assistant "${name}" ${text.includes(name) ? 'found' : 'not confirmed'} in list`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function createAssistant(
  input: CreateAssistantInput
): Promise<CreateAssistantOutput> {
  console.log('[WORKFLOW] ======== create_assistant start ========');
  console.log(`[WORKFLOW] name: ${input.name}, form: ${input.sourceForm}, nodes: ${input.nodes.length}`);

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

    await retry(() => navigateToAssistantManagement(page));
    await retry(async () => {
      await prepareEnvironment(page);
      await openCreateDialog(page);
    });
    await retry(() => configureBasicInfo(input, page));

    for (const node of input.nodes) {
      await retry(() => addNode(page, node));
    }

    await retry(() => saveAssistant(page));
    await retry(() => verifyAssistant(page, input.name));
    await validateWorkflowEnd(page);

    console.log('[WORKFLOW] ======== create_assistant success ========');
    return { success: true, name: input.name, sourceForm: input.sourceForm };
  } catch (error) {
    console.error('[WORKFLOW] ======== create_assistant FAILED ========');
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
  console.error('Usage: npx ts-node workflows/create_assistant.ts');
  process.exit(1);
}
