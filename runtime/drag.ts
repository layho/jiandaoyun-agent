/**
 * runtime/drag.ts — V2 Drag-and-Drop Runtime
 *
 * Handles drag-and-drop operations for the 简道云 form designer.
 * V2 mandate: NEVER use mouse.move(x,y). Always use locator.dragTo()
 * or dispatchEvent-based drag simulation.
 */

import type { Page, Locator } from 'playwright';
import { smartLocate, waitForStableDOM } from './dom';
import { retry } from './retry';

// ---------------------------------------------------------------------------
// Primary: locator.dragTo (Playwright native)
// ---------------------------------------------------------------------------

/**
 * Drag a source element and drop it onto a target element using
 * Playwright's native dragTo API.
 *
 * This is the V2-preferred method — no raw coordinates, no mouse events.
 */
export async function dragTo(
  page: Page,
  sourceSelectors: string[],
  targetSelectors: string[]
): Promise<void> {
  console.log('[DRAG] starting dragTo operation');

  await waitForStableDOM(page);

  const source = await smartLocate(page, sourceSelectors);
  const target = await smartLocate(page, targetSelectors);

  // Ensure both are visible before dragging
  const sourceVisible = await source.first().isVisible();
  const targetVisible = await target.first().isVisible();

  if (!sourceVisible) {
    throw new Error('[DRAG] source element is not visible');
  }
  if (!targetVisible) {
    throw new Error('[DRAG] target element is not visible');
  }

  console.log('[DRAG] executing dragTo');
  await source.first().dragTo(target.first(), {
    force: true,
    timeout: 10_000,
  });

  await waitForStableDOM(page);
  console.log('[DRAG] dragTo completed');
}

// ---------------------------------------------------------------------------
// Fallback: dispatchEvent-based drag simulation
// ---------------------------------------------------------------------------

/**
 * Simulate a drag-and-drop using native DOM drag events.
 * Use when locator.dragTo() is unreliable (e.g. virtual list, shadow DOM).
 */

interface DragEventInit {
  clientX: number;
  clientY: number;
}

export async function dragByEvents(
  page: Page,
  sourceSelectors: string[],
  targetSelectors: string[]
): Promise<void> {
  console.log('[DRAG] starting dispatchEvent-based drag');

  await waitForStableDOM(page);

  const source = await smartLocate(page, sourceSelectors);
  const target = await smartLocate(page, targetSelectors);

  // Get bounding boxes for coordinate calculation
  const sourceBox = await source.first().boundingBox();
  const targetBox = await target.first().boundingBox();

  if (!sourceBox) throw new Error('[DRAG] source boundingBox is null');
  if (!targetBox) throw new Error('[DRAG] target boundingBox is null');

  const sourceCenter: DragEventInit = {
    clientX: Math.round(sourceBox.x + sourceBox.width / 2),
    clientY: Math.round(sourceBox.y + sourceBox.height / 2),
  };

  const targetCenter: DragEventInit = {
    clientX: Math.round(targetBox.x + targetBox.width / 2),
    clientY: Math.round(targetBox.y + targetBox.height / 2),
  };

  await page.evaluate(
    ({ sx, sy, tx, ty }) => {
      const sourceEl = document.elementFromPoint(sx, sy);
      const targetEl = document.elementFromPoint(tx, ty);
      if (!sourceEl || !targetEl) return;

      const dataTransfer = new DataTransfer();

      sourceEl.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          clientX: sx,
          clientY: sy,
          dataTransfer,
        })
      );

      targetEl.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: tx,
          clientY: ty,
          dataTransfer,
        })
      );

      targetEl.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: tx,
          clientY: ty,
          dataTransfer,
        })
      );

      sourceEl.dispatchEvent(
        new DragEvent('dragend', {
          bubbles: true,
          cancelable: true,
          clientX: tx,
          clientY: ty,
          dataTransfer,
        })
      );
    },
    {
      sx: sourceCenter.clientX,
      sy: sourceCenter.clientY,
      tx: targetCenter.clientX,
      ty: targetCenter.clientY,
    }
  );

  await waitForStableDOM(page);
  console.log('[DRAG] dispatchEvent drag completed');
}

// ---------------------------------------------------------------------------
// Smart drag: tries dragTo first, falls back to dragByEvents
// ---------------------------------------------------------------------------

/**
 * Smart drag: attempts locator.dragTo() first.
 * If that fails, retries with dispatchEvent-based drag.
 * This is the recommended entry point for all V2 workflows.
 */
export async function smartDrag(
  page: Page,
  sourceSelectors: string[],
  targetSelectors: string[]
): Promise<void> {
  try {
    await retry(() => dragTo(page, sourceSelectors, targetSelectors));
  } catch (dragToError) {
    console.warn('[DRAG] dragTo failed, trying dispatchEvent fallback');
    console.warn(dragToError);

    try {
      await retry(() => dragByEvents(page, sourceSelectors, targetSelectors));
      console.log('[DRAG] dispatchEvent fallback succeeded');
    } catch (eventError) {
      throw new Error(
        `[DRAG] both drag methods failed. dragTo: ${dragToError}. events: ${eventError}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Field palette → form designer drag helper
// ---------------------------------------------------------------------------

/**
 * Drag a field from the palette onto the form designer canvas.
 * Convenience wrapper around smartDrag.
 */
export async function dragFieldToCanvas(
  page: Page,
  fieldTypeSelectors: string[]
): Promise<void> {
  console.log('[DRAG] dragging field from palette to canvas');

  const canvasSelectors = [
    "[data-testid='form-designer-canvas']",
    "[aria-label='表单设计区']",
    "[role='region'][aria-label='表单设计']",
    "[data-drop-zone='true']",
    "[data-testid='form-drop-zone']",
  ];

  await smartDrag(page, fieldTypeSelectors, canvasSelectors);
  console.log('[DRAG] field placed on canvas');
}
