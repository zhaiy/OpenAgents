import { test, expect } from '@playwright/test';

test.describe('Web UI Smoke Tests', () => {
  test('homepage loads without errors', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('homepage shows quick actions section', async ({ page }) => {
    await page.goto('/');
    // T24: Quick actions section header should be visible (API may fail without backend)
    await expect(page.locator('text=Quick Actions').first()).toBeVisible();
  });

  test('navigation works', async ({ page }) => {
    await page.goto('/');

    await page.click('text=Workflows');
    await expect(page).toHaveURL(/\/workflows/);

    await page.click('text=Runs');
    await expect(page).toHaveURL(/\/runs/);

    await page.click('text=Settings');
    await expect(page).toHaveURL(/\/settings/);

    await page.click('text=Home');
    await expect(page).toHaveURL('/');
  });

  test('workflows page loads with search', async ({ page }) => {
    await page.goto('/workflows');
    // T25: Search input should exist
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('runs page loads with filters', async ({ page }) => {
    await page.goto('/runs');
    // T26: Status filter should exist
    await expect(page.locator('select').first()).toBeVisible();
  });

  test('runs page shows compare section', async ({ page }) => {
    await page.goto('/runs');
    // T26: Compare inputs should exist
    await expect(page.locator('input[placeholder="Run A ID"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Run B ID"]')).toBeVisible();
  });

  test('settings page shows language switcher', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('button:has-text("English")')).toBeVisible();
    await expect(page.locator('button:has-text("简体中文")')).toBeVisible();
  });

  test('settings page allows language switch', async ({ page }) => {
    await page.goto('/settings');

    // Switch to Chinese
    await page.click('button:has-text("简体中文")');
    await expect(page.locator('h2:has-text("设置")')).toBeVisible();

    // Switch back to English
    await page.click('button:has-text("English")');
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible();
  });

  test('settings page shows environment status', async ({ page }) => {
    await page.goto('/settings');
    // T27: Environment section should exist
    await expect(page.locator('text=Environment')).toBeVisible();
  });

  test('settings page shows default runtime options', async ({ page }) => {
    await page.goto('/settings');
    // T27: Runtime options should exist
    await expect(page.locator('text=Default Runtime Options')).toBeVisible();
  });
});

// =============================================================================
// Recovery Path Smoke Tests (M4)
// =============================================================================

test.describe('Recovery Path Smoke Tests', () => {
  test('diagnostics page loads with tabs', async ({ page }) => {
    await page.goto('/diagnostics');
    // Should show Failed Runs tab
    await expect(page.locator('text=Failed Runs').first()).toBeVisible();
    // Should show Waiting Gates tab
    await expect(page.locator('text=Waiting Gates').first()).toBeVisible();
  });

  test('diagnostics page shows refresh button', async ({ page }) => {
    await page.goto('/diagnostics');
    // Refresh button should exist
    await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible();
  });

  test('diagnostics page shows quick links section', async ({ page }) => {
    await page.goto('/diagnostics');
    // Quick links section should be visible
    await expect(page.locator('text=Quick Links').first()).toBeVisible();
  });

  test('runs comparison page loads with run inputs', async ({ page }) => {
    await page.goto('/runs');
    // Compare section should have Run A and Run B inputs
    await expect(page.locator('input[placeholder="Run A ID"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Run B ID"]')).toBeVisible();
  });

  test('navigation to diagnostics from runs page', async ({ page }) => {
    await page.goto('/runs');
    // There should be a way to navigate to diagnostics - via quick links or nav
    await page.click('text=Diagnostics');
    await expect(page).toHaveURL(/\/diagnostics/);
  });
});
