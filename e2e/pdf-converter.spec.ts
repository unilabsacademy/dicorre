import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('PDF Converter Plugin', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and wait for it to be ready
    await page.goto('/');
    
    // Wait for app to be ready - either drop zone or toolbar should be visible
    await Promise.race([
      page.getByTestId('drop-zone-text').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
      page.getByTestId('app-toolbar').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    ]);
    
    // If there's already data, clear it
    const clearButton = page.getByTestId('clear-all-button');
    if (await clearButton.isVisible()) {
      await clearButton.click();
      // Wait for drop zone to reappear after clearing
      await expect(page.getByTestId('drop-zone-text')).toBeVisible({ timeout: 5000 });
    }
  });

  test('converts PDF to DICOM file', async ({ page }) => {

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await page.getByTestId('file-input').setInputFiles([testPdfPath]);

    // Wait for file processing progress card to disappear
    const processingCard = page.getByTestId('file-processing-progress-card');
    await expect(processingCard).toBeHidden({ timeout: 10000 });

    // Check if files were processed - wait for files count badge to appear
    await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 5000 });
    const filesCountBadge = page.getByTestId('files-count-badge');
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(3);

    // Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that 1 study appears in the table (PDF converted to single study)
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    await expect(studyRows).toHaveCount(1);
  });

  test('converts PDF and anonymizes the series', async ({ page }) => {

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await page.getByTestId('file-input').setInputFiles([testPdfPath]);

    // Wait for file processing progress card to disappear
    const processingCard = page.getByTestId('file-processing-progress-card');
    await expect(processingCard).toBeHidden({ timeout: 10000 });

    // Verify studies table appears and select all studies
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Select all studies by clicking the header checkbox
    const headerCheckbox = page.getByRole('checkbox').first();
    await headerCheckbox.click();

    // Verify anonymize button shows correct count
    const anonymizeButton = page.getByTestId('anonymize-button');
    const studyRows = page.locator('[data-testid="studies-data-table"] tbody tr');
    const studiesCount = await studyRows.count();

    await expect(anonymizeButton).toContainText(`Anonymize (${studiesCount})`, { timeout: 5000 });
    await expect(anonymizeButton).toBeEnabled();

    // Click anonymize button
    await anonymizeButton.click();

    // Wait for anonymization to complete
    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

    // Verify files were anonymized
    const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
    const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');

    expect(anonymizedCount).toBe(3); // All converted PDF pages should be anonymized
  });
});
