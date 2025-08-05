import { ref } from 'vue'
import { Effect } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import { DicomProcessor } from '@/services/dicomProcessor'

export function useDicomProcessor() {
  // UI state management with Vue refs
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const lastResult = ref<DicomFile | DicomFile[] | null>(null)

  // Effect program for parsing a single file
  const parseFile = (file: DicomFile) =>
    Effect.gen(function* () {
      const processor = yield* DicomProcessor
      const result = yield* processor.parseFile(file)
      lastResult.value = result
      return result
    })

  // Effect program for parsing multiple files
  const parseFiles = (files: DicomFile[], concurrency = 3) =>
    Effect.gen(function* () {
      const processor = yield* DicomProcessor
      const results = yield* processor.parseFiles(files, concurrency)
      lastResult.value = results
      return results
    })

  // Effect program for validating a file
  const validateFile = (file: DicomFile) =>
    Effect.gen(function* () {
      const processor = yield* DicomProcessor
      return yield* processor.validateFile(file)
    })

  // Effect program for grouping files by study
  const groupFilesByStudy = (files: DicomFile[]) =>
    Effect.gen(function* () {
      const processor = yield* DicomProcessor
      return yield* processor.groupFilesByStudy(files)
    })

  const reset = () => {
    loading.value = false
    error.value = null
    lastResult.value = null
  }

  return {
    // UI state
    loading,
    error,
    lastResult,
    // Effect programs
    parseFile,
    parseFiles,
    validateFile,
    groupFilesByStudy,
    reset
  }
}
