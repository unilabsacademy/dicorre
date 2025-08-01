/**
 * Transmission State Tracker
 * Simple in-memory tracking of DICOM study transmission status
 */

export type TransmissionStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface TransmissionState {
  studyId: string
  status: TransmissionStatus
  startTime?: Date
  endTime?: Date
  totalFiles: number
  completedFiles: number
  errorMessage?: string
  lastActivity: Date
}

export interface TransmissionProgress {
  studyId: string
  total: number
  completed: number
  percentage: number
  currentFile?: string
}

// Simplified state for localStorage persistence
export interface PersistedTransmissionState {
  studyId: string
  status: TransmissionStatus
  startTime?: string // ISO string for JSON serialization
  endTime?: string
  totalFiles: number
  completedFiles: number
  errorMessage?: string
}

// In-memory storage for transmission states
class TransmissionTracker {
  private states: Map<string, TransmissionState> = new Map()
  private listeners: Set<(studyId: string, state: TransmissionState) => void> = new Set()
  private readonly storageKey = 'dicom_transmission_states'

  constructor() {
    // Load persisted states on initialization
    this.loadPersistedStates()
  }

  /**
   * Start tracking transmission for a study
   */
  startTransmission(studyId: string, totalFiles: number): void {
    const state: TransmissionState = {
      studyId,
      status: 'in_progress',
      startTime: new Date(),
      totalFiles,
      completedFiles: 0,
      lastActivity: new Date()
    }
    
    this.states.set(studyId, state)
    this.notifyListeners(studyId, state)
    
    console.log(`[TransmissionTracker] Started tracking transmission for study ${studyId} with ${totalFiles} files`)
  }

  /**
   * Update transmission progress
   */
  updateProgress(studyId: string, progress: TransmissionProgress): void {
    const state = this.states.get(studyId)
    if (!state) {
      console.warn(`[TransmissionTracker] No state found for study ${studyId}`)
      return
    }

    // Update state with progress information
    const updatedState: TransmissionState = {
      ...state,
      completedFiles: progress.completed,
      lastActivity: new Date()
    }

    this.states.set(studyId, updatedState)
    this.notifyListeners(studyId, updatedState)
  }

  /**
   * Mark transmission as completed
   */
  completeTransmission(studyId: string): void {
    const state = this.states.get(studyId)
    if (!state) {
      console.warn(`[TransmissionTracker] No state found for study ${studyId}`)
      return
    }

    const completedState: TransmissionState = {
      ...state,
      status: 'completed',
      endTime: new Date(),
      completedFiles: state.totalFiles,
      lastActivity: new Date()
    }

    this.states.set(studyId, completedState)
    this.notifyListeners(studyId, completedState)
    
    // Persist completed state to localStorage
    this.savePersistedStates()
    
    console.log(`[TransmissionTracker] Completed transmission for study ${studyId}`)
  }

  /**
   * Mark transmission as failed
   */
  failTransmission(studyId: string, errorMessage: string): void {
    const state = this.states.get(studyId)
    if (!state) {
      console.warn(`[TransmissionTracker] No state found for study ${studyId}`)
      return
    }

    const failedState: TransmissionState = {
      ...state,
      status: 'failed',
      endTime: new Date(),
      errorMessage,
      lastActivity: new Date()
    }

    this.states.set(studyId, failedState)
    this.notifyListeners(studyId, failedState)
    
    // Persist failed state to localStorage
    this.savePersistedStates()
    
    console.log(`[TransmissionTracker] Failed transmission for study ${studyId}: ${errorMessage}`)
  }

  /**
   * Get transmission state for a study
   */
  getState(studyId: string): TransmissionState | undefined {
    return this.states.get(studyId)
  }

  /**
   * Get all transmission states
   */
  getAllStates(): TransmissionState[] {
    return Array.from(this.states.values())
  }

  /**
   * Get states by status
   */
  getStatesByStatus(status: TransmissionStatus): TransmissionState[] {
    return Array.from(this.states.values()).filter(state => state.status === status)
  }

  /**
   * Check if a study is currently being transmitted
   */
  isTransmitting(studyId: string): boolean {
    const state = this.states.get(studyId)
    return state?.status === 'in_progress'
  }

  /**
   * Check if a study transmission is completed
   */
  isCompleted(studyId: string): boolean {
    const state = this.states.get(studyId)
    return state?.status === 'completed'
  }

  /**
   * Check if a study transmission failed
   */
  isFailed(studyId: string): boolean {
    const state = this.states.get(studyId)
    return state?.status === 'failed'
  }

  /**
   * Clear state for a study
   */
  clearState(studyId: string): void {
    this.states.delete(studyId)
    console.log(`[TransmissionTracker] Cleared state for study ${studyId}`)
  }

  /**
   * Clear all states
   */
  clearAllStates(): void {
    this.states.clear()
    this.clearPersistedStates()
    console.log(`[TransmissionTracker] Cleared all transmission states`)
  }

  /**
   * Add a listener for state changes
   */
  addListener(listener: (studyId: string, state: TransmissionState) => void): void {
    this.listeners.add(listener)
  }

  /**
   * Remove a listener
   */
  removeListener(listener: (studyId: string, state: TransmissionState) => void): void {
    this.listeners.delete(listener)
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(studyId: string, state: TransmissionState): void {
    this.listeners.forEach(listener => {
      try {
        listener(studyId, state)
      } catch (error) {
        console.error('[TransmissionTracker] Error in state change listener:', error)
      }
    })
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const states = Array.from(this.states.values())
    
    return {
      total: states.length,
      inProgress: states.filter(s => s.status === 'in_progress').length,
      completed: states.filter(s => s.status === 'completed').length,
      failed: states.filter(s => s.status === 'failed').length,
      pending: states.filter(s => s.status === 'pending').length
    }
  }

  /**
   * Save states to localStorage (only completed and failed states persist)
   */
  private savePersistedStates(): void {
    try {
      // Only persist completed and failed states
      const statesToPersist = Array.from(this.states.values())
        .filter(state => state.status === 'completed' || state.status === 'failed')
        .map(state => this.stateToPersistedState(state))

      localStorage.setItem(this.storageKey, JSON.stringify(statesToPersist))
    } catch (error) {
      console.warn('[TransmissionTracker] Failed to save states to localStorage:', error)
    }
  }

  /**
   * Load states from localStorage
   */
  private loadPersistedStates(): void {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (!stored) return

      const persistedStates: PersistedTransmissionState[] = JSON.parse(stored)
      
      for (const persistedState of persistedStates) {
        const state = this.persistedStateToState(persistedState)
        this.states.set(state.studyId, state)
      }

      console.log(`[TransmissionTracker] Loaded ${persistedStates.length} persisted transmission states`)
    } catch (error) {
      console.warn('[TransmissionTracker] Failed to load states from localStorage:', error)
      // Clear invalid data
      localStorage.removeItem(this.storageKey)
    }
  }

  /**
   * Convert TransmissionState to PersistedTransmissionState for JSON serialization
   */
  private stateToPersistedState(state: TransmissionState): PersistedTransmissionState {
    return {
      studyId: state.studyId,
      status: state.status,
      startTime: state.startTime?.toISOString(),
      endTime: state.endTime?.toISOString(),
      totalFiles: state.totalFiles,
      completedFiles: state.completedFiles,
      errorMessage: state.errorMessage
    }
  }

  /**
   * Convert PersistedTransmissionState back to TransmissionState
   */
  private persistedStateToState(persistedState: PersistedTransmissionState): TransmissionState {
    return {
      studyId: persistedState.studyId,
      status: persistedState.status,
      startTime: persistedState.startTime ? new Date(persistedState.startTime) : undefined,
      endTime: persistedState.endTime ? new Date(persistedState.endTime) : undefined,
      totalFiles: persistedState.totalFiles,
      completedFiles: persistedState.completedFiles,
      errorMessage: persistedState.errorMessage,
      lastActivity: persistedState.endTime ? new Date(persistedState.endTime) : new Date()
    }
  }

  /**
   * Clear localStorage persistence
   */
  private clearPersistedStates(): void {
    try {
      localStorage.removeItem(this.storageKey)
    } catch (error) {
      console.warn('[TransmissionTracker] Failed to clear persisted states:', error)
    }
  }
}

// Global instance
let globalTransmissionTracker: TransmissionTracker | null = null

export function getTransmissionTracker(): TransmissionTracker {
  if (!globalTransmissionTracker) {
    globalTransmissionTracker = new TransmissionTracker()
  }
  return globalTransmissionTracker
}

export function destroyTransmissionTracker(): void {
  if (globalTransmissionTracker) {
    globalTransmissionTracker.clearAllStates()
    globalTransmissionTracker = null
  }
}