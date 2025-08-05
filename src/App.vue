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
import { useFileProcessing } from '@/composables/useFileProcessing'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useAnonymizer } from '@/composables/useAnonymizer'
import { useDicomSender } from '@/composables/useDicomSender'
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

// Initialize composables
const workflow = useDicomWorkflow()
const fileProcessing = useFileProcessing()
const dragAndDrop = useDragAndDrop()
const anonymizer = useAnonymizer()
const dicomSender = useDicomSender()

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

// Use drag and drop state from composable
const { 
  isDragOver, 
  isGlobalDragOver, 
  dragCounter,
  handleDrop,
  handleDragOver,
  handleDragLeave,
  handleGlobalDragEnter,
  handleGlobalDragLeave,
  handleGlobalDragOver,
  handleGlobalDrop,
  handleFileInput
} = dragAndDrop

// Use file processing state from composable
const { fileProcessingState } = fileProcessing

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

// File processing handler to use with drag and drop composable
async function processNewFiles(newFiles: File[]) {
  try {
    await runWithAppLayer(
      fileProcessing.processNewFilesEffect(newFiles, {
        isAppReady: isAppReady.value,
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
      workflow.errors.value.push(error)
    }
  }
}

// File addition handler for drag and drop composable
function addFilesToUploaded(newFiles: File[]) {
  uploadedFiles.value = [...uploadedFiles.value, ...newFiles]
}

async function processFiles() {
  // Process all uploaded files (used for initial load or when called directly)
  await processNewFiles(uploadedFiles.value)
}

// Anonymization handler using composable
async function anonymizeSelected() {
  try {
    await runWithAppLayer(
      anonymizer.anonymizeSelectedEffect(selectedStudies.value, config.value, {
        concurrency: concurrency.value,
        isAppReady: isAppReady.value,
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

// Test connection handler using composable
async function testConnection() {
  try {
    await runWithAppLayer(dicomSender.testConnection())
  } catch (error) {
    console.error('Connection test failed:', error)
    setAppError(error as Error)
  }
}

// Sending handler using composable
async function handleSendSelected(selectedStudiesToSend: DicomStudy[]) {
  try {
    successMessage.value = ''
    await runWithAppLayer(
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
    @dragenter="(event) => handleGlobalDragEnter(event)"
    @dragleave="(event) => handleGlobalDragLeave(event)"
    @dragover="(event) => handleGlobalDragOver(event)"
    @drop="(event) => handleGlobalDrop(event, { onFilesAdded: addFilesToUploaded, onProcessFiles: processNewFiles })"
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
        @drop="(event) => handleDrop(event, { onFilesAdded: addFilesToUploaded, onProcessFiles: processNewFiles })"
        @dragover="(event) => handleDragOver(event)"
        @dragleave="() => handleDragLeave()"
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
                @change="(event) => handleFileInput(event, { onFilesAdded: addFilesToUploaded, onProcessFiles: processNewFiles })"
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
