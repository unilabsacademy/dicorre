#!/usr/bin/env -S npx tsx
import * as fs from 'fs'
import * as path from 'path'
import * as dcmjs from 'dcmjs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function createDicomTemplate() {
  console.log('Creating minimal DICOM template for image conversion...')
  
  try {
    // Read an existing DICOM file
    const dicomFilePath = path.join(__dirname, '../test-data/IM-0001-0001.dcm')
    const fileBuffer = fs.readFileSync(dicomFilePath)
    const uint8Array = new Uint8Array(fileBuffer)
    
    // Parse with dcmjs
    const dicomData = dcmjs.data.DicomMessage.readFile(uint8Array.buffer)
    const dataset = dicomData.dict
    
    console.log('Original dataset keys:', Object.keys(dataset).length)
    
    // Use existing dataset as template and modify it
    const templateDataset = { ...dataset }
    
    console.log('Starting with full dataset, modifying for Secondary Capture...')
    
    // Update meta information for Secondary Capture
    if (templateDataset._meta) {
      templateDataset._meta['00020002'] = { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] } // MediaStorageSOPClassUID
    }
    
    // Set Secondary Capture specific values
    templateDataset['00080016'] = { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] } // SOPClassUID
    templateDataset['00080060'] = { vr: 'CS', Value: ['SC'] } // Modality
    templateDataset['00180060'] = { vr: 'CS', Value: ['WSD'] } // ConversionType
    
    // Set image attributes for RGB (these will be template values)
    templateDataset['00280002'] = { vr: 'US', Value: [3] } // SamplesPerPixel
    templateDataset['00280004'] = { vr: 'CS', Value: ['RGB'] } // PhotometricInterpretation
    templateDataset['00280010'] = { vr: 'US', Value: [1] } // Rows (minimal)
    templateDataset['00280011'] = { vr: 'US', Value: [1] } // Columns (minimal)
    templateDataset['00280100'] = { vr: 'US', Value: [8] } // BitsAllocated
    templateDataset['00280101'] = { vr: 'US', Value: [8] } // BitsStored
    templateDataset['00280102'] = { vr: 'US', Value: [7] } // HighBit
    templateDataset['00280103'] = { vr: 'US', Value: [0] } // PixelRepresentation
    templateDataset['00280006'] = { vr: 'US', Value: [0] } // PlanarConfiguration
    
    // Create minimal pixel data (1x1 RGB pixel)
    const minimalPixelData = new Uint8Array([255, 0, 0]) // Single red pixel
    templateDataset['7FE00010'] = { vr: 'OB', Value: [minimalPixelData] } // PixelData
    
    console.log('Modified dataset for Secondary Capture')
    
    // Test that the template works with dcmjs (using instance method like working scripts)
    const templateDicom = new dcmjs.data.DicomMessage(templateDataset)
    const templateBuffer = (templateDicom as any).write()
    
    console.log('✅ Template DICOM created successfully!')
    console.log('Template size:', templateBuffer.byteLength, 'bytes')
    
    // Save the template for inspection
    const templatePath = path.join(__dirname, '../src/utils/dicom-template.dcm')
    fs.writeFileSync(templatePath, new Uint8Array(templateBuffer))
    console.log('Template saved to:', templatePath)
    
    // Also save as JSON for easier inspection
    const jsonPath = path.join(__dirname, '../src/utils/dicom-template.json')
    fs.writeFileSync(jsonPath, JSON.stringify(templateDataset, null, 2))
    console.log('Template JSON saved to:', jsonPath)
    
  } catch (error: any) {
    console.error('❌ Failed to create template:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

createDicomTemplate()