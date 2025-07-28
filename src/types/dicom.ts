export interface DicomFile {
  id: string
  fileName: string
  fileSize: number
  arrayBuffer: ArrayBuffer
  metadata?: DicomMetadata
  anonymized?: boolean
}

export interface DicomMetadata {
  patientName?: string
  patientId?: string
  studyInstanceUID?: string
  studyDate?: string
  studyDescription?: string
  seriesInstanceUID?: string
  seriesDescription?: string
  modality?: string
  sopInstanceUID?: string
}

export interface DicomStudy {
  studyInstanceUID: string
  patientName?: string
  patientId?: string
  studyDate?: string
  studyDescription?: string
  series: DicomSeries[]
}

export interface DicomSeries {
  seriesInstanceUID: string
  seriesDescription?: string
  modality?: string
  files: DicomFile[]
}

export interface AnonymizationConfig {
  removePrivateTags: boolean
  profile: 'basic' | 'clean' | 'very-clean'
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