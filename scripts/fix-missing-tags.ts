#!/usr/bin/env -S npx tsx
import { 
  DicomDeidentifier, 
  BasicProfile, 
  CleanDescOption,
  CleanGraphOption
} from '@umessen/dicom-deidentifier'
import * as fs from 'fs'
import * as path from 'path'
import * as dcmjs from 'dcmjs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dicomFilePath = path.join(__dirname, '../test-data/IM-0001-0001.dcm')

async function fixMissingTags() {
  console.log('Fixing missing required tags in:', dicomFilePath)
  
  try {
    // Read the DICOM file
    const fileBuffer = fs.readFileSync(dicomFilePath)
    const uint8Array = new Uint8Array(fileBuffer)
    
    // Parse the DICOM
    const dicomData = dcmjs.data.DicomMessage.readFile(uint8Array.buffer)
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
    
    console.log('Original DICOM parsed successfully')
    console.log('Current StudyDate:', dataset.StudyDate || 'MISSING')
    console.log('Current SeriesDate:', dataset.SeriesDate || 'MISSING')
    console.log('Current PatientBirthDate:', dataset.PatientBirthDate || 'MISSING')
    
    // Add missing required tags to the dictionary
    const fixedDict = { ...dicomData.dict }
    
    // Add StudyDate if missing (using AcquisitionDate as fallback)
    if (!fixedDict['00080020'] && fixedDict['00080022']) {
      console.log('Adding StudyDate using AcquisitionDate')
      fixedDict['00080020'] = {
        vr: 'DA',
        Value: fixedDict['00080022'].Value  // Copy from AcquisitionDate
      }
    } else if (!fixedDict['00080020']) {
      console.log('Adding default StudyDate')
      fixedDict['00080020'] = {
        vr: 'DA', 
        Value: ['20240527']  // Use a default date
      }
    }
    
    // Add SeriesDate if missing (using StudyDate as fallback)
    if (!fixedDict['00080021']) {
      console.log('Adding SeriesDate using StudyDate')
      fixedDict['00080021'] = {
        vr: 'DA',
        Value: fixedDict['00080020'].Value
      }
    }
    
    // Add PatientBirthDate if missing (empty value is OK for anonymization)
    if (!fixedDict['00100030']) {
      console.log('Adding empty PatientBirthDate')
      fixedDict['00100030'] = {
        vr: 'DA',
        Value: ['']  // Empty is OK, will be replaced during anonymization
      }
    }
    
    // Create new DICOM with fixed dictionary
    const fixedDicom = new dcmjs.data.DicomMessage(fixedDict)
    const fixedBuffer = fixedDicom.write()
    const fixedUint8Array = new Uint8Array(fixedBuffer)
    
    console.log('\nFixed DICOM created, attempting anonymization...')
    
    // Try anonymization on fixed file
    const config = {
      profileOptions: [BasicProfile, CleanDescOption, CleanGraphOption],
      dummies: {
        default: 'REMOVED',
        lookup: {
          '00100010': 'ANONYMOUS',  // Patient Name
          '00100020': 'ANON001',    // Patient ID
          '00100030': '19700101',   // Patient Birth Date
        }
      }
    }
    
    const deidentifier = new DicomDeidentifier(config)
    const result = deidentifier.deidentify(fixedUint8Array)
    console.log('✅ Anonymization succeeded!')
    
    // Save both files
    const fixedPath = path.join(path.dirname(dicomFilePath), 'fixed_tags.dcm')
    const anonymizedPath = path.join(path.dirname(dicomFilePath), 'anonymized_fixed.dcm')
    
    fs.writeFileSync(fixedPath, fixedUint8Array)
    fs.writeFileSync(anonymizedPath, result)
    
    console.log('Saved fixed file to:', fixedPath)
    console.log('Saved anonymized file to:', anonymizedPath)
    
    // Verify the result
    console.log('\nVerifying anonymized result...')
    const resultDicom = dcmjs.data.DicomMessage.readFile(result.buffer)
    const resultDataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(resultDicom.dict)
    
    console.log('Anonymized Patient Name:', resultDataset.PatientName || 'MISSING')
    console.log('Anonymized Patient ID:', resultDataset.PatientID || 'MISSING')
    console.log('Anonymized StudyDate:', resultDataset.StudyDate || 'MISSING')
    
  } catch (error: any) {
    console.error('Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

// Run the fix
fixMissingTags().catch(console.error)