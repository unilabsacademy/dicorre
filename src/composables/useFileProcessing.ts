import { ref } from 'vue'
import { Effect, Fiber } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import type { RuntimeType } from '@/types/effects'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { OPFSStorage } from '@/services/opfsStorage'

export interface FileProcessingState {
  isProcessing: boolean
  fileName: string
  currentStep: string
  progress: number
  totalFiles?: number
  currentFileIndex?: number
}

// Individual file processing state for concurrent operations
export interface IndividualFileProcessingState {
  isProcessing: boolean
  fileName: string
  currentStep: string
  progress: number
  fileId: string
  startTime: number
  error?: string
}

export function useFileProcessing(runtime: RuntimeType) {
  const fileProcessingState = ref<FileProcessingState | null>(null)
  // Map to track individual file processing states for concurrent operations
  const individualFileProcessingStates = ref<Map<string, IndividualFileProcessingState>>(new Map())
  // Keep track of multiple active processing operations
  const activeProcessingOperations = ref<Map<string, Fiber.RuntimeFiber<DicomFile[], Error>>>(new Map())

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

      // Smart concurrency based on file count and system capability
      const fileConcurrency = Math.min(
        newUploadedFiles.length,
        Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2)),
        3 // Max 3 concurrent file processing operations
      )

      console.log(`Starting concurrent processing of ${newUploadedFiles.length} files with concurrency ${fileConcurrency}`)

      // Helper to update individual file processing state
      const updateFileProcessingState = (fileId: string, state: Partial<IndividualFileProcessingState>) =>
        Effect.sync(() => {
          const currentState = individualFileProcessingStates.value.get(fileId)
          if (currentState) {
            const updatedState = { ...currentState, ...state }
            individualFileProcessingStates.value.set(fileId, updatedState)
            // Force reactivity by creating a new Map
            individualFileProcessingStates.value = new Map(individualFileProcessingStates.value)
          }
        })

      // Create individual file processing effects - each file gets processed completely by one fiber
      const fileProcessingEffects = newUploadedFiles.map((file, index) => {
        const fileId = `${file.name}-${Date.now()}-${index}`
        const isZipFile = file.name.toLowerCase().endsWith('.zip')
        const startTime = Date.now()

        return Effect.gen(function* () {
          // Initialize file processing state
          const initialState: IndividualFileProcessingState = {
            isProcessing: true,
            fileName: file.name,
            currentStep: isZipFile ? 'Extracting ZIP archive...' : 'Reading DICOM file...',
            progress: 0,
            fileId,
            startTime
          }

          yield* Effect.sync(() => {
            individualFileProcessingStates.value.set(fileId, initialState)
            individualFileProcessingStates.value = new Map(individualFileProcessingStates.value)
          })

          try {
            // Phase 1: Process file (ZIP extraction or direct DICOM read) - 0-30%
            let progressInterval: NodeJS.Timeout | null = null
            if (isZipFile) {
              // For ZIP files, simulate gradual progress increase during extraction
              let currentProgress = 0
              progressInterval = setInterval(() => {
                currentProgress = Math.min(currentProgress + 2, 30) // 0 - 30% progress
                const state = individualFileProcessingStates.value.get(fileId)
                if (state && state.isProcessing) {
                  individualFileProcessingStates.value.set(fileId, {
                    ...state,
                    progress: currentProgress
                  })
                  individualFileProcessingStates.value = new Map(individualFileProcessingStates.value)
                }
              }, 100)
            }

            yield* updateFileProcessingState(fileId, {
              currentStep: isZipFile ? 'Extracting ZIP archive...' : 'Reading DICOM file...',
              progress: 0
            })

            // Process the file using FileHandler directly (no pre-reading needed since each fiber processes one file)
            const processedFiles = yield* fileHandler.processFile(file).pipe(
              Effect.tap(() => updateFileProcessingState(fileId, { progress: 30 }))
            )

            // Clear the progress interval
            if (progressInterval) {
              clearInterval(progressInterval)
            }

            if (processedFiles.length === 0) {
              yield* updateFileProcessingState(fileId, {
                currentStep: 'No DICOM files found',
                progress: 100,
                isProcessing: false,
                error: 'No DICOM files found in this file'
              })
              return []
            }

            // Phase 2: Parse DICOM files - 30-70%
            yield* updateFileProcessingState(fileId, {
              currentStep: `Parsing ${processedFiles.length} DICOM file(s)...`,
              progress: 30
            })

            const parsedFiles = yield* processor.parseFiles(processedFiles, options.concurrency, {
              onProgress: (completed: number, total: number, currentFile?: DicomFile) => {
                const parsingProgress = Math.round(30 + (completed / total) * 40) // 30% to 70%
                const state = individualFileProcessingStates.value.get(fileId)
                if (state && state.isProcessing) {
                  individualFileProcessingStates.value.set(fileId, {
                    ...state,
                    currentStep: `Parsing: ${currentFile?.fileName || 'processing...'}`,
                    progress: parsingProgress
                  })
                  individualFileProcessingStates.value = new Map(individualFileProcessingStates.value)
                }
              }
            })

            if (parsedFiles.length === 0) {
              yield* updateFileProcessingState(fileId, {
                currentStep: 'DICOM parsing failed',
                progress: 100,
                isProcessing: false,
                error: 'Failed to parse DICOM files'
              })
              return []
            }

            // Phase 3: Save to OPFS - 70-100%
            const opfs = yield* OPFSStorage

            for (let i = 0; i < parsedFiles.length; i++) {
              const dicomFile = parsedFiles[i]
              const saveProgress = Math.round(70 + ((i + 1) / parsedFiles.length) * 30) // 70% to 100%

              yield* updateFileProcessingState(fileId, {
                currentStep: `Saving ${dicomFile.fileName} to storage...`,
                progress: saveProgress
              })

              // Save file to OPFS and verify it exists
              yield* opfs.saveFile(dicomFile.id, dicomFile.arrayBuffer)
              const exists = yield* opfs.fileExists(dicomFile.id)
              if (!exists) {
                yield* updateFileProcessingState(fileId, {
                  currentStep: 'Failed to save to storage',
                  progress: 100,
                  isProcessing: false,
                  error: `Failed to verify file in storage: ${dicomFile.fileName}`
                })
                return yield* Effect.fail(new Error(`Failed to verify file in storage: ${dicomFile.fileName}`))
              }
            }

            // Completion
            yield* updateFileProcessingState(fileId, {
              currentStep: `Successfully processed ${parsedFiles.length} file(s)`,
              progress: 100,
              isProcessing: false
            })

            // Clear successful state immediately (no delay)
            setTimeout(() => {
              if (individualFileProcessingStates.value.has(fileId)) {
                const state = individualFileProcessingStates.value.get(fileId)
                // Only remove if still completed (not reused by another operation)
                if (state && !state.isProcessing && !state.error) {
                  individualFileProcessingStates.value.delete(fileId)
                  individualFileProcessingStates.value = new Map(individualFileProcessingStates.value)
                }
              }
            }, 0) // Use setTimeout with 0 to defer until after current execution

            console.log(`File ${file.name} processed successfully: ${parsedFiles.length} DICOM files`)
            return parsedFiles

          } catch (error) {
            // Handle errors at the file level
            yield* updateFileProcessingState(fileId, {
              currentStep: 'Processing failed',
              progress: 100,
              isProcessing: false,
              error: error instanceof Error ? error.message : String(error)
            })

            return yield* Effect.fail(error instanceof Error ? error : new Error(String(error)))
          }
        }).pipe(
          // Add error recovery per file with proper cleanup
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              console.error(`Failed to process file ${file.name}:`, error)

              // Update file state to show error
              yield* updateFileProcessingState(fileId, {
                isProcessing: false,
                currentStep: 'Processing failed',
                error: error instanceof Error ? error.message : String(error),
                progress: 100
              })

              return [] // Return empty array on error to continue with other files
            })
          ),
          // Add interruption handling
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              console.log(`File processing interrupted for ${file.name}`)
              // Update state to show interruption
              yield* updateFileProcessingState(fileId, {
                isProcessing: false,
                currentStep: 'Processing cancelled',
                error: 'Processing was cancelled',
                progress: 100
              })
            })
          )
        )
      })

      // Process all files concurrently
      const fileResults = yield* Effect.all(fileProcessingEffects, {
        concurrency: fileConcurrency,
        batching: true
      })

      // Flatten results and filter out empty arrays
      const localDicomFiles = fileResults.filter(files => files.length > 0).flat()

      if (localDicomFiles.length === 0) {
        // Check if we have error states to provide more specific feedback
        const errorStates = Array.from(individualFileProcessingStates.value.values())
          .filter(state => state.error)

        let errorMessage = 'No DICOM files found in the uploaded files'
        if (errorStates.length > 0) {
          const errors = errorStates.map(state => `${state.fileName}: ${state.error}`).join('; ')
          errorMessage = `Failed to process uploaded files: ${errors}`
        }

        // Keep error states visible for longer
        setTimeout(() => {
          individualFileProcessingStates.value.clear()
          individualFileProcessingStates.value = new Map()
        }, 5000) // Longer delay so user can see the errors

        return yield* Effect.fail(new Error(errorMessage))
      }

      console.log(`Successfully processed ${localDicomFiles.length} new DICOM files from ${newUploadedFiles.length} uploaded files using concurrent processing`)

      // Clear successfully completed individual file states immediately (no delay)
      // Keep error states visible for user review
      const errorStates = new Map<string, IndividualFileProcessingState>()
      for (const [key, state] of individualFileProcessingStates.value.entries()) {
        if (state.error) {
          errorStates.set(key, state)
        }
      }
      individualFileProcessingStates.value = errorStates

      // Clean up error states after a delay
      if (errorStates.size > 0) {
        setTimeout(() => {
          // Only clear the error states that are still the same (not from new operations)
          const currentStates = individualFileProcessingStates.value
          const activeStates = new Map()
          for (const [key, state] of currentStates.entries()) {
            if (state.isProcessing || !errorStates.has(key)) {
              activeStates.set(key, state)
            }
          }
          individualFileProcessingStates.value = activeStates
        }, 5000)
      }

      // Final phase: Organize into studies (internal state only, not shown in UI)
      console.log('Organizing files into studies...')

      // Only now add to existing DICOM files (after OPFS persistence is complete)
      const updatedFiles = [...options.dicomFiles, ...localDicomFiles]
      options.onUpdateFiles?.(updatedFiles)

      // Group files by study
      const groupedStudies = yield* processor.groupFilesByStudy(updatedFiles)
      options.onUpdateStudies?.(groupedStudies)

      console.log(`Organized ${localDicomFiles.length} new files, total: ${updatedFiles.length} files in ${groupedStudies.length} studies`)

      // No delay for successful completion - states were already cleared above

      return localDicomFiles
    })

  const clearProcessingState = () => {
    fileProcessingState.value = null
    // Only clear non-processing states
    const currentStates = individualFileProcessingStates.value
    const activeStates = new Map()
    for (const [key, state] of currentStates.entries()) {
      if (state.isProcessing) {
        activeStates.set(key, state)
      }
    }
    individualFileProcessingStates.value = activeStates
  }

  const getActiveFileProcessingStates = () => {
    return Array.from(individualFileProcessingStates.value.values()).filter(state => state.isProcessing)
  }

  const getAllFileProcessingStates = () => {
    return Array.from(individualFileProcessingStates.value.values())
  }

  const removeCompletedFileProcessingStates = () => {
    const currentStates = individualFileProcessingStates.value
    const activeStates = new Map()

    for (const [key, state] of currentStates.entries()) {
      // Keep processing states and recent errors (less than 5 seconds old)
      const isRecentError = state.error && (Date.now() - state.startTime < 5000)
      if (state.isProcessing || isRecentError) {
        activeStates.set(key, state)
      }
    }

    individualFileProcessingStates.value = activeStates
  }

  const hasActiveProcessing = () => {
    return getActiveFileProcessingStates().length > 0 || (fileProcessingState.value?.isProcessing ?? false)
  }

  const cancelProcessing = () => {
    console.log('Cancelling all active file processing...')
    
    // Interrupt all active operations
    for (const [_opId, fiber] of activeProcessingOperations.value.entries()) {
      Effect.runSync(Fiber.interrupt(fiber))
    }
    
    // Clear all operations
    activeProcessingOperations.value.clear()
    activeProcessingOperations.value = new Map()

    // Update UI states
    fileProcessingState.value = null

    // Mark all processing files as cancelled
    const currentStates = individualFileProcessingStates.value
    for (const [key, state] of currentStates.entries()) {
      if (state.isProcessing) {
        currentStates.set(key, {
          ...state,
          isProcessing: false,
          currentStep: 'Processing cancelled',
          error: 'Processing was cancelled by user',
          progress: 100
        })
      }
    }
    individualFileProcessingStates.value = new Map(currentStates)
  }

  const processNewFilesWithInterruption = async (
    newUploadedFiles: File[],
    options: {
      isAppReady: boolean
      concurrency: number
      dicomFiles: DicomFile[]
      onUpdateFiles?: (updatedFiles: DicomFile[]) => void
      onUpdateStudies?: (updatedStudies: DicomStudy[]) => void
    }
  ) => {
    // Generate unique operation ID for this batch
    const operationId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    try {
      // Start the fiber for this operation
      const fiber = runtime.runFork(processNewFilesEffect(newUploadedFiles, options))
      
      // Track this operation
      activeProcessingOperations.value.set(operationId, fiber)
      activeProcessingOperations.value = new Map(activeProcessingOperations.value)
      
      // Wait for completion
      const result = await runtime.runPromise(Fiber.join(fiber))
      
      // Clean up completed operation
      activeProcessingOperations.value.delete(operationId)
      activeProcessingOperations.value = new Map(activeProcessingOperations.value)
      
      return result
    } catch (error) {
      // Clean up on error
      activeProcessingOperations.value.delete(operationId)
      activeProcessingOperations.value = new Map(activeProcessingOperations.value)
      console.error('Error in file processing:', error)
      throw error
    }
  }

  const hasActiveOperations = () => {
    return activeProcessingOperations.value.size > 0
  }

  return {
    fileProcessingState,
    individualFileProcessingStates,
    processNewFilesEffect,
    processNewFilesWithInterruption,
    clearProcessingState,
    getActiveFileProcessingStates,
    getAllFileProcessingStates,
    removeCompletedFileProcessingStates,
    hasActiveProcessing,
    cancelProcessing,
    hasActiveOperations
  }
}
