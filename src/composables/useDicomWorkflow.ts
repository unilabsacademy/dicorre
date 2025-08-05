import { computed, onUnmounted, ref } from 'vue'
import { Effect } from 'effect'
import type { DicomFile, DicomStudy, AnonymizationConfig } from '@/types/dicom'
import { DicomProcessor } from '@/services/dicomProcessor'
import { Anonymizer } from '@/services/anonymizer'
import { DicomSender } from '@/services/dicomSender'
import { FileHandler } from '@/services/fileHandler'
import type { DicomProcessorError, AnonymizerError, DicomSenderError } from '@/types/effects'

export function useDicomWorkflow() {
  // UI state management with Vue refs
  const loading = ref(false)
  const errors = ref<Error[]>([])

  // Effect program for processing files from File objects to DicomFile objects
  const processFiles = (files: File[], concurrency = 3) =>
    Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      const processor = yield* DicomProcessor
      
      // Extract files (handles both single files and ZIP archives)
      const extractedFiles: DicomFile[] = []
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const zipFiles = yield* fileHandler.extractZipFile(file)
          extractedFiles.push(...zipFiles)
        } else {
          const dicomFile = yield* fileHandler.readSingleDicomFile(file)
          extractedFiles.push(dicomFile)
        }
      }
      
      // Parse DICOM metadata
      return yield* processor.parseFiles(extractedFiles, concurrency)
    })

  // Effect program for anonymizing DICOM files
  const anonymizeFiles = (
    files: DicomFile[], 
    config: AnonymizationConfig, 
    options?: { concurrency?: number; onProgress?: (progress: any) => void }
  ) =>
    Effect.gen(function* () {
      const anonymizer = yield* Anonymizer
      return yield* anonymizer.anonymizeFiles(files, config, options)
    })
  
  // Effect program for sending a study
  const sendStudy = (
    study: DicomStudy,
    options?: { concurrency?: number; maxRetries?: number; onProgress?: (progress: any) => void }
  ) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.sendStudyWithProgress(study, options)
    })

  // Effect program for complete workflow: process → anonymize → send
  const processAnonymizeAndSend = (
    files: File[],
    config: AnonymizationConfig,
    studyInfo: Partial<DicomStudy>,
    options: { concurrency?: number; maxRetries?: number } = {}
  ) =>
    Effect.gen(function* () {
      // Process files
      const parsed = yield* processFiles(files, options.concurrency)
      if (parsed.length === 0) {
        return yield* Effect.fail(new Error('No valid DICOM files found'))
      }

      // Anonymize files
      const anonymized = yield* anonymizeFiles(parsed, config, { concurrency: options.concurrency })
      if (anonymized.length === 0) {
        return yield* Effect.fail(new Error('Anonymization failed'))
      }

      // Create study structure
      const study: DicomStudy = {
        studyInstanceUID: studyInfo.studyInstanceUID || `1.2.3.4.5.${Date.now()}`,
        patientName: studyInfo.patientName || 'Anonymous',
        patientId: studyInfo.patientId || `PAT${Date.now()}`,
        studyDate: studyInfo.studyDate || new Date().toISOString().split('T')[0].replace(/-/g, ''),
        studyDescription: studyInfo.studyDescription || 'Processed Study',
        accessionNumber: studyInfo.accessionNumber || `ACC${Date.now()}`,
        series: [
          {
            seriesInstanceUID: `1.2.3.4.6.${Date.now()}`,
            seriesDescription: 'Processed Series',
            modality: 'CT',
            files: anonymized
          }
        ]
      }

      // Send study
      const sentFiles = yield* sendStudy(study, options)
      return sentFiles.length > 0
    })

  const resetAll = () => {
    loading.value = false
    errors.value = []
  }

  onUnmounted(() => resetAll())

  return {
    // UI state
    loading,
    errors,
    // Effect programs
    processFiles,
    anonymizeFiles,
    sendStudy,
    processAnonymizeAndSend,
    resetAll
  }
}
