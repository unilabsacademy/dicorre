#!/usr/bin/env -S npx tsx
import * as fs from 'fs'
import * as path from 'path'
import * as dcmjs from 'dcmjs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function debugDcmjsTemplate() {
  console.log('=== Debugging dcmjs template modification ===\n')
  
  try {
    // 1. Load existing DICOM file
    console.log('1. Loading template DICOM file...')
    const dicomFilePath = path.join(__dirname, '../test-data/IM-0001-0001.dcm')
    const fileBuffer = fs.readFileSync(dicomFilePath)
    const uint8Array = new Uint8Array(fileBuffer)
    
    console.log(`   Template file size: ${uint8Array.length} bytes`)
    
    // 2. Parse with dcmjs
    console.log('2. Parsing with dcmjs...')
    const originalDicom = dcmjs.data.DicomMessage.readFile(uint8Array.buffer)
    const originalDataset = originalDicom.dict
    
    console.log(`   Original dataset keys: ${Object.keys(originalDataset).length}`)
    console.log(`   Original image dimensions: ${originalDataset['00280010']?.Value[0] || 'N/A'} x ${originalDataset['00280011']?.Value[0] || 'N/A'}`)
    console.log(`   Original SOP Class: ${originalDataset['00080016']?.Value[0] || 'N/A'}`)
    
    // 3. Test: Can we write the ORIGINAL dataset back without modification?
    console.log('3. Testing: Write original dataset (no modifications)...')
    try {
      const originalBuffer = dcmjs.data.DicomMessage.write(originalDataset)
      console.log(`   ✅ SUCCESS: Original dataset write worked! Size: ${originalBuffer.byteLength} bytes`)
    } catch (error) {
      console.log(`   ❌ FAILED: Original dataset write failed: ${error}`)
    }
    
    // 3b. Test: Can we use the DicomMessage INSTANCE to write?
    console.log('3b. Testing: Use DicomMessage instance methods...')
    console.log(`   DicomMessage instance properties: ${Object.getOwnPropertyNames(originalDicom)}`)
    console.log(`   DicomMessage prototype methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(originalDicom))}`)
    
    // Check if instance has a write method
    if (typeof (originalDicom as any).write === 'function') {
      try {
        const instanceBuffer = (originalDicom as any).write()
        console.log(`   ✅ SUCCESS: Instance write worked! Size: ${instanceBuffer.byteLength} bytes`)
      } catch (error) {
        console.log(`   ❌ FAILED: Instance write failed: ${error}`)
      }
    } else {
      console.log(`   ❌ Instance write method not available`)
    }
    
    // 4. Test: Minimal modification - just change patient name
    console.log('4. Testing: Minimal modification (patient name only)...')
    const minimalModified = { ...originalDataset }
    minimalModified['00100010'] = { vr: 'PN', Value: ['Test^Patient'] } // PatientName
    
    try {
      const minimalBuffer = dcmjs.data.DicomMessage.write(minimalModified)
      console.log(`   ✅ SUCCESS: Minimal modification worked! Size: ${minimalBuffer.byteLength} bytes`)
    } catch (error) {
      console.log(`   ❌ FAILED: Minimal modification failed: ${error}`)
    }
    
    // 5. Test: Image dimension modification
    console.log('5. Testing: Image dimension modification...')
    const dimModified = { ...originalDataset }
    dimModified['00280010'] = { vr: 'US', Value: [100] } // Rows
    dimModified['00280011'] = { vr: 'US', Value: [100] } // Columns
    
    try {
      const dimBuffer = dcmjs.data.DicomMessage.write(dimModified)
      console.log(`   ✅ SUCCESS: Dimension modification worked! Size: ${dimBuffer.byteLength} bytes`)
    } catch (error) {
      console.log(`   ❌ FAILED: Dimension modification failed: ${error}`)
    }
    
    // 6. Test: Pixel data modification (small data)
    console.log('6. Testing: Pixel data modification...')
    const pixelModified = { ...originalDataset }
    const smallPixelData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]) // 3x1 RGB pixels
    pixelModified['7FE00010'] = { vr: 'OB', Value: [smallPixelData] } // PixelData
    pixelModified['00280010'] = { vr: 'US', Value: [1] } // Rows
    pixelModified['00280011'] = { vr: 'US', Value: [3] } // Columns
    
    try {
      const pixelBuffer = dcmjs.data.DicomMessage.write(pixelModified)
      console.log(`   ✅ SUCCESS: Pixel data modification worked! Size: ${pixelBuffer.byteLength} bytes`)
    } catch (error) {
      console.log(`   ❌ FAILED: Pixel data modification failed: ${error}`)
    }
    
    // 7. Test: Full image conversion simulation
    console.log('7. Testing: Full image conversion simulation...')
    const fullModified = { ...originalDataset }
    
    // Update meta information
    if (fullModified._meta) {
      fullModified._meta['00020002'] = { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] } // MediaStorageSOPClassUID
    }
    
    // Convert to Secondary Capture
    fullModified['00080016'] = { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] } // SOPClassUID
    fullModified['00080060'] = { vr: 'CS', Value: ['SC'] } // Modality
    fullModified['00180060'] = { vr: 'CS', Value: ['WSD'] } // ConversionType
    
    // Set RGB image parameters
    fullModified['00280002'] = { vr: 'US', Value: [3] } // SamplesPerPixel
    fullModified['00280004'] = { vr: 'CS', Value: ['RGB'] } // PhotometricInterpretation
    fullModified['00280010'] = { vr: 'US', Value: [2] } // Rows
    fullModified['00280011'] = { vr: 'US', Value: [2] } // Columns
    fullModified['00280100'] = { vr: 'US', Value: [8] } // BitsAllocated
    fullModified['00280101'] = { vr: 'US', Value: [8] } // BitsStored
    fullModified['00280102'] = { vr: 'US', Value: [7] } // HighBit
    fullModified['00280103'] = { vr: 'US', Value: [0] } // PixelRepresentation
    fullModified['00280006'] = { vr: 'US', Value: [0] } // PlanarConfiguration
    
    // 2x2 RGB image (red, green, blue, white)
    const rgbPixelData = new Uint8Array([
      255, 0, 0,    // Red pixel
      0, 255, 0,    // Green pixel  
      0, 0, 255,    // Blue pixel
      255, 255, 255 // White pixel
    ])
    fullModified['7FE00010'] = { vr: 'OB', Value: [rgbPixelData] }
    
    try {
      const fullBuffer = dcmjs.data.DicomMessage.write(fullModified)
      console.log(`   ✅ SUCCESS: Full conversion simulation worked! Size: ${fullBuffer.byteLength} bytes`)
      
      // Save for inspection
      const outputPath = path.join(__dirname, '../test-output-template.dcm')
      fs.writeFileSync(outputPath, new Uint8Array(fullBuffer))
      console.log(`   💾 Saved test output to: ${outputPath}`)
      
    } catch (error) {
      console.log(`   ❌ FAILED: Full conversion simulation failed: ${error}`)
      console.log(`   Error details: ${error}`)
    }
    
    // 8. Analyze what breaks the template approach
    console.log('8. Analyzing dataset structure...')
    console.log(`   _meta keys: ${originalDataset._meta ? Object.keys(originalDataset._meta).length : 'none'}`)
    console.log(`   _syntax: ${originalDataset._syntax || 'undefined'}`)
    console.log(`   Sample tag structure:`)
    const sampleTag = originalDataset['00100010'] // PatientName
    if (sampleTag) {
      console.log(`   PatientName tag:`, {
        vr: sampleTag.vr,
        Value: sampleTag.Value,
        otherProps: Object.keys(sampleTag).filter(k => k !== 'vr' && k !== 'Value')
      })
    }
    
  } catch (error: any) {
    console.error('❌ Debug failed:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

debugDcmjsTemplate()