import { ref, computed, onMounted } from 'vue'
import { useStorage } from '@vueuse/core'
import type { 
  DicomFile, 
  DicomStudy, 
  DicomStudyMetadata,
  DicomFileMetadata,
  AnonymizationConfig, 
  SendProgress 
} from '@/types/dicom'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { Anonymizer } from '@/services/anonymizer'
import { DicomSender, type DicomServerConfig } from '@/services/dicomSender'
import { opfsStorage, OPFSStorage } from '@/services/opfsStorage'

export function useDicomProcessor() {
  // In-memory state (with ArrayBuffers)
  const files = ref<DicomFile[]>([])
  const studies = ref<DicomStudy[]>([])
  const isProcessing = ref(false)
  const error = ref<string | null>(null)
  const isRestoring = ref(false)
  const restoreProgress = ref(0)

  // Persistent state (metadata only, no ArrayBuffers)
  const studiesMetadata = useStorage<DicomStudyMetadata[]>('dicom-studies', [])
  const sendProgress = useStorage<SendProgress[]>('dicom-send-progress', [])
  const serverConfig = useStorage<DicomServerConfig>('dicom-server-config', {
    url: '/api/orthanc'
  })
  const anonymizationConfig = useStorage<AnonymizationConfig>('dicom-anon-config', {
    removePrivateTags: true,
    profile: 'basic'
  })
  const sessionInfo = useStorage('dicom-session', {
    lastUpdated: Date.now(),
    filesCount: 0
  })

  // Services
  const fileHandler = new FileHandler()
  const dicomProcessor = new DicomProcessor()
  const anonymizer = new Anonymizer()

  // Computed
  const totalFiles = computed(() => files.value.length)
  const anonymizedFiles = computed(() => files.value.filter(f => f.anonymized).length)
  const hasFiles = computed(() => files.value.length > 0)

  // Helper functions for persistence
  function fileToMetadata(file: DicomFile): DicomFileMetadata {
    return {
      id: file.id,
      fileName: file.fileName,
      fileSize: file.fileSize,
      metadata: file.metadata,
      anonymized: file.anonymized,
      opfsFileId: file.id
    }
  }

  function studyToMetadata(study: DicomStudy): DicomStudyMetadata {
    return {
      studyInstanceUID: study.studyInstanceUID,
      patientName: study.patientName,
      patientId: study.patientId,
      studyDate: study.studyDate,
      studyDescription: study.studyDescription,
      series: study.series.map(series => ({
        seriesInstanceUID: series.seriesInstanceUID,
        seriesDescription: series.seriesDescription,
        modality: series.modality,
        files: series.files.map(fileToMetadata)
      }))
    }
  }

  async function saveFilesToStorage(filesToSave: DicomFile[]) {
    try {
      // Save binary data to OPFS
      for (const file of filesToSave) {
        await opfsStorage.saveFile(file.id, file.arrayBuffer)
      }
      
      // Update metadata in localStorage via useStorage
      const metadata = studies.value.map(studyToMetadata)
      studiesMetadata.value = metadata
      sessionInfo.value = {
        lastUpdated: Date.now(),
        filesCount: filesToSave.length
      }
    } catch (err) {
      console.error('Failed to save files to storage:', err)
      throw err
    }
  }

  async function restoreFromStorage() {
    if (studiesMetadata.value.length === 0) {
      return
    }

    isRestoring.value = true
    restoreProgress.value = 0
    
    try {
      const restoredFiles: DicomFile[] = []
      const totalFilesToRestore = studiesMetadata.value.reduce(
        (sum, study) => sum + study.series.reduce(
          (seriesSum, series) => seriesSum + series.files.length, 0
        ), 0
      )
      
      let filesRestored = 0

      // Restore files from OPFS
      for (const studyMeta of studiesMetadata.value) {
        for (const seriesMeta of studyMeta.series) {
          for (const fileMeta of seriesMeta.files) {
            try {
              // Load binary data from OPFS
              const arrayBuffer = await opfsStorage.loadFile(fileMeta.id)
              
              // Reconstruct DicomFile
              const file: DicomFile = {
                ...fileMeta,
                arrayBuffer
              }
              
              restoredFiles.push(file)
              filesRestored++
              restoreProgress.value = (filesRestored / totalFilesToRestore) * 100
            } catch (err) {
              console.error(`Failed to restore file ${fileMeta.fileName}:`, err)
              // Continue with other files even if one fails
            }
          }
        }
      }

      // Update in-memory state
      files.value = restoredFiles
      studies.value = dicomProcessor.groupFilesByStudy(restoredFiles)
      
      console.log(`Restored ${restoredFiles.length} files from storage`)
    } catch (err) {
      console.error('Failed to restore from storage:', err)
      error.value = 'Failed to restore previous session'
    } finally {
      isRestoring.value = false
      restoreProgress.value = 0
    }
  }

  // Initialize - restore previous session on mount
  onMounted(async () => {
    // Check if OPFS is supported
    if (!OPFSStorage.isSupported()) {
      error.value = 'Your browser does not support the required storage features. Please use Chrome 86+ or a modern browser.'
      return
    }

    // Restore previous session if available
    if (studiesMetadata.value.length > 0) {
      await restoreFromStorage()
    }
  })

  // Methods
  async function processZipFile(file: File) {
    try {
      isProcessing.value = true
      error.value = null

      console.log('Extracting ZIP file...')
      const extractedFiles = await fileHandler.extractZipFile(file)
      
      if (extractedFiles.length === 0) {
        throw new Error('No DICOM files found in ZIP archive')
      }

      console.log(`Found ${extractedFiles.length} DICOM files`)

      // Parse DICOM files
      const parsedFiles = extractedFiles.map(f => dicomProcessor.parseDicomFile(f))
      
      files.value = parsedFiles
      studies.value = dicomProcessor.groupFilesByStudy(parsedFiles)
      
      console.log(`Organized into ${studies.value.length} studies`)
      
      // Save to persistent storage
      await saveFilesToStorage(parsedFiles)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to process ZIP file'
      console.error('Error processing ZIP file:', err)
    } finally {
      isProcessing.value = false
    }
  }

  async function anonymizeAllFiles() {
    try {
      isProcessing.value = true
      error.value = null

      console.log('Anonymizing files...')
      const anonymizedFiles = await anonymizer.anonymizeFiles(
        files.value,
        anonymizationConfig.value
      )

      files.value = anonymizedFiles
      studies.value = dicomProcessor.groupFilesByStudy(anonymizedFiles)
      
      console.log('Anonymization completed')
      
      // Update persistent storage
      await saveFilesToStorage(anonymizedFiles)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to anonymize files'
      console.error('Error anonymizing files:', err)
    } finally {
      isProcessing.value = false
    }
  }

  async function sendStudy(study: DicomStudy) {
    try {
      const sender = new DicomSender(serverConfig.value)
      
      await sender.sendStudy(study, (progress) => {
        const existingIndex = sendProgress.value.findIndex(p => p.studyUID === progress.studyUID)
        if (existingIndex >= 0) {
          sendProgress.value[existingIndex] = progress
        } else {
          sendProgress.value.push(progress)
        }
      })
      
      console.log(`Study ${study.studyInstanceUID} sent successfully`)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to send study'
      console.error('Error sending study:', err)
    }
  }

  async function testConnection() {
    try {
      const sender = new DicomSender(serverConfig.value)
      const isConnected = await sender.testConnection()
      
      if (isConnected) {
        console.log('Connection test successful')
      } else {
        error.value = 'Failed to connect to DICOM server'
      }
      
      return isConnected
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Connection test failed'
      return false
    }
  }

  async function clearFiles() {
    try {
      // Clear in-memory state
      files.value = []
      studies.value = []
      error.value = null
      
      // Clear persistent storage
      studiesMetadata.value = []
      sendProgress.value = []
      sessionInfo.value = {
        lastUpdated: Date.now(),
        filesCount: 0
      }
      
      // Clear OPFS storage
      await opfsStorage.clearAllFiles()
      
      console.log('All files and storage cleared')
    } catch (err) {
      console.error('Failed to clear storage:', err)
      error.value = 'Failed to clear all files'
    }
  }

  function getProgressForStudy(studyUID: string): SendProgress | undefined {
    return sendProgress.value.find(p => p.studyUID === studyUID)
  }

  return {
    // State
    files,
    studies,
    isProcessing,
    error,
    sendProgress,
    serverConfig,
    anonymizationConfig,
    isRestoring,
    restoreProgress,

    // Computed
    totalFiles,
    anonymizedFiles,
    hasFiles,

    // Methods
    processZipFile,
    anonymizeAllFiles,
    sendStudy,
    testConnection,
    clearFiles,
    getProgressForStudy
  }
}