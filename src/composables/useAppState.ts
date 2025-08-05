import { ref, computed } from 'vue'
import { ManagedRuntime, Effect } from 'effect'
import type { DicomFile, AnonymizationConfig, DicomStudy } from '@/types/dicom'
import { Anonymizer } from '@/services/anonymizer'
import { DicomProcessor } from '@/services/dicomProcessor'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDicomSender } from '@/composables/useDicomSender'

type RuntimeType = ReturnType<typeof ManagedRuntime.make<any, any>>

export function useAppState(runtime: RuntimeType) {
  // Core application state
  const uploadedFiles = ref<File[]>([])
  const dicomFiles = ref<DicomFile[]>([])
  const studies = ref<DicomStudy[]>([])
  const successMessage = ref('')
  const concurrency = ref(3)
  const appError = ref<string | null>(null)

  // Initialize composables
  const fileProcessing = useFileProcessing()
  const dragAndDrop = useDragAndDrop()
  const dicomSender = useDicomSender()

  // Progress management
  const { setStudyProgress, removeStudyProgress, clearAllProgress } = useAnonymizationProgress()
  const { setStudySendingProgress, removeStudySendingProgress, clearAllSendingProgress } = useSendingProgress()
  const { getSelectedStudies, clearSelection } = useTableState()

  const totalFiles = computed(() => dicomFiles.value.length)
  const anonymizedFilesCount = computed(() => dicomFiles.value.filter(file => file.anonymized).length)

  const selectedStudies = computed(() => getSelectedStudies(studies.value))
  const selectedStudiesCount = computed(() => selectedStudies.value.length)

  const setAppError = (err: Error | string) => {
    appError.value = typeof err === 'string' ? err : err.message
    console.error('App Error:', err)
  }

  const clearAppError = () => {
    appError.value = null
  }

  const processNewFiles = async (newFiles: File[], isAppReady: boolean) => {
    try {
      await runtime.runPromise(
        fileProcessing.processNewFilesEffect(newFiles, {
          isAppReady,
          concurrency: concurrency.value,
          dicomFiles: dicomFiles.value,
          onUpdateFiles: (updatedFiles) => {
            dicomFiles.value = updatedFiles
          },
          onUpdateStudies: (updatedStudies) => {
            studies.value = updatedStudies
          }
        })
      )
      successMessage.value = ''
    } catch (error) {
      console.error('Error processing files:', error)
      fileProcessing.clearProcessingState()
      if (error instanceof Error) {
        setAppError(error)
      }
    }
  }

  const addFilesToUploaded = (newFiles: File[]) => {
    uploadedFiles.value = [...uploadedFiles.value, ...newFiles]
  }

  const processFiles = async (isAppReady: boolean) => {
    await processNewFiles(uploadedFiles.value, isAppReady)
  }

  const anonymizeSelected = async (config: AnonymizationConfig, isAppReady: boolean) => {
    if (!isAppReady) {
      setAppError('Configuration not loaded')
      return
    }

    if (selectedStudies.value.length === 0) {
      return
    }

    try {
      // Process each study with direct service calls
      // Events are published internally but we don't need to subscribe for basic functionality
      for (const study of selectedStudies.value) {
        const studyFiles = study.series.flatMap(series => series.files)
        
        // Set initial progress
        setStudyProgress(study.studyInstanceUID, {
          isProcessing: true,
          progress: 0,
          totalFiles: studyFiles.length,
          currentFile: undefined
        })
        
        try {
          const anonymizedFiles = await runtime.runPromise(
            Effect.gen(function* () {
              const anonymizer = yield* Anonymizer
              return yield* anonymizer.anonymizeStudyWithEvents(
                study.studyInstanceUID,
                studyFiles,
                config,
                { concurrency: concurrency.value }
              )
            })
          )
          
          // Update the files in our collection
          anonymizedFiles.forEach(anonymizedFile => {
            const fileIndex = dicomFiles.value.findIndex(f => f.id === anonymizedFile.id)
            if (fileIndex !== -1) {
              dicomFiles.value[fileIndex] = anonymizedFile
            }
          })
          
          // Remove progress for completed study
          removeStudyProgress(study.studyInstanceUID)
          
        } catch (studyError) {
          console.error(`Error anonymizing study ${study.studyInstanceUID}:`, studyError)
          removeStudyProgress(study.studyInstanceUID)
          throw studyError
        }
      }

      // After all studies are anonymized, regenerate the studies structure from updated files
      const updatedStudies = await runtime.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          return yield* processor.groupFilesByStudy(dicomFiles.value)
        })
      )
      
      // Update the studies state with the new anonymized data
      studies.value = updatedStudies

      successMessage.value = `Successfully anonymized ${selectedStudies.value.length} studies`
      
      // Clear selection after successful anonymization
      clearSelection()

    } catch (error) {
      console.error('Error in anonymization:', error)
      setAppError(error as Error)
    }
  }

  const testConnection = async () => {
    try {
      await runtime.runPromise(dicomSender.testConnection())
    } catch (error) {
      console.error('Connection test failed:', error)
      setAppError(error as Error)
    }
  }

  const handleSendSelected = async (selectedStudiesToSend: DicomStudy[]) => {
    try {
      successMessage.value = ''
      await runtime.runPromise(
        dicomSender.handleSendSelectedEffect(selectedStudiesToSend, {
          concurrency: concurrency.value,
          dicomFiles: dicomFiles.value,
          onUpdateFiles: (updatedFiles) => {
            dicomFiles.value = updatedFiles
          },
          onUpdateStudies: (updatedStudies) => {
            studies.value = updatedStudies
          },
          onSetSendingProgress: setStudySendingProgress,
          onRemoveSendingProgress: removeStudySendingProgress,
          onSuccessMessage: (message) => {
            successMessage.value = message
          }
        })
      )
    } catch (error) {
      console.error('Error in sending:', error)
      setAppError(error as Error)
    }
  }

  const clearFiles = () => {
    dicomFiles.value.forEach(file => {
      if (file.metadata) file.metadata = undefined
    })

    uploadedFiles.value = []
    dicomFiles.value = []
    studies.value = []
    successMessage.value = ''
    fileProcessing.clearProcessingState()
    clearAllProgress()
    clearAllSendingProgress()
    clearSelection()
  }

  const processZipFile = (file: File, isAppReady: boolean) => {
    uploadedFiles.value = [file]
    processFiles(isAppReady)
  }

  return {
    // State
    uploadedFiles,
    dicomFiles,
    studies,
    successMessage,
    concurrency,
    appError,

    // Computed
    selectedStudies,
    selectedStudiesCount,
    totalFiles,
    anonymizedFilesCount,

    // Composables
    fileProcessing,
    dragAndDrop,

    // Methods
    setAppError,
    clearAppError,
    processNewFiles,
    addFilesToUploaded,
    processFiles,
    anonymizeSelected,
    testConnection,
    handleSendSelected,
    clearFiles,
    processZipFile
  }
}
