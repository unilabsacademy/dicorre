import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { 
  WorkerManager,
  AnonymizationWorkerManager,
  SendingWorkerManager,
  getAnonymizationWorkerManager,
  getSendingWorkerManager,
  destroyWorkerManagers,
  type AnonymizationJob,
  type SendingJob,
  type BaseJob
} from './workerManager'
import type { DicomFile, AnonymizationConfig } from '@/types/dicom'

// Mock Web Worker
class MockWorker {
  private listeners: Map<string, Function[]> = new Map()
  public postMessage = vi.fn()
  public terminate = vi.fn()

  constructor(public scriptURL: string, public options: any) {}

  addEventListener(event: string, listener: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(listener)
  }

  removeEventListener(event: string, listener: Function) {
    const listeners = this.listeners.get(event)
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  // Helper to simulate messages from worker
  simulateMessage(data: any) {
    const listeners = this.listeners.get('message') || []
    listeners.forEach(listener => listener({ data }))
  }

  // Helper to simulate worker errors
  simulateError(error: Error) {
    const listeners = this.listeners.get('error') || []
    listeners.forEach(listener => listener(error))
  }
}

// Create a spy for the MockWorker constructor
const MockWorkerSpy = vi.fn().mockImplementation((...args) => new MockWorker(...args))

// Mock the global Worker constructor
global.Worker = MockWorkerSpy as any

// Mock OPFSWorkerHelper
vi.mock('../services/opfsStorage/opfsWorkerHelper', () => ({
  OPFSWorkerHelper: {
    saveFile: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(new ArrayBuffer(1000))
  }
}))

// Mock URL constructor for worker scripts
global.URL = vi.fn().mockImplementation((url) => ({ href: url }))

// Helper functions available to all tests
const createMockAnonymizationJob = (): AnonymizationJob => ({
  studyId: 'test-study-123',
  files: [
    {
      id: 'file1',
      fileName: 'test1.dcm',
      fileSize: 1000,
      arrayBuffer: new ArrayBuffer(1000),
      anonymized: false,
      metadata: {
        patientName: 'Test Patient',
        patientId: 'TEST001',
        studyInstanceUID: 'test-study-123',
        studyDate: '20241201',
        studyDescription: 'Test Study',
        seriesInstanceUID: 'series-123',
        sopInstanceUID: 'sop-123',
        modality: 'CT'
      }
    }
  ] as DicomFile[],
  config: {
    profile: 'basic',
    removePrivateTags: true,
    replacements: {
      patientName: 'ANONYMOUS',
      patientId: 'ANON001'
    }
  } as AnonymizationConfig,
  concurrency: 2,
  onProgress: vi.fn(),
  onComplete: vi.fn(),
  onError: vi.fn()
})

const createMockSendingJob = (): SendingJob => ({
  studyId: 'test-study-123',
  files: [
    {
      id: 'file1',
      fileName: 'test1.dcm',
      fileSize: 1000,
      arrayBuffer: new ArrayBuffer(1000),
      anonymized: true,
      metadata: {
        patientName: 'ANONYMOUS',
        patientId: 'ANON001',
        studyInstanceUID: 'test-study-123',
        sopInstanceUID: 'sop-123'
      }
    }
  ] as DicomFile[],
  serverConfig: {
    url: 'http://localhost:8080/dcm4chee-arc',
    headers: { 'Accept': 'application/json' },
    auth: {
      type: 'basic',
      credentials: 'dGVzdDp0ZXN0'
    }
  },
  concurrency: 2,
  onProgress: vi.fn(),
  onComplete: vi.fn(),
  onError: vi.fn()
})

describe('WorkerManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    destroyWorkerManagers()
  })

  afterEach(() => {
    destroyWorkerManagers()
  })

  describe('AnonymizationWorkerManager', () => {

    it('should create worker manager with correct parameters', () => {
      const manager = new AnonymizationWorkerManager(4)
      const status = manager.getStatus()
      
      expect(status.totalWorkers).toBe(4)
      expect(status.activeJobs).toBe(0)
      expect(status.queuedJobs).toBe(0)
    })

    it('should create workers on initialization', () => {
      const manager = new AnonymizationWorkerManager(2)
      
      // Should have created 2 workers
      expect(MockWorkerSpy).toHaveBeenCalledTimes(2)
      expect(MockWorkerSpy).toHaveBeenCalledWith(
        expect.objectContaining({ href: './anonymizationWorker.ts' }),
        { type: 'module' }
      )
    })

    it('should process anonymization job', async () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      // Process the job
      manager.anonymizeStudy(job)
      
      // Wait for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 0))
      
      // Should have called postMessage on the worker
      const workers = (manager as any).workers
      expect(workers[0].worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'anonymize_study',
          data: expect.objectContaining({
            studyId: 'test-study-123',
            files: expect.arrayContaining([
              expect.objectContaining({
                id: 'file1',
                fileName: 'test1.dcm'
              })
            ])
          })
        })
      )
    })

    it('should handle worker progress messages', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      
      // Simulate progress message from worker
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateMessage({
        type: 'progress',
        studyId: 'test-study-123',
        data: {
          total: 1,
          completed: 0,
          percentage: 50,
          currentFile: 'test1.dcm'
        }
      })
      
      expect(job.onProgress).toHaveBeenCalledWith({
        total: 1,
        completed: 0,
        percentage: 50,
        currentFile: 'test1.dcm'
      })
    })

    it('should handle worker completion messages', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      
      // Simulate completion message from worker
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      const anonymizedFiles = [{ id: 'file1', fileName: 'test1_anon.dcm' }]
      worker.simulateMessage({
        type: 'complete',
        studyId: 'test-study-123',
        data: {
          anonymizedFiles
        }
      })
      
      expect(job.onComplete).toHaveBeenCalledWith(anonymizedFiles)
    })

    it('should handle worker error messages', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      
      // Simulate error message from worker
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateMessage({
        type: 'error',
        studyId: 'test-study-123',
        data: {
          message: 'Anonymization failed'
        }
      })
      
      expect(job.onError).toHaveBeenCalledWith(new Error('Anonymization failed'))
    })

    it('should queue jobs when no workers available', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job1 = createMockAnonymizationJob()
      const job2 = { ...createMockAnonymizationJob(), studyId: 'study-2' }
      
      // First job should be assigned to worker
      manager.anonymizeStudy(job1)
      let status = manager.getStatus()
      expect(status.activeJobs).toBe(1)
      expect(status.queuedJobs).toBe(0)
      
      // Second job should be queued
      manager.anonymizeStudy(job2)
      status = manager.getStatus()
      expect(status.activeJobs).toBe(1)
      expect(status.queuedJobs).toBe(1)
    })

    it('should process queued jobs after completion', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job1 = createMockAnonymizationJob()
      const job2 = { ...createMockAnonymizationJob(), studyId: 'study-2' }
      
      manager.anonymizeStudy(job1)
      manager.anonymizeStudy(job2)
      
      // Complete first job
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateMessage({
        type: 'complete',
        studyId: 'test-study-123',
        data: { anonymizedFiles: [] }
      })
      
      // Should process queued job
      const status = manager.getStatus()
      expect(status.activeJobs).toBe(1)
      expect(status.queuedJobs).toBe(0)
    })

    it('should handle worker ready signal', () => {
      const manager = new AnonymizationWorkerManager(1)
      
      // Simulate worker ready message
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateMessage({
        type: 'complete',
        studyId: 'worker-ready',
        data: { anonymizedFiles: [] }
      })
      
      // Should not throw error
      expect(() => {}).not.toThrow()
    })
  })

  describe('SendingWorkerManager', () => {

    it('should create sending worker manager', () => {
      const manager = new SendingWorkerManager(2)
      const status = manager.getStatus()
      
      expect(status.totalWorkers).toBe(2)
      expect(status.activeJobs).toBe(0)
      expect(status.queuedJobs).toBe(0)
    })

    it('should process sending job', async () => {
      const manager = new SendingWorkerManager(1)
      const job = createMockSendingJob()
      
      manager.sendStudy(job)
      
      // Wait for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 0))
      
      // Should have called postMessage on the worker
      const workers = (manager as any).workers
      expect(workers[0].worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'send_study',
          data: expect.objectContaining({
            studyId: 'test-study-123',
            serverConfig: job.serverConfig,
            files: expect.arrayContaining([
              expect.objectContaining({
                id: 'file1',
                fileName: 'test1.dcm'
              })
            ])
          })
        })
      )
    })

    it('should handle sending completion', () => {
      const manager = new SendingWorkerManager(1)
      const job = createMockSendingJob()
      
      manager.sendStudy(job)
      
      // Simulate completion message from worker
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      const sentFiles = [{ id: 'file1', fileName: 'test1.dcm' }]
      worker.simulateMessage({
        type: 'complete',
        studyId: 'test-study-123',
        data: { sentFiles }
      })
      
      expect(job.onComplete).toHaveBeenCalledWith(sentFiles)
    })

    it('should handle sending errors', () => {
      const manager = new SendingWorkerManager(1)
      const job = createMockSendingJob()
      
      manager.sendStudy(job)
      
      // Simulate error message from worker
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateMessage({
        type: 'error',
        studyId: 'test-study-123',
        data: {
          message: 'Network connection failed'
        }
      })
      
      expect(job.onError).toHaveBeenCalledWith(new Error('Network connection failed'))
    })
  })

  describe('Worker Manager Debugging', () => {
    it('should provide worker details', () => {
      const manager = new AnonymizationWorkerManager(2)
      const details = manager.getWorkerDetails()
      
      expect(details).toHaveLength(2)
      expect(details[0]).toEqual({
        id: expect.any(Number),
        isAvailable: true,
        currentJob: null
      })
    })

    it('should track debug messages', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      
      const debugMessages = manager.getDebugMessages()
      expect(debugMessages.length).toBeGreaterThan(0)
      expect(debugMessages[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          type: expect.any(String),
          timestamp: expect.any(String),
          content: expect.any(String)
        })
      )
    })

    it('should clear debug messages', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      expect(manager.getDebugMessages().length).toBeGreaterThan(0)
      
      manager.clearDebugMessages()
      // clearDebugMessages itself adds a debug message, so expect 1
      expect(manager.getDebugMessages().length).toBe(1)
      expect(manager.getDebugMessages()[0].content).toBe('Debug messages cleared')
    })
  })

  describe('Error Handling', () => {
    it('should handle worker preparation errors', async () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      // Mock OPFSWorkerHelper to throw error
      const { OPFSWorkerHelper } = await import('../services/opfsStorage/opfsWorkerHelper')
      vi.mocked(OPFSWorkerHelper.saveFile).mockRejectedValueOnce(new Error('OPFS error'))
      
      manager.anonymizeStudy(job)
      
      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 0))
      
      expect(job.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Failed to prepare job')
        })
      )
    })

    it('should handle worker script errors', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      
      // Simulate worker script error
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateError(new Error('Worker script failed'))
      
      expect(job.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Worker error')
        })
      )
    })

    it('should handle unknown message types', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job = createMockAnonymizationJob()
      
      manager.anonymizeStudy(job)
      
      // Simulate unknown message type
      const workers = (manager as any).workers
      const worker = workers[0].worker as MockWorker
      
      worker.simulateMessage({
        type: 'unknown',
        studyId: 'test-study-123',
        data: {}
      })
      
      // Should not throw error (logs warning)
      expect(() => {}).not.toThrow()
    })
  })

  describe('Global Instance Management', () => {
    it('should return same anonymization worker manager instance', () => {
      const manager1 = getAnonymizationWorkerManager()
      const manager2 = getAnonymizationWorkerManager()
      
      expect(manager1).toBe(manager2)
    })

    it('should return same sending worker manager instance', () => {
      const manager1 = getSendingWorkerManager()
      const manager2 = getSendingWorkerManager()
      
      expect(manager1).toBe(manager2)
    })

    it('should destroy all worker managers', () => {
      const anonymizationManager = getAnonymizationWorkerManager()
      const sendingManager = getSendingWorkerManager()
      
      destroyWorkerManagers()
      
      // Should create new instances
      const newAnonymizationManager = getAnonymizationWorkerManager()
      const newSendingManager = getSendingWorkerManager()
      
      expect(newAnonymizationManager).not.toBe(anonymizationManager)
      expect(newSendingManager).not.toBe(sendingManager)
    })
  })

  describe('Worker Termination', () => {
    it('should terminate all workers on destroy', () => {
      const manager = new AnonymizationWorkerManager(2)
      
      // Get the workers to check their terminate methods
      const workers = (manager as any).workers
      const terminateSpy1 = workers[0].worker.terminate
      const terminateSpy2 = workers[1].worker.terminate
      
      manager.destroy()
      
      // Should have called terminate on all workers
      expect(terminateSpy1).toHaveBeenCalledTimes(1)
      expect(terminateSpy2).toHaveBeenCalledTimes(1)
    })

    it('should clear job queue on destroy', () => {
      const manager = new AnonymizationWorkerManager(1)
      const job1 = createMockAnonymizationJob()
      const job2 = { ...createMockAnonymizationJob(), studyId: 'study-2' }
      
      // Queue two jobs (second will be queued)
      manager.anonymizeStudy(job1)
      manager.anonymizeStudy(job2)
      
      let status = manager.getStatus()
      expect(status.activeJobs + status.queuedJobs).toBe(2)
      
      manager.destroy()
      
      status = manager.getStatus()
      expect(status.totalWorkers).toBe(0)
      expect(status.activeJobs).toBe(0)
      expect(status.queuedJobs).toBe(0)
    })
  })
})