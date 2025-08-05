import { ref, computed } from 'vue'
import { ManagedRuntime } from 'effect'
import type { DicomFile, AnonymizationConfig, DicomStudy } from '@/types/dicom'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useAnonymizer } from '@/composables/useAnonymizer'
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
  const anonymizer = useAnonymizer()
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
    try {
      await runtime.runPromise(
        anonymizer.anonymizeSelectedEffect(selectedStudies.value, config, {
          concurrency: concurrency.value,
          isAppReady,
          dicomFiles: dicomFiles.value,
          onUpdateFiles: (updatedFiles) => {
            dicomFiles.value = updatedFiles
          },
          onUpdateStudies: (updatedStudies) => {
            studies.value = updatedStudies
          },
          onSetStudyProgress: setStudyProgress,
          onRemoveStudyProgress: removeStudyProgress,
          onSuccessMessage: (message) => {
            successMessage.value = message
          }
        })
      )
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
