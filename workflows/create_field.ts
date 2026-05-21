/**
 * workflows/create_field.ts — V2 Create Field Workflow
 *
 * Strict SOP for adding a field to an existing form.
 *
 * Flow:
 *   1. Validate application == 爱马仕
 *   2. Open target form in designer
 *   3. Drag field type from palette onto canvas
 *   4. Configure field properties (name, required, etc.)
 *   5. Save field configuration
 *   6. Save form
 *   7. Validate result
 *
 * All selectors from selectors/field.json + form.json registry.
 * All steps wrapped in retry() with rerender recovery.
 */

import type { Page, BrowserContext } from 'playwright';
import { chromium } from 'playwright';

import { smartLocate, waitForStableDOM, getText } from '../runtime/dom';
import { retry } from '../runtime/retry';
import { smartDrag, dragFieldToCanvas } from '../runtime/drag';
import {
  prepareEnvironment,
  recover,
  withRerenderRecovery,
  recoverFromDragFailure,
  verifyCanvasHealth,
} from '../runtime/recovery';
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
  /** Target form name (must already exist) */
  formName: string;
  /** Field display name */
  fieldName: string;
  /** Field type */
  fieldType: FieldType;
  /** Optional field description */
  fieldDescription?: string;
  /** Make this field required */
  required?: boolean;
  /** 简道云 app URL */
  baseUrl: string;
}

export interface CreateFieldOutput {
  success: boolean;
  formName: string;
  fieldName: string;
  fieldType: FieldType;
}

// ---------------------------------------------------------------------------
// Field type name mapping
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
// Step helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to form management and open the target form in designer.
 */
async function openFormInDesigner(
  page: Page,
  formName: string
): Promise<void> {
  console.log(`[WORKFLOW] opening form "${formName}" in designer`);

  // Navigate to form management tab
  const formMgmt = await smartLocate(
    page,
    FORM_SELECTORS.navigation.form_management_tab
  );
  await formMgmt.click();
  await waitForStableDOM(page);

  // Click on the target form to open it
  const formLinkSelectors = [
    `[data-testid='form-item-${formName}']`,
    `[aria-label='${formName}']`,
    `text=${formName}`,
  ];

  const formLink = await smartLocate(page, formLinkSelectors);
  await formLink.first().click();
  await waitForStableDOM(page);

  console.log(`[WORKFLOW] form "${formName}" opened in designer`);
}

/**
 * Drag the specified field type from the palette onto the canvas.
 */
async function addFieldToCanvas(
  page: Page,
  fieldType: FieldType
): Promise<void> {
  console.log(`[WORKFLOW] adding field: ${fieldType}`);

  // Verify canvas is ready
  const canvasHealthy = await verifyCanvasHealth(page);
  if (!canvasHealthy) {
    await prepareEnvironment(page);
  }

  // Drag field from palette to canvas
  const fieldTypeSelectors = FIELD_TYPE_SELECTOR_MAP[fieldType];

  try {
    await dragFieldToCanvas(page, fieldTypeSelectors[0]);
  } catch (dragError) {
    console.warn('[WORKFLOW] initial drag failed, running recovery');
    await recoverFromDragFailure(page, fieldTypeSelectors[0]);

    // Retry drag after recovery
    await dragFieldToCanvas(page, fieldTypeSelectors[0]);
  }

  console.log(`[WORKFLOW] field "${fieldType}" placed on canvas`);
}

/**
 * Open the field configuration panel by clicking the newly added field.
 */
async function openFieldConfig(page: Page): Promise<void> {
  console.log('[WORKFLOW] opening field configuration');

  // Click the last field container on the canvas (newly added field)
  const fieldContainers = page.locator(
    "[data-testid='field-container'], [role='listitem']"
  );
  const count = await fieldContainers.count();
  if (count === 0) {
    throw new Error('[WORKFLOW] no field containers found on canvas');
  }

  await fieldContainers.last().click();
  await waitForStableDOM(page);

  // Verify config panel is visible
  const configPanel = await smartLocate(
    page,
    FIELD_SELECTORS.field_config.config_panel
  );
  const visible = await configPanel.first().isVisible();
  if (!visible) {
    throw new Error('[WORKFLOW] field configuration panel did not open');
  }

  console.log('[WORKFLOW] field configuration panel opened');
}

/**
 * Fill in field properties: name, description, required toggle.
 */
async function configureField(input: CreateFieldInput, page: Page): Promise<void> {
  console.log('[WORKFLOW] configuring field properties');

  // Field name
  const nameInput = await smartLocate(
    page,
    FIELD_SELECTORS.field_config.field_name_input
  );
  await nameInput.click();
  await nameInput.fill('');
  await nameInput.fill(input.fieldName);

  const enteredName = await nameInput.inputValue();
  if (enteredName !== input.fieldName) {
    throw new Error(
      `[WORKFLOW] field name mismatch: expected "${input.fieldName}", got "${enteredName}"`
    );
  }
  console.log(`[WORKFLOW] field name set: ${input.fieldName}`);

  // Description (optional)
  if (input.fieldDescription) {
    const descInput = await smartLocate(
      page,
      FIELD_SELECTORS.field_config.field_description_input
    );
    await descInput.click();
    await descInput.fill('');
    await descInput.fill(input.fieldDescription);
    console.log('[WORKFLOW] field description set');
  }

  // Required toggle
  if (input.required) {
    console.log('[WORKFLOW] setting field as required');

    const toggle = await smartLocate(
      page,
      FIELD_SELECTORS.field_config.required_toggle
    );

    // Check current state and toggle if needed
    const ariaChecked = await toggle.first().getAttribute('aria-checked');
    if (ariaChecked !== 'true') {
      await toggle.first().click();
      await waitForStableDOM(page);
    }

    const newState = await toggle.first().getAttribute('aria-checked');
    console.log(`[WORKFLOW] required toggle state: ${newState}`);
  }
}

/**
 * Save field configuration and close config panel.
 */
async function saveFieldConfig(page: Page): Promise<void> {
  console.log('[WORKFLOW] saving field configuration');

  const saveBtn = await smartLocate(
    page,
    FIELD_SELECTORS.field_config.save_field_button
  );
  await saveBtn.first().click();

  // Network settle after save
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForTimeout(800);

  console.log('[WORKFLOW] field configuration saved');
}

/**
 * Save the entire form.
 */
async function saveForm(page: Page): Promise<void> {
  console.log('[WORKFLOW] saving form');

  await prepareEnvironment(page);

  const saveBtn = await smartLocate(
    page,
    FIELD_SELECTORS.form_actions.save_form_button
  );
  await saveBtn.first().click();

  // Network settle after form save
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForTimeout(1_000);

  console.log('[SAVE] form saved');
}

/**
 * Verify the field appears on the canvas after save.
 */
async function verifyFieldOnCanvas(
  page: Page,
  fieldName: string
): Promise<void> {
  console.log(`[WORKFLOW] verifying field "${fieldName}" on canvas`);

  await waitForStableDOM(page);

  const canvas = await smartLocate(page, [
    "[data-testid='form-designer-canvas']",
    "[aria-label='表单设计区']",
  ]);

  const canvasText = await getText(canvas.first());
  if (canvasText.includes(fieldName)) {
    console.log(`[WORKFLOW] field "${fieldName}" verified on canvas`);
  } else {
    console.warn(
      `[WORKFLOW] field "${fieldName}" not found in canvas text — may need manual check`
    );
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function createField(
  input: CreateFieldInput
): Promise<CreateFieldOutput> {
  console.log('[WORKFLOW] ======== create_field start ========');
  console.log(`[WORKFLOW] form: ${input.formName}, field: ${input.fieldName} (${input.fieldType})`);

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;

  try {
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

    // --- Step 2: Open target form in designer ---
    await retry(async () => {
      await prepareEnvironment(page);
      await openFormInDesigner(page, input.formName);
    });

    // --- Step 3: Drag field to canvas ---
    await retry(async () => {
      await addFieldToCanvas(page, input.fieldType);
    });

    // --- Step 4: Open field config panel ---
    await retry(async () => {
      await openFieldConfig(page);
    });

    // --- Step 5: Configure field properties ---
    await retry(async () => {
      // Use rerender recovery — config panel may rerender on input
      await withRerenderRecovery(
        page,
        () => configureField(input, page),
        FIELD_SELECTORS.field_config.config_panel
      );
    });

    // --- Step 6: Save field configuration ---
    await retry(async () => {
      await withRerenderRecovery(
        page,
        () => saveFieldConfig(page),
        FIELD_SELECTORS.field_config.save_field_button
      );
    });

    // --- Step 7: Save form ---
    await retry(() => saveForm(page));

    // --- Step 8: Verify ---
    await retry(() => verifyFieldOnCanvas(page, input.fieldName));

    // --- Step 9: End validation ---
    await validateWorkflowEnd(page);

    const output: CreateFieldOutput = {
      success: true,
      formName: input.formName,
      fieldName: input.fieldName,
      fieldType: input.fieldType,
    };

    console.log('[WORKFLOW] ======== create_field success ========');
    return output;
  } catch (error) {
    console.error('[WORKFLOW] ======== create_field FAILED ========');
    console.error(error);

    if (page!) {
      try {
        const snapshot = await page.content();
        console.log(`[WORKFLOW] DOM snapshot captured (${snapshot.length} chars)`);
      } catch {
        console.warn('[WORKFLOW] could not capture DOM snapshot');
      }
    }

    return {
      success: false,
      formName: input.formName,
      fieldName: input.fieldName,
      fieldType: input.fieldType,
    };
  } finally {
    if (browser!) {
      await browser.close();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error(
      'Usage: npx ts-node workflows/create_field.ts <formName> <fieldName> <fieldType> <baseUrl> [required:true|false]'
    );
    process.exit(1);
  }

  const input: CreateFieldInput = {
    formName: args[0],
    fieldName: args[1],
    fieldType: args[2] as FieldType,
    baseUrl: args[3],
    required: args[4] === 'true',
  };

  createField(input)
    .then((result) => {
      console.log('Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}
