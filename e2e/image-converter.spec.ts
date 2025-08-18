import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Image Converter Plugin', () => {
  test('converts JPG images to DICOM files', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('clear-all-button').click();

    // Upload JPG test images
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/blue-rectangle.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/gradient.jpg')
    ];
    await page.getByTestId('file-input').setInputFiles(testImagePaths);

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

    // Check that the converted files appear in the studies table
    const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
    const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(studiesCount).toBe(3);
  });

  test('converts PNG images to DICOM files', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('clear-all-button').click();

    // Upload PNG test images
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/purple-square.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/orange-banner.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/radial-gradient.png')
    ];
    await page.getByTestId('file-input').setInputFiles(testImagePaths);

    // Wait for file processing progress card to disappear
    const processingCard = page.getByTestId('file-processing-progress-card');
    await expect(processingCard).toBeHidden({ timeout: 10000 });

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();

    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(3);

    // Should convert 3 PNG files to DICOM// Verify studies table appears
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 });

    // Check that the converted files appear in the studies table
    const studiesCountText = await page.getByTestId('studies-count-badge').textContent();
    const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(studiesCount).toBe(3);
  });

  test('converts mixed image formats and anonymizes them', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('clear-all-button').click();

    // Upload mixed image formats (2 JPG + 2 PNG)
    const testImagePaths = [
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/red-square.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/gradient.jpg'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/purple-square.png'),
      path.join(process.cwd(), 'src/plugins/imageConverter/test-data/radial-gradient.png')
    ];

    await page.getByTestId('file-input').setInputFiles(testImagePaths);

    // Wait for file processing progress card to disappear
    const processingCard = page.getByTestId('file-processing-progress-card');
    await expect(processingCard).toBeHidden({ timeout: 10000 });

    // Check if files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    await expect(filesCountBadge).toBeVisible();

    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(4);

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

    expect(anonymizedCount).toBe(4);
  });

  test('rejects unsupported file formats', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('clear-all-button').click();

    // Try to upload a text file (should be rejected)
    const testFilePath = path.join(process.cwd(), 'package.json'); // Use an existing non-image file
    await page.getByTestId('file-input').setInputFiles([testFilePath]);

    // Check that no files were processed
    const filesCountBadge = page.getByTestId('files-count-badge');
    const filesCountText = await filesCountBadge.textContent();
    const fileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0');
    expect(fileCount).toBe(0);
  });
});
