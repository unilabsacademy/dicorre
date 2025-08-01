import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { 
  getTransmissionTracker, 
  destroyTransmissionTracker,
  type TransmissionStatus,
  type TransmissionState,
  type TransmissionProgress
} from './transmissionTracker'

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    })
  }
})()

// Replace global localStorage
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true
})

describe('TransmissionTracker', () => {
  beforeEach(() => {
    // Clear localStorage mock and reset tracker
    mockLocalStorage.clear()
    vi.clearAllMocks()
    destroyTransmissionTracker()
  })

  afterEach(() => {
    destroyTransmissionTracker()
  })

  describe('Basic State Management', () => {
    it('should start transmission tracking', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      const totalFiles = 5

      tracker.startTransmission(studyId, totalFiles)

      const state = tracker.getState(studyId)
      expect(state).toBeDefined()
      expect(state!.studyId).toBe(studyId)
      expect(state!.status).toBe('in_progress')
      expect(state!.totalFiles).toBe(totalFiles)
      expect(state!.completedFiles).toBe(0)
      expect(state!.startTime).toBeInstanceOf(Date)
      expect(state!.endTime).toBeUndefined()
    })

    it('should update transmission progress', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      
      tracker.startTransmission(studyId, 10)
      
      const progress: TransmissionProgress = {
        studyId,
        total: 10,
        completed: 3,
        percentage: 30,
        currentFile: 'file3.dcm'
      }
      
      tracker.updateProgress(studyId, progress)
      
      const state = tracker.getState(studyId)
      expect(state!.completedFiles).toBe(3)
      expect(state!.lastActivity).toBeInstanceOf(Date)
    })

    it('should complete transmission', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      
      tracker.startTransmission(studyId, 5)
      tracker.completeTransmission(studyId)
      
      const state = tracker.getState(studyId)
      expect(state!.status).toBe('completed')
      expect(state!.completedFiles).toBe(5)
      expect(state!.endTime).toBeInstanceOf(Date)
    })

    it('should fail transmission with error message', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      const errorMessage = 'Network connection failed'
      
      tracker.startTransmission(studyId, 5)
      tracker.failTransmission(studyId, errorMessage)
      
      const state = tracker.getState(studyId)
      expect(state!.status).toBe('failed')
      expect(state!.errorMessage).toBe(errorMessage)
      expect(state!.endTime).toBeInstanceOf(Date)
    })
  })

  describe('Status Checking Methods', () => {
    it('should check if study is transmitting', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      
      expect(tracker.isTransmitting(studyId)).toBe(false)
      
      tracker.startTransmission(studyId, 5)
      expect(tracker.isTransmitting(studyId)).toBe(true)
      
      tracker.completeTransmission(studyId)
      expect(tracker.isTransmitting(studyId)).toBe(false)
    })

    it('should check if study is completed', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      
      expect(tracker.isCompleted(studyId)).toBe(false)
      
      tracker.startTransmission(studyId, 5)
      expect(tracker.isCompleted(studyId)).toBe(false)
      
      tracker.completeTransmission(studyId)
      expect(tracker.isCompleted(studyId)).toBe(true)
    })

    it('should check if study failed', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      
      expect(tracker.isFailed(studyId)).toBe(false)
      
      tracker.startTransmission(studyId, 5)
      expect(tracker.isFailed(studyId)).toBe(false)
      
      tracker.failTransmission(studyId, 'Error occurred')
      expect(tracker.isFailed(studyId)).toBe(true)
    })
  })

  describe('State Queries', () => {
    it('should get all states', () => {
      const tracker = getTransmissionTracker()
      
      tracker.startTransmission('study-1', 3)
      tracker.startTransmission('study-2', 5)
      tracker.completeTransmission('study-1')
      
      const allStates = tracker.getAllStates()
      expect(allStates).toHaveLength(2)
      expect(allStates.find(s => s.studyId === 'study-1')!.status).toBe('completed')
      expect(allStates.find(s => s.studyId === 'study-2')!.status).toBe('in_progress')
    })

    it('should get states by status', () => {
      const tracker = getTransmissionTracker()
      
      tracker.startTransmission('study-1', 3)
      tracker.startTransmission('study-2', 5)
      tracker.completeTransmission('study-1')
      tracker.failTransmission('study-2', 'Failed')
      tracker.startTransmission('study-3', 2)
      
      const completedStates = tracker.getStatesByStatus('completed')
      expect(completedStates).toHaveLength(1)
      expect(completedStates[0].studyId).toBe('study-1')
      
      const failedStates = tracker.getStatesByStatus('failed')
      expect(failedStates).toHaveLength(1)
      expect(failedStates[0].studyId).toBe('study-2')
      
      const inProgressStates = tracker.getStatesByStatus('in_progress')
      expect(inProgressStates).toHaveLength(1)
      expect(inProgressStates[0].studyId).toBe('study-3')
    })

    it('should get summary statistics', () => {
      const tracker = getTransmissionTracker()
      
      tracker.startTransmission('study-1', 3)
      tracker.startTransmission('study-2', 5)
      tracker.completeTransmission('study-1')
      tracker.failTransmission('study-2', 'Failed')
      tracker.startTransmission('study-3', 2)
      
      const summary = tracker.getSummary()
      expect(summary.total).toBe(3)
      expect(summary.completed).toBe(1)
      expect(summary.failed).toBe(1)
      expect(summary.inProgress).toBe(1)
      expect(summary.pending).toBe(0)
    })
  })

  describe('State Listeners', () => {
    it('should notify listeners on state changes', () => {
      const tracker = getTransmissionTracker()
      const listener = vi.fn()
      
      tracker.addListener(listener)
      
      const studyId = 'test-study-123'
      tracker.startTransmission(studyId, 5)
      
      expect(listener).toHaveBeenCalledWith(studyId, expect.objectContaining({
        studyId,
        status: 'in_progress'
      }))
      
      tracker.completeTransmission(studyId)
      
      expect(listener).toHaveBeenCalledWith(studyId, expect.objectContaining({
        studyId,
        status: 'completed'
      }))
    })

    it('should remove listeners', () => {
      const tracker = getTransmissionTracker()
      const listener = vi.fn()
      
      tracker.addListener(listener)
      tracker.startTransmission('study-1', 3)
      expect(listener).toHaveBeenCalledTimes(1)
      
      tracker.removeListener(listener)
      tracker.startTransmission('study-2', 3)
      expect(listener).toHaveBeenCalledTimes(1) // Should not increase
    })

    it('should handle listener errors gracefully', () => {
      const tracker = getTransmissionTracker()
      const errorListener = vi.fn(() => { throw new Error('Listener error') })
      const goodListener = vi.fn()
      
      // Mock console.error to avoid noise in tests
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      tracker.addListener(errorListener)
      tracker.addListener(goodListener)
      
      tracker.startTransmission('study-1', 3)
      
      expect(errorListener).toHaveBeenCalled()
      expect(goodListener).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('[TransmissionTracker] Error in state change listener:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('LocalStorage Persistence', () => {
    it('should persist completed states to localStorage', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      
      tracker.startTransmission(studyId, 5)
      tracker.completeTransmission(studyId)
      
      // Should have called setItem to persist the completed state
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'dicom_transmission_states',
        expect.stringContaining(studyId)
      )
      
      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1])
      expect(savedData).toHaveLength(1)
      expect(savedData[0].studyId).toBe(studyId)
      expect(savedData[0].status).toBe('completed')
    })

    it('should persist failed states to localStorage', () => {
      const tracker = getTransmissionTracker()
      const studyId = 'test-study-123'
      const errorMessage = 'Network failed'
      
      tracker.startTransmission(studyId, 5)
      tracker.failTransmission(studyId, errorMessage)
      
      expect(mockLocalStorage.setItem).toHaveBeenCalled()
      
      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1])
      expect(savedData[0].status).toBe('failed')
      expect(savedData[0].errorMessage).toBe(errorMessage)
    })

    it('should NOT persist in-progress states', () => {
      const tracker = getTransmissionTracker()
      
      tracker.startTransmission('study-1', 5)
      
      // Should not call setItem for in-progress states
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
    })

    it('should load persisted states on initialization', () => {
      // Pre-populate localStorage with persisted states
      const persistedStates = [{
        studyId: 'restored-study',
        status: 'completed',
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:05:00.000Z',
        totalFiles: 10,
        completedFiles: 10
      }]
      
      mockLocalStorage.setItem('dicom_transmission_states', JSON.stringify(persistedStates))
      
      // Create new tracker - should load persisted states
      destroyTransmissionTracker()
      const tracker = getTransmissionTracker()
      
      const state = tracker.getState('restored-study')
      expect(state).toBeDefined()
      expect(state!.status).toBe('completed')
      expect(state!.totalFiles).toBe(10)
      expect(state!.completedFiles).toBe(10)
    })

    it('should handle invalid localStorage data gracefully', () => {
      // Set invalid JSON in localStorage
      mockLocalStorage.setItem('dicom_transmission_states', 'invalid-json')
      
      // Should not throw and should clear invalid data
      destroyTransmissionTracker()
      const tracker = getTransmissionTracker()
      
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dicom_transmission_states')
      expect(tracker.getAllStates()).toHaveLength(0)
    })
  })

  describe('State Cleanup', () => {
    it('should clear individual study state', () => {
      const tracker = getTransmissionTracker()
      
      tracker.startTransmission('study-1', 3)
      tracker.startTransmission('study-2', 5)
      
      expect(tracker.getState('study-1')).toBeDefined()
      
      tracker.clearState('study-1')
      
      expect(tracker.getState('study-1')).toBeUndefined()
      expect(tracker.getState('study-2')).toBeDefined()
    })

    it('should clear all states', () => {
      const tracker = getTransmissionTracker()
      
      tracker.startTransmission('study-1', 3)
      tracker.startTransmission('study-2', 5)
      tracker.completeTransmission('study-1')
      
      expect(tracker.getAllStates()).toHaveLength(2)
      
      tracker.clearAllStates()
      
      expect(tracker.getAllStates()).toHaveLength(0)
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dicom_transmission_states')
    })
  })

  describe('Edge Cases', () => {
    it('should handle operations on non-existent studies gracefully', () => {
      const tracker = getTransmissionTracker()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      tracker.updateProgress('non-existent', { studyId: 'non-existent', total: 5, completed: 1, percentage: 20 })
      tracker.completeTransmission('non-existent')
      tracker.failTransmission('non-existent', 'error')
      
      expect(consoleSpy).toHaveBeenCalledTimes(3)
      
      consoleSpy.mockRestore()
    })

    it('should handle localStorage errors gracefully', () => {
      const tracker = getTransmissionTracker()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      // Make setItem throw an error
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('Storage quota exceeded')
      })
      
      tracker.startTransmission('study-1', 5)
      tracker.completeTransmission('study-1')
      
      expect(consoleSpy).toHaveBeenCalledWith('[TransmissionTracker] Failed to save states to localStorage:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('Global Instance Management', () => {
    it('should return same instance on multiple calls', () => {
      const tracker1 = getTransmissionTracker()
      const tracker2 = getTransmissionTracker()
      
      expect(tracker1).toBe(tracker2)
    })

    it('should destroy global instance', () => {
      const tracker1 = getTransmissionTracker()
      tracker1.startTransmission('study-1', 3)
      
      destroyTransmissionTracker()
      
      const tracker2 = getTransmissionTracker()
      expect(tracker2).not.toBe(tracker1)
      expect(tracker2.getAllStates()).toHaveLength(0)
    })
  })
})