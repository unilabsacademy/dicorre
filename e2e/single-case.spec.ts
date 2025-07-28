import { test, expect } from '@playwright/test';
import path from 'path';

test('uploads single case zip file and checks correct grouping', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');
  
  // Check that the app loaded correctly
  await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');
  
  // Upload the single case test zip file
  const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip');
  await page.getByTestId('file-input').setInputFiles(testZipPath);
  
  // Wait for file processing
  await page.waitForTimeout(3000);
  
  // Verify that 6 files were extracted from the single case ZIP
  await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 15000 });
  const filesCountText = await page.getByTestId('files-count-badge').textContent();
  const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(fileCount).toBe(6);
  
  // Verify all 6 files were anonymized
  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCount).toBe(6);
  
  // Verify exactly 1 study (one patient)
  const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(studiesCount).toBe(1);
  
  // Verify studies table is displayed
  await expect(page.getByTestId('studies-table-card')).toBeVisible({ timeout: 5000 });
  
  console.log(`Single case: ${fileCount} files anonymized into ${studiesCount} study`);
  console.log('Expected structure: 1 patient × 1 study × 3 series × 2 files = 6 total files');
});