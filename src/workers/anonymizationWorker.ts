/**
 * Web Worker for DICOM anonymization
 * Simplified version that directly uses the anonymization logic
 */

import {
  DicomDeidentifier,
  BasicProfile,
} from '@umessen/dicom-deidentifier'
// AnonymizationConfig not needed - we create config in worker from simple options
import { OPFSWorkerHelper } from '@/services/opfsWorkerHelper'

// Simple config options that can be serialized
interface AnonymizationOptions {
  profile: 'basic' | 'clean' | 'very-clean'
  removePrivateTags: boolean
  dateJitterDays?: number
  replacements?: {
    patientName?: string
    patientId?: string
    patientBirthDate?: string
    institution?: string
  }
}

// Types for worker communication - minimal data only
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: MinimalFileReference[]
    options: AnonymizationOptions  // Simple serializable options
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

// Create deidentifier configuration based on simple options
function createDeidentifierConfig(options: AnonymizationOptions) {
  // Check if BasicProfile.options exists and handle accordingly
  let profileOptions = []
  
  try {
    if (options.profile === 'basic' && BasicProfile && BasicProfile.options) {
      profileOptions = BasicProfile.options
      console.log(`[Worker] Using BasicProfile with ${profileOptions.length} options`)
    } else {
      console.log(`[Worker] BasicProfile.options not available or profile is ${options.profile}, using empty options`)
    }
  } catch (e) {
    console.error('[Worker] Error accessing BasicProfile:', e)
    profileOptions = []
  }

  const config = {
    profileOptions,
    dummies: {
      default: 'ANONYMOUS',
      lookup: {
        '00100010': options.replacements?.patientName || 'ANONYMOUS',
        '00100020': options.replacements?.patientId || 'ANON001',
        '00100030': options.replacements?.patientBirthDate || '19700101',
        '00080080': options.replacements?.institution || 'ANONYMOUS_HOSPITAL'
      }
    },
    keep: []
  }
  
  console.log('[Worker] Created deidentifier config:', config)
  return config
}

// OPFS-based file anonymization function - operates directly on OPFS files
async function anonymizeFile(fileRef: MinimalFileReference, options: AnonymizationOptions): Promise<MinimalFileReference> {
  try {
    console.log(`[Worker] Loading file ${fileRef.fileName} from OPFS (${fileRef.opfsFileId})`)
    
    // Load file data from OPFS (source of truth)
    const arrayBuffer = await OPFSWorkerHelper.loadFile(fileRef.opfsFileId)
    const uint8Array = new Uint8Array(arrayBuffer)

    console.log(`[Worker] Anonymizing file ${fileRef.fileName} (${uint8Array.length} bytes)`)

    // Create deidentifier configuration from simple options
    const deidentifierConfig = createDeidentifierConfig(options)
    
    let deidentifier
    try {
      deidentifier = new DicomDeidentifier(deidentifierConfig)
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
  options: AnonymizationOptions,
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

      const anonymizedFile = await anonymizeFile(fileRef, options)
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
      anonymizeStudy(data.studyId, data.files, data.options, data.concurrency)
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
