import * as dcmjs from 'dcmjs'
import type { DicomMetadata } from '@/types/dicom'

/**
 * Utility for building DICOM files from metadata and pixel data
 * Uses template-based approach to avoid dcmjs dataset creation issues
 */
export class DicomDatasetBuilder {
  // Base64-encoded minimal DICOM template (created from existing valid DICOM)
  private static readonly TEMPLATE_BASE64 = 'data:application/dicom;base64,UElDTQ==' // Placeholder - will be replaced with actual template
  
  /**
   * Create a DICOM ArrayBuffer from metadata and pixel data
   * Uses template modification approach to avoid dcmjs creation issues
   */
  static async createDicomBuffer(
    width: number,
    height: number,
    pixelData: Uint8Array,
    metadata: DicomMetadata,
    imageFormat: {
      samplesPerPixel: number
      photometricInterpretation: string
      bitsAllocated: number
      bitsStored: number
      highBit: number
      pixelRepresentation: number
      planarConfiguration: number
    }
  ): Promise<ArrayBuffer> {
    // For now, use a fallback approach that creates a minimal valid DICOM
    // This is a temporary solution until we can implement proper template handling
    
    // Load existing template DICOM file from test data
    const templateUrl = '/test-data/IM-0001-0001.dcm'
    const response = await fetch(templateUrl)
    const templateBuffer = await response.arrayBuffer()
    
    // Parse template with dcmjs
    const templateDicom = dcmjs.data.DicomMessage.readFile(templateBuffer)
    
    // Modify the instance's dataset directly (preserves syntax metadata)
    this.applyMetadataToDataset(templateDicom.dict, metadata)
    
    // Update image-specific tags
    this.applyImageDataToDataset(templateDicom.dict, width, height, pixelData, imageFormat)
    
    // Use the instance write method (preserves syntax metadata)
    try {
      return (templateDicom as any).write()
    } catch (error) {
      throw new Error(`Failed to create DICOM buffer: ${error}`)
    }
  }
  
  /**
   * Apply provided metadata to DICOM dataset
   */
  private static applyMetadataToDataset(dataset: any, metadata: DicomMetadata): void {
    // Update meta information for Secondary Capture
    if (dataset._meta) {
      dataset._meta['00020002'] = { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] } // MediaStorageSOPClassUID
      if (metadata.sopInstanceUID) {
        dataset._meta['00020003'] = { vr: 'UI', Value: [metadata.sopInstanceUID] } // MediaStorageSOPInstanceUID
      }
      if (metadata.transferSyntaxUID) {
        dataset._meta['00020010'] = { vr: 'UI', Value: [metadata.transferSyntaxUID] } // TransferSyntaxUID
      }
    }
    
    // Set Secondary Capture specific values
    dataset['00080016'] = { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] } // SOPClassUID
    dataset['00180060'] = { vr: 'CS', Value: ['WSD'] } // ConversionType
    
    // Apply all provided metadata
    if (metadata.sopInstanceUID) {
      dataset['00080018'] = { vr: 'UI', Value: [metadata.sopInstanceUID] }
    }
    if (metadata.patientName) {
      dataset['00100010'] = { vr: 'PN', Value: [metadata.patientName] }
    }
    if (metadata.patientId) {
      dataset['00100020'] = { vr: 'LO', Value: [metadata.patientId] }
    }
    if (metadata.studyInstanceUID) {
      dataset['0020000D'] = { vr: 'UI', Value: [metadata.studyInstanceUID] }
    }
    if (metadata.seriesInstanceUID) {
      dataset['0020000E'] = { vr: 'UI', Value: [metadata.seriesInstanceUID] }
    }
    if (metadata.studyDate) {
      dataset['00080020'] = { vr: 'DA', Value: [metadata.studyDate] }
    }
    if (metadata.studyDescription) {
      dataset['00081030'] = { vr: 'LO', Value: [metadata.studyDescription] }
    }
    if (metadata.seriesDescription) {
      dataset['0008103E'] = { vr: 'LO', Value: [metadata.seriesDescription] }
    }
    if (metadata.modality) {
      dataset['00080060'] = { vr: 'CS', Value: [metadata.modality] }
    }
    if (metadata.accessionNumber) {
      dataset['00080050'] = { vr: 'SH', Value: [metadata.accessionNumber] }
    }
    if (metadata.instanceNumber) {
      dataset['00200013'] = { vr: 'IS', Value: [metadata.instanceNumber] }
      dataset['00200011'] = { vr: 'IS', Value: [metadata.instanceNumber] }
    }
  }
  
  /**
   * Apply image data and format to DICOM dataset
   */
  private static applyImageDataToDataset(
    dataset: any, 
    width: number, 
    height: number, 
    pixelData: Uint8Array,
    imageFormat: any
  ): void {
    dataset['00280002'] = { vr: 'US', Value: [imageFormat.samplesPerPixel] }
    dataset['00280004'] = { vr: 'CS', Value: [imageFormat.photometricInterpretation] }
    dataset['00280010'] = { vr: 'US', Value: [height] }
    dataset['00280011'] = { vr: 'US', Value: [width] }
    dataset['00280100'] = { vr: 'US', Value: [imageFormat.bitsAllocated] }
    dataset['00280101'] = { vr: 'US', Value: [imageFormat.bitsStored] }
    dataset['00280102'] = { vr: 'US', Value: [imageFormat.highBit] }
    dataset['00280103'] = { vr: 'US', Value: [imageFormat.pixelRepresentation] }
    dataset['00280006'] = { vr: 'US', Value: [imageFormat.planarConfiguration] }
    dataset['7FE00010'] = { vr: 'OB', Value: [pixelData] }
  }
}