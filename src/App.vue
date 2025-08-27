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
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useSessionPersistence } from '@/composables/useSessionPersistence'
import { useDownload } from '@/composables/useDownload'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import FileProcessingProgress from '@/components/FileProcessingProgress.vue'
import WorkerDebugPanel from '@/components/WorkerDebugPanel.vue'
import ConfigLoader from '@/components/ConfigLoader.vue'
import ProjectToolbar from '@/components/ProjectToolbar.vue'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'
import {
  Shield,
  Send,
  Trash2,
  Settings2,
  Wifi,
  Download
} from 'lucide-vue-next'

const runtime = ManagedRuntime.make(AppLayer)
provide('appRuntime', runtime)
const appState = useAppState(runtime)
const { isDownloading, downloadSelectedStudies } = useDownload(runtime)
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
} = useSessionPersistence(appState.dicomFiles, appState.studies)

watch(persistenceRestoring, (v) => (isRestoring.value = v))
watch(persistenceProgress, (v) => (restoreProgress.value = v))

onMounted(() => {
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

      <!-- Project Toolbar -->
      <ProjectToolbar />

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
          >{{ appState.totalFiles }} Files</Badge>
          <Badge
            variant="default"
            data-testid="anonymized-count-badge"
          >{{ appState.anonymizedFilesCount }} Anonymized</Badge>
          <Badge
            variant="secondary"
            data-testid="studies-count-badge"
          >{{ appState.studies.value.length }} Studies</Badge>
          <Badge
            v-if="appState.selectedStudiesCount.value > 0"
            variant="default"
            data-testid="selected-count-badge"
          >{{ appState.selectedStudiesCount }} Selected</Badge>

        </div>

        <div class="flex items-center gap-2">
          <Button
            @click="anonymizeSelected"
            :disabled="appState.selectedStudiesCount.value === 0"
            variant="default"
            size="sm"
            data-testid="anonymize-button"
          >
            <Shield class="w-4 h-4 mr-2" />
            Anonymize ({{ appState.selectedStudiesCount }})
          </Button>

          <Button
            @click="handleSendSelected(appState.selectedStudies.value)"
            :disabled="fileProcessingState?.isProcessing || appState.selectedStudiesCount.value === 0"
            variant="secondary"
            size="sm"
            data-testid="send-button"
          >
            <Send class="w-4 h-4 mr-2" />
            Send ({{ appState.selectedStudiesCount }})
          </Button>

          <Button
            @click="downloadSelectedStudies(appState.studies.value, appState.selectedStudies.value)"
            :disabled="isDownloading || appState.selectedStudiesCount.value === 0"
            variant="outline"
            size="sm"
            data-testid="download-button"
          >
            <Download class="w-4 h-4 mr-2" />
            Download ({{ appState.selectedStudiesCount }})
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

          <ConfigLoader @config-loaded="handleConfigLoaded" />

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
      <Card
        v-if="showStudiesTable"
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
            :data="studiesData"
            data-testid="studies-data-table"
          />
        </CardContent>
      </Card>
    </div>

    <!-- Worker Debug Panel -->
    <WorkerDebugPanel />

    <!-- Toast Notifications -->
    <Toaster />
  </div>
</template>
