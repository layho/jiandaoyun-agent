/**
 * runtime/auth.ts — V2 Authentication Runtime
 *
 * Handles 简道云 login via Playwright.
 * Credentials read from .env (never logged).
 */

import type { Page } from 'playwright';
import { getUsername, getPassword, maskToken } from './token';
import { smartLocate, waitForStableDOM } from './dom';

// ---------------------------------------------------------------------------
// Selectors for login page
// ---------------------------------------------------------------------------

const LOGIN_SELECTORS = {
  username_input: [
    '[data-testid="login-username"]',
    '[aria-label="用户名"]',
    '[aria-label="账号"]',
    '[placeholder*="用户名"]',
    '[placeholder*="账号"]',
    '[placeholder*="手机"]',
    '[placeholder*="邮箱"]',
    'input[name="username"]',
    'input[name="account"]',
    'input[name="email"]',
    'input[name="mobile"]',
    'input[type="text"]',
  ],
  password_input: [
    '[data-testid="login-password"]',
    '[aria-label="密码"]',
    '[placeholder*="密码"]',
    'input[name="password"]',
    'input[type="password"]',
  ],
  login_button: [
    '[data-testid="login-submit"]',
    '[aria-label="登录"]',
    'button:has-text("登 录")',
    'button:has-text("登录")',
    'button[type="submit"]',
  ],
  // Indicators that we're on a login page
  login_page_indicator: [
    'input[name="password"]',
    'input[type="password"]',
    'button:has-text("登录")',
    '[aria-label="登录"]',
  ],
  // Indicators we're already logged in
  dashboard_indicator: [
    '[data-app-name]',
    '[aria-label="应用列表"]',
    '[data-testid="app-list"]',
    '.app-list',
  ],
};

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Check if we're on a login page.
 */
export async function isOnLoginPage(page: Page): Promise<boolean> {
  for (const selector of LOGIN_SELECTORS.login_page_indicator) {
    const el = page.locator(selector);
    if ((await el.count()) > 0) {
      console.log(`[AUTH] login page detected via: ${selector}`);
      return true;
    }
  }
  console.log('[AUTH] not on login page');
  return false;
}

/**
 * Check if we're already logged in (dashboard visible).
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  for (const selector of LOGIN_SELECTORS.dashboard_indicator) {
    const el = page.locator(selector);
    if ((await el.count()) > 0 && (await el.first().isVisible().catch(() => false))) {
      console.log(`[AUTH] already logged in (found: ${selector})`);
      return true;
    }
  }
  console.log('[AUTH] not logged in');
  return false;
}

/**
 * Navigate to the target app URL.
 * Call ONCE — do NOT wrap in retry.
 */
export async function navigateToApp(page: Page, baseUrl: string): Promise<void> {
  console.log('[AUTH] navigating to', baseUrl);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

/**
 * Perform login using credentials from .env.
 * Safe to retry — does NOT re-navigate.
 */
export async function performLogin(page: Page): Promise<void> {
  console.log('[AUTH] ======== performLogin start ========');

  // Check if we're already logged in (existing session)
  if (await isLoggedIn(page)) {
    console.log('[AUTH] session active — skip login');
    return;
  }

  // Check if we need to login
  if (!(await isOnLoginPage(page))) {
    console.log('[AUTH] no login page found — may already be authenticated');
    return;
  }

  // Get credentials (NEVER log actual values)
  const username = getUsername();
  const password = getPassword();
  console.log(`[AUTH] logging in as: ${username}`);

  // Fill username
  const usernameInput = await smartLocate(page, LOGIN_SELECTORS.username_input);
  await usernameInput.click();
  await usernameInput.fill('');
  await usernameInput.fill(username);

  const enteredUser = await usernameInput.inputValue();
  if (enteredUser !== username) {
    throw new Error(`[AUTH] username fill failed: expected "${username.length} chars", got "${enteredUser.length} chars"`);
  }
  console.log('[AUTH] username filled');

  // Fill password
  const passwordInput = await smartLocate(page, LOGIN_SELECTORS.password_input);
  await passwordInput.click();
  await passwordInput.fill('');
  await passwordInput.fill(password);

  const enteredPass = await passwordInput.inputValue();
  if (enteredPass.length === 0) {
    throw new Error('[AUTH] password fill failed');
  }
  console.log('[AUTH] password filled');

  // Click login
  const loginBtn = await smartLocate(page, LOGIN_SELECTORS.login_button);
  await loginBtn.click();
  console.log('[AUTH] login submitted');

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard**', { timeout: 15_000 }).catch(() => {
    console.log('[AUTH] no dashboard redirect — checking page state');
  });
  await page.waitForTimeout(3_000);

  // Verify we're logged in
  await waitForStableDOM(page);
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    // Take screenshot for debugging
    await page.screenshot({ path: 'snapshots/login_failed.png' }).catch(() => {});
    throw new Error('[AUTH] login verification failed — not seeing dashboard after login');
  }

  console.log('[AUTH] ======== login success ========');
}
