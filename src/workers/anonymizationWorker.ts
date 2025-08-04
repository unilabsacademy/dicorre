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
import { OPFSWorkerHelper } from '@/services/opfsStorage/opfsWorkerHelper'
import type { AnonymizationConfig } from '@/types/dicom'
import { getDicomReferenceDate, getDicomReferenceTime } from '@/services/anonymizer/dicomHelpers'

// Load config in worker - import the config directly
// In workers, we can't use Effect system, so we'll load the config directly
import defaultConfig from '@/../app.config.json'

// Types for worker communication - minimal data only
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: MinimalFileReference[]
    config: AnonymizationConfig  // Original configuration - worker processes it
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

/**
 * Process replacement patterns in worker (e.g., {timestamp} -> actual timestamp)
 * Uses shared timestamp to ensure consistent values across files in the same study
 */
function processReplacements(replacements: Record<string, string>, sharedTimestamp: string): Record<string, string> {
  const processed: Record<string, string> = {}
  
  for (const [key, value] of Object.entries(replacements)) {
    if (typeof value === 'string') {
      processed[key] = value.replace('{timestamp}', sharedTimestamp)
    }
  }
  
  return processed
}

/**
 * Create deidentifier configuration from AnonymizationConfig
 */
function createDeidentifierConfig(config: AnonymizationConfig, sharedTimestamp: string) {
  // Use passed config, fallback to default config from app.config.json
  const effectiveConfig = {
    ...defaultConfig.anonymization,
    ...config
  }
  
  // Process replacement patterns with shared timestamp
  const processedReplacements = processReplacements(effectiveConfig.replacements || {}, sharedTimestamp)
  
  // Select profile options based on config
  let profileOptions: any[] = []
  switch (effectiveConfig.profile) {
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
  
  // Create complete deidentifier configuration using ONLY the configuration
  const deidentifierConfig = {
    profileOptions,
    dummies: {
      default: processedReplacements.default || effectiveConfig.replacements?.default || 'REMOVED',
      lookup: {
        // Use processed replacements - no hardcoded fallbacks
        ...Object.fromEntries(
          Object.entries(processedReplacements).map(([key, value]) => {
            // Map semantic names to DICOM tags using configuration
            switch (key) {
              case 'patientName': return ['00100010', value]
              case 'patientId': return ['00100020', value]
              case 'patientBirthDate': return ['00100030', value]
              case 'institution': return ['00080080', value]
              case 'accessionNumber': return ['00080050', value]
              default: return [key, value] // Direct tag mapping
            }
          })
        ),
        // Add any custom replacements from config
        ...effectiveConfig.customReplacements
      }
    },
    keep: effectiveConfig.preserveTags || [],
    // Add helper functions for handling missing DICOM dates/times
    getReferenceDate: getDicomReferenceDate,
    getReferenceTime: getDicomReferenceTime
  }
  
  console.log('[Worker] Created deidentifier config from configuration')
  return deidentifierConfig
}

// OPFS-based file anonymization function - operates directly on OPFS files
async function anonymizeFile(fileRef: MinimalFileReference, config: AnonymizationConfig, sharedTimestamp: string): Promise<MinimalFileReference> {
  try {
    console.log(`[Worker] Loading file ${fileRef.fileName} from OPFS (${fileRef.opfsFileId})`)
    
    // Load file data from OPFS (source of truth)
    const arrayBuffer = await OPFSWorkerHelper.loadFile(fileRef.opfsFileId)
    const uint8Array = new Uint8Array(arrayBuffer)

    console.log(`[Worker] Anonymizing file ${fileRef.fileName} (${uint8Array.length} bytes) using configuration`)

    // Create deidentifier configuration from passed config with shared timestamp
    const deidentifierConfig = createDeidentifierConfig(config, sharedTimestamp)
    
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
  config: AnonymizationConfig,
  concurrency = 3
) {
  try {
    console.log(`[Worker] Starting anonymization of study ${studyId} with ${files.length} files`)
    
    // Generate shared timestamp for consistent replacements across all files in this study
    const sharedTimestamp = Date.now().toString().slice(-7)
    console.log(`[Worker] Using shared timestamp for study ${studyId}: ${sharedTimestamp}`)
    
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

      const anonymizedFile = await anonymizeFile(fileRef, config, sharedTimestamp)
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
      console.log(`[Worker] Using configuration profile: ${data.config.profile}`)
      anonymizeStudy(data.studyId, data.files, data.config, data.concurrency)
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
