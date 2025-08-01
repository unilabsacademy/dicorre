<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue'
import type { DicomFile } from '@/types/dicom'
import { useDicomWorkflow } from '@/composables/useDicomWorkflow'
import type { AnonymizationConfig, DicomStudy } from '@/types/dicom'
import { FileHandlerWrapper } from '@/services/runtime/fileHandler'
import { groupDicomFilesByStudy } from '@/utils/dicomGrouping'
import { DataTable, columns } from '@/components/StudyDataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useSessionPersistence } from '@/composables/useSessionPersistence'
import { useTableState } from '@/composables/useTableState'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
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

// Initialize the workflow composable and file handler
const workflow = useDicomWorkflow()
const fileHandler = new FileHandlerWrapper()
const { setStudyProgress, removeStudyProgress, clearAllProgress, studyProgressMap } = useAnonymizationProgress()

// Component state
const uploadedFiles = ref<File[]>([])
const extractedDicomFiles = ref<DicomFile[]>([])
const fileInput = ref<HTMLInputElement>()
const successMessage = ref('')
const concurrency = ref(3)

// Store parsed (but not yet anonymized) DICOM files
const parsedDicomFiles = ref<DicomFile[]>([])

// Anonymization configuration
const config = reactive<AnonymizationConfig>({
  profile: 'basic',
  removePrivateTags: true,
  useCustomHandlers: true,
  dateJitterDays: 31
})

const studies = ref<DicomStudy[]>([])
const isProcessing = workflow.loading
const error = computed(() => workflow.errors.value[0]?.message || null)
const totalFiles = computed(() => extractedDicomFiles.value.length)
const anonymizedFiles = computed(() => workflow.anonymizer.results.value.length)
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
    study.series.every(s => s.files.every(f => f.anonymized))
  )
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

async function processNewFiles(newUploadedFiles: File[]) {
  if (newUploadedFiles.length === 0) return

  successMessage.value = ''
  let dicomFiles: DicomFile[] = []

  try {
    // Process each uploaded file with simulated progress tracking
    for (let i = 0; i < newUploadedFiles.length; i++) {
      const file = newUploadedFiles[i]

      // Initialize progress for this file
      fileProcessingState.value = {
        isProcessing: true,
        fileName: file.name,
        currentStep: file.name.toLowerCase().endsWith('.zip') ? 'Extracting ZIP archive...' : 'Reading DICOM file...',
        progress: 0,
        totalFiles: newUploadedFiles.length,
        currentFileIndex: i
      }

      // Simulate progress for ZIP files (they take longer)
      if (file.name.toLowerCase().endsWith('.zip')) {
        // Simulate gradual progress up to 90%
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

          // Add small delay to show progress
          await new Promise(resolve => setTimeout(resolve, 150))
        }

        // Now do the actual extraction
        const extractedFiles = await fileHandler.extractZipFile(file)
        dicomFiles.push(...extractedFiles)

        // Complete this file's progress
        fileProcessingState.value = {
          ...fileProcessingState.value,
          currentStep: `Extracted ${extractedFiles.length} DICOM files`,
          progress: 100
        }

        await new Promise(resolve => setTimeout(resolve, 300))
      } else {
        // For single files, show quick progress
        fileProcessingState.value = {
          ...fileProcessingState.value,
          progress: 50
        }

        const dicomFile = await fileHandler.readSingleDicomFile(file)
        dicomFiles.push(dicomFile)

        fileProcessingState.value = {
          ...fileProcessingState.value,
          currentStep: 'File processed',
          progress: 100
        }

        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    if (dicomFiles.length === 0) {
      workflow.errors.value.push(new Error('No DICOM files found in the uploaded files.'))
      fileProcessingState.value = null
      return
    }

    console.log(`Extracted ${dicomFiles.length} new DICOM files from ${newUploadedFiles.length} uploaded files`)

    // Parse files with simulated progress tracking
    fileProcessingState.value = {
      isProcessing: true,
      fileName: `${dicomFiles.length} DICOM files`,
      currentStep: 'Parsing DICOM metadata...',
      progress: 0,
      totalFiles: dicomFiles.length,
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
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // Do the actual parsing
    const parsedFiles = await workflow.processor.parseFiles(dicomFiles, concurrency.value)

    if (parsedFiles.length === 0) {
      fileProcessingState.value = null
      return
    }

    // Update to 90% and wait there
    fileProcessingState.value = {
      ...fileProcessingState.value,
      currentStep: 'Organizing into studies...',
      progress: 90
    }

    await new Promise(resolve => setTimeout(resolve, 300))

    // Add to existing parsed files for later anonymization
    parsedDicomFiles.value = [...parsedDicomFiles.value, ...parsedFiles]

    // Update extracted files reference with parsed files (which have metadata)
    extractedDicomFiles.value = [...extractedDicomFiles.value, ...parsedFiles]

    // Group all parsed files so that the UI can display studies
    const groupedStudies = groupDicomFilesByStudy(parsedDicomFiles.value)
    studies.value = groupedStudies

    console.log(`Parsed ${parsedFiles.length} new files, total: ${parsedDicomFiles.value.length} files in ${groupedStudies.length} studies`)

    // Complete progress
    fileProcessingState.value = {
      ...fileProcessingState.value,
      fileName: `Processing complete`,
      currentStep: `Successfully processed ${parsedFiles.length} files into ${groupedStudies.length} studies`,
      progress: 100
    }

    // Hide progress after showing completion
    setTimeout(() => {
      fileProcessingState.value = null
    }, 2000)

  } catch (error) {
    console.error('Error processing files:', error)
    fileProcessingState.value = null
    if (error instanceof Error) {
      workflow.errors.value.push(error)
    }
  }
}

async function processFiles() {
  // Process all uploaded files (used for initial load or when called directly)
  await processNewFiles(uploadedFiles.value)
}

// Anonymize selected studies
async function anonymizeSelected() {
  const selected = selectedStudies.value
  if (selected.length === 0) return

  console.log('anonymizeSelected called with', selected.length, 'studies')

  // Process each study separately to track progress per study
  for (const study of selected) {
    const studyFiles = study.series.flatMap(series => series.files)
    const totalFiles = studyFiles.length

    // Initialize progress tracking for this study
    console.log('Starting anonymization for study:', study.studyInstanceUID, 'with', totalFiles, 'files')
    setStudyProgress(study.studyInstanceUID, {
      isProcessing: true,
      progress: 0,
      totalFiles,
      currentFile: undefined
    })

    try {
      const anonymizedFiles = await workflow.anonymizer.anonymizeFiles(studyFiles, config, concurrency.value, {
        onProgress: (progressInfo) => {
          console.log('Progress callback called:', progressInfo)
          // Update progress for this specific study
          setStudyProgress(study.studyInstanceUID, {
            isProcessing: true,
            progress: progressInfo.percentage,
            totalFiles,
            currentFile: progressInfo.currentFile
          })
        }
      })

      console.log(`Successfully anonymized ${anonymizedFiles.length} files for study ${study.studyInstanceUID}`)

      // Update both parsedDicomFiles and extractedDicomFiles with the anonymized versions
      parsedDicomFiles.value = parsedDicomFiles.value.map(file => {
        const anonymized = anonymizedFiles.find(af => af.id === file.id)
        return anonymized || file
      })

      extractedDicomFiles.value = extractedDicomFiles.value.map(file => {
        const anonymized = anonymizedFiles.find(af => af.id === file.id)
        return anonymized || file
      })

      // Show completion for a brief moment
      await new Promise(resolve => setTimeout(resolve, 500))

      // Mark study as complete
      setStudyProgress(study.studyInstanceUID, {
        isProcessing: false,
        progress: 100,
        totalFiles,
        currentFile: undefined
      })

      // Clean up after a delay
      setTimeout(() => {
        removeStudyProgress(study.studyInstanceUID)
      }, 2000)

    } catch (error) {
      console.error(`Error anonymizing study ${study.studyInstanceUID}:`, error)
      removeStudyProgress(study.studyInstanceUID)
    }
  }

  // Refresh study grouping after all anonymizations
  console.log('Regrouping studies after anonymization...')
  console.log('Total parsed files:', parsedDicomFiles.value.length)
  const regroupedStudies = groupDicomFilesByStudy(parsedDicomFiles.value)
  console.log('Regrouped into', regroupedStudies.length, 'studies')
  studies.value = regroupedStudies
  successMessage.value = `Successfully anonymized ${selected.length} studies!`
}

// Test server connection - simple async/await
async function testConnection() {
  await workflow.sender.testConnection()
}

// Send files to server
async function sendStudy(study: DicomStudy) {
  if (workflow.anonymizer.results.value.length === 0) return

  successMessage.value = ''

  const success = await workflow.sender.sendStudyWithProgress(study, {
    concurrency: concurrency.value,
    maxRetries: 2
  })

  if (success) {
    successMessage.value = 'Files sent successfully to server!'
  }
}

function handleSendSelected(selectedStudies: DicomStudy[]) {
  // Send selected studies to PACS
  selectedStudies.forEach(study => {
    sendStudy(study)
  })
}

// Clear all files
function clearFiles() {
  uploadedFiles.value = []
  extractedDicomFiles.value = []
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
} = useSessionPersistence(extractedDicomFiles, studies)

// Bridge persistence state to local refs used in template
watch(persistenceRestoring, (v) => (isRestoring.value = v))
watch(persistenceProgress, (v) => (restoreProgress.value = v))

onMounted(() => {
  restoreSession()
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

      <!-- Debug -->
      <!-- <pre class="text-xs">
        isProcessing: {{ isProcessing }}
        isRestoring: {{ isRestoring }}
        restoreProgress: {{ restoreProgress }}
        error: {{ error }}
        totalFiles: {{ totalFiles }}
        studies: {{ studies.length }}
        parsedDicomFiles: {{ parsedDicomFiles.length }}
        extractedDicomFiles: {{ extractedDicomFiles.length }}
        tableState: {{ tableState }}
       </pre> -->

      <!-- Error Display -->
      <Alert
        v-if="error"
        :variant="error.includes('browser') ? 'default' : 'destructive'"
      >
        <AlertDescription>
          {{ error }}
          <Button
            v-if="!error.includes('browser')"
            variant="ghost"
            size="sm"
            @click="error = null"
            class="ml-2 h-auto p-1"
          >
            ×
          </Button>
          <div
            v-if="error.includes('browser')"
            class="mt-2 text-sm"
          >
            <p>This application requires modern browser features for optimal performance.</p>
            <p>Supported browsers: Chrome 86+, Edge 86+, Safari 15.2+, Firefox 111+</p>
          </div>
        </AlertDescription>
      </Alert>

      <!-- Loading State -->
      <Card v-if="isProcessing || isRestoring">
        <CardContent class="flex items-center justify-center py-8">
          <div class="text-center space-y-4 w-full max-w-md">
            <div class="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
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
          >{{ anonymizedFiles }} Anonymized</Badge>
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
            :disabled="isProcessing || selectedStudies.length === 0 || isAllSelectedAnonymized"
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
        v-if="studies.length === 0 && !isProcessing && !isRestoring"
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
        v-if="studies.length > 0"
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
