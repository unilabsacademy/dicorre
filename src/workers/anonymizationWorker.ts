import { Effect, ManagedRuntime } from 'effect'
import { Anonymizer } from '@/services/anonymizer'
import { AppLayer } from '@/services/shared/layers'
import { OPFSStorage } from '@/services/opfsStorage'
import type { DicomFile } from '@/types/dicom'
import type { AnonymizationConfig } from '@/services/config/schema'

const runtime = ManagedRuntime.make(AppLayer)

// Message types
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: Array<{ id: string; fileName: string; fileSize: number; opfsFileId: string; metadata?: any }>
    anonymizationConfig: AnonymizationConfig
    concurrency?: number
    patientIdMap?: Record<string, string>
  }
}

type WorkerResponse =
  | { type: 'progress'; studyId: string; data: { total: number; completed: number; percentage: number; currentFile?: string } }
  | { type: 'complete'; studyId: string; data: { anonymizedFiles: DicomFile[] } }
  | { type: 'error'; studyId: string; data: { message: string; stack?: string } }

// Main worker function
async function anonymizeStudy(studyId: string, fileRefs: Array<{ id: string; fileName: string; fileSize: number; opfsFileId: string; metadata?: any }>, anonymizationConfig: AnonymizationConfig, concurrency = 3, patientIdMap?: Record<string, string>) {
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const opfs = yield* OPFSStorage
        const anonymizer = yield* Anonymizer

        // Load files from OPFS with error recovery
        const fileLoadingEffects = fileRefs.map(fileRef =>
          Effect.gen(function* () {
            console.log(`Loading file from OPFS: ${fileRef.opfsFileId}`)

            // Load with retry and detailed error logging
            const arrayBuffer = yield* opfs.loadFile(fileRef.opfsFileId).pipe(
              Effect.catchAll(error =>
                Effect.gen(function* () {
                  yield* Effect.logError(`Failed to load file ${fileRef.opfsFileId}: ${error.message}`)
                  // Re-throw the error with more context
                  return yield* Effect.fail(new Error(`File loading failed for ${fileRef.fileName} (${fileRef.opfsFileId}): ${error.message}`))
                })
              )
            )

            return {
              id: fileRef.id,
              fileName: fileRef.fileName,
              fileSize: fileRef.fileSize,
              arrayBuffer,
              anonymized: false,
              opfsFileId: fileRef.opfsFileId,
              metadata: fileRef.metadata
            } as DicomFile
          })
        )

        // Load all files concurrently with proper error isolation
        const dicomFiles = yield* Effect.all(fileLoadingEffects, {
          concurrency: 3,
          batching: false
        }).pipe(
          Effect.catchAll(error =>
            Effect.gen(function* () {
              yield* Effect.logError(`Study ${studyId} file loading failed: ${error.message}`)
              return yield* Effect.fail(error)
            })
          )
        )

        // Anonymize using service with passed config
        const result = yield* anonymizer.anonymizeStudy(studyId, dicomFiles, anonymizationConfig, {
          concurrency,
          patientIdMap,
          onProgress: (progress) => {
            self.postMessage({ type: 'progress', studyId, data: progress } as WorkerResponse)
          }
        })

        // Save anonymized files back to OPFS with error recovery
        const saveEffects = result.anonymizedFiles.map(file =>
          Effect.gen(function* () {
            // Overwrite original logical id with anonymized bytes
            const targetId = file.id
            console.log(`Saving anonymized file to OPFS under original id: ${targetId}`)

            yield* opfs.saveFile(targetId, file.arrayBuffer).pipe(
              Effect.catchAll(error =>
                Effect.gen(function* () {
                  yield* Effect.logError(`Failed to save anonymized file ${targetId}: ${error.message}`)
                  return yield* Effect.fail(new Error(`File saving failed for ${file.fileName}: ${error.message}`))
                })
              )
            )

            // Delete previous OPFS object if it was different from logical id
            if (file.opfsFileId && file.opfsFileId !== targetId) {
              yield* opfs.deleteFile(file.opfsFileId).pipe(
                Effect.catchAll(() => Effect.succeed(undefined))
              )
            }

            // Update file properties to point to canonical id
            file.opfsFileId = targetId
            file.anonymized = true
            return file
          })
        )

        // Save all files concurrently
        yield* Effect.all(saveEffects, {
          concurrency: 3,
          batching: false
        }).pipe(
          Effect.catchAll(error =>
            Effect.gen(function* () {
              yield* Effect.logError(`Study ${studyId} file saving failed: ${error.message}`)
              return yield* Effect.fail(error)
            })
          )
        )

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
    anonymizeStudy(data.studyId, data.files, data.anonymizationConfig, data.concurrency, data.patientIdMap)
  }
})

// Ready signal
self.postMessage({ type: 'complete', studyId: 'worker-ready', data: { anonymizedFiles: [] } } as WorkerResponse)
