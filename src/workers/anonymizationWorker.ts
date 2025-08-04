/**
 * Web Worker for DICOM anonymization
 * Simplified version that directly uses the anonymization logic
 */

import {
  DicomDeidentifier,
  BasicProfile,
  CleanDescOption,
  CleanGraphOption
} from '@umessen/dicom-deidentifier'
// Worker now just uses the complete config passed from main thread
import { OPFSWorkerHelper } from '@/services/opfsStorage/opfsWorkerHelper'

// Complete deidentifier configuration (serializable)
interface DeidentifierConfig {
  profile: 'basic' | 'clean' | 'very-clean' // Profile name instead of objects
  dummies: {
    default: string
    lookup: Record<string, string>
  }
  keep: string[]
  [key: string]: any // Allow additional properties from the deidentifier library
}

// Types for worker communication - minimal data only
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: MinimalFileReference[]
    deidentifierConfig: DeidentifierConfig  // Complete ready-to-use configuration
    concurrency?: number
  }
}

// Minimal file reference - only what's needed for worker processing
interface MinimalFileReference {
  id: string            // Unique file identifier
  fileName: string      // For display in progress
  opfsFileId: string    // OPFS storage key (source of truth)
}


interface ProgressMessage {
  type: 'progress'
  studyId: string
  data: {
    total: number
    completed: number
    percentage: number
    currentFile?: string
  }
}

interface CompletionMessage {
  type: 'complete'
  studyId: string
  data: {
    anonymizedFiles: MinimalFileReference[]
  }
}

interface ErrorMessage {
  type: 'error'
  studyId: string
  data: {
    message: string
    stack?: string
  }
}

type WorkerResponseMessage = ProgressMessage | CompletionMessage | ErrorMessage

// Helper to post messages back to main thread
function postMessage(message: WorkerResponseMessage) {
  self.postMessage(message)
}

// Worker now uses the complete configuration passed from main thread - no internal logic needed

// OPFS-based file anonymization function - operates directly on OPFS files
async function anonymizeFile(fileRef: MinimalFileReference, deidentifierConfig: DeidentifierConfig): Promise<MinimalFileReference> {
  try {
    console.log(`[Worker] Loading file ${fileRef.fileName} from OPFS (${fileRef.opfsFileId})`)
    
    // Load file data from OPFS (source of truth)
    const arrayBuffer = await OPFSWorkerHelper.loadFile(fileRef.opfsFileId)
    const uint8Array = new Uint8Array(arrayBuffer)

    console.log(`[Worker] Anonymizing file ${fileRef.fileName} (${uint8Array.length} bytes) using provided config`)

    // Use the complete deidentifier configuration passed from main thread
    // Need to recreate profile options and add functions that can't be serialized
    
    // Select profile options based on profile name
    let profileOptions: any[] = []
    switch (deidentifierConfig.profile) {
      case 'clean':
        profileOptions = CleanDescOption ? [CleanDescOption] : []
        break
      case 'very-clean':
        profileOptions = CleanGraphOption ? [CleanGraphOption] : []
        break
      case 'basic':
      default:
        profileOptions = BasicProfile ? [BasicProfile] : []
        break
    }
    
    const configWithFunctions = {
      ...deidentifierConfig,
      profileOptions, // Add profile options back
      // Add custom getReferenceDate function to handle missing PatientBirthDate
      getReferenceDate: (dictionary: any) => {
        const studyDate = dictionary['00080020']?.Value?.[0]
        const acquisitionDate = dictionary['00080022']?.Value?.[0]
        const contentDate = dictionary['00080023']?.Value?.[0]
        const patientBirthDate = dictionary['00100030']?.Value?.[0]

        if (patientBirthDate) {
          const year = parseInt(patientBirthDate.substring(0, 4))
          const month = parseInt(patientBirthDate.substring(4, 6)) - 1
          const day = parseInt(patientBirthDate.substring(6, 8))
          return new Date(year, month, day)
        } else if (studyDate) {
          const year = parseInt(studyDate.substring(0, 4))
          const month = parseInt(studyDate.substring(4, 6)) - 1
          const day = parseInt(studyDate.substring(6, 8))
          return new Date(year, month, day)
        } else if (acquisitionDate) {
          const year = parseInt(acquisitionDate.substring(0, 4))
          const month = parseInt(acquisitionDate.substring(4, 6)) - 1
          const day = parseInt(acquisitionDate.substring(6, 8))
          return new Date(year, month, day)
        } else if (contentDate) {
          const year = parseInt(contentDate.substring(0, 4))
          const month = parseInt(contentDate.substring(4, 6)) - 1
          const day = parseInt(contentDate.substring(6, 8))
          return new Date(year, month, day)
        } else {
          return new Date('1970-01-01')
        }
      },
      // Add custom getReferenceTime function to handle missing StudyTime
      getReferenceTime: (dictionary: any) => {
        const studyTime = dictionary['00080030']?.Value?.[0]
        const seriesTime = dictionary['00080031']?.Value?.[0]
        const acquisitionTime = dictionary['00080032']?.Value?.[0]

        if (studyTime) {
          const timeStr = studyTime.padEnd(6, '0')
          const hours = parseInt(timeStr.substring(0, 2))
          const minutes = parseInt(timeStr.substring(2, 4))
          const seconds = parseInt(timeStr.substring(4, 6))
          return new Date(1970, 0, 1, hours, minutes, seconds)
        } else if (seriesTime) {
          const timeStr = seriesTime.padEnd(6, '0')
          const hours = parseInt(timeStr.substring(0, 2))
          const minutes = parseInt(timeStr.substring(2, 4))
          const seconds = parseInt(timeStr.substring(4, 6))
          return new Date(1970, 0, 1, hours, minutes, seconds)
        } else if (acquisitionTime) {
          const timeStr = acquisitionTime.padEnd(6, '0')
          const hours = parseInt(timeStr.substring(0, 2))
          const minutes = parseInt(timeStr.substring(2, 4))
          const seconds = parseInt(timeStr.substring(4, 6))
          return new Date(1970, 0, 1, hours, minutes, seconds)
        } else {
          return new Date(1970, 0, 1, 12, 0, 0)
        }
      }
    }
    
    let deidentifier
    try {
      deidentifier = new DicomDeidentifier(configWithFunctions)
      console.log(`[Worker] Created DicomDeidentifier for ${fileRef.fileName}`)
    } catch (e) {
      console.error(`[Worker] Failed to create DicomDeidentifier:`, e)
      throw new Error(`Failed to create deidentifier: ${e.message}`)
    }

    // Anonymize the DICOM file
    let anonymizedUint8Array
    try {
      anonymizedUint8Array = deidentifier.deidentify(uint8Array)
      console.log(`[Worker] Successfully deidentified ${fileRef.fileName}`)
    } catch (e) {
      console.error(`[Worker] Failed to deidentify file:`, e)
      throw new Error(`Failed to deidentify: ${e.message}`)
    }

    // Create new OPFS file ID for anonymized version
    const anonymizedOpfsFileId = `${fileRef.opfsFileId}_anonymized`

    // Convert back to ArrayBuffer and save to OPFS (new source of truth)
    const anonymizedArrayBuffer = anonymizedUint8Array.buffer.slice(
      anonymizedUint8Array.byteOffset,
      anonymizedUint8Array.byteOffset + anonymizedUint8Array.byteLength
    )

    await OPFSWorkerHelper.saveFile(anonymizedOpfsFileId, anonymizedArrayBuffer)

    console.log(`[Worker] Successfully anonymized and saved ${fileRef.fileName} to OPFS`)

    // Return minimal reference to anonymized file
    return {
      id: fileRef.id,
      fileName: fileRef.fileName,
      opfsFileId: anonymizedOpfsFileId
    }
  } catch (error) {
    console.error(`[Worker] Error anonymizing file ${fileRef.fileName}:`, error)
    throw new Error(`Failed to anonymize file: ${fileRef.fileName} - ${error.message}`)
  }
}

// Main anonymization function that runs in worker
async function anonymizeStudy(
  studyId: string,
  files: MinimalFileReference[],
  deidentifierConfig: DeidentifierConfig,
  concurrency = 3
) {
  try {
    console.log(`[Worker] Starting anonymization of study ${studyId} with ${files.length} files`)
    
    const anonymizedFiles: MinimalFileReference[] = []
    const total = files.length

    // Process files with concurrency limit
    const processFile = async (fileRef: MinimalFileReference, index: number) => {
      console.log(`[Worker] Starting file ${index + 1}/${total}: ${fileRef.fileName}`)
      
      // Send progress update
      const progressData = {
        total,
        completed: index,
        percentage: Math.round((index / total) * 100),
        currentFile: fileRef.fileName
      }
      console.log(`[Worker] Sending progress update:`, progressData)
      
      postMessage({
        type: 'progress',
        studyId,
        data: progressData
      })

      const anonymizedFile = await anonymizeFile(fileRef, deidentifierConfig)
      anonymizedFiles.push(anonymizedFile)

      // Send progress update after completion
      const completedProgressData = {
        total,
        completed: index + 1,
        percentage: Math.round(((index + 1) / total) * 100),
        currentFile: fileRef.fileName
      }
      console.log(`[Worker] Sending completion progress:`, completedProgressData)
      
      postMessage({
        type: 'progress',
        studyId,
        data: completedProgressData
      })
    }

    // Process files in batches to respect concurrency
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      await Promise.all(batch.map((file, batchIndex) => processFile(file, i + batchIndex)))
    }

    // Send completion message
    console.log(`[Worker] Anonymization completed for study ${studyId}. Sending ${anonymizedFiles.length} files back to main thread`)
    postMessage({
      type: 'complete',
      studyId,
      data: { anonymizedFiles }
    })

  } catch (error) {
    console.error('Worker anonymization error:', error)
    // Send error message
    postMessage({
      type: 'error',
      studyId,
      data: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }
    })
  }
}

// Listen for messages from main thread
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data
  
  console.log(`[Worker] Received message of type: ${type}`)

  switch (type) {
    case 'anonymize_study':
      console.log(`[Worker] Starting anonymization for study ${data.studyId} with ${data.files.length} files`)
      console.log(`[Worker] Using complete deidentifier config with ${Object.keys(data.deidentifierConfig.dummies.lookup).length} lookup entries`)
      anonymizeStudy(data.studyId, data.files, data.deidentifierConfig, data.concurrency)
      break
    default:
      console.warn('[Worker] Unknown message type:', type)
  }
})

// Signal that worker is ready
postMessage({
  type: 'complete',
  studyId: 'worker-ready',
  data: { anonymizedFiles: [] }
})
