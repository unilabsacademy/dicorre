import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Image Converter Plugin', () => {
  test('converts JPG images to DICOM files', async ({ page }) => {
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

    // Upload JPG test images
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/blue-rectangle.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/gradient.jpg')
    ];

    await page.getByTestId('file-input').setInputFiles(testImagePaths);

    // Wait for file processing with longer timeout
    await page.waitForTimeout(5000);

    // Debug: Check console messages
    console.log('Console messages during file upload:');
    consoleMessages.forEach(msg => console.log(`  ${msg}`));

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    const isBadgeVisible = await filesCountBadge.isVisible();
    
    if (isBadgeVisible) {
      const filesCountText = await filesCountBadge.textContent();
      const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
      console.log(`JPG files converted: ${fileCount}`);
      expect(fileCount).toBe(3); // Should convert 3 JPG files to DICOM

      // Verify studies table appears
      await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

      // Check that the converted files appear in the studies table
      const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
      const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
      console.log(`Studies created from JPG images: ${studiesCount}`);
      expect(studiesCount).toBeGreaterThan(0); // Should create at least one study

      console.log('JPG conversion test completed successfully');
    } else {
      console.log('Files count badge not visible - files may not have been processed');
      console.log('Final console messages:', consoleMessages.slice(-10));
      throw new Error('No files were processed - check console messages for errors');
    }
  });

  test('converts PNG images to DICOM files', async ({ page }) => {
    // Capture console messages for debugging
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Upload PNG test images
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/purple-square.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/orange-banner.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/radial-gradient.png')
    ];

    await page.getByTestId('file-input').setInputFiles(testImagePaths);

    // Wait for file processing
    await page.waitForTimeout(3000);

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();
    
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    console.log(`PNG files converted: ${fileCount}`);
    expect(fileCount).toBe(3); // Should convert 3 PNG files to DICOM

    // Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that the converted files appear in the studies table
    const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
    const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
    console.log(`Studies created from PNG images: ${studiesCount}`);
    expect(studiesCount).toBeGreaterThan(0); // Should create at least one study

    console.log('PNG conversion test completed successfully');
  });

  test('converts mixed image formats and anonymizes them', async ({ page }) => {
    // Capture console messages for debugging
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Upload mixed image formats (2 JPG + 2 PNG)
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/gradient.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/purple-square.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/radial-gradient.png')
    ];

    await page.getByTestId('file-input').setInputFiles(testImagePaths);

    // Wait for file processing
    await page.waitForTimeout(3000);

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();
    
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    console.log(`Mixed image files converted: ${fileCount}`);
    expect(fileCount).toBe(4); // Should convert 4 images to DICOM

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
    console.log('Clicking anonymize button for converted images');
    await anonymizeButton.click();
    
    // Wait for anonymization to complete
    await expect(anonymizeButton).toBeDisabled({ timeout: 15000 });

    // Verify files were anonymized
    const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent();
    const anonymizedCount = parseInt(anonymizedCountText?.match(/(\d+)/)?.[1] || '0');
    
    console.log(`Converted images anonymized: ${anonymizedCount} out of ${fileCount}`);
    expect(anonymizedCount).toBe(fileCount); // All converted images should be anonymized

    console.log('Mixed format conversion and anonymization test completed successfully');
  });

  test('rejects unsupported file formats', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Check that the app loaded correctly
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender');

    // Try to upload a text file (should be rejected)
    const testFilePath = path.join(process.cwd(), 'package.json'); // Use an existing non-image file
    await page.getByTestId('file-input').setInputFiles([testFilePath]);

    // Wait a moment
    await page.waitForTimeout(2000);

    // Check that no files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    const isVisible = await filesCountBadge.isVisible();
    
    if (isVisible) {
      const filesCountText = await filesCountBadge.textContent();
      const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
      expect(fileCount).toBe(0); // Should not process non-image files
    }

    console.log('Unsupported file format rejection test completed successfully');
  });
});