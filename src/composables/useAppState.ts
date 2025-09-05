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
import { clearStudyCache } from '@/services/anonymizer/handlers'
import { toast } from 'vue-sonner'
import { getAnonymizationWorkerManager } from '@/workers/workerManager'

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
  const fileProcessing = useFileProcessing(runtime)
  const dragAndDrop = useDragAndDrop()
  const dicomSender = useDicomSender(runtime)

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
  const groupSelectedStudies = async (): Promise<void> => {
    const selected = selectedStudies.value
    if (selected.length < 2) return

    // Require an existing assignedPatientId on at least one selected study
    const targetAssignedId = selected.find(s => s.assignedPatientId)?.assignedPatientId
    if (!targetAssignedId) {
      toast.error('Cannot group studies', {
        description: 'Assign a patient ID to one of the selected studies before grouping.'
      })
      return
    }

    // Apply to all selected studies
    const selectedUids = new Set(selected.map(s => s.studyInstanceUID))
    studies.value = studies.value.map(s => selectedUids.has(s.studyInstanceUID) ? { ...s, assignedPatientId: targetAssignedId } : s)
  }

  const assignPatientIdToSelected = (patientId: string): void => {
    if (!patientId || selectedStudies.value.length === 0) return
    const selectedUids = new Set(selectedStudies.value.map(s => s.studyInstanceUID))
    studies.value = studies.value.map(s => selectedUids.has(s.studyInstanceUID) ? { ...s, assignedPatientId: patientId } : s)
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
          // Update only the project field, preserving all other config
          yield* configService.updateProject(project)
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

  const handleUpdateProject = async (project: ProjectConfig): Promise<void> => {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          yield* configService.updateProject(project)
        })
      )
      toast.success(`Project "${project.name}" updated`)
    } catch (error) {
      console.error('Failed to update project:', error)
      toast.error('Failed to update project')
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
      fileProcessing.addFiles(newFiles, {
        isAppReady,
        parseConcurrency: concurrency.value,
        onAppendFiles: (files: DicomFile[]) => {
          const nextFiles = [...dicomFiles.value, ...files]
          dicomFiles.value = nextFiles
          runtime.runPromise(
            Effect.gen(function* () {
              const processor = yield* DicomProcessor
              const cfgService = yield* ConfigService
              const cfg = yield* cfgService.getAnonymizationConfig
              const grouped = yield* processor.groupFilesByStudy(nextFiles)
              const withAssigned = yield* processor.assignPatientIds(grouped, cfg)
              studies.value = withAssigned
            })
          ).catch(err => {
            console.error('Failed to group/assign patient IDs:', err)
            // Fallback: try grouping without assignment
            runtime.runPromise(
              Effect.gen(function* () {
                const processor = yield* DicomProcessor
                studies.value = yield* processor.groupFilesByStudy(nextFiles)
              })
            ).catch(() => { })
          })
        }
      })
      successMessage.value = ''
    } catch (error) {
      console.error('Error processing files:', error)
      fileProcessing.clearAllTasks()
      if (error instanceof Error) {
        if (error.message.includes('unsupported format')) {
          toast.error('Unsupported file format', {
            description: error.message,
            duration: 5000
          })
        } else if (error.message.includes('No valid DICOM files found')) {
          toast.error('No DICOM files found', {
            description: 'The uploaded file(s) did not contain any valid DICOM files.',
            duration: 5000
          })
        } else {
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
      const anonymizationConfig = await runtime.runPromise(
        Effect.gen(function* () {
          const cfgService = yield* ConfigService
          return yield* cfgService.getAnonymizationConfig
        })
      )

      const manager = getAnonymizationWorkerManager()

      const promises = selectedStudies.value.map(study => {
        const studyFiles = study.series.flatMap(series => series.files)

        // Build patientIdMap based on currently assigned IDs for all studies in memory
        const patientIdMap: Record<string, string> = {}
        studies.value.forEach(s => {
          const orig = s.patientId || 'Unknown'
          if (s.assignedPatientId) {
            patientIdMap[orig] = s.assignedPatientId
          }
        })

        // Initial progress
        setStudyProgress(study.studyInstanceUID, {
          isProcessing: true,
          progress: 0,
          totalFiles: studyFiles.length,
          currentFile: undefined
        })

        return new Promise<boolean>((resolve) => {
          manager.anonymizeStudy({
            studyId: study.studyInstanceUID,
            files: studyFiles,
            anonymizationConfig,
            concurrency: concurrency.value,
            patientIdMap,
            onProgress: (p) => {
              setStudyProgress(study.studyInstanceUID, {
                isProcessing: true,
                progress: Math.round((p.completed / p.total) * 100),
                totalFiles: p.total,
                currentFile: p.currentFile
              })
            },
            onComplete: (anonymizedFiles) => {
              anonymizedFiles.forEach(anonymizedFile => {
                const fileIndex = dicomFiles.value.findIndex(f => f.id === anonymizedFile.id)
                if (fileIndex !== -1) {
                  dicomFiles.value[fileIndex] = anonymizedFile
                }
              })
              removeStudyProgress(study.studyInstanceUID)
              console.log(`Study ${study.studyInstanceUID} anonymization completed with ${anonymizedFiles.length} files`)
              rebuildStudyAfterFileChanges(study.studyInstanceUID)

              resolve(true)
            },
            onError: (err) => {
              console.error(`Anonymization error for study ${study.studyInstanceUID}:`, err)
              removeStudyProgress(study.studyInstanceUID)
              resolve(false)
            }
          })
        })
      })

      const results = await Promise.allSettled(promises)
      const successfulStudies = results
        .map((r, idx) => (r.status === 'fulfilled' && r.value === true) ? selectedStudies.value[idx].studyInstanceUID : null)
        .filter((v): v is string => v !== null)
      const failedStudies = results
        .map((r, idx) => (r.status === 'fulfilled' && r.value === false) ? selectedStudies.value[idx].studyInstanceUID : null)
        .filter((v): v is string => v !== null)

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

      // Build Effect per study (no streams)
      const studyEffects = selectedStudiesToSend.map(study => {
        const studyFiles = study.series.flatMap(series => series.files).filter(file => file.anonymized)

        const callBeforeSendHooks = Effect.gen(function* () {
          const registry = yield* PluginRegistry
          const hookPlugins = yield* registry.getHookPlugins()
          for (const plugin of hookPlugins) {
            if (plugin.hooks.beforeSend) {
              yield* plugin.hooks.beforeSend(study).pipe(
                Effect.catchAll((error) => {
                  console.error(`Plugin ${plugin.id} beforeSend hook failed:`, error)
                  const message = (error && (error as any).message) ? String((error as any).message) : String(error)
                  const pluginId = (error && (error as any).pluginId) ? String((error as any).pluginId) : plugin.id
                  toast.error(`Plugin ${pluginId} beforeSend error`, { description: message })
                  return Effect.succeed(undefined)
                })
              )
            }
          }
        })

        const sendEffect = dicomSender.sendStudyEffect(
          study.studyInstanceUID,
          studyFiles,
          concurrency.value,
          {
            onProgress: (completed, total, current) => {
              setStudySendingProgress(study.studyInstanceUID, {
                isProcessing: true,
                progress: Math.round((completed / total) * 100),
                totalFiles: total,
                currentFile: current?.fileName
              })
            }
          }
        ).pipe(
          Effect.tap((sentFiles) =>
            Effect.gen(function* () {
              // Mark files as sent
              sentFiles.forEach(sentFile => {
                const fileIndex = dicomFiles.value.findIndex(f => f.id === sentFile.id)
                if (fileIndex !== -1) {
                  dicomFiles.value[fileIndex] = { ...dicomFiles.value[fileIndex], sent: true }
                }
              })

              yield* Effect.tryPromise({
                try: () => rebuildStudyAfterFileChanges(study.studyInstanceUID),
                catch: (error) => new Error(String(error))
              })

              // afterSend hooks
              const registry = yield* PluginRegistry
              const hookPlugins = yield* registry.getHookPlugins()
              const sentStudy = studies.value.find(s => s.studyInstanceUID === study.studyInstanceUID)
              if (sentStudy) {
                for (const plugin of hookPlugins) {
                  if (plugin.hooks.afterSend) {
                    yield* plugin.hooks.afterSend(sentStudy).pipe(
                      Effect.catchAll((error) => {
                        console.error(`Plugin ${plugin.id} afterSend hook failed:`, error)
                        const message = (error && (error as any).message) ? String((error as any).message) : String(error)
                        const pluginId = (error && (error as any).pluginId) ? String((error as any).pluginId) : plugin.id
                        toast.error(`Plugin ${pluginId} afterSend error`, { description: message })
                        return Effect.succeed(undefined)
                      })
                    )
                  }
                }
              }

              removeStudySendingProgress(study.studyInstanceUID)
              clearStudyCache(study.studyInstanceUID)
            })
          ),
          Effect.catchAll((err) =>
            Effect.gen(function* () {
              console.error(`Error sending study ${study.studyInstanceUID}:`, err)
              removeStudySendingProgress(study.studyInstanceUID)
              // onSendError hooks
              const registry = yield* PluginRegistry
              const hookPlugins = yield* registry.getHookPlugins()
              const errorStudy = studies.value.find(s => s.studyInstanceUID === study.studyInstanceUID)
              if (errorStudy) {
                for (const plugin of hookPlugins) {
                  if (plugin.hooks.onSendError) {
                    yield* plugin.hooks.onSendError(errorStudy, err).pipe(
                      Effect.catchAll((error) => {
                        console.error(`Plugin ${plugin.id} onSendError hook failed:`, error)
                        const message = (error && (error as any).message) ? String((error as any).message) : String(error)
                        const pluginId = (error && (error as any).pluginId) ? String((error as any).pluginId) : plugin.id
                        toast.error(`Plugin ${pluginId} onSendError error`, { description: message })
                        return Effect.succeed(undefined)
                      })
                    )
                  }
                }
              }
              return Effect.succeed(false)
            })
          )
        )

        return Effect.flatMap(callBeforeSendHooks, () => sendEffect)
      })

      // Track successful and failed studies
      const failedStudies: string[] = []
      const successfulStudies: string[] = []

      // Run all study effects concurrently with result tracking
      await runtime.runPromise(
        Effect.all(studyEffects.map((effect, index) =>
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

  async function rebuildStudyAfterFileChanges(studyId: string): Promise<void> {
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const processor = yield* DicomProcessor
          const current = studies.value
          const existing = current.find(s => s.studyInstanceUID === studyId)
          const filesForStudy = dicomFiles.value.filter(f => f.metadata?.studyInstanceUID === studyId)
          const rebuilt = yield* processor.groupFilesByStudy(filesForStudy)
          if (rebuilt.length > 0) {
            const updatedStudy = { ...rebuilt[0], assignedPatientId: existing?.assignedPatientId }
            const idx = current.findIndex(s => s.studyInstanceUID === studyId)
            if (idx !== -1) {
              const next = [...current]
              next[idx] = updatedStudy
              studies.value = next
            } else {
              studies.value = [...current, updatedStudy]
            }
          }
        })
      )
    } catch (error) {
      console.error('Failed to rebuild study after file changes:', error)
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
    fileProcessing.clearAllTasks()
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
    handleUpdateProject,
    handleLoadConfig,
    processNewFiles,
    addFilesToUploaded,
    processFiles,
    anonymizeSelected,
    groupSelectedStudies,
    assignPatientIdToSelected,
    testConnection,
    handleSendSelected,
    clearFiles,
    clearSelected,
    processZipFile
  }
}
