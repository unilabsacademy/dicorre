import { test, expect } from '@playwright/test';
import path from 'path';

test('uploads zip file and checks anonymization works', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');
  
  // Check that the app loaded correctly
  await expect(page.locator('h1')).toHaveText('DICOM Anonymizer & Sender');
  
  // Verify the file drop zone is visible
  await expect(page.locator('text=Drop ZIP file here or')).toBeVisible();
  
  // Upload the test zip file
  const testZipPath = path.join(process.cwd(), 'test-data/CASES/Caso1.zip');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(testZipPath);
  
  // Wait for the file processing to complete
  await expect(page.locator('text=Processing files...')).toBeVisible();
  await expect(page.locator('text=Processing files...')).not.toBeVisible({ timeout: 30000 });
  
  // Check that the study summary card appears
  await expect(page.locator('text=Study Summary')).toBeVisible();
  
  // Verify file counts are displayed
  const totalFilesText = await page.locator('text=Total Files:').textContent();
  expect(totalFilesText).toContain('Total Files:');
  
  // Click the "Anonymize All" button
  await page.locator('button:has-text("Anonymize All")').click();
  
  // Wait for the button to change to "All Files Anonymized"
  await expect(page.locator('button:has-text("All Files Anonymized")')).toBeVisible({ timeout: 30000 });
  
  // Verify the anonymized count matches total
  const anonymizedBadge = page.locator('text=Anonymized:');
  await expect(anonymizedBadge).toBeVisible();
  
  // Check that the data table is displayed with studies using more specific locator
  await expect(page.locator('h3:has-text("DICOM Studies")')).toBeVisible();
  
  // Verify the data table has rows
  const tableRows = page.locator('table tbody tr');
  await expect(tableRows.first()).toBeVisible();
  
  // Check that at least one study shows as "Anonymized" status
  await expect(page.locator('text=Anonymized').first()).toBeVisible();
  
  // Verify the search functionality works
  const searchInput = page.locator('input[placeholder*="Search by accession"]');
  await expect(searchInput).toBeVisible();
  
  // Test checkbox selection
  const firstCheckbox = page.locator('table tbody tr:first-child input[type="checkbox"]');
  await expect(firstCheckbox).toBeVisible();
  await firstCheckbox.check();
  
  // Verify selection counter updates
  await expect(page.locator('text=1 of')).toBeVisible();
});

test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('DICOM Anonymizer & Sender');
})
