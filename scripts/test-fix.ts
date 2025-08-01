#!/usr/bin/env -S npx tsx
import { 
  DicomDeidentifier, 
  BasicProfile, 
  CleanDescOption,
  CleanGraphOption
} from '@umessen/dicom-deidentifier'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dicomFilePath = path.join(__dirname, '../test-data/IM-0001-0001.dcm')

async function testFix() {
  console.log('Testing the anonymization fix with:', dicomFilePath)
  
  try {
    // Read the DICOM file
    const fileBuffer = fs.readFileSync(dicomFilePath)
    const uint8Array = new Uint8Array(fileBuffer)
    console.log(`File size: ${uint8Array.length} bytes`)
    
    // Create deidentifier with custom getReferenceDate and getReferenceTime functions
    const config = {
      profileOptions: [BasicProfile, CleanDescOption, CleanGraphOption],
      dummies: {
        default: 'REMOVED',
        lookup: {
          '00100010': 'ANONYMOUS',  // Patient Name
          '00100020': 'ANON001',    // Patient ID
        }
      },
      getReferenceDate: (dictionary: any) => {
        // Try to find a suitable reference date
        const studyDate = dictionary['00080020']?.Value?.[0]
        const acquisitionDate = dictionary['00080022']?.Value?.[0] 
        const contentDate = dictionary['00080023']?.Value?.[0]
        const patientBirthDate = dictionary['00100030']?.Value?.[0]
        
        console.log('Available dates:', { studyDate, acquisitionDate, contentDate, patientBirthDate })
        
        if (patientBirthDate) {
          const year = parseInt(patientBirthDate.substring(0, 4))
          const month = parseInt(patientBirthDate.substring(4, 6)) - 1 
          const day = parseInt(patientBirthDate.substring(6, 8))
          console.log('Using PatientBirthDate as reference:', patientBirthDate)
          return new Date(year, month, day)
        } else if (acquisitionDate) {
          const year = parseInt(acquisitionDate.substring(0, 4))
          const month = parseInt(acquisitionDate.substring(4, 6)) - 1
          const day = parseInt(acquisitionDate.substring(6, 8))
          console.log('Using AcquisitionDate as reference:', acquisitionDate)
          return new Date(year, month, day)
        } else if (contentDate) {
          const year = parseInt(contentDate.substring(0, 4))
          const month = parseInt(contentDate.substring(4, 6)) - 1  
          const day = parseInt(contentDate.substring(6, 8))
          console.log('Using ContentDate as reference:', contentDate)
          return new Date(year, month, day)
        } else {
          console.log('Using fallback date: 1970-01-01')
          return new Date('1970-01-01')
        }
      },
      getReferenceTime: (dictionary: any) => {
        const studyTime = dictionary['00080030']?.Value?.[0]
        const seriesTime = dictionary['00080031']?.Value?.[0]
        const acquisitionTime = dictionary['00080032']?.Value?.[0]
        
        console.log('Available times:', { studyTime, seriesTime, acquisitionTime })
        
        if (studyTime) {
          const timeStr = studyTime.padEnd(6, '0')
          const hours = parseInt(timeStr.substring(0, 2))
          const minutes = parseInt(timeStr.substring(2, 4))
          const seconds = parseInt(timeStr.substring(4, 6))
          console.log('Using StudyTime as reference:', studyTime)
          return new Date(1970, 0, 1, hours, minutes, seconds)
        } else if (seriesTime) {
          const timeStr = seriesTime.padEnd(6, '0')
          const hours = parseInt(timeStr.substring(0, 2))
          const minutes = parseInt(timeStr.substring(2, 4))
          const seconds = parseInt(timeStr.substring(4, 6))
          console.log('Using SeriesTime as reference:', seriesTime)
          return new Date(1970, 0, 1, hours, minutes, seconds)
        } else if (acquisitionTime) {
          const timeStr = acquisitionTime.toString().padEnd(6, '0')
          const hours = parseInt(timeStr.substring(0, 2))
          const minutes = parseInt(timeStr.substring(2, 4))
          const seconds = parseInt(timeStr.substring(4, 6))
          console.log('Using AcquisitionTime as reference:', acquisitionTime)
          return new Date(1970, 0, 1, hours, minutes, seconds)
        } else {
          console.log('Using fallback time: 12:00:00')
          return new Date(1970, 0, 1, 12, 0, 0)
        }
      }
    }
    
    console.log('\nCreating deidentifier...')
    const deidentifier = new DicomDeidentifier(config)
    console.log('Deidentifier created successfully!')
    
    console.log('\nAttempting anonymization...')
    const result = deidentifier.deidentify(uint8Array)
    console.log('✅ Anonymization succeeded!')
    console.log('Result size:', result.length)
    
    // Save the result
    const outputPath = path.join(path.dirname(dicomFilePath), 'anonymized_fixed.dcm')
    fs.writeFileSync(outputPath, result)
    console.log('Saved to:', outputPath)
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run the test
testFix().catch(console.error)