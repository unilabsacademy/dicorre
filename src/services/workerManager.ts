/**
 * Worker Pool Manager for DICOM Anonymization
 * Manages a pool of web workers for parallel processing
 */

import type { DicomFile, AnonymizationConfig } from '@/types/dicom'
import { OPFSWorkerHelper } from './opfsWorkerHelper'

// Debug message interface
export interface DebugMessage {
  id: string
  type: 'create' | 'assign' | 'progress' | 'complete' | 'error' | 'queue' | 'message'
  timestamp: string
  content: string
  workerId?: number
  studyId?: string
}

// Worker details for debugging
export interface WorkerDetail {
  id: number
  isAvailable: boolean
  currentJob: {
    studyId: string
    fileCount: number
  } | null
}

// Global debug state
let debugMessages: DebugMessage[] = []
let debugMessageId = 0

export interface AnonymizationJob {
  studyId: string
  files: DicomFile[]
  config: AnonymizationConfig
  concurrency?: number
  onProgress?: (progress: { total: number; completed: number; percentage: number; currentFile?: string }) => void
  onComplete?: (anonymizedFiles: DicomFile[]) => void
  onError?: (error: Error) => void
}

interface WorkerTask {
  id: number
  worker: Worker
  job: AnonymizationJob | null
  isAvailable: boolean
}

export class WorkerManager {
  private workers: WorkerTask[] = []
  private jobQueue: AnonymizationJob[] = []
  private maxWorkers: number
  private nextWorkerId = 1

  constructor(maxWorkers?: number) {
    // Use hardware concurrency or default to 4 workers
    this.maxWorkers = maxWorkers || Math.min(navigator.hardwareConcurrency || 4, 8)
    this.logDebug('create', `Initializing WorkerManager with ${this.maxWorkers} workers`)
    this.initializeWorkers()
  }

  private logDebug(type: DebugMessage['type'], content: string, workerId?: number, studyId?: string) {
    const message: DebugMessage = {
      id: `debug-${++debugMessageId}`,
      type,
      timestamp: new Date().toISOString().split('T')[1].split('.')[0],
      content,
      workerId,
      studyId
    }
    debugMessages.push(message)
    
    // Keep only last 100 messages
    if (debugMessages.length > 100) {
      debugMessages = debugMessages.slice(-100)
    }

    console.log(`[WorkerManager] ${type.toUpperCase()}: ${content}`, { workerId, studyId })
  }

  private initializeWorkers() {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker()
    }
  }

  private createWorker(): WorkerTask {
    const workerId = this.nextWorkerId++
    this.logDebug('create', `Creating worker #${workerId}`, workerId)

    const worker = new Worker(
      new URL('../workers/anonymizationWorker.ts', import.meta.url),
      { type: 'module' }
    )

    const workerTask: WorkerTask = {
      id: workerId,
      worker,
      job: null,
      isAvailable: true
    }

    // Handle messages from worker
    worker.addEventListener('message', (event) => {
      this.handleWorkerMessage(workerTask, event.data)
    })

    // Handle worker errors
    worker.addEventListener('error', (error) => {
      this.logDebug('error', `Worker #${workerId} error: ${error.message}`, workerId)
      if (workerTask.job) {
        workerTask.job.onError?.(new Error(`Worker error: ${error.message}`))
        this.completeJob(workerTask)
      }
    })

    this.workers.push(workerTask)
    this.logDebug('create', `Worker #${workerId} created and added to pool`, workerId)
    return workerTask
  }

  private handleWorkerMessage(workerTask: WorkerTask, message: any) {
    const { type, studyId, data } = message

    // Handle worker ready signal
    if (studyId === 'worker-ready') {
      this.logDebug('message', `Worker #${workerTask.id} is ready`, workerTask.id)
      return
    }

    const job = workerTask.job
    if (!job || job.studyId !== studyId) {
      this.logDebug('error', `Worker #${workerTask.id} received message for unknown job: ${studyId}`, workerTask.id, studyId)
      return
    }

    this.logDebug('message', `Worker #${workerTask.id} sent ${type} message`, workerTask.id, studyId)

    switch (type) {
      case 'progress':
        this.logDebug('progress', `Progress: ${data.percentage}% (${data.completed}/${data.total})`, workerTask.id, studyId)
        job.onProgress?.(data)
        break

      case 'complete':
        this.logDebug('complete', `Completed anonymization of ${data.anonymizedFiles.length} files`, workerTask.id, studyId)
        job.onComplete?.(data.anonymizedFiles)
        this.completeJob(workerTask)
        break

      case 'error':
        this.logDebug('error', `Error: ${data.message}`, workerTask.id, studyId)
        job.onError?.(new Error(data.message))
        this.completeJob(workerTask)
        break

      default:
        this.logDebug('error', `Unknown message type: ${type}`, workerTask.id, studyId)
    }
  }

  private completeJob(workerTask: WorkerTask) {
    const studyId = workerTask.job?.studyId
    this.logDebug('complete', `Worker #${workerTask.id} completed job`, workerTask.id, studyId)
    
    workerTask.job = null
    workerTask.isAvailable = true
    
    // Process next job in queue if available
    this.processQueue()
  }

  private processQueue() {
    if (this.jobQueue.length === 0) {
      return
    }

    const availableWorker = this.workers.find(w => w.isAvailable)
    if (!availableWorker) {
      this.logDebug('queue', `No available workers for ${this.jobQueue.length} queued jobs`)
      return
    }

    const job = this.jobQueue.shift()!
    this.logDebug('queue', `Processing queued job for study ${job.studyId}`)
    this.assignJobToWorker(availableWorker, job).catch(error => {
      this.logDebug('error', `Failed to assign queued job: ${error.message}`)
    })
  }

  private async assignJobToWorker(workerTask: WorkerTask, job: AnonymizationJob) {
    this.logDebug('assign', `Assigning job (${job.files.length} files) to worker #${workerTask.id}`, workerTask.id, job.studyId)
    
    workerTask.job = job
    workerTask.isAvailable = false

    try {
      // Save files to OPFS and create file references
      this.logDebug('message', `Saving ${job.files.length} files to OPFS for worker processing`, workerTask.id, job.studyId)
      
      // Create minimal file references for worker - only essential data
      const fileReferences = await Promise.all(
        job.files.map(async (file, index) => {
          // Generate unique OPFS file ID if not already set
          const opfsFileId = file.opfsFileId || `${job.studyId}_${file.id}_${Date.now()}_${index}`
          
          // Save file to OPFS if not already there (establish source of truth)
          if (!file.opfsFileId) {
            this.logDebug('message', `Saving file ${file.fileName} to OPFS (${opfsFileId})`, workerTask.id, job.studyId)
            await OPFSWorkerHelper.saveFile(opfsFileId, file.arrayBuffer)
          }

          // Return minimal reference - only what worker needs
          return {
            id: file.id,
            fileName: file.fileName,
            opfsFileId
          }
        })
      )

      // Extract simple options from config for serialization
      const options = {
        profile: job.config.profile,
        removePrivateTags: job.config.removePrivateTags,
        dateJitterDays: job.config.dateJitterDays,
        replacements: job.config.replacements ? {
          patientName: job.config.replacements.patientName,
          patientId: job.config.replacements.patientId,
          patientBirthDate: job.config.replacements.patientBirthDate,
          institution: job.config.replacements.institution
        } : undefined
      }

      this.logDebug('message', `Sending ${fileReferences.length} file references to worker #${workerTask.id}`, workerTask.id, job.studyId)

      // Send job to worker with file references and simple options
      const message = {
        type: 'anonymize_study',
        data: {
          studyId: job.studyId,
          files: fileReferences,
          options, // Simple serializable options
          concurrency: job.concurrency
        }
      }
      
      // Send to worker
      workerTask.worker.postMessage(message)
    } catch (error) {
      this.logDebug('error', `Failed to prepare job for worker #${workerTask.id}: ${error.message}`, workerTask.id, job.studyId)
      
      // Call the job's error handler
      if (job.onError) {
        job.onError(new Error(`Failed to prepare OPFS files: ${error.message}`))
      }
      
      // Reset worker state
      workerTask.job = null
      workerTask.isAvailable = true
    }
  }

  /**
   * Queue a study for anonymization
   */
  public anonymizeStudy(job: AnonymizationJob): void {
    this.logDebug('queue', `Received job for study ${job.studyId} with ${job.files.length} files`, undefined, job.studyId)
    
    // Find available worker or queue the job
    const availableWorker = this.workers.find(w => w.isAvailable)
    
    if (availableWorker) {
      this.assignJobToWorker(availableWorker, job).catch(error => {
        this.logDebug('error', `Failed to assign job: ${error.message}`)
      })
    } else {
      this.logDebug('queue', `No available workers, queueing job for study ${job.studyId}`, undefined, job.studyId)
      this.jobQueue.push(job)
    }
  }

  /**
   * Get current status of workers
   */
  public getStatus() {
    return {
      totalWorkers: this.workers.length,
      activeJobs: this.workers.filter(w => !w.isAvailable).length,
      queuedJobs: this.jobQueue.length
    }
  }

  /**
   * Get detailed worker information for debugging
   */
  public getWorkerDetails(): WorkerDetail[] {
    return this.workers.map(worker => ({
      id: worker.id,
      isAvailable: worker.isAvailable,
      currentJob: worker.job ? {
        studyId: worker.job.studyId,
        fileCount: worker.job.files.length
      } : null
    }))
  }

  /**
   * Get recent debug messages
   */
  public getDebugMessages(): DebugMessage[] {
    return [...debugMessages]
  }

  /**
   * Clear debug messages
   */
  public clearDebugMessages(): void {
    debugMessages = []
    debugMessageId = 0
    this.logDebug('message', 'Debug messages cleared')
  }

  /**
   * Terminate all workers and clear queue
   */
  public destroy() {
    this.logDebug('message', `Destroying WorkerManager with ${this.workers.length} workers`)
    this.workers.forEach(({ worker, id }) => {
      this.logDebug('message', `Terminating worker #${id}`, id)
      worker.terminate()
    })
    this.workers = []
    this.jobQueue = []
  }
}

// Global worker manager instance
let globalWorkerManager: WorkerManager | null = null

export function getWorkerManager(): WorkerManager {
  if (!globalWorkerManager) {
    globalWorkerManager = new WorkerManager()
  }
  return globalWorkerManager
}

export function destroyWorkerManager() {
  if (globalWorkerManager) {
    globalWorkerManager.destroy()
    globalWorkerManager = null
  }
}