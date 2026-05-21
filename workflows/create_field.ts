/**
 * workflows/create_field.ts — V2 Create Field Workflow (Verification Phase)
 *
 * Verification phase adjustments:
 *   - Partial DOM snapshot only
 *   - Watchdog enabled
 *   - Networkidle with 5s fallback
 *   - Browser ALWAYS closed
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { startWatchdog, stopWatchdog } from '../runtime/watchdog';
import { navigateToApp, performLogin } from '../runtime/auth';
import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { prepareEnvironment } from '../runtime/recovery';
import { smartDrag, dragFieldToCanvas } from '../runtime/drag';
import { captureForPatch } from '../runtime/snapshot';
import {
  validateWorkflowStart,
  validateWorkflowEnd,
} from '../runtime/validator';
import FIELD_SELECTORS from '../selectors/field.json';
import FORM_SELECTORS from '../selectors/form.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldType =
  | 'single_line_text'
  | 'multi_line_text'
  | 'number'
  | 'date_time'
  | 'radio'
  | 'checkbox_group'
  | 'dropdown'
  | 'attachment'
  | 'image'
  | 'member'
  | 'sub_form';

export interface CreateFieldInput {
  formName: string;
  fieldName: string;
  fieldType: FieldType;
  fieldDescription?: string;
  required?: boolean;
  baseUrl: string;
}

export interface CreateFieldOutput {
  success: boolean;
  formName: string;
  fieldName: string;
  fieldType: FieldType;
  error?: string;
}

// ---------------------------------------------------------------------------
// Field type → selector map
// ---------------------------------------------------------------------------

const FIELD_TYPE_SELECTOR_MAP: Record<FieldType, string[][]> = {
  single_line_text: [FIELD_SELECTORS.field_types.single_line_text],
  multi_line_text: [FIELD_SELECTORS.field_types.multi_line_text],
  number: [FIELD_SELECTORS.field_types.number],
  date_time: [FIELD_SELECTORS.field_types.date_time],
  radio: [FIELD_SELECTORS.field_types.radio],
  checkbox_group: [FIELD_SELECTORS.field_types.checkbox_group],
  dropdown: [FIELD_SELECTORS.field_types.dropdown],
  attachment: [FIELD_SELECTORS.field_types.attachment],
  image: [FIELD_SELECTORS.field_types.image],
  member: [FIELD_SELECTORS.field_types.member],
  sub_form: [FIELD_SELECTORS.field_types.sub_form],
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------



async function openFormInDesigner(page: Page, formName: string): Promise<void> {
  console.log(`[WORKFLOW] step: open form "${formName}"`);
  await prepareEnvironment(page);

  const formMgmt = await smartLocate(page, FORM_SELECTORS.navigation.form_management_tab);
  await formMgmt.click();
  await waitForStableDOM(page);

  const formLink = await smartLocate(page, [
    `text=${formName}`,
    `[aria-label='${formName}']`,
  ]);
  await formLink.first().click();
  await waitForStableDOM(page);
}

async function dragFieldOnCanvas(page: Page, fieldType: FieldType): Promise<void> {
  console.log(`[WORKFLOW] step: drag field "${fieldType}"`);
  const fieldTypeSelectors = FIELD_TYPE_SELECTOR_MAP[fieldType];
  await dragFieldToCanvas(page, fieldTypeSelectors[0]);
}

async function configureAndSaveField(page: Page, input: CreateFieldInput): Promise<void> {
  console.log('[WORKFLOW] step: configure field');

  // Click the newly added field to open config panel
  const containers = page.locator("[data-testid='field-container'], [role='listitem']");
  const count = await containers.count();
  if (count === 0) throw new Error('[WORKFLOW] no field containers on canvas');
  await containers.last().click();
  await waitForStableDOM(page);

  // Field name
  const nameInput = await smartLocate(page, FIELD_SELECTORS.field_config.field_name_input);
  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(input.fieldName);
  console.log(`[WORKFLOW] field name: ${input.fieldName}`);

  // Required toggle
  if (input.required) {
    const toggle = await smartLocate(page, FIELD_SELECTORS.field_config.required_toggle);
    const checked = await toggle.first().getAttribute('aria-checked');
    if (checked !== 'true') {
      await toggle.first().click();
      await waitForStableDOM(page);
    }
    console.log('[WORKFLOW] required: true');
  }

  // Save field config
  const saveBtn = await smartLocate(page, FIELD_SELECTORS.field_config.save_field_button);
  await saveBtn.first().click();
  await waitForStableDOM(page);
  console.log('[WORKFLOW] field config saved');
}

async function saveForm(page: Page): Promise<void> {
  console.log('[WORKFLOW] step: save form');
  await prepareEnvironment(page);
  const saveBtn = await smartLocate(page, FIELD_SELECTORS.form_actions.save_form_button);
  await saveBtn.first().click();
  await waitForStableDOM(page);
  console.log('[SAVE] form saved');
}

async function verifyFieldOnCanvas(page: Page, fieldName: string): Promise<boolean> {
  console.log(`[WORKFLOW] step: verify field "${fieldName}"`);
  await waitForStableDOM(page);
  const canvas = await smartLocate(page, [
    "[data-testid='form-designer-canvas']",
    "[aria-label='表单设计区']",
  ]);
  const text = await getText(canvas.first());
  return text.includes(fieldName);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function createField(input: CreateFieldInput): Promise<CreateFieldOutput> {
  console.log('[WORKFLOW] ======== create_field start ========');
  console.log(`[WORKFLOW] form: ${input.formName}, field: ${input.fieldName} (${input.fieldType})`);

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

    // Step 1: Navigate (once — no retry of navigation)
    await navigateToApp(page!, input.baseUrl);

    // Step 2: Login (retry-safe)
    await retry(() => performLogin(page!));

    // Step 2: Validate
    await retry(() => validateWorkflowStart(page!));

    // Step 3: Open form
    await retry(() => openFormInDesigner(page!, input.formName));

    // Step 4: Drag field
    await retry(() => dragFieldOnCanvas(page!, input.fieldType));

    // Step 5: Configure + save field
    await retry(() => configureAndSaveField(page!, input));

    // Step 6: Save form
    await retry(() => saveForm(page!));

    // Step 7: Verify
    const verified = await retry(() => verifyFieldOnCanvas(page!, input.fieldName));

    // Step 8: End validation
    await retry(() => validateWorkflowEnd(page!));

    console.log('[WORKFLOW] ======== create_field success ========');
    return { success: verified, formName: input.formName, fieldName: input.fieldName, fieldType: input.fieldType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[WORKFLOW] ======== create_field FAILED ========');
    console.error(message);

    if (page) {
      try {
        const snapshot = await captureForPatch(page, `error_${input.fieldName}`);
        console.log(`[WORKFLOW] snapshot: level=${snapshot.level}, dom=${snapshot.domLength} chars`);
      } catch { /* snapshot failed */ }
    }

    return { success: false, formName: input.formName, fieldName: input.fieldName, fieldType: input.fieldType, error: message };
  } finally {
    stopWatchdog();

    if (page) try { await page.close(); } catch { /* ok */ }
    if (context) try { await context.close(); } catch { /* ok */ }
    if (browser) try { await browser.close(); } catch { /* ok */ }
    console.log('[WORKFLOW] browser closed');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: npx ts-node workflows/create_field.ts <formName> <fieldName> <fieldType> <baseUrl> [required]');
    process.exit(1);
  }

  createField({
    formName: args[0],
    fieldName: args[1],
    fieldType: args[2] as FieldType,
    baseUrl: args[3],
    required: args[4] === 'true',
  })
    .then((r) => {
      console.log('Result:', JSON.stringify(r, null, 2));
      process.exit(r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error('Fatal:', e);
      process.exit(1);
    });
}
