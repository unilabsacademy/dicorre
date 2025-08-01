import { ref, computed } from 'vue'
import { Effect, Layer } from 'effect'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { Anonymizer, AnonymizerLive, type AnonymizationProgress } from '@/services/anonymizer'
import { DicomProcessor, DicomProcessorLive } from '@/services/dicomProcessor'
import { ConfigServiceLive } from '@/services/config'
import { getWorkerManager } from '@/services/workerManager'

const anonymizerLayer = Layer.mergeAll(
  AnonymizerLive,
  DicomProcessorLive,
  ConfigServiceLive
)

const run = <A>(effect: Effect.Effect<A, any, any>) =>
  // @ts-ignore – Typing clash between provide and env never
  Effect.runPromise(effect.pipe(Effect.provide(anonymizerLayer)))

// Environment variable to control worker usage (can be toggled for debugging)
let USE_WORKERS = import.meta.env.VITE_USE_WORKERS !== 'false'

// Allow runtime toggling for debugging
if (typeof window !== 'undefined') {
  (window as any).toggleWorkers = (enabled?: boolean) => {
    USE_WORKERS = enabled ?? !USE_WORKERS
    console.log(`[useAnonymizer] Workers ${USE_WORKERS ? 'ENABLED' : 'DISABLED'}`)
    return USE_WORKERS
  }
  console.log(`[useAnonymizer] Workers are ${USE_WORKERS ? 'ENABLED' : 'DISABLED'}. Use toggleWorkers() to change.`)
}

export function useAnonymizer() {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<AnonymizationProgress | null>(null)
  const results = ref<DicomFile[]>([])

  const anonymizeFile = async (file: DicomFile, config: AnonymizationConfig): Promise<DicomFile | null> => {
    loading.value = true
    error.value = null
    try {
      const result = await run(
        Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.anonymizeFile(file, config)
        })
      )
      return result
    } catch (e) {
      error.value = e as Error
      return null
    } finally {
      loading.value = false
    }
  }

  const anonymizeFiles = async (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency = 3,
    options?: { onProgress?: (progress: AnonymizationProgress) => void }
  ): Promise<DicomFile[]> => {
    loading.value = true
    error.value = null
    progress.value = null
    results.value = []

    try {
      // Use workers if enabled, otherwise fall back to Effect services
      if (USE_WORKERS) {
        console.log('[useAnonymizer] Using WorkerManager for anonymization')
        return await anonymizeFilesWithWorkers(files, config, concurrency, options)
      } else {
        console.log('[useAnonymizer] Using Effect services for anonymization')
        return await anonymizeFilesWithEffect(files, config, concurrency, options)
      }
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  // Worker-based anonymization
  const anonymizeFilesWithWorkers = async (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency: number,
    options?: { onProgress?: (progress: AnonymizationProgress) => void }
  ): Promise<DicomFile[]> => {
    return new Promise((resolve, reject) => {
      const workerManager = getWorkerManager()
      const studyId = `study-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      console.log(`[useAnonymizer] Starting OPFS-based worker anonymization for ${files.length} files`)
      console.log(`[useAnonymizer] Study ID: ${studyId}`)

      workerManager.anonymizeStudy({
        studyId,
        files,
        config,
        concurrency,
        onProgress: (progressData) => {
          const progressInfo: AnonymizationProgress = {
            total: progressData.total,
            completed: progressData.completed,
            percentage: progressData.percentage,
            currentFile: progressData.currentFile
          }
          progress.value = progressInfo
          options?.onProgress?.(progressInfo)
        },
        onComplete: async (anonymizedFileRefs) => {
          console.log(`[useAnonymizer] Worker anonymization completed: ${anonymizedFileRefs.length} file references`)
          
          // Load anonymized files from OPFS and parse their metadata to update the UI
          const anonymizedFiles = await Promise.all(
            anonymizedFileRefs.map(async (fileRef: any) => {
              try {
                // Load the anonymized file data from OPFS
                const arrayBuffer = await run(
                  Effect.gen(function* () {
                    const opfsStorage = yield* Effect.succeed({
                      async loadFile(fileId: string) {
                        // Use the OPFSWorkerHelper to load the file
                        const { OPFSWorkerHelper } = await import('@/services/opfsWorkerHelper')
                        return await OPFSWorkerHelper.loadFile(fileId)
                      }
                    })
                    return yield* Effect.tryPromise(() => opfsStorage.loadFile(fileRef.opfsFileId))
                  })
                )

                // Create a temporary DicomFile to parse metadata
                const tempFile = {
                  id: fileRef.id,
                  fileName: fileRef.fileName,
                  fileSize: arrayBuffer.byteLength,
                  arrayBuffer,
                  anonymized: true,
                  opfsFileId: fileRef.opfsFileId
                }

                // Parse the anonymized file to get updated metadata
                const parsedFile = await run(
                  Effect.gen(function* () {
                    const processor = yield* DicomProcessor
                    return yield* processor.parseFile(tempFile)
                  })
                )

                console.log(`[useAnonymizer] Parsed anonymized file ${fileRef.fileName} with updated metadata`)

                return {
                  ...parsedFile,
                  arrayBuffer: new ArrayBuffer(0), // Empty - will load from OPFS when needed for performance
                  anonymized: true,
                  opfsFileId: fileRef.opfsFileId
                }

              } catch (error) {
                console.error(`[useAnonymizer] Failed to parse anonymized file ${fileRef.fileName}:`, error)
                // Fallback: use original file structure but mark as anonymized
                const originalFile = files.find(f => f.id === fileRef.id)
                return {
                  id: fileRef.id,
                  fileName: fileRef.fileName,
                  fileSize: originalFile?.fileSize || 0,
                  arrayBuffer: new ArrayBuffer(0),
                  metadata: originalFile?.metadata,
                  anonymized: true,
                  opfsFileId: fileRef.opfsFileId
                }
              }
            })
          )
          
          console.log(`[useAnonymizer] Created ${anonymizedFiles.length} parsed file references with updated metadata`)
          results.value = anonymizedFiles
          resolve(anonymizedFiles)
        },
        onError: (err) => {
          console.error('[useAnonymizer] Worker anonymization error:', err)
          error.value = err
          reject(err)
        }
      })
    })
  }

  // Effect-based anonymization (fallback)
  const anonymizeFilesWithEffect = async (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency: number,
    options?: { onProgress?: (progress: AnonymizationProgress) => void }
  ): Promise<DicomFile[]> => {
    const anonymizedFiles = await run(
      Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        return yield* anonymizer.anonymizeFiles(files, config, {
          concurrency,
          onProgress: (p) => {
            progress.value = p
            options?.onProgress?.(p)
          }
        })
      })
    )
    results.value = anonymizedFiles
    return anonymizedFiles
  }

  const anonymizeInBatches = async (
    files: DicomFile[],
    config: AnonymizationConfig,
    batchSize = 10
  ): Promise<DicomFile[]> => {
    loading.value = true
    error.value = null
    results.value = []
    try {
      const anonymizedFiles = await run(
        Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.anonymizeInBatches(files, config, batchSize, (batchIdx, totalBatches) => {
            progress.value = {
              total: totalBatches,
              completed: batchIdx,
              percentage: Math.round((batchIdx / totalBatches) * 100)
            }
          })
        })
      )
      results.value = anonymizedFiles
      return anonymizedFiles
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
    results.value = []
  }

  const progressPercentage = computed(() => progress.value?.percentage || 0)
  
  const isUsingWorkers = computed(() => USE_WORKERS)

  return {
    loading,
    error,
    progress,
    results,
    progressPercentage,
    isUsingWorkers,
    anonymizeFile,
    anonymizeFiles,
    anonymizeInBatches,
    reset
  }
}
