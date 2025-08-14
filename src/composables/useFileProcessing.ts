import { ref } from 'vue'
import { Effect } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'

export interface FileProcessingState {
  isProcessing: boolean
  fileName: string
  currentStep: string
  progress: number
  totalFiles?: number
  currentFileIndex?: number
}

export function useFileProcessing() {
  const fileProcessingState = ref<FileProcessingState | null>(null)

  const processNewFilesEffect = (
    newUploadedFiles: File[],
    options: {
      isAppReady: boolean
      concurrency: number
      dicomFiles: DicomFile[]
      onUpdateFiles?: (updatedFiles: DicomFile[]) => void
      onUpdateStudies?: (updatedStudies: DicomStudy[]) => void
    }
  ) =>
    Effect.gen(function* () {
      if (!options.isAppReady) {
        return yield* Effect.fail(new Error('Configuration not loaded'))
      }

      if (newUploadedFiles.length === 0) {
        return yield* Effect.succeed([])
      }

      const fileHandler = yield* FileHandler
      const processor = yield* DicomProcessor

      let localDicomFiles: DicomFile[] = []

      for (let i = 0; i < newUploadedFiles.length; i++) {
        const file = newUploadedFiles[i]

        // Update progress UI
        fileProcessingState.value = {
          isProcessing: true,
          fileName: file.name,
          currentStep: file.name.toLowerCase().endsWith('.zip') ? 'Extracting ZIP archive...' : 'Reading DICOM file...',
          progress: 0,
          totalFiles: newUploadedFiles.length,
          currentFileIndex: i
        }

        if (file.name.toLowerCase().endsWith('.zip')) {
          // Simulate progress steps for ZIP files
          const progressSteps = [10, 25, 40, 60, 75, 90]
          const stepTexts = [
            'Reading archive structure...',
            'Extracting files...',
            'Validating DICOM files...',
            'Processing file headers...',
            'Analyzing metadata...',
            'Finalizing extraction...'
          ]

          for (let step = 0; step < progressSteps.length; step++) {
            fileProcessingState.value = {
              ...fileProcessingState.value,
              currentStep: stepTexts[step],
              progress: progressSteps[step]
            }
          }

          const extractedFiles = yield* fileHandler.extractZipFile(file)
          localDicomFiles.push(...extractedFiles)

          fileProcessingState.value = {
            ...fileProcessingState.value,
            currentStep: `Extracted ${extractedFiles.length} DICOM files`,
            progress: 100
          }
        } else {
          fileProcessingState.value = {
            ...fileProcessingState.value,
            progress: 50
          }

          const dicomFile = yield* fileHandler.readSingleDicomFile(file)
          localDicomFiles.push(dicomFile)

          fileProcessingState.value = {
            ...fileProcessingState.value,
            currentStep: 'File processed',
            progress: 100
          }
        }
      }

      if (localDicomFiles.length === 0) {
        fileProcessingState.value = null
        return yield* Effect.fail(new Error('No DICOM files found in the uploaded files'))
      }

      console.log(`Extracted ${localDicomFiles.length} new DICOM files from ${newUploadedFiles.length} uploaded files`)

      fileProcessingState.value = {
        isProcessing: true,
        fileName: `${localDicomFiles.length} DICOM files`,
        currentStep: 'Parsing DICOM metadata...',
        progress: 0,
        totalFiles: localDicomFiles.length,
        currentFileIndex: 0
      }

      const parsingSteps = [20, 50, 80, 90]
      const parsingTexts = [
        'Reading DICOM headers...',
        'Extracting metadata...',
        'Validating file structure...',
        'Processing complete...'
      ]

      for (let step = 0; step < parsingSteps.length - 1; step++) {
        fileProcessingState.value = {
          ...fileProcessingState.value,
          currentStep: parsingTexts[step],
          progress: parsingSteps[step]
        }
      }

      const parsedFiles = yield* processor.parseFiles(localDicomFiles, options.concurrency)

      if (parsedFiles.length === 0) {
        fileProcessingState.value = null
        return yield* Effect.succeed([])
      }

      fileProcessingState.value = {
        ...fileProcessingState.value,
        currentStep: 'Organizing into studies...',
        progress: 90
      }

      // Add to existing DICOM files
      const updatedFiles = [...options.dicomFiles, ...parsedFiles]
      options.onUpdateFiles?.(updatedFiles)

      // Group files by study
      const groupedStudies = yield* processor.groupFilesByStudy(updatedFiles)
      options.onUpdateStudies?.(groupedStudies)

      console.log(`Parsed ${parsedFiles.length} new files, total: ${updatedFiles.length} files in ${groupedStudies.length} studies`)

      fileProcessingState.value = {
        ...fileProcessingState.value,
        fileName: `Processing complete`,
        currentStep: `Successfully processed ${parsedFiles.length} files into ${groupedStudies.length} studies`,
        progress: 100
      }

      setTimeout(() => {
        fileProcessingState.value = null
      }, 300)

      return parsedFiles
    })

  const clearProcessingState = () => {
    fileProcessingState.value = null
  }

  return {
    fileProcessingState,
    processNewFilesEffect,
    clearProcessingState
  }
}
