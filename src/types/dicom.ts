export interface DicomFile {
  id: string
  fileName: string
  fileSize: number
  arrayBuffer: ArrayBuffer
  metadata?: DicomMetadata
  anonymized?: boolean
  sent?: boolean
  parsed?: boolean
  // Optional OPFS file ID for worker-based processing
  opfsFileId?: string
}

export interface DicomMetadata {
  patientName?: string
  patientId?: string
  accessionNumber?: string
  patientBirthDate?: string
  patientSex?: string
  patientHeight?: number
  patientWeight?: number
  studyInstanceUID?: string
  studyDate?: string
  studyDescription?: string
  seriesInstanceUID?: string
  seriesDescription?: string
  modality?: string
  sopInstanceUID?: string
  instanceNumber?: number
  transferSyntaxUID?: string
}

export interface DicomStudy {
  accessionNumber?: string
  studyInstanceUID: string
  patientName?: string
  patientId?: string
  assignedPatientId?: string
  studyDate?: string
  studyDescription?: string
  series: DicomSeries[]
  // Field overrides for anonymization
  fieldOverrides?: DicomFieldOverrides
}

// Type for DICOM field overrides during anonymization
export type DicomFieldOverrides = Record<string, string | Record<string, string>>

export interface DicomSeries {
  seriesInstanceUID: string
  seriesDescription?: string
  modality?: string
  files: DicomFile[]
}


export interface SendProgress {
  studyUID: string
  totalFiles: number
  sentFiles: number
  status: 'pending' | 'sending' | 'completed' | 'error'
  error?: string
}

// Lightweight metadata types for persistence (without ArrayBuffer)
export interface DicomFileMetadata {
  id: string
  fileName: string
  fileSize: number
  metadata?: DicomMetadata
  anonymized?: boolean
  sent?: boolean
  // Reference to OPFS file
  opfsFileId?: string
}

export interface DicomStudyMetadata {
  studyInstanceUID: string
  patientName?: string
  patientId?: string
  studyDate?: string
  studyDescription?: string
  series: DicomSeriesMetadata[]
}

export interface DicomSeriesMetadata {
  seriesInstanceUID: string
  seriesDescription?: string
  modality?: string
  files: DicomFileMetadata[]
}

