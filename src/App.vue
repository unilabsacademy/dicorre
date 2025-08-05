<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Effect } from 'effect'
import type { DicomFile } from '@/types/dicom'
import { useDicomWorkflow } from '@/composables/useDicomWorkflow'
import type { AnonymizationConfig, DicomStudy } from '@/types/dicom'
import { useAppConfig } from '@/composables/useAppConfig'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { Anonymizer } from '@/services/anonymizer'
import { DicomSender } from '@/services/dicomSender'
import { AppLayer } from '@/services/shared/layers'
import { DataTable, columns } from '@/components/StudyDataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useSessionPersistence } from '@/composables/useSessionPersistence'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import FileProcessingProgress from '@/components/FileProcessingProgress.vue'
import WorkerDebugPanel from '@/components/WorkerDebugPanel.vue'
import {
  Shield,
  Send,
  Trash2,
  Settings2,
  Wifi
} from 'lucide-vue-next'

// Initialize workflow composable for Effect program access
const workflow = useDicomWorkflow()

// Main Effect program services (will be initialized in onMounted)
const appServices = ref<{
  fileHandler: any
  processor: any
  anonymizer: any
  sender: any
} | null>(null)

// Main Effect program for the application
const mainProgram = Effect.gen(function* () {
  const fileHandler = yield* FileHandler
  const processor = yield* DicomProcessor
  const anonymizer = yield* Anonymizer
  const sender = yield* DicomSender
  
  return { fileHandler, processor, anonymizer, sender }
})

// Helper to run Effect programs with the application layer
const runWithAppLayer = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<A, E, never>)
const { setStudyProgress, removeStudyProgress, clearAllProgress } = useAnonymizationProgress()
const { setStudySendingProgress, removeStudySendingProgress, clearAllSendingProgress } = useSendingProgress()
const { config: loadedConfig, loading: configLoading, error: configError } = useAppConfig()

// Component state
const uploadedFiles = ref<File[]>([])
const dicomFiles = ref<DicomFile[]>([])
const successMessage = ref('')
const concurrency = ref(3)

// Use loaded configuration from app.config.json
const config = computed<AnonymizationConfig>(() => {
  return loadedConfig.value || {
    profile: 'basic',
    removePrivateTags: true,
    useCustomHandlers: true,
    dateJitterDays: 31
  }
})

const studies = ref<DicomStudy[]>([])
const isProcessing = workflow.loading
const error = computed(() => {
  if (configError.value) {
    return `Configuration Error: ${configError.value.message}`
  }
  return workflow.errors.value[0]?.message || null
})

// Application-level error handling
const appError = ref<string | null>(null)
const setAppError = (err: Error | string) => {
  appError.value = typeof err === 'string' ? err : err.message
  console.error('App Error:', err)
}

const clearAppError = () => {
  appError.value = null
}
const totalFiles = computed(() => dicomFiles.value.length)
const anonymizedFilesCount = computed(() => dicomFiles.value.filter(file => file.anonymized).length)
const isRestoring = ref(false)
const restoreProgress = ref(0)

const isDragOver = ref(false)
const isGlobalDragOver = ref(false)
const dragCounter = ref(0)

// File processing progress state
const fileProcessingState = ref<{
  isProcessing: boolean
  fileName: string
  currentStep: string
  progress: number
  totalFiles?: number
  currentFileIndex?: number
} | null>(null)

// Table state management
const tableState = useTableState()

// Computed properties for selected studies
const selectedStudies = computed(() => {
  return tableState.getSelectedStudies(studies.value)
})


const isAllSelectedAnonymized = computed(() => {
  if (selectedStudies.value.length === 0) return false

  return selectedStudies.value.every(study =>
    study?.series.every(s => s.files.every(f => f.anonymized)) ?? false
  )
})

const isAppReady = computed(() => {
  return !configLoading.value && !configError.value && loadedConfig.value !== null
})

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = false

  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const fileArray = Array.from(files)
    uploadedFiles.value = [...uploadedFiles.value, ...fileArray]

    // Auto-process only the new files
    await processNewFiles(fileArray)
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = true
}

function handleDragLeave() {
  isDragOver.value = false
}

function handleGlobalDragEnter(event: DragEvent) {
  event.preventDefault()
  dragCounter.value++
  if (event.dataTransfer?.types.includes('Files')) {
    isGlobalDragOver.value = true
  }
}

function handleGlobalDragLeave(event: DragEvent) {
  event.preventDefault()
  dragCounter.value--
  if (dragCounter.value === 0) {
    isGlobalDragOver.value = false
  }
}

function handleGlobalDragOver(event: DragEvent) {
  event.preventDefault()
}

async function handleGlobalDrop(event: DragEvent) {
  event.preventDefault()
  dragCounter.value = 0
  isGlobalDragOver.value = false

  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const fileArray = Array.from(files)
    uploadedFiles.value = [...uploadedFiles.value, ...fileArray]
    await processNewFiles(fileArray)
  }
}

async function handleFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) {
    const files = Array.from(target.files)
    uploadedFiles.value = [...uploadedFiles.value, ...files]

    // Auto-process only the new files
    await processNewFiles(files)
  }
}

// Effect-based file processing workflow
const processNewFilesEffect = (newUploadedFiles: File[]) =>
  Effect.gen(function* () {
    if (!isAppReady.value) {
      return yield* Effect.fail(new Error('Configuration not loaded'))
    }

    if (newUploadedFiles.length === 0) {
      return yield* Effect.succeed([])
    }

    const services = appServices.value
    if (!services) {
      return yield* Effect.fail(new Error('Application services not initialized'))
    }

    let localDicomFiles: DicomFile[] = []

    // Process each uploaded file
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
        // Simulate progress steps for ZIP files
        const progressSteps = [10, 25, 40, 60, 75, 90]
        const stepTexts = [
          'Reading archive structure...',
          'Extracting files...',
          'Validating DICOM files...',
          'Processing file headers...',
          'Analyzing metadata...',
          'Finalizing extraction...'
        ]

        for (let step = 0; step < progressSteps.length; step++) {
          fileProcessingState.value = {
            ...fileProcessingState.value,
            currentStep: stepTexts[step],
            progress: progressSteps[step]
          }
        }

        // Extract ZIP file using Effect
        const extractedFiles = yield* services.fileHandler.extractZipFile(file)
        localDicomFiles.push(...extractedFiles)

        fileProcessingState.value = {
          ...fileProcessingState.value,
          currentStep: `Extracted ${extractedFiles.length} DICOM files`,
          progress: 100
        }
      } else {
        fileProcessingState.value = {
          ...fileProcessingState.value,
          progress: 50
        }

        const dicomFile = yield* services.fileHandler.readSingleDicomFile(file)
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

    // Parse files with progress tracking
    fileProcessingState.value = {
      isProcessing: true,
      fileName: `${localDicomFiles.length} DICOM files`,
      currentStep: 'Parsing DICOM metadata...',
      progress: 0,
      totalFiles: localDicomFiles.length,
      currentFileIndex: 0
    }

    // Simulate parsing progress
    const parsingSteps = [20, 50, 80, 90]
    const parsingTexts = [
      'Reading DICOM headers...',
      'Extracting metadata...',
      'Validating file structure...',
      'Processing complete...'
    ]

    for (let step = 0; step < parsingSteps.length - 1; step++) {
      fileProcessingState.value = {
        ...fileProcessingState.value,
        currentStep: parsingTexts[step],
        progress: parsingSteps[step]
      }
    }

    // Parse files using Effect
    const parsedFiles = yield* services.processor.parseFiles(localDicomFiles, concurrency.value)

    if (parsedFiles.length === 0) {
      fileProcessingState.value = null
      return yield* Effect.succeed([])
    }

    fileProcessingState.value = {
      ...fileProcessingState.value,
      currentStep: 'Organizing into studies...',
      progress: 90
    }

    // Add to existing DICOM files
    dicomFiles.value = [...dicomFiles.value, ...parsedFiles]

    // Group files by study
    const groupedStudies = yield* services.processor.groupFilesByStudy(dicomFiles.value)
    studies.value = groupedStudies

    console.log(`Parsed ${parsedFiles.length} new files, total: ${dicomFiles.value.length} files in ${groupedStudies.length} studies`)

    // Complete progress
    fileProcessingState.value = {
      ...fileProcessingState.value,
      fileName: `Processing complete`,
      currentStep: `Successfully processed ${parsedFiles.length} files into ${groupedStudies.length} studies`,
      progress: 100
    }

    // Hide progress after completion
    setTimeout(() => {
      fileProcessingState.value = null
    }, 500)

    return parsedFiles
  })

// Wrapper function to execute the Effect program
async function processNewFiles(newUploadedFiles: File[]) {
  try {
    await runWithAppLayer(processNewFilesEffect(newUploadedFiles))
    successMessage.value = ''
  } catch (error) {
    console.error('Error processing files:', error)
    fileProcessingState.value = null
    if (error instanceof Error) {
      setAppError(error)
      workflow.errors.value.push(error)
    }
  }
}

async function processFiles() {
  // Process all uploaded files (used for initial load or when called directly)
  await processNewFiles(uploadedFiles.value)
}

// Effect-based anonymization workflow
const anonymizeSelectedEffect = () =>
  Effect.gen(function* () {
    if (!isAppReady.value) {
      return yield* Effect.fail(new Error('Configuration not loaded'))
    }

    const selected = selectedStudies.value
    if (selected.length === 0) {
      return yield* Effect.succeed([])
    }

    const services = appServices.value
    if (!services) {
      return yield* Effect.fail(new Error('Application services not initialized'))
    }

    console.log('anonymizeSelected called with', selected.length, 'studies')

    // Process all studies in parallel
    const anonymizeStudy = (study: DicomStudy) =>
      Effect.gen(function* () {
        const studyFiles = study.series.flatMap(series => series.files)
        const totalFiles = studyFiles.length

        // Initialize progress tracking
        setStudyProgress(study.studyInstanceUID, {
          isProcessing: true,
          progress: 0,
          totalFiles,
          currentFile: undefined
        })

        try {
          const anonymizedFiles = yield* services.anonymizer.anonymizeFiles(studyFiles, config.value, {
            concurrency: concurrency.value,
            onProgress: (progressInfo: any) => {
              console.log('Progress callback called for study', study.studyInstanceUID, ':', progressInfo)
              setStudyProgress(study.studyInstanceUID, {
                isProcessing: true,
                progress: progressInfo.percentage,
                totalFiles,
                currentFile: progressInfo.currentFile
              })
            }
          })

          console.log(`Successfully anonymized ${anonymizedFiles.length} files for study ${study.studyInstanceUID}`)

          // Update DICOM files with anonymized versions
          const updatedFiles = dicomFiles.value.map(file => {
            const anonymized = anonymizedFiles.find((af: any) => af.id === file.id)
            if (anonymized) {
              if (file.metadata && file.metadata !== anonymized.metadata) {
                file.metadata = undefined
              }
            }
            return anonymized || file
          })

          dicomFiles.value = updatedFiles

          // Refresh study grouping
          console.log(`Regrouping studies after ${study.studyInstanceUID} anonymization completion...`)
          const regroupedStudies = yield* services.processor.groupFilesByStudy(dicomFiles.value)
          studies.value = regroupedStudies
          console.log(`Updated UI with ${regroupedStudies.length} studies after ${study.studyInstanceUID} completion`)

          // Mark study as complete
          setStudyProgress(study.studyInstanceUID, {
            isProcessing: false,
            progress: 100,
            totalFiles,
            currentFile: undefined
          })

          removeStudyProgress(study.studyInstanceUID)

          return anonymizedFiles
        } catch (error) {
          console.error(`Error anonymizing study ${study.studyInstanceUID}:`, error)
          removeStudyProgress(study.studyInstanceUID)
          return yield* Effect.fail(error as Error)
        }
      })

    // Process all studies in parallel
    const results = yield* Effect.all(selected.map(anonymizeStudy), { concurrency: 'unbounded' })
    
    console.log(`All ${selected.length} studies completed anonymization`)
    successMessage.value = `Successfully anonymized ${selected.length} studies!`
    
    return results
  })

// Wrapper function to execute the Effect program
async function anonymizeSelected() {
  try {
    await runWithAppLayer(anonymizeSelectedEffect())
  } catch (error) {
    console.error('Error in anonymization:', error)
    setAppError(error as Error)
  }
}

// Effect-based connection testing  
const testConnectionEffect = () =>
  Effect.gen(function* () {
    const services = appServices.value
    if (!services) {
      return yield* Effect.fail(new Error('Application services not initialized'))
    }
    
    return yield* services.sender.testConnection
  })

async function testConnection() {
  try {
    await runWithAppLayer(testConnectionEffect())
  } catch (error) {
    console.error('Connection test failed:', error)
    setAppError(error as Error)
  }
}

// Effect-based sending workflow
const handleSendSelectedEffect = (selectedStudiesToSend: DicomStudy[]) =>
  Effect.gen(function* () {
    const services = appServices.value
    if (!services) {
      return yield* Effect.fail(new Error('Application services not initialized'))
    }

    console.log(`Starting to send ${selectedStudiesToSend.length} selected studies`)
    
    const sendStudy = (study: DicomStudy) =>
      Effect.gen(function* () {
        const totalFiles = study.series.reduce((sum, s) => sum + s.files.length, 0)
        
        try {
          console.log(`Starting to send study ${study.studyInstanceUID} with ${totalFiles} files`)
          
          // Set initial sending progress
          setStudySendingProgress(study.studyInstanceUID, {
            isProcessing: true,
            progress: 0,
            totalFiles,
            currentFile: undefined
          })

          // Create progress callback
          const onProgress = (completed: number, total: number, currentFile?: string) => {
            const progress = Math.round((completed / total) * 100)
            console.log(`Sending progress for study ${study.studyInstanceUID}: ${completed}/${total} (${progress}%)`)
            
            setStudySendingProgress(study.studyInstanceUID, {
              isProcessing: true,
              progress,
              totalFiles: total,
              currentFile
            })
          }

          // Send study using Effect program
          const sentFiles = yield* services.sender.sendStudy(study, {
            concurrency: concurrency.value,
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
            const updatedFiles = dicomFiles.value.map(file => {
              const studyFile = study.series.find(s => s.files.find(f => f.id === file.id))?.files.find(f => f.id === file.id)
              if (studyFile) {
                return { ...file, sent: true }
              }
              return file
            })
            
            dicomFiles.value = updatedFiles

            // Refresh study grouping
            console.log(`Regrouping studies after ${study.studyInstanceUID} sending completion...`)
            const regroupedStudies = yield* services.processor.groupFilesByStudy(dicomFiles.value)
            studies.value = regroupedStudies
            console.log(`Updated UI with ${regroupedStudies.length} studies after ${study.studyInstanceUID} completion`)
            
            // Mark study as complete
            setStudySendingProgress(study.studyInstanceUID, {
              isProcessing: false,
              progress: 100,
              totalFiles,
              currentFile: undefined
            })

            removeStudySendingProgress(study.studyInstanceUID)
            
            console.log(`Successfully sent study ${study.studyInstanceUID}`)
            return true
          } else {
            return yield* Effect.fail(new Error('Failed to send study'))
          }

        } catch (error) {
          console.error(`Error sending study ${study.studyInstanceUID}:`, error)
          removeStudySendingProgress(study.studyInstanceUID)
          return yield* Effect.fail(error as Error)
        }
      })

    // Process all studies in parallel
    const results = yield* Effect.all(selectedStudiesToSend.map(sendStudy), { concurrency: 'unbounded' })

    console.log(`All ${selectedStudiesToSend.length} studies completed sending`)
    successMessage.value = `Successfully sent ${selectedStudiesToSend.length} studies!`
    
    return results
  })

// Wrapper function to execute the Effect program
async function handleSendSelected(selectedStudies: DicomStudy[]) {
  try {
    successMessage.value = ''
    await runWithAppLayer(handleSendSelectedEffect(selectedStudies))
  } catch (error) {
    console.error('Error in sending:', error)
    setAppError(error as Error)
  }
}

// Legacy function removed - now handled by Effect-based workflow

// Clear all files
function clearFiles() {
  // Clear file data explicitly to help garbage collection
  dicomFiles.value.forEach(file => {
    // Clear metadata to reduce memory usage
    if (file.metadata) file.metadata = undefined
  })

  uploadedFiles.value = []
  dicomFiles.value = []
  studies.value = []
  workflow.resetAll()
  successMessage.value = ''
  fileProcessingState.value = null
  clearAllProgress()
  clearSession()
  tableState.clearSelection()
}

// Aliases for template compatibility
const processZipFile = (file: File) => {
  uploadedFiles.value = [file]
  processFiles()
}

// Session persistence
const {
  restore: restoreSession,
  clear: clearSession,
  isRestoring: persistenceRestoring,
  restoreProgress: persistenceProgress
} = useSessionPersistence(dicomFiles, studies)

// Bridge persistence state to local refs used in template
watch(persistenceRestoring, (v) => (isRestoring.value = v))
watch(persistenceProgress, (v) => (restoreProgress.value = v))

// Initialize application services on mount
onMounted(async () => {
  try {
    // Initialize main Effect program and services
    const services = await runWithAppLayer(mainProgram)
    appServices.value = services
    console.log('Application services initialized:', services)
    
    // Restore session after services are available
    restoreSession()
  } catch (error) {
    console.error('Failed to initialize application services:', error)
    setAppError(error as Error)
  }
})

// Cleanup on unmount
onUnmounted(() => {
  // Clear any running Effect programs
  clearAppError()
  appServices.value = null
})
</script>

<template>
  <div
    class="min-h-screen bg-background p-6 relative"
    @dragenter="handleGlobalDragEnter"
    @dragleave="handleGlobalDragLeave"
    @dragover="handleGlobalDragOver"
    @drop="handleGlobalDrop"
  >
    <!-- Global Drag Overlay -->
    <div
      v-if="isGlobalDragOver"
      class="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center"
      data-testid="global-drag-overlay"
    >
      <div class="bg-background border-2 border-dashed border-primary rounded-lg p-12 text-center">
        <div class="text-6xl text-primary mb-4">📁</div>
        <p class="text-2xl font-semibold text-primary">Drop files to upload</p>
        <p class="text-muted-foreground mt-2">Release to add DICOM files</p>
      </div>
    </div>

    <div class="mx-auto max-w-7xl space-y-6">
      <!-- Header -->
      <div class="text-center">
        <h1
          data-testid="app-title"
          class="text-4xl font-bold tracking-tight"
        >DICOM Anonymizer & Sender</h1>
        <p class="text-muted-foreground mt-2">Drop DICOM files or ZIP archives to get started</p>
      </div>

      <!-- Error Display -->
      <Alert
        v-if="error || appError"
        :variant="(error || appError)?.includes('browser') ? 'default' : 'destructive'"
      >
        <AlertDescription>
          {{ error || appError }}
          <Button
            v-if="!(error || appError)?.includes('browser')"
            variant="ghost"
            size="sm"
            @click="error ? (error = null) : clearAppError()"
            class="ml-2 h-auto p-1"
          >
            ×
          </Button>
          <div
            v-if="(error || appError)?.includes('browser')"
            class="mt-2 text-sm"
          >
            <p>This application requires modern browser features for optimal performance.</p>
            <p>Supported browsers: Chrome 86+, Edge 86+, Safari 15.2+, Firefox 111+</p>
          </div>
        </AlertDescription>
      </Alert>

      <!-- Configuration Loading State -->
      <Card v-if="configLoading">
        <CardContent class="flex items-center justify-center py-8">
          <div class="text-center space-y-4 w-full max-w-md">
            <p class="text-muted-foreground">
              Loading configuration...
            </p>
            <Progress
              :model-value="50"
              class="w-full"
            />
          </div>
        </CardContent>
      </Card>

      <!-- Session Restore Loading State -->
      <Card v-else-if="isRestoring">
        <CardContent class="flex items-center justify-center py-8">
          <div class="text-center space-y-4 w-full max-w-md">
            <p class="text-muted-foreground">
              {{ isRestoring ? 'Restoring previous session...' : 'Processing files...' }}
            </p>
            <Progress
              v-if="isRestoring && restoreProgress > 0"
              :model-value="restoreProgress"
              class="w-full"
            />
          </div>
        </CardContent>
      </Card>

      <!-- Toolbar -->
      <div
        v-if="isAppReady"
        class="flex items-center justify-between bg-muted/50 p-4 rounded-lg border"
        data-testid="toolbar"
      >
        <div class="flex items-center gap-3">
          <Badge
            variant="outline"
            data-testid="files-count-badge"
          >{{ totalFiles }} Files</Badge>
          <Badge
            variant="default"
            data-testid="anonymized-count-badge"
          >{{ anonymizedFilesCount }} Anonymized</Badge>
          <Badge
            variant="secondary"
            data-testid="studies-count-badge"
          >{{ studies.length }} Studies</Badge>
          <Badge
            v-if="selectedStudies.length > 0"
            variant="default"
            data-testid="selected-count-badge"
          >{{ selectedStudies.length }} Selected</Badge>
        </div>

        <div class="flex items-center gap-2">
          <Button
            @click="anonymizeSelected"
            :disabled="selectedStudies.length === 0 || isAllSelectedAnonymized"
            variant="default"
            size="sm"
            data-testid="anonymize-button"
          >
            <Shield class="w-4 h-4 mr-2" />
            Anonymize ({{ selectedStudies.length }})
          </Button>

          <Button
            @click="handleSendSelected(selectedStudies)"
            :disabled="isProcessing || selectedStudies.length === 0 || !isAllSelectedAnonymized"
            variant="secondary"
            size="sm"
            data-testid="send-button"
          >
            <Send class="w-4 h-4 mr-2" />
            Send{{ selectedStudies.length > 0 ? ` (${selectedStudies.length})` : '' }}
          </Button>

          <Button
            @click="clearFiles"
            variant="destructive"
            size="sm"
            data-testid="clear-all-button"
          >
            <Trash2 class="w-4 h-4 mr-2" />
            Clear All
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                data-testid="settings-menu-button"
              >
                <Settings2 class="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                @click="testConnection"
                data-testid="test-connection-menu-item"
              >
                <Wifi class="w-4 h-4 mr-2" />
                Test Connection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <!-- File Processing Progress -->
      <FileProcessingProgress
        v-if="fileProcessingState?.isProcessing"
        :file-name="fileProcessingState.fileName"
        :current-step="fileProcessingState.currentStep"
        :progress="fileProcessingState.progress"
        :total-files="fileProcessingState.totalFiles"
        :current-file-index="fileProcessingState.currentFileIndex"
      />

      <!-- File Drop Zone -->
      <Card
        v-if="isAppReady && studies.length === 0 && !isProcessing && !isRestoring"
        data-testid="file-drop-zone"
        class="border-dashed border-2 cursor-pointer transition-colors hover:border-primary/50"
        :class="{ 'border-primary bg-primary/5': isDragOver }"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
      >
        <CardContent class="flex flex-col items-center justify-center py-16">
          <div class="text-center space-y-4">
            <div class="text-6xl text-muted-foreground">📁</div>
            <div>
              <p
                data-testid="drop-zone-text"
                class="text-lg text-muted-foreground mb-4"
              >Drop DICOM files here or</p>
              <input
                type="file"
                accept=".dcm,.zip"
                multiple
                @change="handleFileInput"
                class="hidden"
                id="file-input"
                data-testid="file-input"
              >
              <Button asChild>
                <label
                  for="file-input"
                  class="cursor-pointer"
                  data-testid="browse-files-button"
                >
                  Browse Files
                </label>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Studies Data Table -->
      <Card
        v-if="isAppReady && studies.length > 0"
        data-testid="studies-table-card"
      >
        <CardHeader>
          <CardTitle data-testid="studies-table-title">DICOM Studies</CardTitle>
          <CardDescription>
            Select studies to anonymize and send to PACS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            :columns="columns"
            :data="studies"
            data-testid="studies-data-table"
          />
        </CardContent>
      </Card>
    </div>

    <!-- Worker Debug Panel -->
    <WorkerDebugPanel />
  </div>
</template>
