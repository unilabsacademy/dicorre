import { ref, computed } from 'vue'
import { Effect } from 'effect'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { Anonymizer, type AnonymizationProgress } from '@/services/anonymizer'
import { DicomProcessor } from '@/services/dicomProcessor'
import { getWorkerManager } from '@/workers/workerManager'

// Environment variable to control worker usage (can be toggled for debugging)
let USE_WORKERS = true // Both worker and Effect-based paths working correctly

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
  // UI state management with Vue refs
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<AnonymizationProgress | null>(null)
  const results = ref<DicomFile[]>([])

  // Effect program for anonymizing a single file
  const anonymizeFile = (file: DicomFile, config: AnonymizationConfig) =>
    Effect.gen(function* () {
      const anonymizer = yield* Anonymizer
      return yield* anonymizer.anonymizeFile(file, config)
    })

  // Effect program for anonymizing multiple files
  const anonymizeFiles = (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency = 3,
    options?: { onProgress?: (progress: AnonymizationProgress) => void }
  ) =>
    Effect.gen(function* () {
      if (USE_WORKERS) {
        console.log('[useAnonymizer] Using WorkerManager for anonymization')
        return yield* anonymizeFilesWithWorkersEffect(files, config, concurrency, options)
      } else {
        console.log('[useAnonymizer] Using Effect services for anonymization')
        return yield* anonymizeFilesWithEffect(files, config, concurrency, options)
      }
    })

  // Worker-based anonymization as Effect program
  const anonymizeFilesWithWorkersEffect = (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency: number,
    options?: { onProgress?: (progress: AnonymizationProgress) => void }
  ) =>
    Effect.async<DicomFile[], Error>((resume) => {
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
          
          try {
            // Load anonymized files from OPFS and parse their metadata to update the UI
            const anonymizedFiles = await Promise.all(
              anonymizedFileRefs.map(async (fileRef: any) => {
                try {
                  // Load the anonymized file data from OPFS
                  const arrayBuffer = await Effect.runPromise(
                    Effect.gen(function* () {
                      const opfsStorage = yield* Effect.succeed({
                        async loadFile(fileId: string) {
                          // Use the OPFSWorkerHelper to load the file
                          const { OPFSWorkerHelper } = await import('@/services/opfsStorage/opfsWorkerHelper')
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
                  const parsedFile = await Effect.runPromise(
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
            resume(Effect.succeed(anonymizedFiles))
          } catch (err) {
            resume(Effect.fail(err as Error))
          }
        },
        onError: (err) => {
          console.error('[useAnonymizer] Worker anonymization error:', err)
          error.value = err
          resume(Effect.fail(err))
        }
      })
    })

  // Effect-based anonymization (fallback)
  const anonymizeFilesWithEffect = (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency: number,
    options?: { onProgress?: (progress: AnonymizationProgress) => void }
  ) =>
    Effect.gen(function* () {
      const anonymizer = yield* Anonymizer
      const anonymizedFiles = yield* anonymizer.anonymizeFiles(files, config, {
        concurrency,
        onProgress: (p) => {
          progress.value = p
          options?.onProgress?.(p)
        }
      })
      results.value = anonymizedFiles
      return anonymizedFiles
    })

  // Effect program for batch anonymization
  const anonymizeInBatches = (
    files: DicomFile[],
    config: AnonymizationConfig,
    batchSize = 10
  ) =>
    Effect.gen(function* () {
      const anonymizer = yield* Anonymizer
      const anonymizedFiles = yield* anonymizer.anonymizeInBatches(files, config, batchSize, (batchIdx, totalBatches) => {
        progress.value = {
          total: totalBatches,
          completed: batchIdx,
          percentage: Math.round((batchIdx / totalBatches) * 100)
        }
      })
      results.value = anonymizedFiles
      return anonymizedFiles
    })

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
    results.value = []
  }

  const progressPercentage = computed(() => progress.value?.percentage || 0)
  
  const isUsingWorkers = computed(() => USE_WORKERS)

  return {
    // UI state
    loading,
    error,
    progress,
    results,
    progressPercentage,
    isUsingWorkers,
    // Effect programs
    anonymizeFile,
    anonymizeFiles,
    anonymizeInBatches,
    reset
  }
}
