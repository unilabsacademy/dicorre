import { ref, computed } from 'vue'
import { Effect, Stream } from 'effect'
import type { DicomFile, AnonymizationConfig, DicomStudy } from '@/types/dicom'
import type { AnonymizationEvent } from '@/types/events'
import { Anonymizer, type AnonymizationProgress } from '@/services/anonymizer'
import { getAnonymizationWorkerManager } from '@/workers/workerManager'

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

  /**
   * Unified stream-based anonymization that works with both workers and Effect services
   * Always returns a stream of AnonymizationEvent regardless of execution path
   */
  const anonymizeStudyStream = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    options: { concurrency?: number } = {}
  ): Stream.Stream<AnonymizationEvent, Error> => {
    const { concurrency = 3 } = options

    if (USE_WORKERS) {
      console.log(`[useAnonymizer] Using workers for study ${studyId} with ${files.length} files`)
      return createWorkerBasedStream(studyId, files, config, concurrency)
    } else {
      console.log(`[useAnonymizer] Using Effect services for study ${studyId} with ${files.length} files`)
      return createEffectBasedStream(studyId, files, config, concurrency)
    }
  }

  /**
   * Create a stream that bridges worker messages to AnonymizationEvents
   */
  const createWorkerBasedStream = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency: number
  ): Stream.Stream<AnonymizationEvent, Error> =>
    Stream.async<AnonymizationEvent, Error>((emit) => {
      const workerManager = getAnonymizationWorkerManager()
      
      workerManager.anonymizeStudy({
        studyId,
        files,
        config,
        concurrency,
        onProgress: (progressData) => {
          emit.single({
            _tag: "AnonymizationProgress",
            studyId,
            completed: progressData.completed,
            total: progressData.total,
            currentFile: progressData.currentFile
          })
        },
        onComplete: (anonymizedFiles) => {
          emit.single({
            _tag: "StudyAnonymized",
            studyId,
            files: anonymizedFiles
          })
          emit.end()
        },
        onError: (err) => {
          emit.single({
            _tag: "AnonymizationError",
            studyId,
            error: err
          })
          emit.fail(err)
        }
      })
      
      // Emit start event immediately
      emit.single({
        _tag: "AnonymizationStarted",
        studyId,
        totalFiles: files.length
      })
    })

  /**
   * Create a stream using Effect services directly
   */
  const createEffectBasedStream = (
    studyId: string,
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency: number
  ): Stream.Stream<AnonymizationEvent, Error> =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const anonymizer = yield* Anonymizer
        return anonymizer.anonymizeStudyStream(studyId, files, config, { concurrency })
      }).pipe(Effect.mapError(error => new Error(String(error))))
    ).pipe(
      Stream.flatten,
      Stream.mapError(error => error instanceof Error ? error : new Error(String(error)))
    )

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
  }

  const progressPercentage = computed(() => progress.value?.percentage || 0)
  const isUsingWorkers = computed(() => USE_WORKERS)

  return {
    // UI state
    loading,
    error,
    progress,
    progressPercentage,
    isUsingWorkers,
    // Unified stream-based anonymization
    anonymizeStudyStream,
    reset
  }
}
