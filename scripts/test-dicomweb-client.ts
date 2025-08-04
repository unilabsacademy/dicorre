#!/usr/bin/env node
// Test script to debug DICOMweb client configuration

import { api } from 'dicomweb-client'
const { DICOMwebClient } = api
import fs from 'fs/promises'
import path from 'path'

async function testDICOMwebClient() {
  console.log('Testing DICOMweb client configuration...\n')

  // Test 1: Base URL without /dicom-web
  console.log('Test 1: URL without /dicom-web')
  const client1 = new DICOMwebClient({
    url: 'http://localhost:8080',
    singlepart: false
  })
  console.log('Client 1 baseURL:', (client1 as any).baseURL)
  console.log('Client 1 qidoURL:', (client1 as any).qidoURL)
  console.log('Client 1 wadoURL:', (client1 as any).wadoURL)
  console.log('Client 1 stowURL:', (client1 as any).stowURL)

  // Test 2: Base URL with /dicom-web
  console.log('\nTest 2: URL with /dicom-web')
  const client2 = new DICOMwebClient({
    url: 'http://localhost:8080/dicom-web',
    singlepart: false
  })
  console.log('Client 2 baseURL:', (client2 as any).baseURL)
  console.log('Client 2 qidoURL:', (client2 as any).qidoURL)
  console.log('Client 2 wadoURL:', (client2 as any).wadoURL)
  console.log('Client 2 stowURL:', (client2 as any).stowURL)

  // Test 3: Try to send a minimal DICOM file
  console.log('\nTest 3: Sending minimal DICOM...')
  try {
    // Read a real DICOM file
    const dicomPath = path.join(process.cwd(), 'test-data/CASES/Caso1/DICOM/0000042D/AA4B9094/AAAB4A82/00002C50/EE0BF3EC')
    const dicomBuffer = await fs.readFile(dicomPath)
    const uint8Array = new Uint8Array(dicomBuffer)
    
    console.log('DICOM file size:', uint8Array.length, 'bytes')
    
    // Try with client2 (includes /dicom-web)
    const result = await client2.storeInstances({
      datasets: [uint8Array]
    })
    
    console.log('Success! Result:', result)
  } catch (error) {
    console.error('Error:', error.message)
    if (error.response) {
      console.error('Response status:', error.response.status)
      console.error('Response data:', error.response.data)
    }
  }
}

testDICOMwebClient().catch(console.error)