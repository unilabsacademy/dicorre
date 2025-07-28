import { ref, computed } from 'vue'
import type { DicomFile, DicomStudy, AnonymizationConfig, SendProgress } from '@/types/dicom'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { Anonymizer } from '@/services/anonymizer'
import { DicomSender, type DicomServerConfig } from '@/services/dicomSender'

export function useDicomProcessor() {
  // State
  const files = ref<DicomFile[]>([])
  const studies = ref<DicomStudy[]>([])
  const isProcessing = ref(false)
  const error = ref<string | null>(null)
  const sendProgress = ref<SendProgress[]>([])

  // Services
  const fileHandler = new FileHandler()
  const dicomProcessor = new DicomProcessor()
  const anonymizer = new Anonymizer()

  // Default server config - Use Vite proxy to avoid CORS issues
  const serverConfig = ref<DicomServerConfig>({
    url: '/api/orthanc'
  })

  // Default anonymization config
  const anonymizationConfig = ref<AnonymizationConfig>({
    removePrivateTags: true,
    profile: 'basic'
  })

  // Computed
  const totalFiles = computed(() => files.value.length)
  const anonymizedFiles = computed(() => files.value.filter(f => f.anonymized).length)
  const hasFiles = computed(() => files.value.length > 0)

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

  function clearFiles() {
    files.value = []
    studies.value = []
    sendProgress.value = []
    error.value = null
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