import { ref, computed } from 'vue'
import { Effect } from 'effect'
import type { DicomStudy, DicomFile } from '@/types/dicom'
import { DicomSender, type DicomServerConfig, type SendingProgress } from '@/services/dicomSender'
import { DicomProcessor } from '@/services/dicomProcessor'

export function useDicomSender() {
  // UI state management with Vue refs
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendingProgress | null>(null)
  const connectionStatus = ref<boolean | null>(null)

  // Effect program for sending study
  const sendStudy = (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number } = {}
  ) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.sendStudy(study, options)
    })

  // Effect program for sending study with progress tracking
  const sendStudyWithProgress = (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number; onProgress?: (progress: SendingProgress) => void } = {}
  ) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.sendStudy(study, {
        ...options,
        onProgress: (p) => {
          progress.value = p
          // Also call the external callback if provided
          if (options.onProgress) {
            options.onProgress(p)
          }
        }
      })
    })

  // Effect program for testing connection
  const testConnection = () =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      const isConnected = yield* sender.testConnection
      connectionStatus.value = isConnected
      return isConnected
    })

  // Effect program for updating server configuration
  const updateServerConfig = (newConfig: DicomServerConfig) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      return yield* sender.updateConfig(newConfig)
    })

  // Effect program for sending multiple selected studies with progress tracking
  const handleSendSelectedEffect = (
    selectedStudiesToSend: DicomStudy[],
    options: {
      concurrency?: number
      dicomFiles: DicomFile[]
      onUpdateFiles?: (updatedFiles: DicomFile[]) => void
      onUpdateStudies?: (updatedStudies: DicomStudy[]) => void
      onSetSendingProgress?: (studyId: string, progress: any) => void
      onRemoveSendingProgress?: (studyId: string) => void
      onSuccessMessage?: (message: string) => void
    }
  ) =>
    Effect.gen(function* () {
      const sender = yield* DicomSender
      const processor = yield* DicomProcessor

      console.log(`Starting to send ${selectedStudiesToSend.length} selected studies`)
      
      const sendStudy = (study: DicomStudy) =>
        Effect.gen(function* () {
          const totalFiles = study.series.reduce((sum, s) => sum + s.files.length, 0)
          
          try {
            console.log(`Starting to send study ${study.studyInstanceUID} with ${totalFiles} files`)
            
            // Set initial sending progress
            options.onSetSendingProgress?.(study.studyInstanceUID, {
              isProcessing: true,
              progress: 0,
              totalFiles,
              currentFile: undefined
            })

            // Create progress callback
            const onProgress = (completed: number, total: number, currentFile?: string) => {
              const progress = Math.round((completed / total) * 100)
              console.log(`Sending progress for study ${study.studyInstanceUID}: ${completed}/${total} (${progress}%)`)
              
              options.onSetSendingProgress?.(study.studyInstanceUID, {
                isProcessing: true,
                progress,
                totalFiles: total,
                currentFile
              })
            }

            // Send study using Effect program
            const sentFiles = yield* sender.sendStudy(study, {
              concurrency: options.concurrency || 3,
              maxRetries: 2,
              onProgress: (progress: any) => {
                if (progress && typeof progress.completed === 'number' && typeof progress.total === 'number') {
                  onProgress(progress.completed, progress.total, progress.currentFile)
                }
              }
            })
            
            if (sentFiles.length > 0) {
              // Mark all files as sent
              study.series.forEach(series => {
                series.files.forEach(file => {
                  file.sent = true
                })
              })
              
              // Update global dicomFiles array
              const updatedFiles = options.dicomFiles.map(file => {
                const studyFile = study.series.find(s => s.files.find(f => f.id === file.id))?.files.find(f => f.id === file.id)
                if (studyFile) {
                  return { ...file, sent: true }
                }
                return file
              })
              
              options.onUpdateFiles?.(updatedFiles)

              // Refresh study grouping
              console.log(`Regrouping studies after ${study.studyInstanceUID} sending completion...`)
              const regroupedStudies = yield* processor.groupFilesByStudy(updatedFiles)
              options.onUpdateStudies?.(regroupedStudies)
              console.log(`Updated UI with ${regroupedStudies.length} studies after ${study.studyInstanceUID} completion`)
              
              // Mark study as complete
              options.onSetSendingProgress?.(study.studyInstanceUID, {
                isProcessing: false,
                progress: 100,
                totalFiles,
                currentFile: undefined
              })

              options.onRemoveSendingProgress?.(study.studyInstanceUID)
              
              console.log(`Successfully sent study ${study.studyInstanceUID}`)
              return true
            } else {
              return yield* Effect.fail(new Error('Failed to send study'))
            }

          } catch (error) {
            console.error(`Error sending study ${study.studyInstanceUID}:`, error)
            options.onRemoveSendingProgress?.(study.studyInstanceUID)
            return yield* Effect.fail(error as Error)
          }
        })

      // Process all studies in parallel
      const results = yield* Effect.all(selectedStudiesToSend.map(sendStudy), { concurrency: 'unbounded' })

      console.log(`All ${selectedStudiesToSend.length} studies completed sending`)
      options.onSuccessMessage?.(`Successfully sent ${selectedStudiesToSend.length} studies!`)
      
      return results
    })

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
  }

  const isConnected = computed(() => connectionStatus.value === true)
  const progressPercentage = computed(() => {
    if (!progress.value) return 0
    return Math.round((progress.value.completed / progress.value.total) * 100)
  })

  return {
    // UI state
    loading,
    error,
    progress,
    connectionStatus,
    isConnected,
    progressPercentage,
    // Effect programs
    sendStudy,
    sendStudyWithProgress,
    testConnection,
    updateServerConfig,
    handleSendSelectedEffect,
    reset
  }
}
