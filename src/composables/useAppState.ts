import { ref, computed, onMounted } from 'vue'
import { Effect, Stream } from 'effect'
import type { DicomFile, DicomStudy } from '@/types/dicom'
import type { RuntimeType } from '@/types/effects'
import { DicomProcessor } from '@/services/dicomProcessor'
import { ConfigService } from '@/services/config'
import type { AppConfig, ProjectConfig } from '@/services/config/schema'
import { PluginRegistry } from '@/services/pluginRegistry'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDicomSender } from '@/composables/useDicomSender'
import { useAnonymizer } from '@/composables/useAnonymizer'
import { clearStudyCache } from '@/services/anonymizer/handlers'
import { toast } from 'vue-sonner'

export function useAppState(runtime: RuntimeType) {
  // Core application state
  const uploadedFiles = ref<File[]>([])
  const dicomFiles = ref<DicomFile[]>([])
  const studies = ref<DicomStudy[]>([])
  const successMessage = ref('')
  const concurrency = ref(3)
  const appError = ref<string | null>(null)

  // Configuration state
  const config = ref<AppConfig | null>(null)
  const configError = ref<Error | null>(null)
  const serverUrl = computed<string>(() => config.value?.dicomServer?.url ?? '')
  const configLoading = computed(() => config.value === null)

  // Project state
  const currentProject = computed<ProjectConfig | undefined>(() => config.value?.project)
  const isProjectMode = computed(() => !!currentProject.value)

  // Initialize composables
  const fileProcessing = useFileProcessing()
  const dragAndDrop = useDragAndDrop()
  const dicomSender = useDicomSender(runtime)
  const anonymizer = useAnonymizer(runtime)

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

  const loadConfig = async () => { /* stream-backed; kept for API compatibility */ }

  const loadServerUrl = async () => { /* replaced by stream; keep for API compatibility */ }

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

  const loadProjectState = async () => { /* replaced by stream; keep for API compatibility */ }

  const handleCreateProject = async (name: string): Promise<void> => {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          const project = yield* configService.createProject(name)
          // Get current config and add the project to it
          const currentConfig = yield* configService.getCurrentConfig
          const updatedConfig = { ...currentConfig, project }
          yield* configService.loadConfig(updatedConfig)
        })
      )

      // Stream will update config/currentProject
      toast.success(`Project "${name}" created`)
    } catch (error) {
      console.error('Failed to create project:', error)
      toast.error('Failed to create project')
      throw error
    }
  }

  const handleClearProject = async (): Promise<void> => {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.clearProject
        })
      )

      // Stream will update config/currentProject
      toast.success('Project cleared')
    } catch (error) {
      console.error('Failed to clear project:', error)
      toast.error('Failed to clear project')
      throw error
    }
  }

  const handleLoadConfig = async (configData: unknown): Promise<void> => {
    try {
      const loadedConfig = await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.loadConfig(configData)
          // Return the loaded config
          return yield* configService.getCurrentConfig
        })
      )

      // Show success toast if there's a project in the loaded config
      if (loadedConfig.project) {
        toast.success(`Loaded project: ${loadedConfig.project.name}`)
      } else {
        toast.success('Configuration loaded successfully')
      }
    } catch (error) {
      console.error('Failed to load configuration:', error)
      toast.error('Failed to load configuration')
      throw error
    }
  }

  const handleConfigReload = async () => { await loadConfig() }

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
            // Assign patient IDs for preview/mapping
            runtime.runPromise(
              Effect.gen(function* () {
                const processor = yield* DicomProcessor
                const cfgService = yield* ConfigService
                const cfg = yield* cfgService.getAnonymizationConfig
                const withAssigned = yield* processor.assignPatientIds(updatedStudies, cfg)
                studies.value = withAssigned
              })
            ).catch(err => {
              console.error('Failed to assign patient IDs:', err)
              studies.value = updatedStudies
            })
          }
        })
      )
      successMessage.value = ''
    } catch (error) {
      console.error('Error processing files:', error)
      fileProcessing.clearProcessingState()
      if (error instanceof Error) {
        // Check if it's an unsupported file format error
        if (error.message.includes('unsupported format')) {
          // Extract filename from error message if present
          const fileNameMatch = error.message.match(/File ([^\s]+) has unsupported format/)
          const fileName = fileNameMatch ? fileNameMatch[1] : 'Unknown file'

          toast.error('Unsupported file format', {
            description: `${fileName} could not be processed. Only DICOM files (.dcm), ZIP archives, and supported image formats are accepted.`,
            duration: 5000
          })
        } else if (error.message.includes('No valid DICOM files found')) {
          toast.error('No DICOM files found', {
            description: 'The uploaded file(s) did not contain any valid DICOM files.',
            duration: 5000
          })
        } else {
          // For other errors, show generic error message
          toast.error('Failed to process files', {
            description: error.message,
            duration: 5000
          })
        }
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

        // Build patientIdMap based on currently assigned IDs for all studies in memory
        const patientIdMap: Record<string, string> = {}
        studies.value.forEach(s => {
          const orig = s.patientId || 'Unknown'
          if (s.assignedPatientId) {
            patientIdMap[orig] = s.assignedPatientId
          }
        })

        return anonymizer.anonymizeStudyStream(
          study.studyInstanceUID,
          studyFiles,
          concurrency.value,
          patientIdMap
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

                  // Update only the affected study to preserve assigned IDs on others
                  runtime.runPromise(
                    Effect.gen(function* () {
                      const processor = yield* DicomProcessor
                      const current = studies.value
                      const existing = current.find(s => s.studyInstanceUID === event.studyId)
                      const filesForStudy = dicomFiles.value.filter(f => f.metadata?.studyInstanceUID === event.studyId)
                      const rebuilt = yield* processor.groupFilesByStudy(filesForStudy)
                      if (rebuilt.length > 0) {
                        const updatedStudy = { ...rebuilt[0], assignedPatientId: existing?.assignedPatientId }
                        const idx = current.findIndex(s => s.studyInstanceUID === event.studyId)
                        if (idx !== -1) {
                          const next = [...current]
                          next[idx] = updatedStudy
                          studies.value = next
                        } else {
                          studies.value = [...current, updatedStudy]
                        }
                      }
                      console.log(`Study ${event.studyId} updated after completion`)
                    })
                  ).catch(error => {
                    console.error('Failed to update study after anonymization:', error)
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
              const currentStudy = selectedStudies.value[index]
              if (currentStudy) {
                successfulStudies.push(currentStudy.studyInstanceUID)
              }
              return true
            }),
            Effect.catchAll(() => {
              const currentStudy = selectedStudies.value[index]
              if (currentStudy) {
                failedStudies.push(currentStudy.studyInstanceUID)
              }
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
      toast.success('Connection successful', {
        description: 'DICOM server is reachable',
        duration: 3000
      })
    } catch (error) {
      console.error('Connection test failed:', error)
      toast.error('Connection failed', {
        description: (error as Error).message,
        duration: 5000
      })
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

                  // Update only the affected study to preserve assigned IDs on others
                  runtime.runPromise(
                    Effect.gen(function* () {
                      const processor = yield* DicomProcessor
                      const current = studies.value
                      const existing = current.find(s => s.studyInstanceUID === event.studyId)
                      const filesForStudy = dicomFiles.value.filter(f => f.metadata?.studyInstanceUID === event.studyId)
                      const rebuilt = yield* processor.groupFilesByStudy(filesForStudy)
                      if (rebuilt.length > 0) {
                        const updatedStudy = { ...rebuilt[0], assignedPatientId: existing?.assignedPatientId }
                        const idx = current.findIndex(s => s.studyInstanceUID === event.studyId)
                        if (idx !== -1) {
                          const next = [...current]
                          next[idx] = updatedStudy
                          studies.value = next
                        } else {
                          studies.value = [...current, updatedStudy]
                        }
                      }
                      console.log(`Study ${event.studyId} updated after send completion`)

                      // Call afterSend hooks
                      const registry = yield* PluginRegistry
                      const hookPlugins = yield* registry.getHookPlugins()
                      const sentStudy = studies.value.find(s => s.studyInstanceUID === event.studyId)

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
              const currentStudy = selectedStudiesToSend[index]
              if (currentStudy) {
                successfulStudies.push(currentStudy.studyInstanceUID)
              }
              return true
            }),
            Effect.catchAll(() => {
              const currentStudy = selectedStudiesToSend[index]
              if (currentStudy) {
                failedStudies.push(currentStudy.studyInstanceUID)
              }
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

  const clearSelected = () => {
    const selectedStudiesToClear = selectedStudies.value

    // Get study IDs to clear
    const studyIdsToClear = new Set(selectedStudiesToClear.map(s => s.studyInstanceUID))

    // Remove files associated with selected studies
    dicomFiles.value = dicomFiles.value.filter(file => {
      if (file.metadata?.studyInstanceUID && studyIdsToClear.has(file.metadata.studyInstanceUID)) {
        // Clear metadata for files being removed
        if (file.metadata) file.metadata = undefined
        return false
      }
      return true
    })

    // Remove selected studies from studies array
    studies.value = studies.value.filter(study => !studyIdsToClear.has(study.studyInstanceUID))

    // Clear progress for removed studies
    selectedStudiesToClear.forEach(study => {
      removeStudyProgress(study.studyInstanceUID)
      removeStudySendingProgress(study.studyInstanceUID)
    })

    // Clear selection
    clearSelection()

    successMessage.value = `Cleared ${selectedStudiesToClear.length} selected ${selectedStudiesToClear.length === 1 ? 'study' : 'studies'}`
  }

  const processZipFile = (file: File, isAppReady: boolean) => {
    uploadedFiles.value = [file]
    processFiles(isAppReady)
  }

  onMounted(async () => {
    try {
      config.value = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConfigService
          return yield* svc.getCurrentConfig
        })
      )
    } catch (e) {
      configError.value = e as Error
    }

    runtime.runFork(
      Effect.gen(function* () {
        const svc = yield* ConfigService
        return yield* Stream.runForEach(svc.configChanges, (cfg) =>
          Effect.sync(() => { config.value = cfg })
        )
      })
    )

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
    currentProject,
    isProjectMode,

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
    loadProjectState,
    handleConfigReload,
    handleCreateProject,
    handleClearProject,
    handleLoadConfig,
    processNewFiles,
    addFilesToUploaded,
    processFiles,
    anonymizeSelected,
    testConnection,
    handleSendSelected,
    clearFiles,
    clearSelected,
    processZipFile
  }
}
