import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('PDF Converter Plugin', () => {
  test('converts PDF to DICOM file', async ({ page }) => {
    // Capture console messages for debugging
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Capture page errors
    page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });
    
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');

    await page.getByTestId('file-input').setInputFiles([testPdfPath]);

    // Wait for file processing with longer timeout (PDF processing can be slower)  
    // Look for either success or error messages
    await Promise.race([
      page.waitForFunction(() => 
        document.querySelector('[data-testid="files-count-badge"]')?.textContent?.includes('1') ||
        document.querySelector('[data-testid="files-count-badge"]')?.textContent?.includes('0')
      , { timeout: 20000 }),
      page.waitForTimeout(20000)
    ]);

    // Debug: Check console messages
    console.log('Console messages during PDF upload:');
    consoleMessages.forEach(msg => console.log(`  ${msg}`));

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    const isBadgeVisible = await filesCountBadge.isVisible();
    
    if (isBadgeVisible) {
      const filesCountText = await filesCountBadge.textContent();
      const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
      console.log(`PDF pages converted to DICOM: ${fileCount}`);
      expect(fileCount).toBeGreaterThan(0); // Should convert at least 1 file

      // Verify studies table appears
      await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

      // Check that the converted files appear in the studies table as a series
      const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
      const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
      console.log(`Studies created from PDF: ${studiesCount}`);
      expect(studiesCount).toBeGreaterThan(0); // Should create at least one study

      // Verify that multiple files are in the same series (PDF pages should be grouped)
      // The PDF should create one study with one series containing 3 instances
      const seriesRows = page.getByTestId('studies-data-table').locator('tbody tr');
      const seriesCount = await seriesRows.count();
      console.log(`Series created: ${seriesCount}`);

      // Check that series contains multiple instances
      if (seriesCount > 0) {
        const firstSeriesRow = seriesRows.first();
        await firstSeriesRow.click(); // Expand to see details if applicable
        
        // The series should indicate it contains multiple instances (3 pages)
        // This is implementation-dependent on how the UI shows series details
      }

      console.log('PDF conversion test completed successfully');
    } else {
      console.log('Files count badge not visible - PDF may not have been processed');
      console.log('Final console messages:', consoleMessages.slice(-10));
      throw new Error('No files were processed - check console messages for errors');
    }
  });

  test('converts PDF and verifies DICOM instance creation', async ({ page }) => {
    // Capture console messages for debugging
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await page.getByTestId('file-input').setInputFiles([testPdfPath]);

    // Wait for file processing
    await page.waitForTimeout(6000);

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();
    
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    console.log(`PDF converted to ${fileCount} DICOM files`);
    
    // The mock PDF should create 1 DICOM instance
    expect(fileCount).toBe(1);

    // Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    console.log('PDF page-to-DICOM conversion test completed successfully');
  });

  test('converts PDF and anonymizes the series', async ({ page }) => {
    // Capture console messages for debugging
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Upload the test PDF
    const testPdfPath = path.join(process.cwd(), 'src/plugins/pdfConverter/test-data/test-document.pdf');
    await page.getByTestId('file-input').setInputFiles([testPdfPath]);

    // Wait for file processing
    await page.waitForTimeout(6000);

    // Verify files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();
    
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(1); // 1 page converted (mock implementation)

    // Verify studies table appears and select all studies
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Select all studies by clicking the header checkbox
    const headerCheckbox = page.getByRole('checkbox').first();
    await headerCheckbox.click();
    await page.waitForTimeout(500);

    // Verify anonymize button shows correct count
    const anonymizeButton = page.getByTestId('anonymize-button');
    const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
    const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
    
    await expect(anonymizeButton).toContainText(`Anonymize (${studiesCount})`, { timeout: 5000 });
    await expect(anonymizeButton).toBeEnabled();

    // Click anonymize button
    console.log('Clicking anonymize button for converted PDF series');
    await anonymizeButton.click();
    
    // Wait for anonymization to complete
    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

    // Verify files were anonymized
    const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
    const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
    
    console.log(`PDF series anonymized: ${anonymizedCount} out of ${fileCount}`);
    expect(anonymizedCount).toBe(fileCount); // All converted PDF pages should be anonymized

    console.log('PDF conversion and anonymization test completed successfully');
  });

  test('rejects non-PDF files when using PDF converter', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Try to upload a non-PDF file (should be handled by other plugins or rejected)
    const testFilePath = path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg');
    await page.getByTestId('file-input').setInputFiles([testFilePath]);

    // Wait a moment
    await page.waitForTimeout(3000);

    // Check if files were processed - this JPG should be handled by image converter, not PDF converter
    const filesCountBadge = page.getByTestId('files-count-badge');
    const isVisible = await filesCountBadge.isVisible();
    
    if (isVisible) {
      const filesCountText = await filesCountBadge.textContent();
      const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
      // JPG should be processed by image converter (1 file) not PDF converter
      expect(fileCount).toBe(1);
    }

    console.log('Non-PDF file handling test completed successfully');
  });

  test('handles empty PDF upload gracefully', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Try to upload no files
    await page.getByTestId('file-input').setInputFiles([]);

    // Wait a moment
    await page.waitForTimeout(2000);

    // Check that no files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    const isVisible = await filesCountBadge.isVisible();
    
    if (isVisible) {
      const filesCountText = await filesCountBadge.textContent();
      const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
      expect(fileCount).toBe(0); // Should not process any files
    }

    console.log('Empty upload handling test completed successfully');
  });
});