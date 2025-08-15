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
    files: Array<{ id: string; fileName: string; arrayBuffer: ArrayBuffer; opfsFileId: string }>
    config: AnonymizationConfig
    concurrency?: number
  }
}

type WorkerResponse = 
  | { type: 'progress'; studyId: string; data: { total: number; completed: number; percentage: number; currentFile?: string } }
  | { type: 'complete'; studyId: string; data: { anonymizedFiles: DicomFile[] } }
  | { type: 'error'; studyId: string; data: { message: string; stack?: string } }

// Main worker function
async function anonymizeStudy(studyId: string, fileRefs: Array<{ id: string; fileName: string; arrayBuffer: ArrayBuffer; opfsFileId: string }>, config: AnonymizationConfig, concurrency = 3) {
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const opfs = yield* OPFSStorage
        const anonymizer = yield* Anonymizer

        // Create DicomFile objects from the data
        const dicomFiles: DicomFile[] = fileRefs.map(fileRef => ({
          id: fileRef.id,
          fileName: fileRef.fileName,
          fileSize: fileRef.arrayBuffer.byteLength,
          arrayBuffer: fileRef.arrayBuffer,
          anonymized: false,
          opfsFileId: fileRef.opfsFileId
        }))

        // Save files to OPFS first
        for (const file of dicomFiles) {
          yield* opfs.saveFile(file.opfsFileId!, file.arrayBuffer)
        }

        // Anonymize using service
        const result = yield* anonymizer.anonymizeStudy(studyId, dicomFiles, config, {
          concurrency,
          onProgress: (progress) => {
            self.postMessage({ type: 'progress', studyId, data: progress } as WorkerResponse)
          }
        })

        // Save anonymized files using service
        for (const file of result.anonymizedFiles) {
          const anonymizedId = `${file.opfsFileId}_anonymized`
          yield* opfs.saveFile(anonymizedId, file.arrayBuffer)
          file.opfsFileId = anonymizedId
          file.anonymized = true
        }

        // Send completion
        self.postMessage({ type: 'complete', studyId, data: { anonymizedFiles: result.anonymizedFiles } } as WorkerResponse)
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
