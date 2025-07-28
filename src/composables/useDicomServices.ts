/**
 * Simplified Vue composables using Promise-based services
 */

import { ref, computed, onUnmounted } from 'vue'
import type { DicomFile, DicomStudy, AnonymizationConfig, DicomServerConfig, SendProgress } from '@/types/dicom'
import { DicomProcessor } from '@/services/dicomProcessor'
import { Anonymizer, type AnonymizationProgress } from '@/services/anonymizer'
import { createDicomSenderService } from '@/services/dicomSender'
import { configService } from '@/services/config'

// DICOM Processor Composable
export function useDicomProcessor() {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const lastResult = ref<DicomFile | DicomFile[] | null>(null)

  const parseFile = async (file: DicomFile): Promise<DicomFile | null> => {
    loading.value = true
    error.value = null
    
    try {
      const processor = new DicomProcessor()
      const result = await processor.parseFile(file)
      lastResult.value = result
      return result
    } catch (e) {
      error.value = e as Error
      return null
    } finally {
      loading.value = false
    }
  }

  const parseFiles = async (files: DicomFile[], concurrency = 3): Promise<DicomFile[]> => {
    loading.value = true
    error.value = null
    
    try {
      const processor = new DicomProcessor()
      const results = await processor.parseFiles(files, concurrency)
      lastResult.value = results
      return results
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  const validateFile = async (file: DicomFile) => {
    loading.value = true
    error.value = null
    
    try {
      const processor = new DicomProcessor()
      return await processor.validateFile(file)
    } catch (e) {
      error.value = e as Error
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    lastResult,
    parseFile,
    parseFiles,
    validateFile
  }
}

// Anonymizer Composable
export function useAnonymizer() {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<AnonymizationProgress | null>(null)
  const results = ref<DicomFile[]>([])

  const anonymizeFile = async (file: DicomFile, config: AnonymizationConfig): Promise<DicomFile | null> => {
    loading.value = true
    error.value = null
    
    try {
      const anonymizer = new Anonymizer()
      const result = await anonymizer.anonymizeFileWithEffect(file, config)
      return result
    } catch (e) {
      error.value = e as Error
      return null
    } finally {
      loading.value = false
    }
  }

  const anonymizeFiles = async (
    files: DicomFile[],
    config: AnonymizationConfig,
    concurrency = 3
  ): Promise<DicomFile[]> => {
    loading.value = true
    error.value = null
    progress.value = null
    results.value = []
    
    try {
      const anonymizer = new Anonymizer()
      const anonymizedFiles = await anonymizer.anonymizeFilesConcurrently(
        files,
        config,
        {
          concurrency,
          onProgress: (p) => {
            progress.value = p
          }
        }
      )
      
      results.value = anonymizedFiles
      return anonymizedFiles
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  const anonymizeInBatches = async (
    files: DicomFile[],
    config: AnonymizationConfig,
    batchSize = 10
  ): Promise<DicomFile[]> => {
    loading.value = true
    error.value = null
    results.value = []
    
    try {
      const anonymizer = new Anonymizer()
      const anonymizedFiles = await anonymizer.anonymizeInBatches(
        files,
        config,
        batchSize,
        (batchIndex, totalBatches) => {
          progress.value = {
            total: totalBatches,
            completed: batchIndex,
            percentage: Math.round((batchIndex / totalBatches) * 100)
          }
        }
      )
      
      results.value = anonymizedFiles
      return anonymizedFiles
    } catch (e) {
      error.value = e as Error
      return []
    } finally {
      loading.value = false
    }
  }

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
    results.value = []
  }

  // Computed progress percentage
  const progressPercentage = computed(() => progress.value?.percentage || 0)

  return {
    loading,
    error,
    progress,
    results,
    progressPercentage,
    anonymizeFile,
    anonymizeFiles,
    anonymizeInBatches,
    reset
  }
}

// DICOM Sender Composable
export function useDicomSender(serverConfig?: DicomServerConfig) {
  const config = serverConfig || configService.getDefaultServerConfig()
  const senderService = createDicomSenderService(config)
  
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref<SendProgress | null>(null)
  const connectionStatus = ref<boolean | null>(null)

  const sendStudy = async (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number } = {}
  ): Promise<boolean> => {
    loading.value = true
    error.value = null
    
    try {
      await senderService.sendStudy(study, (progress) => {
        // Handle progress if needed
      })
      return true
    } catch (e) {
      error.value = e as Error
      return false
    } finally {
      loading.value = false
    }
  }

  const sendStudyWithProgress = async (
    study: DicomStudy,
    options: { concurrency?: number; maxRetries?: number } = {}
  ): Promise<boolean> => {
    loading.value = true
    error.value = null
    progress.value = null
    
    try {
      await senderService.sendStudyWithProgressEffect(study, {
        ...options,
        onProgress: (p: any) => {
          progress.value = p
        },
        onError: (e: any) => {
          error.value = e
        }
      })
      return true
    } catch (e: any) {
      error.value = e as Error
      return false
    } finally {
      loading.value = false
    }
  }

  const testConnection = async (): Promise<boolean> => {
    try {
      const isConnected = await senderService.testConnection()
      connectionStatus.value = isConnected
      return isConnected
    } catch (e) {
      error.value = e as Error
      connectionStatus.value = false
      return false
    }
  }

  const updateServerConfig = (newConfig: DicomServerConfig) => {
    senderService.updateConfig(newConfig)
  }

  const reset = () => {
    loading.value = false
    error.value = null
    progress.value = null
  }

  // Computed properties
  const isConnected = computed(() => connectionStatus.value === true)
  const progressPercentage = computed(() => {
    if (!progress.value) return 0
    return Math.round((progress.value.sentFiles / progress.value.totalFiles) * 100)
  })

  return {
    loading,
    error,
    progress,
    connectionStatus,
    isConnected,
    progressPercentage,
    sendStudy,
    sendStudyWithProgress,
    testConnection,
    updateServerConfig,
    reset
  }
}

// Combined workflow composable for common patterns
export function useDicomWorkflow(serverConfig?: DicomServerConfig) {
  const processor = useDicomProcessor()
  const anonymizer = useAnonymizer()
  const sender = useDicomSender(serverConfig)

  // Overall loading state
  const loading = computed(() => 
    processor.loading.value || anonymizer.loading.value || sender.loading.value
  )

  // Combined error handling
  const errors = computed(() => {
    const errorList: Error[] = []
    if (processor.error.value) errorList.push(processor.error.value)
    if (anonymizer.error.value) errorList.push(anonymizer.error.value)
    if (sender.error.value) errorList.push(sender.error.value)
    return errorList
  })

  // Full workflow: parse -> anonymize -> send
  const processAnonymizeAndSend = async (
    files: File[],
    config: AnonymizationConfig,
    studyInfo: Partial<DicomStudy>,
    options: {
      concurrency?: number
      maxRetries?: number
    } = {}
  ): Promise<boolean> => {
    try {
      // Convert Files to DicomFiles
      const dicomFiles: DicomFile[] = await Promise.all(
        files.map(async (file, index) => ({
          id: `file-${index}-${Date.now()}`,
          fileName: file.name,
          fileSize: file.size,
          arrayBuffer: await file.arrayBuffer(),
          anonymized: false
        }))
      )

      // Parse files
      const parsedFiles = await processor.parseFiles(dicomFiles, options.concurrency)
      if (parsedFiles.length === 0) return false

      // Anonymize files
      const anonymizedFiles = await anonymizer.anonymizeFiles(parsedFiles, config, options.concurrency)
      if (anonymizedFiles.length === 0) return false

      // Create study structure
      const study: DicomStudy = {
        studyInstanceUID: studyInfo.studyInstanceUID || `1.2.3.4.5.${Date.now()}`,
        patientName: studyInfo.patientName || 'Anonymous',
        patientId: studyInfo.patientId || `PAT${Date.now()}`,
        studyDate: studyInfo.studyDate || new Date().toISOString().split('T')[0].replace(/-/g, ''),
        studyDescription: studyInfo.studyDescription || 'Processed Study',
        series: [{
          seriesInstanceUID: `1.2.3.4.6.${Date.now()}`,
          seriesDescription: 'Processed Series',
          modality: 'CT',
          files: anonymizedFiles
        }]
      }

      // Send to server
      return await sender.sendStudyWithProgress(study, options)
    } catch (e) {
      console.error('Workflow error:', e)
      return false
    }
  }

  const resetAll = () => {
    processor.lastResult.value = null
    processor.error.value = null
    anonymizer.reset()
    sender.reset()
  }

  // Cleanup on unmount
  onUnmounted(() => {
    resetAll()
  })

  return {
    // Individual services
    processor,
    anonymizer,
    sender,

    // Combined state
    loading,
    errors,

    // Combined workflows
    processAnonymizeAndSend,
    resetAll
  }
}