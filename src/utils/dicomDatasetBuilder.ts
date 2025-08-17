import type { DicomMetadata } from '@/types/dicom'

/**
 * Utility for building DICOM datasets from metadata and pixel data
 * This centralizes DICOM dataset creation logic for all converter plugins
 */
export class DicomDatasetBuilder {
  /**
   * Create a DICOM dataset from metadata and pixel data
   * Pure function - no business logic, just format conversion
   */
  static createDataset(
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
  ): any {
    // Start with the provided metadata and convert to DICOM format
    const dataset: any = {}

    // File Meta Information (required for DICOM files) - use only provided values
    dataset._meta = {}
    
    // Required DICOM file header elements
    if (metadata.sopInstanceUID) {
      dataset._meta['00020001'] = { vr: 'OB', Value: [new Uint8Array([0, 1])] } // FileMetaInformationVersion
      dataset._meta['00020003'] = { vr: 'UI', Value: [metadata.sopInstanceUID] } // MediaStorageSOPInstanceUID
    }
    if (metadata.transferSyntaxUID) {
      dataset._meta['00020010'] = { vr: 'UI', Value: [metadata.transferSyntaxUID] } // TransferSyntaxUID
    }

    // Convert all provided metadata to DICOM format
    if (metadata.sopInstanceUID) {
      dataset['00080018'] = { vr: 'UI', Value: [metadata.sopInstanceUID] } // SOPInstanceUID
    }
    if (metadata.patientName) {
      dataset['00100010'] = { vr: 'PN', Value: [metadata.patientName] } // PatientName
    }
    if (metadata.patientId) {
      dataset['00100020'] = { vr: 'LO', Value: [metadata.patientId] } // PatientID
    }
    if (metadata.studyInstanceUID) {
      dataset['0020000D'] = { vr: 'UI', Value: [metadata.studyInstanceUID] } // StudyInstanceUID
    }
    if (metadata.seriesInstanceUID) {
      dataset['0020000E'] = { vr: 'UI', Value: [metadata.seriesInstanceUID] } // SeriesInstanceUID
    }
    if (metadata.studyDate) {
      dataset['00080020'] = { vr: 'DA', Value: [metadata.studyDate] } // StudyDate
    }
    if (metadata.studyDescription) {
      dataset['00081030'] = { vr: 'LO', Value: [metadata.studyDescription] } // StudyDescription
    }
    if (metadata.seriesDescription) {
      dataset['0008103E'] = { vr: 'LO', Value: [metadata.seriesDescription] } // SeriesDescription
    }
    if (metadata.modality) {
      dataset['00080060'] = { vr: 'CS', Value: [metadata.modality] } // Modality
    }
    if (metadata.accessionNumber) {
      dataset['00080050'] = { vr: 'SH', Value: [metadata.accessionNumber] } // AccessionNumber
    }
    if (metadata.instanceNumber) {
      dataset['00200013'] = { vr: 'IS', Value: [metadata.instanceNumber] } // InstanceNumber
      dataset['00200011'] = { vr: 'IS', Value: [metadata.instanceNumber] } // SeriesNumber
    }

    // Set image-specific DICOM elements based on the provided format
    dataset['00280002'] = { vr: 'US', Value: [imageFormat.samplesPerPixel] } // SamplesPerPixel
    dataset['00280004'] = { vr: 'CS', Value: [imageFormat.photometricInterpretation] } // PhotometricInterpretation
    dataset['00280010'] = { vr: 'US', Value: [height] } // Rows
    dataset['00280011'] = { vr: 'US', Value: [width] } // Columns
    dataset['00280100'] = { vr: 'US', Value: [imageFormat.bitsAllocated] } // BitsAllocated
    dataset['00280101'] = { vr: 'US', Value: [imageFormat.bitsStored] } // BitsStored
    dataset['00280102'] = { vr: 'US', Value: [imageFormat.highBit] } // HighBit
    dataset['00280103'] = { vr: 'US', Value: [imageFormat.pixelRepresentation] } // PixelRepresentation
    dataset['00280006'] = { vr: 'US', Value: [imageFormat.planarConfiguration] } // PlanarConfiguration
    dataset['7FE00010'] = { vr: 'OB', Value: [pixelData] } // PixelData

    return dataset
  }
}