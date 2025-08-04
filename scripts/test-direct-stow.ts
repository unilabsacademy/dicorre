#!/usr/bin/env node
// Test direct STOW-RS implementation

import fs from 'fs/promises'
import path from 'path'

async function testDirectSTOW() {
  console.log('Testing direct STOW-RS implementation...\n')

  try {
    // Read a real DICOM file
    const dicomPath = path.join(process.cwd(), 'test-data/CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
    const dicomBuffer = await fs.readFile(dicomPath)
    
    console.log('DICOM file size:', dicomBuffer.length, 'bytes')
    
    // Create multipart boundary
    const boundary = 'boundary_' + Date.now()
    
    // Create multipart body
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/dicom',
      'Content-Transfer-Encoding: binary',
      '',
    ].join('\r\n') + '\r\n'
    
    // Combine text and binary parts
    const textPart = Buffer.from(multipartBody, 'utf8')
    const endBoundary = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    
    const finalBody = Buffer.concat([textPart, dicomBuffer, endBoundary])
    
    console.log('Multipart body size:', finalBody.length, 'bytes')
    console.log('Content-Type:', `multipart/related; type="application/dicom"; boundary=${boundary}`)
    
    // Test with fetch
    const response = await fetch('http://localhost:8080/dicom-web/studies', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; type="application/dicom"; boundary=${boundary}`,
        'Accept': 'application/dicom+json'
      },
      body: finalBody
    })
    
    console.log('Response status:', response.status)
    console.log('Response headers:', Object.fromEntries(response.headers.entries()))
    
    const responseText = await response.text()
    console.log('Response body:', responseText)
    
    if (response.ok) {
      console.log('\n✅ Success! DICOM file uploaded successfully')
      
      // Check if it was actually stored
      const studiesResponse = await fetch('http://localhost:8080/dicom-web/studies')
      const studies = await studiesResponse.json()
      console.log('Studies now in server:', studies.length)
    } else {
      console.log('\n❌ Failed to upload DICOM file')
    }
    
  } catch (error) {
    console.error('Error:', error.message)
  }
}

testDirectSTOW().catch(console.error)