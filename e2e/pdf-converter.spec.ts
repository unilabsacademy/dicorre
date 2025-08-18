import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('PDF Converter Plugin', () => {
  test('converts PDF to DICOM file', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('clear-all-button').click();

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await page.getByTestId('file-input').setInputFiles([testPdfPath]);

    // Wait for file processing progress card to disappear
    const processingCard = page.getByTestId('file-processing-progress-card');
    await expect(processingCard).toBeHidden({ timeout: 10000 });

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');

    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(3);

    // Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that the converted files appear in the studies table as a series
    const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
    const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(studiesCount).toBe(1);
  });

  test('converts PDF and anonymizes the series', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('clear-all-button').click();

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
    const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
    const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');

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
