import { test, expect } from '@playwright/test'
import path from 'path'

/**
 * This test verifies that local state (including uploaded files metadata) is
 * persisted using localStorage + OPFS so that the UI is restored after a page
 * reload. We purposely do NOT trigger anonymization – only the initial upload
 * workflow is required for the persistence check.
 */

test('persists uploaded files and UI state across page reload', async ({ page }) => {
  // Step 1: Load the app
  await page.goto('/')

  // Upload a small test ZIP (6 DICOM files, 1 study)
  const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
  await page.getByTestId('file-input').setInputFiles(testZipPath)

  // Wait for initial processing to finish – the toolbar should appear
  await expect(page.getByTestId('toolbar')).toBeVisible({ timeout: 15000 })

  // Capture the displayed file count so we can compare after reload
  const filesCountText = await page.getByTestId('files-count-badge').textContent()
  const initialFileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0')
  expect(initialFileCount).toBe(6)

  // Reload the page (simulates user refresh)
  await page.reload()

  // After reload, the application should restore previous session automatically
  // Wait for toolbar to re-appear indicating restoration finished
  await expect(page.getByTestId('toolbar')).toBeVisible({ timeout: 15000 })

  // Verify that the file count is the same as before the reload
  const filesCountTextAfter = await page.getByTestId('files-count-badge').textContent()
  const fileCountAfter = parseInt(filesCountTextAfter?.match(/(\d+)/)?.[1] || '0')
  expect(fileCountAfter).toBe(initialFileCount)

  // Optional: verify studies count badge is also restored
  const studiesCountText = await page.getByTestId('studies-count-badge').textContent()
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0')
  expect(studiesCount).toBe(1)
})
