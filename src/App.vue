<script setup lang="ts">
import { ref } from 'vue'
import { useDicomProcessor } from '@/composables/useDicomProcessor'
import { DataTable, columns } from '@/components/StudyDataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

const {
  studies,
  isProcessing,
  error,
  totalFiles,
  anonymizedFiles,
  hasFiles,
  processZipFile,
  anonymizeAllFiles,
  sendStudy,
  testConnection,
  clearFiles,
  getProgressForStudy
} = useDicomProcessor()

const dataTableRef = ref()

const isDragOver = ref(false)

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = false

  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const file = files[0]
    if (file.name.endsWith('.zip')) {
      processZipFile(file)
    } else {
      error.value = 'Please drop a ZIP file containing DICOM files'
    }
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = true
}

function handleDragLeave() {
  isDragOver.value = false
}

function handleFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file && file.name.endsWith('.zip')) {
    processZipFile(file)
  }
}
</script>

<template>
  <div class="min-h-screen bg-background p-6">
    <div class="mx-auto max-w-7xl space-y-6">
      <!-- Header -->
      <div class="text-center">
        <h1 class="text-4xl font-bold tracking-tight">DICOM Anonymizer & Sender</h1>
        <p class="text-muted-foreground mt-2">Drop a ZIP file containing DICOM files to get started</p>
      </div>

      <!-- File Drop Zone -->
      <Card
        v-if="!hasFiles"
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
              <p class="text-lg text-muted-foreground mb-4">Drop ZIP file here or</p>
              <input
                type="file"
                accept=".zip"
                @change="handleFileInput"
                class="hidden"
                id="file-input"
              >
              <Button asChild>
                <label
                  for="file-input"
                  class="cursor-pointer"
                >
                  Browse Files
                </label>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Error Display -->
      <Alert
        v-if="error"
        variant="destructive"
      >
        <AlertDescription>
          {{ error }}
          <Button
            variant="ghost"
            size="sm"
            @click="error = null"
            class="ml-2 h-auto p-1"
          >
            ×
          </Button>
        </AlertDescription>
      </Alert>

      <!-- Loading State -->
      <Card v-if="isProcessing">
        <CardContent class="flex items-center justify-center py-8">
          <div class="text-center space-y-2">
            <div class="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p class="text-muted-foreground">Processing files...</p>
          </div>
        </CardContent>
      </Card>

      <!-- File Summary and Actions -->
      <Card v-if="hasFiles">
        <CardHeader>
          <CardTitle>Study Summary</CardTitle>
          <CardDescription>
            Manage your DICOM studies and anonymization process
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex flex-wrap gap-4">
            <div class="flex items-center gap-2">
              <Badge variant="outline">Total Files: {{ totalFiles }}</Badge>
              <Badge variant="default">Anonymized: {{ anonymizedFiles }}</Badge>
              <Badge variant="secondary">Studies: {{ studies.length }}</Badge>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button
              @click="anonymizeAllFiles"
              :disabled="isProcessing || anonymizedFiles === totalFiles"
              variant="default"
            >
              {{ anonymizedFiles === totalFiles ? 'All Files Anonymized' : 'Anonymize All' }}
            </Button>

            <Button
              @click="testConnection"
              variant="secondary"
            >
              Test Connection
            </Button>

            <Button
              @click="clearFiles"
              variant="destructive"
            >
              Clear All
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Studies Data Table -->
      <Card v-if="studies.length > 0">
        <CardHeader>
          <CardTitle>DICOM Studies</CardTitle>
          <CardDescription>
            Select studies to anonymize and send to PACS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            ref="dataTableRef"
            :columns="columns"
            :data="studies"
          />
        </CardContent>
      </Card>
    </div>
  </div>
</template>
