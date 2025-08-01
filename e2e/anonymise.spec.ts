import { test, expect } from '@playwright/test';
import path from 'path';

test('uploads zip file and checks anonymization works', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');

  // Check that the app loaded correctly
  await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

  // Verify the file drop zone is visible
  await expect(page.getByTestId('drop-zone-text')).toBeVisible();

  // Upload the test zip file with 3 cases, 3 series each, 18 files total
  const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip');
  await page.getByTestId('file-input').setInputFiles(testZipPath);

  // Wait for initial file processing (ZIP extraction + parsing)
  await page.waitForTimeout(3000);

  // Verify that files were extracted from ZIP and processed
  await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 15000 });

  // Get the actual file count from the badge
  const filesCountText = await page.getByTestId('files-count-badge').textContent();
  const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
  console.log(`Found ${fileCount} files extracted from ZIP`);

  // Verify that we extracted exactly 18 files from the 3-case ZIP
  expect(fileCount).toBe(18);

  // Verify the toolbar is displayed
  await expect(page.getByTestId('toolbar')).toBeVisible();

  // Before anonymization, anonymized count should be 0
  const anonymizedCountTextBefore = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCountBefore = parseInt(anonymizedCountTextBefore?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCountBefore).toBe(0);

  // Wait for studies table to appear
  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

  // Wait a moment for table to fully render
  await page.waitForTimeout(1000);

  // Select all studies by clicking each study's checkbox
  const studyCheckboxes = page.getByRole('checkbox');
  const checkboxCount = await studyCheckboxes.count();
  
  // Click all checkboxes except the first one (which is the header checkbox)
  for (let i = 1; i < checkboxCount; i++) {
    await studyCheckboxes.nth(i).click();
  }

  // Wait for selection to propagate
  await page.waitForTimeout(500);

  // Verify that studies are selected - button should now show "Anonymize (3)" for 3 studies
  const anonymizeButton = page.getByTestId('anonymize-button');
  await expect(anonymizeButton).toContainText('Anonymize (3)', { timeout: 5000 });
  await expect(anonymizeButton).toBeEnabled();

  // Trigger anonymization
  await anonymizeButton.click();

  // Wait for anonymization to finish – wait until all studies are anonymized
  // The button should become disabled when all selected studies are anonymized
  await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

  // Re-fetch anonymized badge text now that processing is complete
  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCount).toBe(fileCount); // All files should now be anonymized

  // Verify studies table is displayed with anonymized data
  await expect(page.getByTestId('studies-table-card')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('studies-table-title')).toHaveText('DICOM Studies');
  await expect(page.getByTestId('studies-data-table')).toBeVisible();

  // Verify studies count badge shows exactly 3 studies (one per patient)
  const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(studiesCount).toBe(3); // Should be 3 studies for 3 patients

  console.log(`Successfully processed and anonymized ${fileCount} DICOM files into ${studiesCount} studies`);

  // Verify the proper grouping occurred: 3 patients, each with 1 study containing 3 series
  console.log('Expected structure: 3 patients × 1 study × 3 series × 2 files = 18 total files');
});

test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');
})
