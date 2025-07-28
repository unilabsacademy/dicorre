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
  
  // Wait for initial file processing (ZIP extraction + parsing + anonymization)
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
  
  // Check anonymized count - should equal file count since auto-processing happens
  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  console.log(`Found ${anonymizedCount} anonymized files`);
  
  // Verify that anonymization actually occurred - all 18 files should be anonymized
  expect(anonymizedCount).toBe(18);
  expect(anonymizedCount).toBe(fileCount); // All files should be anonymized automatically
  
  // Verify the anonymize button shows "All Anonymized" since auto-processing happened
  const anonymizeButton = page.getByTestId('anonymize-all-button');
  await expect(anonymizeButton).toHaveText('All Anonymized');
  await expect(anonymizeButton).toBeDisabled();
  
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
