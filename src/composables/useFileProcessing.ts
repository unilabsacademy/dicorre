import { ref } from 'vue'
import { Effect } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { OPFSStorage, OPFSStorageLive } from '@/services/opfsStorage'

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

      const localDicomFiles: DicomFile[] = []

      for (let i = 0; i < newUploadedFiles.length; i++) {
        const file = newUploadedFiles[i]
        const isZipFile = file.name.toLowerCase().endsWith('.zip')

        // Update progress UI
        fileProcessingState.value = {
          isProcessing: true,
          fileName: file.name,
          currentStep: isZipFile ? 'Extracting ZIP archive...' : 'Reading DICOM file...',
          progress: 0,
          totalFiles: newUploadedFiles.length,
          currentFileIndex: i
        }

        // For ZIP files, simulate gradual progress increase
        let progressInterval: NodeJS.Timeout | null = null
        if (isZipFile) {
          let currentProgress = 0
          progressInterval = setInterval(() => {
            currentProgress = Math.min(currentProgress + 1, 30) // 0 - 30% progress
            if (fileProcessingState.value && fileProcessingState.value.fileName === file.name) {
              fileProcessingState.value = {
                ...fileProcessingState.value,
                progress: currentProgress
              }
            }
          }, 100)
        }

        // Use the new processFile method that handles plugins
        const processedFiles = yield* fileHandler.processFile(file)

        // Clear the progress interval if it was set
        if (progressInterval) {
          clearInterval(progressInterval)
        }

        if (processedFiles.length > 0) {
          localDicomFiles.push(...processedFiles)

          // Brief completion state before moving to next file
          fileProcessingState.value = {
            isProcessing: true,
            fileName: file.name,
            currentStep: `Processed ${processedFiles.length} file(s)`,
            progress: 100,
            currentFileIndex: i + 1,
            totalFiles: newUploadedFiles.length
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
        currentStep: 'Starting DICOM parsing...',
        progress: 0,
        totalFiles: localDicomFiles.length,
        currentFileIndex: 0
      }

      // Phase 1: Parse DICOM files (30-70%)
      const parsedFiles = yield* processor.parseFiles(localDicomFiles, options.concurrency, {
        onProgress: (completed: number, total: number, currentFile?: DicomFile) => {
          const parsingProgress = Math.round(30 + (completed / total) * 40) // 30% to 70%
          fileProcessingState.value = {
            isProcessing: true,
            fileName: fileProcessingState.value?.fileName || `${localDicomFiles.length} DICOM files`,
            currentStep: `Parsing DICOM file: ${currentFile?.fileName || 'processing...'}`,
            progress: parsingProgress,
            currentFileIndex: completed,
            totalFiles: fileProcessingState.value?.totalFiles
          }
        }
      })

      if (parsedFiles.length === 0) {
        fileProcessingState.value = null
        return yield* Effect.succeed([])
      }

      // Phase 2: Save to OPFS (70-95%)
      const opfs = yield* OPFSStorage

      for (let i = 0; i < parsedFiles.length; i++) {
        const file = parsedFiles[i]
        const saveProgress = Math.round(70 + ((i + 1) / parsedFiles.length) * 25) // 70% to 95%

        fileProcessingState.value = {
          isProcessing: true,
          fileName: fileProcessingState.value?.fileName || `${parsedFiles.length} DICOM files`,
          currentStep: `Saving file to storage: ${file.fileName}`,
          progress: saveProgress,
          currentFileIndex: i + 1,
          totalFiles: fileProcessingState.value?.totalFiles
        }

        // Save file to OPFS and verify it exists
        yield* opfs.saveFile(file.id, file.arrayBuffer)
        const exists = yield* opfs.fileExists(file.id)
        if (!exists) {
          return yield* Effect.fail(new Error(`Failed to verify file in storage: ${file.fileName}`))
        }

        console.log(`File ${file.id} successfully saved and verified in OPFS`)
      }

      // Phase 3: Organize into studies (95-100%)
      fileProcessingState.value = {
        isProcessing: true,
        fileName: fileProcessingState.value?.fileName || `${parsedFiles.length} DICOM files`,
        currentStep: 'Organizing files into studies...',
        progress: 95,
        currentFileIndex: fileProcessingState.value?.currentFileIndex,
        totalFiles: fileProcessingState.value?.totalFiles
      }

      // Only now add to existing DICOM files (after OPFS persistence is complete)
      const updatedFiles = [...options.dicomFiles, ...parsedFiles]
      options.onUpdateFiles?.(updatedFiles)

      // Group files by study
      const groupedStudies = yield* processor.groupFilesByStudy(updatedFiles)
      options.onUpdateStudies?.(groupedStudies)

      console.log(`Parsed ${parsedFiles.length} new files, total: ${updatedFiles.length} files in ${groupedStudies.length} studies`)

      fileProcessingState.value = {
        isProcessing: true,
        fileName: `Processing complete`,
        currentStep: `Successfully processed ${parsedFiles.length} files into ${groupedStudies.length} studies`,
        progress: 100,
        currentFileIndex: fileProcessingState.value?.currentFileIndex,
        totalFiles: fileProcessingState.value?.totalFiles
      }

      setTimeout(() => {
        fileProcessingState.value = null
      }, 300)

      return parsedFiles
    }).pipe(
      Effect.provide(OPFSStorageLive)
    )

  const clearProcessingState = () => {
    fileProcessingState.value = null
  }

  return {
    fileProcessingState,
    processNewFilesEffect,
    clearProcessingState
  }
}
