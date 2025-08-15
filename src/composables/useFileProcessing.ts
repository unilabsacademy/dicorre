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
          // Real progress tracking for ZIP extraction (0-30%)
          const extractedFiles = yield* fileHandler.extractZipFile(file, {
            onProgress: (completed, total, currentFile) => {
              const extractionProgress = Math.round((completed / total) * 30) // 0% to 30%
              fileProcessingState.value = {
                ...fileProcessingState.value,
                currentStep: `Extracting from ZIP: ${currentFile || 'processing...'}`,
                progress: extractionProgress,
                currentFileIndex: completed,
                totalFiles: total
              }
            }
          })
          localDicomFiles.push(...extractedFiles)

          fileProcessingState.value = {
            ...fileProcessingState.value,
            currentStep: `Extracted ${extractedFiles.length} DICOM files from ZIP`,
            progress: 30
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
        currentStep: 'Starting DICOM parsing...',
        progress: 0,
        totalFiles: localDicomFiles.length,
        currentFileIndex: 0
      }

      // Phase 1: Parse DICOM files (30-70%)
      const parsedFiles = yield* processor.parseFiles(localDicomFiles, options.concurrency, {
        onProgress: (completed, total, currentFile) => {
          const parsingProgress = Math.round(30 + (completed / total) * 40) // 30% to 70%
          fileProcessingState.value = {
            ...fileProcessingState.value,
            currentStep: `Parsing DICOM file: ${currentFile?.fileName || 'processing...'}`,
            progress: parsingProgress,
            currentFileIndex: completed
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
          ...fileProcessingState.value,
          currentStep: `Saving file to storage: ${file.fileName}`,
          progress: saveProgress,
          currentFileIndex: i + 1
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
        ...fileProcessingState.value,
        currentStep: 'Organizing files into studies...',
        progress: 95
      }

      // Only now add to existing DICOM files (after OPFS persistence is complete)
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
