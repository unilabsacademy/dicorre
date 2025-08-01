# Web Worker Architecture for DICOM Anonymization

## Overview

This document describes the architecture for incorporating web workers into the DICOM anonymization system to enable non-blocking, parallel processing of large DICOM datasets while maintaining the existing Effect services pattern.

## Problem Statement

The original anonymization system suffered from several performance issues:

1. **UI Blocking**: Large DICOM studies (2000+ files) would freeze the browser UI during processing
2. **Single-threaded Processing**: Only one CPU core was utilized, limiting throughput
3. **Poor User Experience**: No visual progress feedback during heavy processing
4. **Memory Pressure**: Large datasets could overwhelm the main thread

## Architecture Design

### High-Level Flow

```
Main Thread                    Worker Pool                    Worker Threads
┌─────────────┐               ┌─────────────┐               ┌─────────────┐
│ UI Components│              │ Worker      │              │ Anonymization│
│             │─────────────▶│ Manager     │─────────────▶│ Worker       │
│ - Progress  │              │             │              │             │
│ - Selection │              │ - Queue     │              │ - Effect    │
│ - Controls  │              │ - Pool Mgmt │              │ - Services  │
└─────────────┘              │ - Load Bal. │              │ - Processing│
       ▲                     └─────────────┘              └─────────────┘
       │                            │                             │
       │                            │ Progress Updates            │
       └────────────────────────────┴─────────────────────────────┘
```

### Component Architecture

#### 1. Web Worker (`src/workers/anonymizationWorker.ts`)

**Purpose**: Self-contained worker that runs DICOM anonymization in isolation from the main thread.

**Key Features**:
- Imports and initializes Effect services within worker context
- Handles message-based communication with main thread
- Provides real-time progress updates
- Maintains same Effect architecture pattern as main thread

**Message Protocol**:
```typescript
// Input Messages
interface WorkerMessage {
  type: 'anonymize_study'
  data: {
    studyId: string
    files: DicomFile[]
    config: AnonymizationConfig
    concurrency?: number
  }
}

// Output Messages
type WorkerResponseMessage = 
  | ProgressMessage 
  | CompletionMessage 
  | ErrorMessage
```

**Service Integration**:
```typescript
// Worker creates its own Effect runtime
const anonymizerLayer = Layer.mergeAll(
  AnonymizerLive,
  DicomProcessorLive,
  ConfigServiceLive
)

// Runs Effect services in worker context
const anonymizedFiles = await Effect.runPromise(
  Effect.gen(function* () {
    const anonymizer = yield* Anonymizer
    return yield* anonymizer.anonymizeFiles(files, config, {
      concurrency,
      onProgress: (progress) => {
        // Send progress to main thread
        postMessage({ type: 'progress', studyId, data: progress })
      }
    })
  }).pipe(Effect.provide(anonymizerLayer))
)
```

#### 2. Worker Manager (`src/services/workerManager.ts`)

**Purpose**: Manages a pool of web workers, handles job queuing, and coordinates parallel processing.

**Key Responsibilities**:
- **Worker Pool Management**: Creates and maintains optimal number of workers
- **Job Queuing**: Queues studies when all workers are busy
- **Load Balancing**: Distributes work across available workers
- **Error Handling**: Manages worker failures and recovery
- **Resource Cleanup**: Terminates workers when done

**Pool Sizing Strategy**:
```typescript
// Dynamic pool sizing based on hardware
const maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 8)
```

**Job Distribution**:
```typescript
class WorkerManager {
  public anonymizeStudy(job: AnonymizationJob): void {
    const availableWorker = this.workers.find(w => w.isAvailable)
    
    if (availableWorker) {
      this.assignJobToWorker(availableWorker, job)
    } else {
      this.jobQueue.push(job) // Queue for later processing
    }
  }
}
```

#### 3. Anonymizer Composable (`src/composables/useAnonymizer.ts`)

**Purpose**: Updated to coordinate with worker manager instead of running services directly on main thread.

**Integration Pattern**:
```typescript
const anonymizeFiles = async (
  files: DicomFile[],
  config: AnonymizationConfig,
  concurrency = 3,
  options?: { onProgress?: (progress: AnonymizationProgress) => void }
): Promise<DicomFile[]> => {
  return new Promise((resolve, reject) => {
    const workerManager = getWorkerManager()
    
    workerManager.anonymizeStudy({
      studyId: generateUniqueId(),
      files,
      config,
      concurrency,
      onProgress: (progressData) => {
        progress.value = progressData
        options?.onProgress?.(progressData)
      },
      onComplete: (anonymizedFiles) => {
        results.value = anonymizedFiles
        resolve(anonymizedFiles)
      },
      onError: (err) => {
        error.value = err
        reject(err)
      }
    })
  })
}
```

#### 4. Progress Tracking System

**Global State Management**:
```typescript
// src/composables/useAnonymizationProgress.ts
const studyProgressMap = ref<Map<string, StudyProgress>>(new Map())

export function useAnonymizationProgress() {
  const setStudyProgress = (studyId: string, progress: StudyProgress) => {
    studyProgressMap.value.set(studyId, progress)
    // Force reactivity
    studyProgressMap.value = new Map(studyProgressMap.value)
  }
}
```

**UI Integration**:
```typescript
// StudyProgressIndicator.vue - Directly accesses global state
const { getStudyProgress } = useAnonymizationProgress()
const progressInfo = getStudyProgress(props.studyId) // Reactive computed
```

## Message Flow Diagram

```
┌─────────────────┐    1. Select Studies     ┌─────────────────┐
│   User Action   │─────────────────────────▶│  Main Thread    │
└─────────────────┘                          │  (App.vue)      │
                                              └─────────────────┘
                                                       │
                                              2. anonymizeSelected()
                                                       │
                                                       ▼
┌─────────────────┐    3. anonymizeStudy()   ┌─────────────────┐
│ Worker Manager  │◀─────────────────────────│  useAnonymizer  │
│                 │                          │  Composable     │
└─────────────────┘                          └─────────────────┘
         │                                            ▲
         │ 4. Queue/Assign                            │
         ▼                                            │
┌─────────────────┐    5. postMessage()     ┌─────────────────┐
│ Available       │─────────────────────────▶│ Anonymization   │
│ Worker          │                          │ Worker          │
└─────────────────┘                          └─────────────────┘
         ▲                                            │
         │                                            │ 6. Progress Updates
         │ 8. Complete/Error                          │    & Completion
         │                                            ▼
┌─────────────────┐    7. Progress Messages ┌─────────────────┐
│ Progress Update │◀─────────────────────────│ Effect Services │
│ (Global State)  │                          │ (In Worker)     │
└─────────────────┘                          └─────────────────┘
         │
         │ 9. Reactive Updates
         ▼
┌─────────────────┐
│ UI Components   │
│ (Progress Bars) │
└─────────────────┘
```

## Concurrency Model

### Study-Level Parallelism

```typescript
// Multiple studies can be processed simultaneously
for (const study of selectedStudies) {
  workerManager.anonymizeStudy({
    studyId: study.studyInstanceUID,
    files: study.files,
    config,
    onProgress: (progress) => {
      // Each study has independent progress tracking
      setStudyProgress(study.studyInstanceUID, progress)
    }
  })
}
```

### File-Level Concurrency

```typescript
// Within each worker, files are processed concurrently
const anonymizedFiles = await anonymizer.anonymizeFiles(files, config, {
  concurrency: 3, // Process 3 files simultaneously per worker
  onProgress: (progress) => {
    // Real-time progress updates per study
    postMessage({ type: 'progress', studyId, data: progress })
  }
})
```

## Error Handling Strategy

### Worker Error Recovery

```typescript
// Worker error handling
worker.addEventListener('error', (error) => {
  console.error('Worker error:', error)
  if (workerTask.job) {
    workerTask.job.onError?.(new Error(`Worker error: ${error.message}`))
    this.completeJob(workerTask) // Clean up and process queue
  }
})
```

### Service Error Propagation

```typescript
// Effect services error handling in worker
try {
  const anonymizedFiles = await Effect.runPromise(effectChain)
  postMessage({ type: 'complete', studyId, data: { anonymizedFiles } })
} catch (error) {
  postMessage({ 
    type: 'error', 
    studyId, 
    data: { 
      message: error.message,
      stack: error.stack 
    } 
  })
}
```

## Performance Characteristics

### Expected Improvements

1. **UI Responsiveness**: Main thread remains responsive during heavy processing
2. **Throughput**: Parallel processing across multiple CPU cores
3. **Memory Distribution**: Memory usage spread across worker threads
4. **Progress Visibility**: Real-time progress updates without blocking

### Resource Management

```typescript
// Optimal worker pool sizing
const optimalWorkerCount = Math.min(
  navigator.hardwareConcurrency || 4, // Hardware cores
  8, // Maximum reasonable workers
  selectedStudies.length // Don't create more workers than studies
)
```

## Vite Configuration

### Worker Bundle Support

```typescript
// vite.config.ts
export default defineConfig({
  worker: {
    format: 'es',
    plugins: () => [
      // Ensure workers can use the same module resolution
    ]
  }
})
```

### Module Resolution

Workers use the same TypeScript/Effect module resolution as the main thread, ensuring consistent behavior and shared service implementations.

## Migration Strategy

### Phase 1: Parallel Architecture (Current)
- Traditional Effect services on main thread
- Worker infrastructure ready but not active
- Progress tracking system in place

### Phase 2: Worker Integration (Next)
- Activate worker-based anonymization
- Maintain Effect services pattern
- Debug worker execution issues

### Phase 3: Optimization (Future)
- Dynamic worker scaling
- Memory usage optimization
- Advanced error recovery strategies

## Debugging and Monitoring

### Worker Status Monitoring

```typescript
// Expose worker metrics for debugging
const workerStatus = getWorkerManager().getStatus()
// Returns: { totalWorkers, activeJobs, queuedJobs }
```

### Progress State Inspection

```typescript
// Global progress state is visible in development
{{ studyProgressMap }} // Template debugging display
```

### Error Tracing

- Worker errors are captured and propagated to main thread
- Effect service errors maintain full stack traces
- Progress updates include current file context for debugging

## State Management, Anonymization, and Source of Truth

### OPFS as Single Source of Truth

The architecture follows a **OPFS-first** approach where the Origin Private File System serves as the authoritative source for all DICOM file data. This ensures data integrity and consistency throughout the application lifecycle.

#### Core Principles

1. **OPFS Files are Authoritative**: The actual DICOM bytes stored in OPFS represent the true state of each file
2. **In-Memory Data is Ephemeral**: DicomFile objects in memory are temporary views/metadata containers
3. **Workers Operate on Real Files**: Anonymization directly modifies the source files in OPFS
4. **UI Displays Current State**: What users see always reflects the actual file state

#### Data Flow Architecture

```
File Upload → OPFS Storage → Metadata Extraction → UI Display
     ↓              ↓              ↓              ↓
  ArrayBuffer → Persistent File → DicomFile → Study Table
```

#### Anonymization Workflow

```
Main Thread                    Worker Thread                  OPFS Storage
┌─────────────┐               ┌─────────────┐               ┌─────────────┐
│ Study       │   File ID     │ Load File   │               │ Original    │
│ Selection   │──────────────▶│ from OPFS   │◀──────────────│ DICOM Files │
└─────────────┘               └─────────────┘               └─────────────┘
       │                             │                             │
       │                             ▼                             │
       │                      ┌─────────────┐                     │
       │                      │ Anonymize   │                     │
       │                      │ File Data   │                     │
       │                      └─────────────┘                     │
       │                             │                             │
       │                             ▼                             ▼
       │                      ┌─────────────┐               ┌─────────────┐
       │                      │ Save Back   │──────────────▶│ Anonymized  │
       │                      │ to OPFS     │               │ DICOM Files │
       │                      └─────────────┘               └─────────────┘
       │                             │                             │
       ▼                             ▼                             │
┌─────────────┐               ┌─────────────┐                     │
│ Update UI   │◀──────────────│ Completion  │                     │
│ State       │   File ID     │ Notification│                     │
└─────────────┘               └─────────────┘                     │
       │                                                           │
       │ When needed (display/send)                                │
       └───────────────────────────────────────────────────────────┘
```

#### File Identity and Reference System

**OPFS File Naming Convention:**
```typescript
// Original files
`${studyId}_${fileId}_${timestamp}_${index}`

// Anonymized files  
`${studyId}_${fileId}_${timestamp}_${index}_anonymized`
```

**Worker Communication Protocol:**
```typescript
interface FileReference {
  id: string           // Unique file identifier
  fileName: string     // Original filename for display
  fileSize: number     // File size for progress tracking
  opfsFileId: string   // OPFS storage key (source of truth)
  anonymized: boolean  // Current state flag
}
```

#### State Consistency Guarantees

1. **Atomicity**: File operations in OPFS are atomic - files are either fully written or not at all
2. **Consistency**: UI state is updated only after successful OPFS operations
3. **Isolation**: Each worker operates on separate files, preventing conflicts
4. **Durability**: OPFS provides persistence across browser sessions

#### Memory vs Storage Strategy

**In-Memory Objects (DicomFile):**
- Used for: UI display, metadata access, temporary operations
- Lifecycle: Created on-demand, garbage collected after use
- Contents: Metadata + ArrayBuffer reference
- Purpose: Performance optimization for UI interactions

**OPFS Storage:**
- Used for: Persistent file data, worker processing, sending operations
- Lifecycle: Persists until explicitly deleted
- Contents: Raw DICOM bytes (original or anonymized)
- Purpose: Source of truth, cross-thread access

#### Data Synchronization Pattern

```typescript
// Load current state from OPFS when needed
async function getFileCurrentState(fileId: string): Promise<DicomFile> {
  const opfsFileId = await findCurrentOpfsFileId(fileId)
  const arrayBuffer = await OPFSHelper.loadFile(opfsFileId)
  return {
    id: fileId,
    arrayBuffer,
    anonymized: opfsFileId.includes('_anonymized'),
    // ... other metadata
  }
}

// Update UI after worker completion
function onWorkerComplete(fileReferences: FileReference[]) {
  // UI now knows these files have been anonymized
  // Actual data remains in OPFS until needed
  fileReferences.forEach(ref => {
    updateFileStatus(ref.id, { anonymized: true, opfsFileId: ref.opfsFileId })
  })
}
```

#### Critical Operations and Source of Truth

**File Display:**
- UI shows metadata (fast)
- OPFS files remain untouched until processing needed

**Anonymization:**
- Worker receives only file references
- Loads actual data from OPFS
- Saves anonymized version back to OPFS
- Returns updated references to main thread

**Sending to PACS:**
- Always loads current file from OPFS
- Ensures sent data matches displayed state
- No risk of sending wrong version

**Data Validation:**
```typescript
// Before sending, verify file state matches UI
async function validateBeforeSend(fileId: string, expectedState: FileState) {
  const currentFile = await getFileCurrentState(fileId)
  if (currentFile.anonymized !== expectedState.anonymized) {
    throw new Error(`File state mismatch: UI shows ${expectedState.anonymized}, OPFS has ${currentFile.anonymized}`)
  }
  return currentFile
}
```

This approach ensures:
- **Data Integrity**: What you see is what gets processed
- **Consistency**: No drift between UI state and actual file data  
- **Performance**: Large files don't consume memory unnecessarily
- **Scalability**: Workers can process files without memory constraints
- **Reliability**: Persistent storage survives browser crashes/refreshes

## Conclusion

This worker architecture provides a robust foundation for scalable DICOM anonymization while preserving the existing Effect services pattern. The system is designed to be:

- **Non-blocking**: UI remains responsive during processing
- **Scalable**: Utilizes multiple CPU cores effectively  
- **Maintainable**: Preserves existing service architecture
- **Observable**: Provides real-time progress and error feedback
- **Resilient**: Handles worker failures gracefully
- **Consistent**: OPFS serves as single source of truth for data integrity

The architecture separates concerns cleanly between UI management (main thread), job coordination (worker manager), and data processing (worker threads), enabling robust parallel processing without sacrificing code maintainability.