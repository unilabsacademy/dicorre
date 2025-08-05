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
  replacements?: {
    default?: string
    patientName?: string
    patientId?: string
    accessionNumber?: string
    patientBirthDate?: string
    institution?: string
    [key: string]: string | undefined
  }
  preserveTags?: string[]
  tagsToRemove?: string[]
  customReplacements?: Record<string, string>
  // Advanced options for custom handlers
  dateJitterDays?: number
  useCustomHandlers?: boolean
  organizationRoot?: string
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

// App configuration types
export interface AnonymizationPreset {
  profile: 'basic' | 'clean' | 'very-clean'
  removePrivateTags: boolean
  description: string
}

// Import DicomServerConfig for use in AppConfig
import type { DicomServerConfig } from '@/services/dicomSender'

export interface AppConfig {
  dicomServer: DicomServerConfig
  anonymization: AnonymizationConfig & {
    tagDescriptions?: Record<string, string>
  }
  presets?: Record<string, AnonymizationPreset>
}

// Re-export DicomServerConfig for convenience
export type { DicomServerConfig } from '@/services/dicomSender'
