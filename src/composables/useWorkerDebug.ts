import { ref, computed } from 'vue'
import { getAnonymizationWorkerManager, getSendingWorkerManager } from '@/workers/workerManager'
import type { WorkerDetail as BaseWorkerDetail, DebugMessage } from '@/workers/workerManager'

// Extended worker detail with type information
interface WorkerDetail extends BaseWorkerDetail {
  type: 'anonymization' | 'sending'
}

// Global reactive state for worker debugging
const workerStatus = ref({
  totalWorkers: 0,
  activeJobs: 0,
  queuedJobs: 0
})

const workerDetails = ref<WorkerDetail[]>([])
const recentMessages = ref<DebugMessage[]>([])

export function useWorkerDebug() {
  const refreshStatus = () => {
    try {
      const anonymizationManager = getAnonymizationWorkerManager()
      const sendingManager = getSendingWorkerManager()
      
      // Combine status from both managers
      const anonStatus = anonymizationManager.getStatus()
      const sendStatus = sendingManager.getStatus()
      
      workerStatus.value = {
        totalWorkers: anonStatus.totalWorkers + sendStatus.totalWorkers,
        activeJobs: anonStatus.activeJobs + sendStatus.activeJobs,
        queuedJobs: anonStatus.queuedJobs + sendStatus.queuedJobs
      }
      
      // Combine worker details from both managers
      const anonWorkers = anonymizationManager.getWorkerDetails().map(w => ({
        ...w,
        type: 'anonymization' as const
      }))
      const sendWorkers = sendingManager.getWorkerDetails().map(w => ({
        ...w,
        type: 'sending' as const
      }))
      workerDetails.value = [...anonWorkers, ...sendWorkers]
      
      // Combine recent messages from both managers
      const anonMessages = anonymizationManager.getDebugMessages()
      const sendMessages = sendingManager.getDebugMessages()
      
      // Merge and sort by timestamp
      const allMessages = [...anonMessages, ...sendMessages]
      allMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      
      recentMessages.value = allMessages
    } catch (error) {
      console.error('Failed to refresh worker status:', error)
    }
  }

  const clearMessages = () => {
    try {
      const anonymizationManager = getAnonymizationWorkerManager()
      const sendingManager = getSendingWorkerManager()
      
      anonymizationManager.clearDebugMessages()
      sendingManager.clearDebugMessages()
      recentMessages.value = []
    } catch (error) {
      console.error('Failed to clear debug messages:', error)
    }
  }

  // Computed properties for easier access
  const isWorkerManagerActive = computed(() => workerStatus.value.totalWorkers > 0)
  
  const activeWorkers = computed(() => 
    workerDetails.value.filter(worker => !worker.isAvailable)
  )
  
  const idleWorkers = computed(() => 
    workerDetails.value.filter(worker => worker.isAvailable)
  )

  const hasActiveJobs = computed(() => workerStatus.value.activeJobs > 0)
  
  const hasQueuedJobs = computed(() => workerStatus.value.queuedJobs > 0)

  // Message filtering helpers
  const errorMessages = computed(() => 
    recentMessages.value.filter(msg => msg.type === 'error')
  )
  
  const progressMessages = computed(() => 
    recentMessages.value.filter(msg => msg.type === 'progress')
  )

  const workerCreationMessages = computed(() => 
    recentMessages.value.filter(msg => msg.type === 'create')
  )

  // Summary statistics
  const totalFilesProcessing = computed(() => 
    activeWorkers.value.reduce((total, worker) => 
      total + (worker.currentJob?.fileCount || 0), 0
    )
  )

  const averageWorkerUtilization = computed(() => {
    if (workerStatus.value.totalWorkers === 0) return 0
    return Math.round((workerStatus.value.activeJobs / workerStatus.value.totalWorkers) * 100)
  })

  return {
    // Core data
    workerStatus: computed(() => workerStatus.value),
    workerDetails: computed(() => workerDetails.value),
    recentMessages: computed(() => recentMessages.value),
    
    // Actions
    refreshStatus,
    clearMessages,
    
    // Computed properties
    isWorkerManagerActive,
    activeWorkers,
    idleWorkers,
    hasActiveJobs,
    hasQueuedJobs,
    
    // Message filters
    errorMessages,
    progressMessages,
    workerCreationMessages,
    
    // Statistics
    totalFilesProcessing,
    averageWorkerUtilization
  }
}

// Auto-refresh functionality for development
export function useWorkerDebugAutoRefresh(intervalMs = 2000) {
  const { refreshStatus, ...rest } = useWorkerDebug()
  
  let interval: NodeJS.Timeout | null = null
  
  const startAutoRefresh = () => {
    if (interval) return
    
    // Initial refresh
    refreshStatus()
    
    // Set up interval
    interval = setInterval(refreshStatus, intervalMs)
  }
  
  const stopAutoRefresh = () => {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  }
  
  return {
    ...rest,
    refreshStatus,
    startAutoRefresh,
    stopAutoRefresh
  }
}