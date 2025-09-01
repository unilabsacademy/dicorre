<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, provide } from 'vue'
import { ManagedRuntime } from 'effect'
import type { DicomStudy } from '@/types/dicom'
import { useAppState } from '@/composables/useAppState'
import { AppLayer } from '@/services/shared/layers'
import { DataTable, columns } from '@/components/StudyDataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { useSessionPersistence } from '@/composables/useSessionPersistence'
import { useDownload } from '@/composables/useDownload'
import { useProjectSharing } from '@/composables/useProjectSharing'
import FileProcessingProgress from '@/components/FileProcessingProgress.vue'
import WorkerDebugPanel from '@/components/WorkerDebugPanel.vue'
import AppToolbar from '@/components/AppToolbar.vue'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'

const runtime = ManagedRuntime.make(AppLayer)
provide('appRuntime', runtime)
const appState = useAppState(runtime)

const { isDownloading, downloadSelectedStudies } = useDownload(runtime)
const { loadProjectFromUrl } = useProjectSharing()
const error = computed(() => {
  if (appState.configError.value) {
    return `Configuration Error: ${appState.configError.value.message}`
  }
})

const isRestoring = ref(false)
const restoreProgress = ref(0)

const {
  isDragOver,
  isGlobalDragOver,
  handleDrop,
  handleDragOver,
  handleDragLeave,
  handleGlobalDragEnter,
  handleGlobalDragLeave,
  handleGlobalDragOver,
  handleGlobalDrop,
  handleFileInput
} = appState.dragAndDrop

const { fileProcessingState } = appState.fileProcessing

const isAppReady = computed(() => {
  return !appState.configLoading.value && !appState.configError.value && appState.config.value !== null
})

const showFileDropZone = computed(() => {
  return isAppReady.value &&
    (!appState.studies.value || appState.studies.value.length === 0) &&
    !isRestoring.value
})

const showStudiesTable = computed(() => {
  return isAppReady.value && appState.studies.value && appState.studies.value.length > 0
})

const studiesData = computed(() => {
  return appState.studies.value || []
})

async function processNewFiles(newFiles: File[]) {
  await appState.processNewFiles(newFiles, isAppReady.value)
}

function addFilesToUploaded(newFiles: File[]) {
  appState.addFilesToUploaded(newFiles)
}

async function anonymizeSelected() {
  await appState.anonymizeSelected()
}

async function testConnection() {
  await appState.testConnection()
}

async function handleSendSelected(selectedStudiesToSend: DicomStudy[]) {
  await appState.handleSendSelected(selectedStudiesToSend)
}

function clearFiles() {
  appState.clearFiles()
  clearSession()
}

function handleConfigLoaded() {
  appState.handleConfigReload()
}

const {
  restore: restoreSession,
  clear: clearSession,
  isRestoring: persistenceRestoring,
  restoreProgress: persistenceProgress
} = useSessionPersistence(runtime, appState.dicomFiles, appState.studies)

watch(persistenceRestoring, (v) => (isRestoring.value = v))
watch(persistenceProgress, (v) => (restoreProgress.value = v))

onMounted(async () => {
  // Check for project in URL and load it
  try {
    const projectConfig = await loadProjectFromUrl()
    if (projectConfig) {
      await appState.handleLoadProject(projectConfig)
    }
  } catch (error) {
    console.error('Failed to load project from URL:', error)
  }

  // Restore session after potential project loading
  restoreSession()
})

onUnmounted(() => {
  runtime.dispose()
  appState.clearAppError()
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

    <div class="mx-auto max-w-7xl space-y-2">
      <!-- Error Display -->
      <Alert
        v-if="error"
        :variant="error?.includes('browser') ? 'default' : 'destructive'"
      >
        <AlertDescription>
          {{ error }}
          <Button
            v-if="!error?.includes('browser')"
            variant="ghost"
            size="sm"
            @click="error ? (error = undefined) : appState.clearAppError()"
            class="ml-2 h-auto p-1"
          >
            ×
          </Button>
          <div
            v-if="error?.includes('browser')"
            class="mt-2 text-sm"
          >
            <p>This application requires modern browser features for optimal performance.</p>
            <p>Supported browsers: Chrome 86+, Edge 86+, Safari 15.2+, Firefox 111+</p>
          </div>
        </AlertDescription>
      </Alert>

      <!-- Configuration Loading State -->
      <Card v-if="appState.configLoading.value">
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

      <!-- Consolidated Toolbar -->
      <AppToolbar
        v-if="isAppReady"
        :current-project="appState.currentProject.value"
        :is-project-mode="appState.isProjectMode.value"
        :selected-studies-count="appState.selectedStudiesCount.value"
        :is-processing="fileProcessingState?.isProcessing || false"
        :is-downloading="isDownloading"
        @create-project="appState.handleCreateProject"
        @clear-project="appState.handleClearProject"
        @anonymize-selected="anonymizeSelected"
        @send-selected="handleSendSelected(appState.selectedStudies.value)"
        @download-selected="downloadSelectedStudies(appState.studies.value, appState.selectedStudies.value)"
        @clear-all="clearFiles"
        @test-connection="testConnection"
        @config-loaded="handleConfigLoaded"
      />

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
        v-if="showFileDropZone"
        data-testid="file-drop-zone"
        class="border-dashed border-2 cursor-pointer transition-colors hover:border-primary/50"
        :class="{ 'border-primary bg-primary/5': isDragOver }"
        @drop="(event: any) => handleDrop(event, { onFilesAdded: addFilesToUploaded, onProcessFiles: processNewFiles })"
        @dragover="(event: any) => handleDragOver(event)"
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
                accept=".dcm,.zip,.jpg,.jpeg,.png,.bmp"
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
      <DataTable
        :columns="columns"
        :data="studiesData"
        data-testid="studies-data-table"
      />
      
      <!-- File counts for testing (small text at bottom) -->
      <div v-if="appState.dicomFiles.value.length > 0 || appState.anonymizedFilesCount.value > 0" class="text-xs text-muted-foreground mt-4 flex gap-4">
        <span data-testid="files-count-badge">Files: {{ appState.dicomFiles.value.length }}</span>
        <span data-testid="anonymized-count-badge">Anonymized: {{ appState.anonymizedFilesCount.value }}</span>
      </div>
    </div>

    <!-- Worker Debug Panel -->
    <WorkerDebugPanel />

    <!-- Toast Notifications -->
    <Toaster />
  </div>
</template>
