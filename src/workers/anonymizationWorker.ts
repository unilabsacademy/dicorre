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


// Study anonymization using Effect service (pure I/O layer)
async function anonymizeStudy(
  studyId: string,
  files: MinimalFileReference[],
  config: AnonymizationConfig,
  concurrency = 3
) {
  try {
    console.log(`[Worker] Starting I/O operations for study ${studyId} with ${files.length} files`)
    
    // Convert OPFS file references to DicomFiles
    const dicomFiles: DicomFile[] = []
    for (const fileRef of files) {
      const dicomFile = await createDicomFileFromReference(fileRef)
      dicomFiles.push(dicomFile)
    }
    
    console.log(`[Worker] Loaded ${dicomFiles.length} DICOM files from OPFS`)
    
    // Use Effect service for study anonymization
    const result = await runWithWorkerServices(
      Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        
        return yield* anonymizer.anonymizeStudy(studyId, dicomFiles, config, {
          concurrency,
          onProgress: (progress) => {
            // Forward progress updates to main thread
            postMessage({
              type: 'progress',
              studyId,
              data: progress
            })
          }
        })
      })
    )
    
    console.log(`[Worker] Effect service completed anonymization: ${result.anonymizedFiles.length} files`)
    
    // Save anonymized files back to OPFS and create references
    const anonymizedFileRefs: DicomFile[] = []
    for (let i = 0; i < result.anonymizedFiles.length; i++) {
      const anonymizedFile = result.anonymizedFiles[i]
      const originalRef = files[i]
      
      // Create new OPFS file ID for anonymized version
      const anonymizedOpfsFileId = `${originalRef.opfsFileId}_anonymized`
      
      // Save to OPFS
      await OPFSWorkerHelper.saveFile(anonymizedOpfsFileId, anonymizedFile.arrayBuffer)
      
      // Create DicomFile with anonymized flag set to true
      anonymizedFileRefs.push({
        id: originalRef.id,
        fileName: originalRef.fileName,
        fileSize: anonymizedFile.arrayBuffer.byteLength,
        arrayBuffer: anonymizedFile.arrayBuffer,
        anonymized: true,
        metadata: anonymizedFile.metadata,
        opfsFileId: anonymizedOpfsFileId
      })
    }

    console.log(`[Worker] Saved ${anonymizedFileRefs.length} anonymized files to OPFS`)
    
    // Send completion message
    postMessage({
      type: 'complete',
      studyId,
      data: { anonymizedFiles: anonymizedFileRefs }
    })

  } catch (error) {
    console.error('Worker I/O error:', error)
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
