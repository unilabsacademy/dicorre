import { test, expect } from '@playwright/test';
import path from 'path';

test('uploads zip file and checks anonymization works', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('drop-zone-text')).toBeVisible();

  const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip');
  await page.getByTestId('file-input').setInputFiles(testZipPath);

  const processingCard = page.getByTestId('file-processing-progress-card');
  await expect(processingCard).toBeHidden({ timeout: 10000 });

  await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 15000 });

  const filesCountText = await page.getByTestId('files-count-badge').textContent();
  const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(fileCount).toBeGreaterThan(0);

  await expect(page.getByTestId('toolbar')).toBeVisible();

  const anonymizedCountTextBefore = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCountBefore = parseInt(anonymizedCountTextBefore?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCountBefore).toBe(0);

  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

  const originalAccessionNumbers: string[] = [];
  const originalPatientIds: string[] = [];

  const accessionCellsBefore = page.locator('[data-testid="studies-data-table"] tbody tr td:nth-child(2)');
  const patientIdCellsBefore = page.locator('[data-testid="studies-data-table"] tbody tr td:nth-child(3)');

  const accessionCountBefore = await accessionCellsBefore.count();
  for (let i = 0; i < Math.min(accessionCountBefore, 3); i++) {
    const accessionText = await accessionCellsBefore.nth(i).textContent();
    if (accessionText) originalAccessionNumbers.push(accessionText);
  }

  const patientIdCountBefore = await patientIdCellsBefore.count();
  for (let i = 0; i < Math.min(patientIdCountBefore, 3); i++) {
    const patientIdText = await patientIdCellsBefore.nth(i).textContent();
    if (patientIdText) originalPatientIds.push(patientIdText);
  }

  const studyCheckboxes = page.getByRole('checkbox');
  const checkboxCount = await studyCheckboxes.count();

  for (let i = 1; i < checkboxCount; i++) {
    await studyCheckboxes.nth(i).click();
  }

  const anonymizeButton = page.getByTestId('anonymize-button');
  await expect(anonymizeButton).toContainText('Anonymize (', { timeout: 5000 });
  await expect(anonymizeButton).toBeEnabled();

  await anonymizeButton.click();

  await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCount).toBeGreaterThan(0);

  await expect(page.getByTestId('studies-table-card')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('studies-data-table')).toBeVisible();

  const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(studiesCount).toBeGreaterThan(0);
  expect(studiesCount).toBeLessThan(fileCount);

  const accessionCells = page.locator('[data-testid="studies-data-table"] tbody tr td:nth-child(2)');
  const accessionCount = await accessionCells.count();

  if (accessionCount > 0) {
    for (let i = 0; i < Math.min(accessionCount, 3); i++) {
      const accessionText = await accessionCells.nth(i).textContent();
      if (accessionText) {
        expect(accessionText).toMatch(/^ACA\w{7,8}$/);
      }
    }
  }

  const patientIdCells = page.locator('[data-testid="studies-data-table"] tbody tr td:nth-child(3)');
  const patientIdCount = await patientIdCells.count();

  const anonymizedAccessionNumbers: string[] = [];
  const anonymizedPatientIds: string[] = [];

  const accessionCellsAfter = page.locator('[data-testid="studies-data-table"] tbody tr td:nth-child(2)');
  const accessionCountAfter = await accessionCellsAfter.count();
  for (let i = 0; i < Math.min(accessionCountAfter, 3); i++) {
    const accessionText = await accessionCellsAfter.nth(i).textContent();
    if (accessionText) anonymizedAccessionNumbers.push(accessionText);
  }

  for (let i = 0; i < Math.min(patientIdCount, 3); i++) {
    const patientIdText = await patientIdCells.nth(i).textContent();
    if (patientIdText) anonymizedPatientIds.push(patientIdText);
  }

  let accessionNumbersChanged = false;
  let patientIdsChanged = false;

  for (let i = 0; i < Math.min(originalAccessionNumbers.length, anonymizedAccessionNumbers.length); i++) {
    if (originalAccessionNumbers[i] !== anonymizedAccessionNumbers[i]) {
      accessionNumbersChanged = true;
    }
  }

  for (let i = 0; i < Math.min(originalPatientIds.length, anonymizedPatientIds.length); i++) {
    if (originalPatientIds[i] !== anonymizedPatientIds[i]) {
      patientIdsChanged = true;
    }
  }

  expect(accessionNumbersChanged).toBe(true);
  expect(patientIdsChanged).toBe(true);

  const anonymizedCells = page.locator('[data-testid="studies-data-table"] tbody tr td:nth-child(9)');
  const cellCount = await anonymizedCells.count();

  if (cellCount > 0) {
    for (let i = 0; i < Math.min(cellCount, 3); i++) {
      const cellText = await anonymizedCells.nth(i).textContent();
      expect(cellText).toBe('Anonymized');
    }
  }

  if (patientIdCount > 0) {
    for (let i = 0; i < Math.min(patientIdCount, 3); i++) {
      const patientIdText = await patientIdCells.nth(i).textContent();
      if (patientIdText) {
        expect(patientIdText).toMatch(/^PAT\w{7,8}$/);
      }
    }
  }
});

test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');
})
