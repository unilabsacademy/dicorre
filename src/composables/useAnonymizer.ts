import { ref, computed } from 'vue'
import { Stream } from 'effect'
import type { DicomFile } from '@/types/dicom'
import type { AnonymizationConfig } from '@/services/config/schema'
import type { AnonymizationEvent } from '@/types/events'
import type { AnonymizationProgress } from '@/services/anonymizer'
import { getAnonymizationWorkerManager } from '@/workers/workerManager'

export function useAnonymizer() {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<AnonymizationProgress | null>(null)

  const anonymizeStudyStream = (
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
