import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('Download Functionality', () => {
  test('should download selected studies as ZIP file', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')
    
    // Wait for the app to be ready
    await expect(page.getByTestId('drop-zone-text')).toBeVisible()
    
    // Upload test ZIP file
    const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    await page.getByTestId('file-input').setInputFiles(testZipPath)
    
    // Wait for file processing to complete
    const processingCard = page.getByTestId('file-processing-progress-card')
    await expect(processingCard).toBeHidden({ timeout: 10000 })
    
    // Verify files are loaded
    await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })
    
    // Initially download button should be disabled (no studies selected)
    const downloadButton = page.getByTestId('download-button')
    await expect(downloadButton).toBeVisible()
    await expect(downloadButton).toBeDisabled()
    
    // Select studies by checking checkboxes
    const studyCheckboxes = page.getByRole('checkbox')
    const checkboxCount = await studyCheckboxes.count()
    
    // Select at least one study (skip the header checkbox at index 0)
    for (let i = 1; i < Math.min(checkboxCount, 3); i++) {
      await studyCheckboxes.nth(i).check()
    }
    
    // Verify download button is now enabled
    await expect(downloadButton).toBeEnabled()
    
    // Verify selected count is shown in button text
    const buttonText = await downloadButton.textContent()
    expect(buttonText).toMatch(/Download \(\d+\)/)
    
    // Start download and wait for the download to be triggered
    const downloadPromise = page.waitForEvent('download')
    await downloadButton.click()
    
    // Wait for download to start
    const download = await downloadPromise
    
    // Verify download filename follows expected pattern
    const filename = download.suggestedFilename()
    expect(filename).toMatch(/DICOM_Studies?_\d+_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.zip/)
    
    // Verify download is a ZIP file
    expect(filename).toContain('.zip')
    
    // Save download to verify it's not empty
    const downloadPath = path.join('/tmp', filename)
    await download.saveAs(downloadPath)
    
    // Verify the downloaded file exists and has content
    const fs = await import('fs')
    const stats = fs.statSync(downloadPath)
    expect(stats.size).toBeGreaterThan(0)
    
    // Clean up
    fs.unlinkSync(downloadPath)
  })

  test('should show correct button states during download', async ({ page }) => {
    await page.goto('/')
    
    // Upload and wait for processing
    const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    await page.getByTestId('file-input').setInputFiles(testZipPath)
    
    const processingCard = page.getByTestId('file-processing-progress-card')
    await expect(processingCard).toBeHidden({ timeout: 10000 })
    
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })
    
    // Select a study
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()
    
    const downloadButton = page.getByTestId('download-button')
    await expect(downloadButton).toBeEnabled()
    
    // Start download
    const downloadPromise = page.waitForEvent('download')
    await downloadButton.click()
    
    // During download, button should be disabled
    await expect(downloadButton).toBeDisabled()
    
    // Wait for download to complete
    await downloadPromise
    
    // After download, button should be enabled again
    await expect(downloadButton).toBeEnabled()
  })

  test('should handle single study download with correct filename', async ({ page }) => {
    await page.goto('/')
    
    // Upload test data
    const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    await page.getByTestId('file-input').setInputFiles(testZipPath)
    
    const processingCard = page.getByTestId('file-processing-progress-card')
    await expect(processingCard).toBeHidden({ timeout: 10000 })
    
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })
    
    // Select only one study
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()
    
    // Verify button shows single study count
    const downloadButton = page.getByTestId('download-button')
    const buttonText = await downloadButton.textContent()
    expect(buttonText).toContain('Download (1)')
    
    // Start download
    const downloadPromise = page.waitForEvent('download')
    await downloadButton.click()
    
    const download = await downloadPromise
    
    // For single study, filename should include patient ID pattern
    const filename = download.suggestedFilename()
    expect(filename).toMatch(/DICOM_Study_.*_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.zip/)
  })

  test('should show no studies selected warning', async ({ page }) => {
    await page.goto('/')
    
    // Upload test data
    const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    await page.getByTestId('file-input').setInputFiles(testZipPath)
    
    const processingCard = page.getByTestId('file-processing-progress-card')
    await expect(processingCard).toBeHidden({ timeout: 10000 })
    
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })
    
    // Don't select any studies - download button should be disabled
    const downloadButton = page.getByTestId('download-button')
    await expect(downloadButton).toBeDisabled()
    
    // Button text should show 0 selected
    const buttonText = await downloadButton.textContent()
    expect(buttonText).toContain('Download (0)')
  })

  test('should work with anonymized studies', async ({ page }) => {
    await page.goto('/')
    
    // Upload test data
    const testZipPath = path.join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    await page.getByTestId('file-input').setInputFiles(testZipPath)
    
    const processingCard = page.getByTestId('file-processing-progress-card')
    await expect(processingCard).toBeHidden({ timeout: 10000 })
    
    await expect(page.getByTestId('studies-data-table')).toBeVisible({ timeout: 10000 })
    
    // Select studies
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).check()
    
    // Anonymize selected studies first
    const anonymizeButton = page.getByTestId('anonymize-button')
    await anonymizeButton.click()
    
    // Wait for anonymization to complete
    await expect(page.getByTestId('anonymized-count-badge')).toContainText(/[1-9]/, { timeout: 30000 })
    
    // Re-select studies after anonymization (they get deselected after anonymization)
    const studyCheckboxesAfter = page.getByRole('checkbox')
    await studyCheckboxesAfter.nth(1).check()
    
    // Now download the anonymized studies
    const downloadButton = page.getByTestId('download-button')
    await expect(downloadButton).toBeEnabled()
    
    const downloadPromise = page.waitForEvent('download')
    await downloadButton.click()
    
    const download = await downloadPromise
    
    // Verify download works with anonymized data
    expect(download.suggestedFilename()).toContain('.zip')
  })
})