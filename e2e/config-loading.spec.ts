import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Config Loading Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    
    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');
  });

  test('displays config loading button in the UI', async ({ page }) => {
    // Check for config loading button
    const configButton = page.getByTestId('load-config-button');
    await expect(configButton).toBeVisible();
    await expect(configButton).toHaveText(/Load Config/i);
  });

  test('loads valid config file and updates anonymization settings', async ({ page }) => {
    // Create a valid test config file
    const validConfig = {
      dicomServer: {
        url: "/api/test-server/dicom-web",
        headers: { "X-Test": "true" },
        timeout: 60000,
        auth: null,
        description: "Test DICOM server"
      },
      anonymization: {
        profile: "clean",
        removePrivateTags: false,
        useCustomHandlers: false,
        dateJitterDays: 15,
        organizationRoot: "1.2.3.4.5",
        replacements: {
          default: "TEST_REMOVED",
          patientName: "TEST_PATIENT",
          accessionNumber: "TEST_ACC_{timestamp}",
          patientId: "TEST_ID_{timestamp}",
          patientBirthDate: "20000101",
          institution: "TEST_INSTITUTION"
        },
        preserveTags: ["00080016", "00080018"],
        tagsToRemove: ["PatientAddress", "PatientTelephoneNumber"]
      },
      presets: {
        test: {
          profile: "basic",
          removePrivateTags: true,
          description: "Test preset configuration"
        }
      }
    };

    // Write config to temp file
    const tempConfigPath = path.join(process.cwd(), 'test-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(validConfig, null, 2));

    try {
      // Click the config loading button
      await page.getByTestId('load-config-button').click();

      // Handle file input
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Wait for success message to appear (must appear within 3 seconds before timeout)
      await expect(page.getByTestId('config-load-success')).toBeVisible({ timeout: 2000 });
      await expect(page.getByTestId('config-load-success')).toContainText(/Config loaded successfully/i);

      // Verify config is applied - check anonymization settings display
      const profileDisplay = page.getByTestId('current-profile');
      await expect(profileDisplay).toContainText('clean');

      // Check that server URL is updated
      const serverDisplay = page.getByTestId('server-url-display');
      await expect(serverDisplay).toContainText('/api/test-server/dicom-web');
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('rejects invalid config with missing required fields', async ({ page }) => {
    // Create an invalid config file (missing dicomServer.url)
    const invalidConfig = {
      dicomServer: {
        headers: {},
        timeout: 30000
      },
      anonymization: {
        profile: "basic",
        removePrivateTags: true
      }
    };

    // Write config to temp file
    const tempConfigPath = path.join(process.cwd(), 'invalid-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(invalidConfig, null, 2));

    try {
      // Click the config loading button
      await page.getByTestId('load-config-button').click();

      // Handle file input
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Wait for error message to appear
      await expect(page.getByTestId('config-load-error')).toBeVisible({ timeout: 2000 });
      await expect(page.getByTestId('config-load-error')).toContainText(/DICOM server URL is required/i);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('rejects config with invalid profile value', async ({ page }) => {
    // Create config with invalid profile
    const invalidProfileConfig = {
      dicomServer: {
        url: "/api/test/dicom-web",
        headers: {},
        timeout: 30000,
        auth: null
      },
      anonymization: {
        profile: "invalid-profile", // Invalid profile value
        removePrivateTags: true,
        replacements: {
          default: "REMOVED"
        }
      }
    };

    // Write config to temp file
    const tempConfigPath = path.join(process.cwd(), 'invalid-profile-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(invalidProfileConfig, null, 2));

    try {
      // Click the config loading button
      await page.getByTestId('load-config-button').click();

      // Handle file input
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Wait for error message to appear
      await expect(page.getByTestId('config-load-error')).toBeVisible({ timeout: 2000 });
      await expect(page.getByTestId('config-load-error')).toContainText(/Invalid anonymization profile/i);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('rejects config with invalid dateJitterDays value', async ({ page }) => {
    // Create config with invalid dateJitterDays
    const invalidJitterConfig = {
      dicomServer: {
        url: "/api/test/dicom-web",
        headers: {},
        timeout: 30000,
        auth: null
      },
      anonymization: {
        profile: "basic",
        removePrivateTags: true,
        dateJitterDays: 500, // Invalid: > 365
        replacements: {
          default: "REMOVED"
        }
      }
    };

    // Write config to temp file
    const tempConfigPath = path.join(process.cwd(), 'invalid-jitter-config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(invalidJitterConfig, null, 2));

    try {
      // Click the config loading button
      await page.getByTestId('load-config-button').click();

      // Handle file input
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Wait for error message to appear
      await expect(page.getByTestId('config-load-error')).toBeVisible({ timeout: 2000 });
      await expect(page.getByTestId('config-load-error')).toContainText(/Invalid dateJitterDays.*between 0 and 365/i);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('handles malformed JSON gracefully', async ({ page }) => {
    // Create a malformed JSON file
    const tempConfigPath = path.join(process.cwd(), 'malformed-config.json');
    fs.writeFileSync(tempConfigPath, '{ invalid json content }');

    try {
      // Click the config loading button
      await page.getByTestId('load-config-button').click();

      // Handle file input
      const fileInput = page.getByTestId('config-file-input');
      await fileInput.setInputFiles(tempConfigPath);

      // Wait for error message to appear
      await expect(page.getByTestId('config-load-error')).toBeVisible({ timeout: 2000 });
      await expect(page.getByTestId('config-load-error')).toContainText(/Invalid JSON/i);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    }
  });

  test('preserves current config when loading is cancelled', async ({ page }) => {
    // Get initial config display values
    const initialProfile = await page.getByTestId('current-profile').textContent();
    const initialServerUrl = await page.getByTestId('server-url-display').textContent();

    // Click the config loading button
    await page.getByTestId('load-config-button').click();

    // Cancel the file dialog (simulate by not selecting a file)
    await page.keyboard.press('Escape');

    // Verify config hasn't changed
    await expect(page.getByTestId('current-profile')).toHaveText(initialProfile || '');
    await expect(page.getByTestId('server-url-display')).toHaveText(initialServerUrl || '');
  });
});