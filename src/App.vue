<script setup lang="ts">
import { ref } from 'vue'
import { useDicomProcessor } from '@/composables/useDicomProcessor'

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
  <div class="app">
    <header class="header">
      <h1>DICOM Anonymizer & Sender</h1>
      <p>Drop a ZIP file containing DICOM files to get started</p>
    </header>

    <main class="main">
      <!-- File Drop Zone -->
      <div 
        v-if="!hasFiles"
        class="drop-zone"
        :class="{ 'drag-over': isDragOver }"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
      >
        <div class="drop-content">
          <p>Drop ZIP file here or</p>
          <input 
            type="file" 
            accept=".zip" 
            @change="handleFileInput"
            class="file-input"
            id="file-input"
          >
          <label for="file-input" class="file-label">Browse Files</label>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="error" class="error">
        {{ error }}
        <button @click="error = null" class="close-btn">×</button>
      </div>

      <!-- Loading State -->
      <div v-if="isProcessing" class="loading">
        Processing files...
      </div>

      <!-- File Summary -->
      <div v-if="hasFiles" class="summary">
        <div class="summary-stats">
          <span>Total Files: {{ totalFiles }}</span>
          <span>Anonymized: {{ anonymizedFiles }}</span>
          <span>Studies: {{ studies.length }}</span>
        </div>
        
        <div class="actions">
          <button 
            @click="anonymizeAllFiles" 
            :disabled="isProcessing || anonymizedFiles === totalFiles"
            class="btn btn-primary"
          >
            {{ anonymizedFiles === totalFiles ? 'All Files Anonymized' : 'Anonymize All' }}
          </button>
          
          <button @click="testConnection" class="btn btn-secondary">
            Test Connection
          </button>
          
          <button @click="clearFiles" class="btn btn-danger">
            Clear All
          </button>
        </div>
      </div>

      <!-- Studies List -->
      <div v-if="studies.length > 0" class="studies">
        <h3>Studies</h3>
        <div v-for="study in studies" :key="study.studyInstanceUID" class="study-card">
          <div class="study-header">
            <h4>{{ study.patientName || 'Unknown Patient' }}</h4>
            <span class="study-date">{{ study.studyDate || 'Unknown Date' }}</span>
          </div>
          
          <div class="study-details">
            <p><strong>Study ID:</strong> {{ study.studyInstanceUID }}</p>
            <p><strong>Patient ID:</strong> {{ study.patientId || 'Unknown' }}</p>
            <p><strong>Description:</strong> {{ study.studyDescription || 'No description' }}</p>
            <p><strong>Series:</strong> {{ study.series.length }}</p>
            <p><strong>Total Files:</strong> {{ study.series.reduce((sum, s) => sum + s.files.length, 0) }}</p>
          </div>

          <!-- Progress Display -->
          <div v-if="getProgressForStudy(study.studyInstanceUID)" class="progress">
            <div class="progress-info">
              <span>{{ getProgressForStudy(study.studyInstanceUID)?.status }}</span>
              <span>{{ getProgressForStudy(study.studyInstanceUID)?.sentFiles }} / {{ getProgressForStudy(study.studyInstanceUID)?.totalFiles }}</span>
            </div>
            <div class="progress-bar">
              <div 
                class="progress-fill" 
                :style="{ width: `${(getProgressForStudy(study.studyInstanceUID)?.sentFiles || 0) / (getProgressForStudy(study.studyInstanceUID)?.totalFiles || 1) * 100}%` }"
              ></div>
            </div>
          </div>

          <button 
            @click="sendStudy(study)" 
            :disabled="isProcessing || !study.series.every(s => s.files.every(f => f.anonymized))"
            class="btn btn-primary"
          >
            {{ study.series.every(s => s.files.every(f => f.anonymized)) ? 'Send Study' : 'Anonymize First' }}
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.header {
  text-align: center;
  margin-bottom: 40px;
}

.header h1 {
  color: #2c3e50;
  margin-bottom: 10px;
}

.header p {
  color: #7f8c8d;
}

/* Drop Zone */
.drop-zone {
  border: 3px dashed #bdc3c7;
  border-radius: 10px;
  padding: 60px 20px;
  text-align: center;
  margin-bottom: 20px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.drop-zone.drag-over {
  border-color: #3498db;
  background-color: #f8f9fa;
}

.drop-content p {
  margin-bottom: 20px;
  font-size: 18px;
  color: #7f8c8d;
}

.file-input {
  display: none;
}

.file-label {
  background-color: #3498db;
  color: white;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-block;
  transition: background-color 0.3s ease;
}

.file-label:hover {
  background-color: #2980b9;
}

/* Error Display */
.error {
  background-color: #e74c3c;
  color: white;
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
  position: relative;
}

.close-btn {
  position: absolute;
  right: 15px;
  top: 15px;
  background: none;
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
}

/* Loading */
.loading {
  text-align: center;
  padding: 20px;
  font-size: 18px;
  color: #7f8c8d;
}

/* Summary */
.summary {
  background-color: #f8f9fa;
  padding: 20px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.summary-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.summary-stats span {
  background-color: white;
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #3498db;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #2980b9;
}

.btn-secondary {
  background-color: #95a5a6;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #7f8c8d;
}

.btn-danger {
  background-color: #e74c3c;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background-color: #c0392b;
}

/* Studies */
.studies h3 {
  color: #2c3e50;
  margin-bottom: 20px;
}

.study-card {
  background-color: white;
  border: 1px solid #ecf0f1;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 15px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.study-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid #ecf0f1;
  padding-bottom: 10px;
}

.study-header h4 {
  margin: 0;
  color: #2c3e50;
}

.study-date {
  color: #7f8c8d;
  font-size: 14px;
}

.study-details {
  margin-bottom: 15px;
}

.study-details p {
  margin: 5px 0;
  font-size: 14px;
  color: #34495e;
}

/* Progress */
.progress {
  margin: 15px 0;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 14px;
  color: #7f8c8d;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background-color: #ecf0f1;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #27ae60;
  transition: width 0.3s ease;
}
</style>
