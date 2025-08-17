import { ref, computed, onMounted } from 'vue'
import { ManagedRuntime, Effect, Stream } from 'effect'
import type { DicomFile, AnonymizationConfig, DicomStudy } from '@/types/dicom'
import { DicomProcessor } from '@/services/dicomProcessor'
import { ConfigService } from '@/services/config'
import { PluginRegistry } from '@/services/pluginRegistry'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDicomSender } from '@/composables/useDicomSender'
import { useAnonymizer } from '@/composables/useAnonymizer'
import { clearStudyCache } from '@/services/anonymizer/handlers'

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
  const serverUrl = ref<string>('')

  // Initialize composables
  const fileProcessing = useFileProcessing()
  const dragAndDrop = useDragAndDrop()
  const dicomSender = useDicomSender(runtime)
  const anonymizer = useAnonymizer()

  // Progress and UI state management
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

  // Load server URL from config
  const loadServerUrl = async () => {
    try {
      const url = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          const config = yield* configService.getServerConfig
          return config.url
        })
      )
      serverUrl.value = url
    } catch (err) {
      console.error('Failed to load server URL:', err)
      serverUrl.value = ''
    }
  }

  // Load plugins from configuration
  const loadPlugins = async () => {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          const config = yield* configService.getCurrentConfig
          
          if ((config as any).plugins) {
            const registry = yield* PluginRegistry
            
            // Load configuration into registry
            yield* registry.loadPluginConfig((config as any).plugins)
            
            // Import and register plugins
            const { initializePlugins } = yield* Effect.tryPromise({
              try: () => import('@/plugins'),
              catch: (error) => new Error(`Failed to import plugins: ${error}`)
            })
            
            yield* initializePlugins()
          }
        })
      )
    } catch (err) {
      console.error('Failed to load plugins:', err)
    }
  }

  // Handle config reload event
  const handleConfigReload = async () => {
    await loadConfig()
    await loadServerUrl()
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

                  // Immediately regenerate studies structure to reflect the anonymized data
                  runtime.runPromise(
                    Effect.gen(function* () {
                      const processor = yield* DicomProcessor
                      const updatedStudies = yield* processor.groupFilesByStudy(dicomFiles.value)
                      studies.value = updatedStudies
                      console.log(`Studies updated after ${event.studyId} completion`)
                    })
                  ).catch(error => {
                    console.error('Failed to update studies after anonymization:', error)
                  })
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

      // Track successful and failed studies
      const failedStudies: string[] = []
      const successfulStudies: string[] = []

      // Run all study streams concurrently with result tracking
      await runtime.runPromise(
        Effect.all(studyStreamEffects.map((effect, index) =>
          effect.pipe(
            Effect.map(() => {
              successfulStudies.push(selectedStudies.value[index].studyInstanceUID)
              return true
            }),
            Effect.catchAll(() => {
              failedStudies.push(selectedStudies.value[index].studyInstanceUID)
              return Effect.succeed(false)
            })
          )
        ), { concurrency: "unbounded" })
      )

      // Show appropriate success/error message based on results
      if (failedStudies.length === 0) {
        successMessage.value = `Successfully anonymized ${successfulStudies.length} studies`
      } else if (successfulStudies.length === 0) {
        setAppError(new Error(`Failed to anonymize all ${failedStudies.length} studies`))
      } else {
        successMessage.value = `Anonymized ${successfulStudies.length} of ${selectedStudies.value.length} studies. ${failedStudies.length} failed.`
      }

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
    if (selectedStudiesToSend.length === 0) {
      return
    }

    try {
      successMessage.value = ''

      // Filter out any files that are not marked as anonymized
      const studyStreamEffects = selectedStudiesToSend.map(study => {
        const studyFiles = study.series.flatMap(series => series.files).filter(file => file.anonymized)

        // Call beforeSend hooks
        const callBeforeSendHooks = Effect.gen(function* () {
          const registry = yield* PluginRegistry
          const hookPlugins = yield* registry.getHookPlugins()
          
          for (const plugin of hookPlugins) {
            if (plugin.hooks.beforeSend) {
              yield* plugin.hooks.beforeSend(study).pipe(
                Effect.catchAll((error) => {
                  console.error(`Plugin ${plugin.id} beforeSend hook failed:`, error)
                  return Effect.succeed(undefined)
                })
              )
            }
          }
        })

        return Stream.fromEffect(callBeforeSendHooks).pipe(
          Stream.flatMap(() => dicomSender.sendStudyStream(
            study.studyInstanceUID,
            studyFiles,
            concurrency.value
          )),
          Stream.tap((event) =>
            Effect.sync(() => {
              switch (event._tag) {
                case "SendingStarted":
                  setStudySendingProgress(event.studyId, {
                    isProcessing: true,
                    progress: 0,
                    totalFiles: event.totalFiles,
                    currentFile: undefined
                  })
                  break

                case "SendingProgress":
                  setStudySendingProgress(event.studyId, {
                    isProcessing: true,
                    progress: Math.round((event.completed / event.total) * 100),
                    totalFiles: event.total,
                    currentFile: event.currentFile
                  })
                  break

                case "StudySent":
                  // Update files with sent status
                  console.log("StudySent", event)
                  event.files.forEach(sentFile => {
                    const fileIndex = dicomFiles.value.findIndex(f => f.id === sentFile.id)
                    if (fileIndex !== -1) {
                      dicomFiles.value[fileIndex] = { ...dicomFiles.value[fileIndex], sent: true }
                    }
                  })

                  // Update studies with dicomFiles to reflect changes in UI
                  runtime.runPromise(
                    Effect.gen(function* () {
                      const processor = yield* DicomProcessor
                      const updatedStudies = yield* processor.groupFilesByStudy(dicomFiles.value)
                      studies.value = updatedStudies
                      console.log(`Studies updated after ${event.studyId} completion`)
                      
                      // Call afterSend hooks
                      const registry = yield* PluginRegistry
                      const hookPlugins = yield* registry.getHookPlugins()
                      const sentStudy = updatedStudies.find(s => s.studyInstanceUID === event.studyId)
                      
                      if (sentStudy) {
                        for (const plugin of hookPlugins) {
                          if (plugin.hooks.afterSend) {
                            yield* plugin.hooks.afterSend(sentStudy).pipe(
                              Effect.catchAll((error) => {
                                console.error(`Plugin ${plugin.id} afterSend hook failed:`, error)
                                return Effect.succeed(undefined)
                              })
                            )
                          }
                        }
                      }
                    })
                  )

                  removeStudySendingProgress(event.studyId)
                  console.log(`Study ${event.studyId} sent successfully with ${event.files.length} files`)

                  // Clear the anonymization cache for this study to prevent UID conflicts
                  clearStudyCache(event.studyId)
                  break

                case "SendingError":
                  console.error(`Sending error for study ${event.studyId}:`, event.error)
                  removeStudySendingProgress(event.studyId)
                  
                  // Call onSendError hooks
                  runtime.runPromise(
                    Effect.gen(function* () {
                      const registry = yield* PluginRegistry
                      const hookPlugins = yield* registry.getHookPlugins()
                      const errorStudy = studies.value.find(s => s.studyInstanceUID === event.studyId)
                      
                      if (errorStudy) {
                        for (const plugin of hookPlugins) {
                          if (plugin.hooks.onSendError) {
                            yield* plugin.hooks.onSendError(errorStudy, event.error).pipe(
                              Effect.catchAll((error) => {
                                console.error(`Plugin ${plugin.id} onSendError hook failed:`, error)
                                return Effect.succeed(undefined)
                              })
                            )
                          }
                        }
                      }
                    })
                  )
                  break
              }
            })
          ),
          Stream.runDrain,
          Effect.catchAll(error =>
            Effect.sync(() => {
              console.error(`Error sending study ${study.studyInstanceUID}:`, error)
              removeStudySendingProgress(study.studyInstanceUID)
              // Don't rethrow to prevent stopping other concurrent studies
            })
          )
        )
      })

      // Track successful and failed studies
      const failedStudies: string[] = []
      const successfulStudies: string[] = []

      // Run all study streams concurrently with result tracking
      await runtime.runPromise(
        Effect.all(studyStreamEffects.map((effect, index) =>
          effect.pipe(
            Effect.map(() => {
              successfulStudies.push(selectedStudiesToSend[index].studyInstanceUID)
              return true
            }),
            Effect.catchAll(() => {
              failedStudies.push(selectedStudiesToSend[index].studyInstanceUID)
              return Effect.succeed(false)
            })
          )
        ), { concurrency: "unbounded" })
      )

      // Show appropriate success/error message based on results
      if (failedStudies.length === 0) {
        successMessage.value = `Successfully sent ${successfulStudies.length} studies`
      } else if (successfulStudies.length === 0) {
        setAppError(new Error(`Failed to send all ${failedStudies.length} studies`))
      } else {
        successMessage.value = `Sent ${successfulStudies.length} of ${selectedStudiesToSend.length} studies. ${failedStudies.length} failed.`
      }

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
  onMounted(async () => {
    await loadConfig()
    await loadServerUrl()
    await loadPlugins()
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
    serverUrl,

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
    loadServerUrl,
    handleConfigReload,
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
