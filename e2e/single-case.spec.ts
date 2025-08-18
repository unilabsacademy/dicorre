import { test, expect } from '@playwright/test';
import path from 'path';

test('uploads single case zip file and checks correct grouping', async ({ page }) => {
  await page.goto('/');

  const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip');
  await page.getByTestId('file-input').setInputFiles(testZipPath);

  const processingCard = page.getByTestId('file-processing-progress-card');
  await expect(processingCard).toBeHidden({ timeout: 10000 });

  const filesCountBadge = page.getByTestId('files-count-badge');
  await expect(filesCountBadge).toBeVisible();
  
  const filesCountText = await filesCountBadge.textContent();
  const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(fileCount).toBeGreaterThan(0);

  const anonymizedCountBeforeText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCountBefore = parseInt(anonymizedCountBeforeText?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCountBefore).toBe(0);

  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

  const studyCheckboxes = page.getByRole('checkbox');
  await studyCheckboxes.nth(1).click();

  const anonymizeButton = page.getByTestId('anonymize-button');
  await expect(anonymizeButton).toContainText('Anonymize (1)', { timeout: 5000 });
  await expect(anonymizeButton).toBeEnabled();

  await anonymizeButton.click();
  
  await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  
  const currentFilesCountText = await page.getByTestId('files-count-badge').textContent();
  const currentFileCount = parseInt(currentFilesCountText?.match(/(\d+)/)?.[1] || '0');
  
  expect(anonymizedCount).toBe(currentFileCount);

  const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(studiesCount).toBe(1);

  await expect(page.getByTestId('studies-table-card')).toBeVisible({ timeout: 5000 })
});
