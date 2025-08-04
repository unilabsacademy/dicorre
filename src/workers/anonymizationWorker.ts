/**
 * Web Worker for DICOM anonymization
 * Uses Effect services for consistent anonymization logic
 */

import { Effect, Layer } from 'effect'
import { Anonymizer, AnonymizerLive } from '@/services/anonymizer'
import { ConfigService, ConfigServiceLive } from '@/services/config'
import { DicomProcessor, DicomProcessorLive } from '@/services/dicomProcessor'
import { OPFSStorage, OPFSStorageLive } from '@/services/opfsStorage'
import { FileHandler, FileHandlerLive } from '@/services/fileHandler'
import { OPFSWorkerHelper } from '@/services/opfsStorage/opfsWorkerHelper'
import type { AnonymizationConfig, DicomFile } from '@/types/dicom'

// Worker-specific layer that excludes services requiring browser APIs like localStorage
const WorkerServicesLayer = Layer.mergeAll(
  ConfigServiceLive,
  FileHandlerLive,
  OPFSStorageLive,
  DicomProcessorLive,
  AnonymizerLive
).pipe(
  Layer.provide(Layer.mergeAll(
    ConfigServiceLive,
    FileHandlerLive,
    OPFSStorageLive
  ))
)

// Worker-specific runtime helper
function runWithWorkerServices<A, E>(effect: Effect.Effect<A, E, any>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(WorkerServicesLayer)))
}

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
 * Convert OPFS file reference to DicomFile for Effect services
 * Parse metadata using DicomProcessor service
 */
async function createDicomFileFromReference(fileRef: MinimalFileReference): Promise<DicomFile> {
  const arrayBuffer = await OPFSWorkerHelper.loadFile(fileRef.opfsFileId)
  
  // Create basic DicomFile first
  const basicFile: DicomFile = {
    id: fileRef.id,
    fileName: fileRef.fileName,
    fileSize: arrayBuffer.byteLength,
    arrayBuffer,
    anonymized: false
  }
  
  // Parse metadata using DicomProcessor service
  const parsedFile = await runWithWorkerServices(
    Effect.gen(function* () {
      const processor = yield* DicomProcessor
      return yield* processor.parseFile(basicFile)
    })
  )
  
  return parsedFile
}

// Effect-based file anonymization using services
async function anonymizeFile(fileRef: MinimalFileReference, config: AnonymizationConfig, sharedTimestamp: string): Promise<MinimalFileReference> {
  try {
    console.log(`[Worker] Loading file ${fileRef.fileName} from OPFS (${fileRef.opfsFileId})`)
    
    // Create DicomFile from OPFS reference
    const dicomFile = await createDicomFileFromReference(fileRef)
    
    console.log(`[Worker] Anonymizing file ${fileRef.fileName} using Effect services`)

    // Use Effect services for anonymization
    const anonymizedFile = await runWithWorkerServices(
      Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        
        // Use shared timestamp for consistent replacements across files
        return yield* anonymizer.anonymizeFile(dicomFile, config, sharedTimestamp)
      })
    )

    // Create new OPFS file ID for anonymized version
    const anonymizedOpfsFileId = `${fileRef.opfsFileId}_anonymized`

    // Save anonymized file to OPFS
    await OPFSWorkerHelper.saveFile(anonymizedOpfsFileId, anonymizedFile.arrayBuffer)

    console.log(`[Worker] Successfully anonymized and saved ${fileRef.fileName} to OPFS`)

    // Return minimal reference to anonymized file
    return {
      id: fileRef.id,
      fileName: fileRef.fileName,
      opfsFileId: anonymizedOpfsFileId
    }
  } catch (error) {
    console.error(`[Worker] Error anonymizing file ${fileRef.fileName}:`, error)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to anonymize file: ${fileRef.fileName} - ${message}`)
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
    // Send error message with consistent Error handling
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    
    postMessage({
      type: 'error',
      studyId,
      data: {
        message: errorMessage,
        stack: errorStack
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
