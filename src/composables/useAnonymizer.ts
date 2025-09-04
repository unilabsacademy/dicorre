import { ref, computed } from 'vue'
import { Effect, Stream } from 'effect'
import type { DicomFile, DicomFieldOverrides } from '@/types/dicom'
import type { AnonymizationEvent } from '@/types/events'
import type { AnonymizationProgress } from '@/services/anonymizer'
import type { RuntimeType } from '@/types/effects'
import { ConfigService } from '@/services/config'
import { getAnonymizationWorkerManager } from '@/workers/workerManager'

export function useAnonymizer(runtime: RuntimeType) {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<AnonymizationProgress | null>(null)

  const anonymizeStudyStream = (
    studyId: string,
    files: DicomFile[],
    concurrency: number,
    fieldOverrides?: DicomFieldOverrides,
    patientIdMap?: Record<string, string>
  ): Stream.Stream<AnonymizationEvent, Error> =>
    Stream.async<AnonymizationEvent, Error>((emit) => {
      // Get config and pass it to worker
      runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          const anonymizationConfig = yield* configService.getAnonymizationConfig

          const workerManager = getAnonymizationWorkerManager()
          workerManager.anonymizeStudy({
            studyId,
            files,
            anonymizationConfig,
            concurrency,
            fieldOverrides,
            patientIdMap,
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
      ).catch(error => {
        emit.fail(error as Error)
      })
    })

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
  }

  const progressPercentage = computed(() => progress.value?.percentage || 0)

  return {
    loading,
    error,
    progress,
    progressPercentage,
    anonymizeStudyStream,
    reset
  }
}
