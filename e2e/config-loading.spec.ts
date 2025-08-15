import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Config Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');
  });

  test('loads valid config file', async ({ page }) => {
    // Create a valid config file
    const validConfig = {
      dicomServer: {
        url: "/api/test-server/dicom-web",
        timeout: 60000
      },
      anonymization: {
        profile: "clean",
        removePrivateTags: false
      }
    };

    const tempConfigPath = path.join(process.cwd(), 'test-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(validConfig, null, 2));

    try {
      // Load the config
      await page.getByTestId('load-config-button').click();
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Check success toast appears
      await expect(page.locator('[data-sonner-toast][data-type="success"]')).toBeVisible({ timeout: 3000 });
      
      // Verify config was applied
      await expect(page.getByTestId('current-profile')).toContainText('clean');
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('shows error for invalid config', async ({ page }) => {
    // Create an invalid config (missing required url field)
    const invalidConfig = {
      dicomServer: {
        timeout: 30000
      },
      anonymization: {
        profile: "basic",
        removePrivateTags: true
      }
    };

    const tempConfigPath = path.join(process.cwd(), 'invalid-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(invalidConfig, null, 2));

    try {
      // Load the invalid config
      await page.getByTestId('load-config-button').click();
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Check error toast appears
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({ timeout: 3000 });
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });
});