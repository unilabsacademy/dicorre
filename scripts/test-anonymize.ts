#!/usr/bin/env -S npx tsx
import { 
  DicomDeidentifier, 
  BasicProfile, 
  CleanDescOption,
  CleanGraphOption,
  RetainDeviceIdentOption 
} from '@umessen/dicom-deidentifier'
import * as fs from 'fs'
import * as path from 'path'
import * as dcmjs from 'dcmjs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dicomFilePath = path.join(__dirname, '../test-data/IM-0001-0001.dcm')

async function testAnonymization() {
  console.log('Testing anonymization with:', dicomFilePath)
  
  try {
    // Read the DICOM file
    const fileBuffer = fs.readFileSync(dicomFilePath)
    const uint8Array = new Uint8Array(fileBuffer)
    console.log(`File size: ${uint8Array.length} bytes`)
    
    // First, let's parse it with dcmjs to see what we're dealing with
    console.log('\n1. Parsing with dcmjs to inspect structure...')
    try {
      const dicomData = dcmjs.data.DicomMessage.readFile(uint8Array.buffer)
      const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
      console.log('Successfully parsed with dcmjs')
      console.log('Patient Name:', dataset.PatientName)
      console.log('Patient ID:', dataset.PatientID)
      console.log('Number of elements:', Object.keys(dicomData.dict).length)
      
      // Check date fields
      console.log('\nDate fields:')
      console.log('StudyDate:', dataset.StudyDate || 'MISSING')
      console.log('SeriesDate:', dataset.SeriesDate || 'MISSING')
      console.log('AcquisitionDate:', dataset.AcquisitionDate || 'MISSING')
      console.log('ContentDate:', dataset.ContentDate || 'MISSING')
      console.log('PatientBirthDate:', dataset.PatientBirthDate || 'MISSING')
      
      // Check if required tags exist in dict
      console.log('\nChecking dict for date tags:')
      console.log('00080020 (StudyDate):', dicomData.dict['00080020'] ? 'Present' : 'MISSING')
      console.log('00080021 (SeriesDate):', dicomData.dict['00080021'] ? 'Present' : 'MISSING')
      console.log('00080022 (AcquisitionDate):', dicomData.dict['00080022'] ? 'Present' : 'MISSING')
      console.log('00080023 (ContentDate):', dicomData.dict['00080023'] ? 'Present' : 'MISSING')
      console.log('00100030 (PatientBirthDate):', dicomData.dict['00100030'] ? 'Present' : 'MISSING')
      
      // Count private tags
      const privateTags = Object.keys(dicomData.dict).filter(tag => {
        const tagNum = parseInt(tag, 16)
        const group = (tagNum >> 16) & 0xFFFF
        return group & 0x0001
      })
      console.log('Private tags count:', privateTags.length)
    } catch (parseError) {
      console.error('Error parsing with dcmjs:', parseError)
    }
    
    // Now try anonymization with default config
    console.log('\n2. Testing anonymization with basic config...')
    const config = {
      profileOptions: [BasicProfile, CleanDescOption, CleanGraphOption],
      dummies: {
        default: 'REMOVED',
        lookup: {
          '00100010': 'ANONYMOUS',  // Patient Name
          '00100020': 'ANON001',    // Patient ID
        }
      }
    }
    
    try {
      const deidentifier = new DicomDeidentifier(config)
      console.log('Created deidentifier successfully')
      
      const result = deidentifier.deidentify(uint8Array)
      console.log('✅ Anonymization succeeded!')
      console.log('Result size:', result.length)
      
      // Save the result
      const outputPath = path.join(path.dirname(dicomFilePath), 'anonymized_test.dcm')
      fs.writeFileSync(outputPath, result)
      console.log('Saved to:', outputPath)
      
    } catch (error: any) {
      console.error('❌ Anonymization failed:', error.message)
      console.error('Stack trace:', error.stack)
      
      // Try to identify which tag caused the issue
      if (error.message?.includes('Cannot read properties of undefined')) {
        console.log('\n3. This looks like the undefined Value error. Testing with minimal config...')
        
        // Try with absolutely minimal config
        const minimalConfig = {
          profileOptions: [BasicProfile],
          dummies: {
            default: 'REMOVED'
          }
        }
        
        try {
          const minimalDeidentifier = new DicomDeidentifier(minimalConfig)
          const minimalResult = minimalDeidentifier.deidentify(uint8Array)
          console.log('✅ Minimal anonymization succeeded!')
        } catch (minimalError: any) {
          console.error('❌ Even minimal config failed:', minimalError.message)
          
          // Let's try removing private tags first
          console.log('\n4. Attempting to remove private tags before anonymization...')
          await testWithPrivateTagsRemoved(uint8Array)
        }
      }
    }
    
  } catch (error) {
    console.error('Fatal error:', error)
  }
}

async function testWithPrivateTagsRemoved(uint8Array: Uint8Array) {
  try {
    // Parse the DICOM
    const dicomData = dcmjs.data.DicomMessage.readFile(uint8Array.buffer)
    
    // Remove private tags
    const cleanedDict: any = {}
    let removedCount = 0
    
    for (const [tag, value] of Object.entries(dicomData.dict)) {
      const tagNum = parseInt(tag, 16)
      const group = (tagNum >> 16) & 0xFFFF
      
      if (!(group & 0x0001)) {
        // Not a private tag, keep it
        cleanedDict[tag] = value
      } else {
        removedCount++
      }
    }
    
    console.log(`Removed ${removedCount} private tags`)
    
    // Create new DICOM with cleaned dictionary
    const cleanedDicom = new dcmjs.data.DicomMessage(cleanedDict)
    const cleanedBuffer = cleanedDicom.write()
    const cleanedUint8Array = new Uint8Array(cleanedBuffer)
    
    // Try anonymization on cleaned file
    console.log('Testing anonymization on cleaned file...')
    const config = {
      profileOptions: [BasicProfile, CleanDescOption, CleanGraphOption],
      dummies: {
        default: 'REMOVED',
        lookup: {
          '00100010': 'ANONYMOUS',
          '00100020': 'ANON001',
        }
      }
    }
    
    const deidentifier = new DicomDeidentifier(config)
    const result = deidentifier.deidentify(cleanedUint8Array)
    console.log('✅ Anonymization succeeded after removing private tags!')
    
    // Save both files
    const cleanedPath = path.join(path.dirname(dicomFilePath), 'cleaned_no_private.dcm')
    const anonymizedPath = path.join(path.dirname(dicomFilePath), 'anonymized_no_private.dcm')
    
    fs.writeFileSync(cleanedPath, cleanedUint8Array)
    fs.writeFileSync(anonymizedPath, result)
    
    console.log('Saved cleaned file to:', cleanedPath)
    console.log('Saved anonymized file to:', anonymizedPath)
    
  } catch (error: any) {
    console.error('Error in private tag removal test:', error.message)
  }
}

// Run the test
testAnonymization().catch(console.error)