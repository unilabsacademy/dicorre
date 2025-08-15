import { ref, computed, onMounted } from 'vue'
import { ManagedRuntime, Effect, Stream } from 'effect'
import type { DicomFile, AnonymizationConfig, DicomStudy } from '@/types/dicom'
import { DicomProcessor } from '@/services/dicomProcessor'
import { ConfigService } from '@/services/config'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDicomSender } from '@/composables/useDicomSender'
import { useAnonymizer } from '@/composables/useAnonymizer'

type RuntimeType = ReturnType<typeof ManagedRuntime.make<any, any>>

export function useAppState(runtime: RuntimeType) {
  // Core application state
  const uploadedFiles = ref<File[]>([])
  const dicomFiles = ref<DicomFile[]>([])
  const studies = ref<DicomStudy[]>([])
  const successMessage = ref('')
  const concurrency = ref(3)
  const appError = ref<string | null>(null)

  // Configuration state
  const config = ref<AnonymizationConfig | null>(null)
  const configLoading = ref(false)
  const configError = ref<Error | null>(null)

  // Initialize composables
  const fileProcessing = useFileProcessing()
  const dragAndDrop = useDragAndDrop()
  const dicomSender = useDicomSender()
  const anonymizer = useAnonymizer()

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

  const loadConfig = async () => {
    configLoading.value = true
    configError.value = null
    try {
      const loadedConfig = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getAnonymizationConfig
        })
      )
      config.value = loadedConfig
      console.log('Loaded configuration from app.config.json:', loadedConfig)
    } catch (e) {
      configError.value = e as Error
      console.error('Failed to load configuration:', e)
      throw new Error(`Critical configuration loading failed: ${e}`)
    } finally {
      configLoading.value = false
    }
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

  const anonymizeSelected = async () => {
    if (!config.value) {
      setAppError('Configuration not loaded')
      return
    }

    if (selectedStudies.value.length === 0) {
      return
    }

    try {
      // Process all studies concurrently using Effect.all for true parallelism
      const studyStreamEffects = selectedStudies.value.map(study => {
        const studyFiles = study.series.flatMap(series => series.files)

        return anonymizer.anonymizeStudyStream(
          study.studyInstanceUID,
          studyFiles,
          config.value!,
          concurrency.value
        ).pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              // React to each event in the stream
              switch (event._tag) {
                case "AnonymizationStarted":
                  setStudyProgress(event.studyId, {
                    isProcessing: true,
                    progress: 0,
                    totalFiles: event.totalFiles,
                    currentFile: undefined
                  })
                  break

                case "AnonymizationProgress":
                  setStudyProgress(event.studyId, {
                    isProcessing: true,
                    progress: Math.round((event.completed / event.total) * 100),
                    totalFiles: event.total,
                    currentFile: event.currentFile
                  })
                  break

                case "FileAnonymized":
                  // Update the file in our collection
                  const fileIndex = dicomFiles.value.findIndex(f => f.id === event.file.id)
                  if (fileIndex !== -1) {
                    dicomFiles.value[fileIndex] = event.file
                  }
                  break

                case "StudyAnonymized":
                  // Study completed - update files with anonymized versions
                  event.files.forEach(anonymizedFile => {
                    const fileIndex = dicomFiles.value.findIndex(f => f.id === anonymizedFile.id)
                    if (fileIndex !== -1) {
                      dicomFiles.value[fileIndex] = anonymizedFile
                    }
                  })
                  removeStudyProgress(event.studyId)
                  console.log(`Study ${event.studyId} anonymization completed with ${event.files.length} files`)
                  break

                case "AnonymizationError":
                  console.error(`Anonymization error for study ${event.studyId}:`, event.error)
                  removeStudyProgress(event.studyId)
                  break
              }
            })
          ),
          Stream.runDrain,
          Effect.catchAll(error =>
            Effect.sync(() => {
              console.error(`Error anonymizing study ${study.studyInstanceUID}:`, error)
              removeStudyProgress(study.studyInstanceUID)
              // Don't rethrow to prevent stopping other concurrent studies
            })
          )
        )
      })

      // Run all study streams concurrently
      await runtime.runPromise(
        Effect.all(studyStreamEffects, { concurrency: "unbounded" })
      )

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

  // Load configuration on mount
  onMounted(() => {
    loadConfig()
  })

  return {
    // State
    uploadedFiles,
    dicomFiles,
    studies,
    successMessage,
    concurrency,
    appError,
    config,
    configLoading,
    configError,

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
    loadConfig,
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
