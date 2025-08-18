import { test, expect } from '@playwright/test'
import path from 'path'

test('persists uploaded files and UI state across page reload', async ({ page }) => {
  await page.goto('/')

  const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
  await page.getByTestId('file-input').setInputFiles(testZipPath)

  const processingCard = page.getByTestId('file-processing-progress-card')
  await expect(processingCard).toBeHidden({ timeout: 10000 })
  
  await expect(page.getByTestId('toolbar')).toBeVisible({ timeout: 15000 })

  const filesCountText = await page.getByTestId('files-count-badge').textContent()
  const initialFileCount = parseInt(filesCountText?.match(/(\d+)/)?.[1] || '0')
  expect(initialFileCount).toBe(6)

  await page.reload()

  await expect(page.getByTestId('toolbar')).toBeVisible({ timeout: 15000 })
  
  await page.waitForFunction(
    (expectedCount) => {
      const badge = document.querySelector('[data-testid="files-count-badge"]')
      if (!badge || !badge.textContent) return false
      const count = parseInt(badge.textContent.match(/(\d+)/)?.[1] || '0')
      return count === expectedCount
    },
    initialFileCount,
    { timeout: 10000 }
  )

  const filesCountTextAfter = await page.getByTestId('files-count-badge').textContent()
  const fileCountAfter = parseInt(filesCountTextAfter?.match(/(\d+)/)?.[1] || '0')
  expect(fileCountAfter).toBe(initialFileCount)

  const studiesCountText = await page.getByTestId('studies-count-badge').textContent()
  const studiesCount = parseInt(studiesCountText?.match(/(\d+)/)?.[1] || '0')
  expect(studiesCount).toBe(1)
})
