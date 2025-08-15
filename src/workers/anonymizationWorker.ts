/**
 * Ultra-simplified DICOM Anonymization Worker
 * Delegates all business logic to proper services
 */

import { Effect, Layer, ManagedRuntime } from 'effect'
import { Anonymizer, AnonymizerLive } from '@/services/anonymizer'
import { ConfigServiceLive } from '@/services/config'
import { DicomProcessorLive } from '@/services/dicomProcessor'
import { OPFSStorage, OPFSStorageLive } from '@/services/opfsStorage'
import { FileHandlerLive } from '@/services/fileHandler'
import type { AnonymizationConfig, DicomFile } from '@/types/dicom'

// Worker services layer - same as main thread
const WorkerLayer = Layer.mergeAll(
  ConfigServiceLive,
  FileHandlerLive,
  OPFSStorageLive,
  DicomProcessorLive,
  AnonymizerLive
)

const runtime = ManagedRuntime.make(WorkerLayer)

// Message types
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: Array<{ id: string; fileName: string; fileSize: number; opfsFileId: string; metadata?: any }>
    config: AnonymizationConfig
    concurrency?: number
  }
}

type WorkerResponse = 
  | { type: 'progress'; studyId: string; data: { total: number; completed: number; percentage: number; currentFile?: string } }
  | { type: 'complete'; studyId: string; data: { anonymizedFiles: DicomFile[] } }
  | { type: 'error'; studyId: string; data: { message: string; stack?: string } }

// Main worker function
async function anonymizeStudy(studyId: string, fileRefs: Array<{ id: string; fileName: string; fileSize: number; opfsFileId: string; metadata?: any }>, config: AnonymizationConfig, concurrency = 3) {
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const opfs = yield* OPFSStorage
        const anonymizer = yield* Anonymizer

        // Load files from OPFS and create DicomFile objects
        const dicomFiles: DicomFile[] = []
        for (const fileRef of fileRefs) {
          const arrayBuffer = yield* opfs.loadFile(fileRef.opfsFileId)
          dicomFiles.push({
            id: fileRef.id,
            fileName: fileRef.fileName,
            fileSize: fileRef.fileSize,
            arrayBuffer,
            anonymized: false,
            opfsFileId: fileRef.opfsFileId,
            metadata: fileRef.metadata
          })
        }

        // Anonymize using service
        const result = yield* anonymizer.anonymizeStudy(studyId, dicomFiles, config, {
          concurrency,
          onProgress: (progress) => {
            self.postMessage({ type: 'progress', studyId, data: progress } as WorkerResponse)
          }
        })

        // Save anonymized files back to OPFS
        for (const file of result.anonymizedFiles) {
          const anonymizedId = `${file.opfsFileId}_anonymized`
          yield* opfs.saveFile(anonymizedId, file.arrayBuffer)
          file.opfsFileId = anonymizedId
          file.anonymized = true
        }

        // Send completion - return files without ArrayBuffers since main thread will reload from OPFS
        const anonymizedFiles = result.anonymizedFiles.map(file => ({
          ...file,
          arrayBuffer: new ArrayBuffer(0) // Empty ArrayBuffer since main thread will reload from OPFS
        }))

        self.postMessage({ type: 'complete', studyId, data: { anonymizedFiles } } as WorkerResponse)
      })
    )
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      studyId, 
      data: { 
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      } 
    } as WorkerResponse)
  }
}

// Message listener
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data
  
  if (type === 'anonymize_study') {
    anonymizeStudy(data.studyId, data.files, data.config, data.concurrency)
  }
})

// Ready signal
self.postMessage({ type: 'complete', studyId: 'worker-ready', data: { anonymizedFiles: [] } } as WorkerResponse)
