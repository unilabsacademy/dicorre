import { ref, computed } from 'vue'
import { Effect, Layer } from 'effect'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { Anonymizer, AnonymizerLive, type AnonymizationProgress } from '@/services/anonymizer'
import { DicomProcessorLive } from '@/services/dicomProcessor'
import { ConfigServiceLive } from '@/services/config'

const anonymizerLayer = Layer.mergeAll(
  AnonymizerLive,
  DicomProcessorLive,
  ConfigServiceLive
)

const run = <A>(effect: Effect.Effect<A, any, any>) =>
  // @ts-ignore – Typing clash between provide and env never
  Effect.runPromise(effect.pipe(Effect.provide(anonymizerLayer)))

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
      const anonymizedFiles = await run(
        Effect.gen(function* () {
          const anonymizer = yield* Anonymizer
          return yield* anonymizer.anonymizeFiles(files, config, {
            concurrency,
            onProgress: (p) => {
              progress.value = p
              // Call custom progress callback if provided
              if (options?.onProgress) {
                options.onProgress(p)
              }
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

  return {
    loading,
    error,
    progress,
    results,
    progressPercentage,
    anonymizeFile,
    anonymizeFiles,
    anonymizeInBatches,
    reset
  }
}
