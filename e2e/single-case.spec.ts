import { test, expect } from '@playwright/test';
import path from 'path';

test('uploads single case zip file and checks correct grouping', async ({ page }) => {
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

  // Upload the single case test zip file
  const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip');
  await page.getByTestId('file-input').setInputFiles(testZipPath);

  // Wait for file processing (extraction + parsing)
  await page.waitForTimeout(3000);

  // Check if files were extracted from the ZIP at all
  const filesCountBadge = page.getByTestId('files-count-badge');
  const isBadgeVisible = await filesCountBadge.isVisible();
  console.log('Files count badge visible:', isBadgeVisible);
  
  if (isBadgeVisible) {
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    console.log(`Files extracted: ${fileCount}`);
    expect(fileCount).toBeGreaterThan(0); // At least some files should be extracted
  } else {
    console.log('Files count badge not visible - checking for error messages');
    // Check for any error messages or console logs
    const consoleMessages = await page.evaluate(() => {
      return window.console ? 'Console available' : 'No console';
    });
    console.log('Console status:', consoleMessages);
    
    // Fail the test if no files are loaded
    expect(isBadgeVisible).toBe(true);
  }

  // Anonymized count should be 0 before manual anonymization
  const anonymizedCountBeforeText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCountBefore = parseInt(anonymizedCountBeforeText?.match(/(\d+)/)?.[1] || '0');
  expect(anonymizedCountBefore).toBe(0);

  // Wait for studies table to appear
  await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

  // Wait a moment for table to fully render
  await page.waitForTimeout(1000);

  // Select the study by clicking its checkbox (skip header checkbox at index 0)
  const studyCheckboxes = page.getByRole('checkbox');
  await studyCheckboxes.nth(1).click(); // Click the first (and only) study checkbox

  // Wait for selection to propagate
  await page.waitForTimeout(500);

  // Verify that studies are selected - button should now show "Anonymize (1)" for 1 study
  const anonymizeButton = page.getByTestId('anonymize-button');
  await expect(anonymizeButton).toContainText('Anonymize (1)', { timeout: 5000 });
  await expect(anonymizeButton).toBeEnabled();

  // Click anonymize button
  console.log('Clicking anonymize button');
  await anonymizeButton.click();
  
  // Wait for anonymization to complete - monitor button state and progress
  console.log('Waiting for anonymization to complete...');
  
  // First, wait for button to change from "Anonymize (1)" to indicate processing started
  await page.waitForTimeout(2000); // Give worker time to start
  
  // Check if button text changed to indicate processing
  let buttonText = await anonymizeButton.textContent();
  console.log('Button text after 2s:', buttonText);
  
  // Wait for completion - either button disabled or anonymized count increases
  let attempts = 0;
  while (attempts < 15) { // 15 attempts = 30 seconds
    const currentAnonymizedText = await page.getByTestId('anonymized-count-badge').textContent();
    const currentAnonymized = parseInt(currentAnonymizedText?.match(/(\d+)/)?.[1] || '0');
    
    buttonText = await anonymizeButton.textContent();
    const isDisabled = !(await anonymizeButton.isEnabled());
    
    console.log(`Attempt ${attempts + 1}: Anonymized=${currentAnonymized}, Button="${buttonText}", Disabled=${isDisabled}`);
    
    if (currentAnonymized > 0 || isDisabled) {
      console.log('Anonymization progress detected!');
      break;
    }
    
    await page.waitForTimeout(2000);
    attempts++;
  }
  
  // Final check - ensure button is disabled (indicating completion)
  await expect(anonymizeButton).toBeDisabled({ timeout: 10000 });

  // Verify files were anonymized (count should match original file count)
  const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
  const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
  
  // Get the current file count for comparison
  const currentFilesCountText = await page.getByTestId('files-count-badge').textContent();
  const currentFileCount = parseInt(currentFilesCountText?.match(/(\d+)/)?.[1] || '0');
  
  console.log(`Anonymized: ${anonymizedCount}, Total: ${currentFileCount}`);
  // Final verification: all files should be anonymized
  if (anonymizedCount === 0) {
    console.log('ERROR: No files were anonymized after waiting!');
    console.log('Final console messages:', consoleMessages.slice(-10));
    
    // Try to get more debug info
    const finalButtonText = await anonymizeButton.textContent();
    console.log('Final button text:', finalButtonText);
    
    // Check button state
    const isStillEnabled = await anonymizeButton.isEnabled();
    console.log('Button still enabled:', isStillEnabled);
  } else {
    console.log(`SUCCESS: ${anonymizedCount} files anonymized!`);
  }
  
  expect(anonymizedCount).toBe(currentFileCount); // All files should be anonymized

  // Verify exactly 1 study (one patient)
  const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
  expect(studiesCount).toBe(1);

  // Verify studies table is displayed
  await expect(page.getByTestId('studies-table-card')).toBeVisible({ timeout: 5000 });

  console.log(`Single case: ${currentFileCount} files anonymized into ${studiesCount} study`);
  console.log('Console messages during test:', consoleMessages.slice(-10)); // Last 10 messages
});
