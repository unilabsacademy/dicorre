import { test, expect } from '@playwright/test'
import path from 'path'

// This test uses the real Orthanc server running on localhost:8080
test.describe('DICOM Sending with Real Orthanc Server', () => {

  test('send DICOM files to real Orthanc server', async ({ page }) => {
    // Enable console logging to capture errors
    page.on('console', msg => {
      console.log(`Browser console [${msg.type()}]:`, msg.text())
    })
    
    // Log network failures
    page.on('requestfailed', request => {
      console.log(`Request failed: ${request.url()} - ${request.failure()?.errorText}`)
    })

    // Log network requests to DICOM server
    page.on('request', request => {
      if (request.url().includes('orthanc') || request.url().includes('studies')) {
        console.log(`Request: ${request.method()} ${request.url()}`)
      }
    })

    page.on('response', response => {
      if (response.url().includes('orthanc') || response.url().includes('studies')) {
        console.log(`Response: ${response.status()} ${response.url()}`)
      }
    })

    await page.goto('/')
    await expect(page.getByTestId('app-title')).toHaveText('DICOM Anonymizer & Sender')

    // First test the connection
    console.log('Testing connection to Orthanc...')
    await page.getByTestId('settings-menu-button').click()
    await page.getByTestId('test-connection-menu-item').click()
    await page.waitForTimeout(2000)

    // Upload test ZIP file with real DICOM files
    console.log('Uploading test DICOM files...')
    const testZipPath = path.join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
    await page.getByTestId('file-input').setInputFiles(testZipPath)

    // Wait for processing and verify files loaded
    await expect(page.getByTestId('files-count-badge')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('studies-data-table')).toBeVisible()

    // Get file count
    const filesCountText = await page.getByTestId('files-count-badge').textContent()
    console.log('Files loaded:', filesCountText)

    // Select first study
    console.log('Selecting study for anonymization...')
    const studyCheckboxes = page.getByRole('checkbox')
    await studyCheckboxes.nth(1).click()

    // Anonymize study
    console.log('Starting anonymization...')
    const anonymizeButton = page.getByTestId('anonymize-button')
    await expect(anonymizeButton).toBeEnabled()
    await anonymizeButton.click()

    // Wait for anonymization to complete
    await page.waitForTimeout(5000)

    // Check anonymized count
    const anonymizedCountText = await page.getByTestId('anonymized-count-badge').textContent()
    console.log('Anonymized files:', anonymizedCountText)

    // After anonymization, the study gets a new ID, so we need to find and select it again
    console.log('Selecting anonymized study for sending...')
    // Wait for the anonymized study to appear
    await page.waitForTimeout(2000)
    
    // Get all checkboxes again (the anonymized study will be a new one)
    const allCheckboxes = page.getByRole('checkbox')
    const checkboxCount = await allCheckboxes.count()
    console.log('Total checkboxes after anonymization:', checkboxCount)
    
    // Find and select the anonymized study (usually it's still the first non-header checkbox)
    if (checkboxCount > 1) {
      // Force click the checkbox
      await allCheckboxes.nth(1).click({ force: true })
      await page.waitForTimeout(1000)
      
      // Verify it's checked, if not try again
      let isChecked = await allCheckboxes.nth(1).isChecked()
      if (!isChecked) {
        console.log('First click failed, trying again...')
        await allCheckboxes.nth(1).check({ force: true })
        await page.waitForTimeout(500)
        isChecked = await allCheckboxes.nth(1).isChecked()
      }
      
      console.log('Anonymized study selected:', isChecked)
      
      // Debug: check all checkbox states
      for (let i = 0; i < checkboxCount; i++) {
        const checked = await allCheckboxes.nth(i).isChecked()
        console.log(`Checkbox ${i} checked:`, checked)
      }
    } else {
      console.error('No studies found after anonymization!')
    }

    // Check send button state
    const sendButton = page.getByTestId('send-button')
    const isEnabled = await sendButton.isEnabled()
    console.log('Send button enabled:', isEnabled)

    if (!isEnabled) {
      console.log('Send button disabled - checking why...')
      // Try to understand why it's disabled
      const selectedCount = await page.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked')
        return checkboxes.length
      })
      console.log('Selected checkboxes:', selectedCount)
    }

    // Try to send
    console.log('Attempting to send to Orthanc...')
    await expect(sendButton).toBeEnabled({ timeout: 10000 })
    await sendButton.click()

    // Wait for sending to complete and capture any errors
    await page.waitForTimeout(10000)

    // Check if files were sent successfully by querying Orthanc
    console.log('Checking Orthanc for uploaded studies...')
    const response = await page.request.get('http://localhost:5173/api/orthanc/studies')
    const studies = await response.json()
    console.log('Studies in Orthanc:', studies.length)

    // Expect at least one study to be uploaded
    expect(studies.length).toBeGreaterThan(0)
  })

  test('debug STOW-RS endpoint directly', async ({ page }) => {
    await page.goto('/')
    
    // Test the STOW-RS endpoint directly
    console.log('Testing STOW-RS endpoint directly...')
    
    // Check if the endpoint is accessible
    const getResponse = await page.request.get('http://localhost:5173/api/orthanc/dicom-web/studies')
    console.log('GET /dicom-web/studies status:', getResponse.status())
    console.log('GET /dicom-web/studies body:', await getResponse.text())
    
    // Try POST with empty multipart
    console.log('\nTesting POST to STOW-RS endpoint...')
    try {
      const postResponse = await page.request.post('http://localhost:5173/api/orthanc/dicom-web/studies', {
        headers: {
          'Content-Type': 'multipart/related; type="application/dicom"; boundary=boundary123'
        },
        data: '--boundary123\r\nContent-Type: application/dicom\r\n\r\n\r\n--boundary123--'
      })
      console.log('POST /dicom-web/studies status:', postResponse.status())
      console.log('POST /dicom-web/studies body:', await postResponse.text())
    } catch (error) {
      console.error('POST error:', error.message)
    }
    
    // Test from browser context
    const browserResponse = await page.evaluate(async () => {
      try {
        // Try simpler POST first
        const response = await fetch('/api/orthanc/dicom-web/studies', {
          method: 'POST',
          headers: {
            'Content-Type': 'multipart/related; type="application/dicom"; boundary=boundary123'
          },
          body: '--boundary123\r\nContent-Type: application/dicom\r\n\r\n\r\n--boundary123--'
        })
        
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text()
        }
      } catch (error) {
        return {
          error: error.message,
          name: error.name,
          stack: error.stack
        }
      }
    })
    
    console.log('\nBrowser fetch result:', JSON.stringify(browserResponse, null, 2))
  })

})