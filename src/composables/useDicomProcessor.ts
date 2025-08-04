import { ref } from 'vue'
import { Effect, Layer } from 'effect'
import type { DicomFile } from '@/types/dicom'
import { DicomProcessor, DicomProcessorLive } from '@/services/dicomProcessor'
import { ConfigServiceLive } from '@/services/config'

// Compose the required Effect layers once for this composable
const processorLayer = Layer.mergeAll(
  DicomProcessorLive,
  ConfigServiceLive
)
// Helper to execute an Effect with the processor environment and return a Promise
const run = <A>(effect: Effect.Effect<A, any, any>) =>
  // @ts-ignore – Effect typing for provideLayer narrows env to never which conflicts with Vue TS config
  Effect.runPromise(effect.pipe(Effect.provide(processorLayer)))

export function useDicomProcessor() {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const lastResult = ref<DicomFile | DicomFile[] | null>(null)

  const parseFile = async (file: DicomFile): Promise<DicomFile | null> => {
    loading.value = true
    error.value = null
    try {
      const result = await run(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFile(file)
        })
      )
      lastResult.value = result
      return result
    } catch (e) {
      error.value = e as Error
      return null
    } finally {
      loading.value = false
    }
  }

  const parseFiles = async (files: DicomFile[], concurrency = 3): Promise<DicomFile[]> => {
    loading.value = true
    error.value = null
    try {
      const results = await run(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.parseFiles(files, concurrency)
        })
      )
      lastResult.value = results
      return results
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  const validateFile = async (file: DicomFile) => {
    loading.value = true
    error.value = null
    try {
      await run(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.validateFile(file)
        })
      )
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  const groupFilesByStudy = async (files: DicomFile[]) => {
    loading.value = true
    error.value = null
    try {
      const results = await run(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.groupFilesByStudy(files)
        })
      )
      return results
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    lastResult,
    parseFile,
    parseFiles,
    validateFile,
    groupFilesByStudy
  }
}
