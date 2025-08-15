/**
 * Worker Pool Manager for DICOM Anonymization
 * Manages a pool of web workers for parallel processing
 */

import type { DicomFile, AnonymizationConfig } from '@/types/dicom'

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

// Base job interface
export interface BaseJob {
  studyId: string
  files: DicomFile[]
  concurrency?: number
  onProgress?: (progress: { total: number; completed: number; percentage: number; currentFile?: string }) => void
  onError?: (error: Error) => void
}

// Anonymization-specific job
export interface AnonymizationJob extends BaseJob {
  config: AnonymizationConfig
  onComplete?: (anonymizedFiles: DicomFile[]) => void
}

// Sending-specific job
export interface SendingJob extends BaseJob {
  serverConfig: {
    url: string
    headers?: Record<string, string>
    auth?: {
      type: 'basic' | 'bearer'
      credentials: string
    } | null
  }
  onComplete?: (sentFiles: DicomFile[]) => void
}

interface WorkerTask<T extends BaseJob> {
  id: number
  worker: Worker
  job: T | null
  isAvailable: boolean
}

export class WorkerManager<T extends BaseJob> {
  private workers: WorkerTask<T>[] = []
  private jobQueue: T[] = []
  private maxWorkers: number
  private nextWorkerId = 1
  private workerScriptUrl: string
  private workerType: string

  constructor(workerScriptUrl: string, workerType: string, maxWorkers?: number) {
    this.workerScriptUrl = workerScriptUrl
    this.workerType = workerType
    // Use hardware concurrency or default to 4 workers
    this.maxWorkers = maxWorkers || Math.min(navigator.hardwareConcurrency || 4, 8)
    this.logDebug('create', `Initializing ${workerType}WorkerManager with ${this.maxWorkers} workers`)
    this.initializeWorkers()
  }

  protected logDebug(type: DebugMessage['type'], content: string, workerId?: number, studyId?: string) {
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

  private createWorker(): WorkerTask<T> {
    const workerId = this.nextWorkerId++
    this.logDebug('create', `Creating ${this.workerType} worker #${workerId}`, workerId)

    const worker = new Worker(
      new URL(this.workerScriptUrl, import.meta.url),
      { type: 'module' }
    )

    const workerTask: WorkerTask<T> = {
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
    this.logDebug('create', `${this.workerType} worker #${workerId} created and added to pool`, workerId)
    return workerTask
  }

  private handleWorkerMessage(workerTask: WorkerTask<T>, message: any) {
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
        this.logDebug('complete', `Completed processing of files`, workerTask.id, studyId)
        // Handle completion based on job type
        if ('onComplete' in job && typeof job.onComplete === 'function') {
          job.onComplete(data.anonymizedFiles || data.sentFiles || [])
        }
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

  private completeJob(workerTask: WorkerTask<T>) {
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

    // Process all queued jobs that can be assigned to available workers
    while (this.jobQueue.length > 0) {
      const availableWorker = this.workers.find(w => w.isAvailable)
      if (!availableWorker) {
        this.logDebug('queue', `No available workers for ${this.jobQueue.length} queued jobs`)
        break
      }

      const job = this.jobQueue.shift()!
      this.logDebug('queue', `Processing queued job for study ${job.studyId}`)
      this.assignJobToWorker(availableWorker, job).catch(error => {
        this.logDebug('error', `Failed to assign queued job: ${error instanceof Error ? error.message : 'Unknown error'}`)
      })
    }
  }

  private async assignJobToWorker(workerTask: WorkerTask<T>, job: T) {
    this.logDebug('assign', `Assigning ${this.workerType} job (${job.files.length} files) to worker #${workerTask.id}`, workerTask.id, job.studyId)

    workerTask.job = job
    workerTask.isAvailable = false

    try {
      // Prepare job data based on worker type
      const jobData = await this.prepareJobData(job)

      // Send to worker
      workerTask.worker.postMessage(jobData)
    } catch (error) {
      this.logDebug('error', `Failed to prepare job for worker #${workerTask.id}: ${error instanceof Error ? error.message : 'Unknown error'}`, workerTask.id, job.studyId)

      // Call the job's error handler
      if (job.onError) {
        job.onError(new Error(`Failed to prepare job: ${error instanceof Error ? error.message : 'Unknown error'}`))
      }

      // Reset worker state
      workerTask.job = null
      workerTask.isAvailable = true
    }
  }

  public processJob(job: T): void {
    this.logDebug('queue', `Received ${this.workerType} job for study ${job.studyId} with ${job.files.length} files`, undefined, job.studyId)

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

  protected async prepareJobData(job: T): Promise<any> {
    throw new Error('prepareJobData must be implemented by subclass')
  }

  public getStatus() {
    return {
      totalWorkers: this.workers.length,
      activeJobs: this.workers.filter(w => !w.isAvailable).length,
      queuedJobs: this.jobQueue.length
    }
  }

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

  public getDebugMessages(): DebugMessage[] {
    return [...debugMessages]
  }

  public clearDebugMessages(): void {
    debugMessages = []
    debugMessageId = 0
    this.logDebug('message', 'Debug messages cleared')
  }

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

export class AnonymizationWorkerManager extends WorkerManager<AnonymizationJob> {
  constructor(maxWorkers?: number) {
    super('./anonymizationWorker.ts', 'Anonymization', maxWorkers)
  }

  protected async prepareJobData(job: AnonymizationJob): Promise<any> {
    this.logDebug('message', `Preparing ${job.files.length} files for worker processing`, undefined, job.studyId)

    // Pass only OPFS file references to worker - no ArrayBuffers
    // Serialize and deserialize to ensure all data is cloneable
    const files = job.files.map((file, index) => {
      const fileData = {
        id: file.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        opfsFileId: file.opfsFileId || file.id, // Use existing opfsFileId or fall back to file.id
        metadata: file.metadata ? JSON.parse(JSON.stringify(file.metadata)) : undefined
      }
      return fileData
    })

    // Ensure config is also cloneable
    const cloneableConfig = JSON.parse(JSON.stringify(job.config))

    return {
      type: 'anonymize_study',
      data: {
        studyId: job.studyId,
        files,
        config: cloneableConfig,
        concurrency: job.concurrency
      }
    }
  }

  public anonymizeStudy(job: AnonymizationJob): void {
    this.processJob(job)
  }
}

export class SendingWorkerManager extends WorkerManager<SendingJob> {
  constructor(maxWorkers?: number) {
    super('./sendingWorker.ts', 'Sending', maxWorkers)
  }

  protected async prepareJobData(job: SendingJob): Promise<any> {
    this.logDebug('message', `Preparing ${job.files.length} files for sending`, undefined, job.studyId)

    // Pass only OPFS file references to worker - no ArrayBuffers
    // Serialize and deserialize to ensure all data is cloneable
    const files = job.files.map((file, index) => {
      const fileData = {
        id: file.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        opfsFileId: file.opfsFileId || file.id, // Use existing opfsFileId or fall back to file.id
        metadata: file.metadata ? JSON.parse(JSON.stringify(file.metadata)) : undefined
      }
      return fileData
    })

    // Ensure server config is also cloneable
    const cloneableServerConfig = JSON.parse(JSON.stringify(job.serverConfig))

    return {
      type: 'send_study',
      data: {
        studyId: job.studyId,
        files,
        serverConfig: cloneableServerConfig,
        concurrency: job.concurrency
      }
    }
  }

  /**
   * Queue a study for sending
   */
  public sendStudy(job: SendingJob): void {
    this.processJob(job)
  }
}

// Global worker manager instances
let globalAnonymizationWorkerManager: AnonymizationWorkerManager | null = null
let globalSendingWorkerManager: SendingWorkerManager | null = null

export function getAnonymizationWorkerManager(): AnonymizationWorkerManager {
  if (!globalAnonymizationWorkerManager) {
    globalAnonymizationWorkerManager = new AnonymizationWorkerManager()
  }
  return globalAnonymizationWorkerManager
}

export function getSendingWorkerManager(): SendingWorkerManager {
  if (!globalSendingWorkerManager) {
    globalSendingWorkerManager = new SendingWorkerManager()
  }
  return globalSendingWorkerManager
}

export function destroyWorkerManagers() {
  if (globalAnonymizationWorkerManager) {
    globalAnonymizationWorkerManager.destroy()
    globalAnonymizationWorkerManager = null
  }
  if (globalSendingWorkerManager) {
    globalSendingWorkerManager.destroy()
    globalSendingWorkerManager = null
  }
}

