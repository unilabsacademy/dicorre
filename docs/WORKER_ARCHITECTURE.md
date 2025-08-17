# Web Worker Architecture for DICOM Anonymization

## Overview

This document describes the current implementation of web workers in the DICOM anonymization system, enabling non-blocking, parallel processing of large DICOM datasets while maintaining the Effect services pattern.

## Current Implementation Status

✅ **Implemented:**
- Web Worker infrastructure with `anonymizationWorker.ts` and `sendingWorker.ts`
- Generic `WorkerManager` class for pool management
- Progress tracking system with global state
- OPFS integration for file persistence
- Effect services running in worker context
- Message-based communication protocol

⚠️ **In Progress:**
- Full activation of worker-based processing in production
- Performance optimization and tuning

## Architecture Design

### High-Level Flow

```
Main Thread                    Worker Manager                 Worker Threads
┌─────────────┐               ┌─────────────┐               ┌─────────────┐
│ UI Components│              │ WorkerManager│              │ Anonymization│
│             │─────────────▶│ (Generic)    │─────────────▶│ Worker       │
│ - Progress  │              │             │              │             │
│ - Selection │              │ - Queue     │              │ - Effect    │
│ - Controls  │              │ - Pool Mgmt │              │ - Services  │
└─────────────┘              │ - Load Bal. │              │ - OPFS I/O  │
       ▲                     └─────────────┘              └─────────────┘
       │                            │                             │
       │                            │ Progress Updates            │
       └────────────────────────────┴─────────────────────────────┘
```

## Component Implementation

### 1. Web Workers

#### Anonymization Worker (`src/workers/anonymizationWorker.ts`)

**Current Implementation:**
- Uses `ManagedRuntime` from Effect for service initialization
- Loads files from OPFS using file references
- Processes files with concurrent batching
- Sends progress updates via `postMessage`

**Service Layer:**
```typescript
const WorkerLayer = Layer.mergeAll(
  ConfigServiceLive,
  FileHandlerLive,
  OPFSStorageLive,
  DicomProcessorLive,
  AnonymizerLive
)

const runtime = ManagedRuntime.make(WorkerLayer)
```

#### Sending Worker (`src/workers/sendingWorker.ts`)

**Current Implementation:**
- Similar architecture to anonymization worker
- Handles DICOM file sending to PACS servers
- Uses DicomSender service with ConfigService dependency

### 2. Worker Manager (`src/workers/workerManager.ts`)

**Generic Implementation:**
```typescript
export class WorkerManager<T extends BaseJob> {
  private workers: WorkerTask<T>[] = []
  private jobQueue: T[] = []
  private maxWorkers: number
  
  constructor(workerScriptUrl: string, workerType: string, maxWorkers?: number) {
    this.maxWorkers = maxWorkers || Math.min(navigator.hardwareConcurrency || 4, 8)
  }
}
```

**Key Features:**
- Generic type system supporting different job types (anonymization, sending)
- Dynamic worker pool sizing based on hardware
- Job queuing when all workers are busy
- Debug message system for monitoring
- Automatic worker recycling after errors

**Singleton Instances:**
```typescript
// Global singleton instances
let anonymizationWorkerManager: WorkerManager<AnonymizationJob> | null = null
let sendingWorkerManager: WorkerManager<SendingJob> | null = null

export function getAnonymizationWorkerManager(): WorkerManager<AnonymizationJob>
export function getSendingWorkerManager(): WorkerManager<SendingJob>
```

### 3. Composables Integration

#### useAnonymizer (`src/composables/useAnonymizer.ts`)

**Current Implementation:**
- Creates Effect Streams for anonymization events
- Delegates to WorkerManager for processing
- Provides reactive state for UI components

```typescript
const anonymizeStudyStream = (
  studyId: string,
  files: DicomFile[],
  config: AnonymizationConfig,
  concurrency: number
): Stream.Stream<AnonymizationEvent, Error> =>
  Stream.async<AnonymizationEvent, Error>((emit) => {
    const workerManager = getAnonymizationWorkerManager()
    workerManager.anonymizeStudy({
      studyId,
      files,
      config,
      concurrency,
      onProgress: (progressData) => {
        emit.single({
          _tag: "AnonymizationProgress",
          studyId,
          completed: progressData.completed,
          total: progressData.total,
          currentFile: progressData.currentFile
        })
      }
    })
  })
```

### 4. Progress Tracking (`src/composables/useAnonymizationProgress.ts`)

**Global State Management:**
```typescript
const studyProgressMap = ref<Map<string, StudyProgress>>(new Map())

interface StudyProgress {
  isProcessing: boolean
  progress: number
  totalFiles: number
  currentFile?: string
}
```

**Reactive Updates:**
- Map recreation for Vue reactivity
- Per-study progress tracking
- Global state accessible from any component

## OPFS Integration

### File Reference System

**DicomFile Interface:**
```typescript
interface DicomFile {
  id: string           // Unique identifier
  fileName: string     // Display name
  fileSize: number     
  arrayBuffer: ArrayBuffer  // In-memory data
  opfsFileId?: string  // OPFS storage key
  anonymized: boolean
  metadata?: DicomMetadata
}
```

### Worker File Loading Pattern

```typescript
// Worker loads files from OPFS
const fileLoadingEffects = fileRefs.map(fileRef => 
  Effect.gen(function* () {
    try {
      const arrayBuffer = yield* opfs.loadFile(fileRef.opfsFileId)
      return {
        ...fileRef,
        arrayBuffer,
        parsed: true
      } as DicomFile
    } catch (error) {
      // Error recovery with fallback
      return {
        ...fileRef,
        arrayBuffer: new ArrayBuffer(0),
        parsed: false
      } as DicomFile
    }
  })
)
```

## Message Protocol

### Worker Input Messages

```typescript
interface WorkerMessage {
  type: 'anonymize_study' | 'send_study'
  data: {
    studyId: string
    files: Array<{
      id: string
      fileName: string
      fileSize: number
      opfsFileId: string
      metadata?: any
    }>
    config: AnonymizationConfig | ServerConfig
    concurrency?: number
  }
}
```

### Worker Output Messages

```typescript
type WorkerResponse = 
  | { type: 'progress'; studyId: string; data: { 
      total: number
      completed: number
      percentage: number
      currentFile?: string 
    }}
  | { type: 'complete'; studyId: string; data: { 
      anonymizedFiles?: DicomFile[]
      sentFiles?: DicomFile[]
    }}
  | { type: 'error'; studyId: string; data: { 
      message: string
      stack?: string 
    }}
```

## Concurrency Model

### Worker Pool Management

```typescript
// Dynamic pool sizing
const maxWorkers = Math.min(
  navigator.hardwareConcurrency || 4,  // Hardware cores
  8,                                   // Maximum cap
  selectedStudies.length               // Don't exceed work items
)
```

### File-Level Concurrency

```typescript
// Within each worker
const BATCH_SIZE = 5  // Process 5 files concurrently
const batches = Effect.chunk(BATCH_SIZE)(fileLoadingEffects)

// Process batches sequentially with concurrency within batch
for (const batch of batches) {
  const loadedBatch = yield* Effect.all(batch, { concurrency: "unbounded" })
  // Process loaded files...
}
```

## Error Handling

### Worker Error Recovery

```typescript
// In WorkerManager
worker.addEventListener('error', (error) => {
  console.error(`Worker ${workerTask.id} error:`, error)
  if (workerTask.job) {
    workerTask.job.onError?.(new Error(`Worker error: ${error.message}`))
    this.completeJob(workerTask)  // Clean up and process queue
  }
})
```

### Service Error Propagation

```typescript
// In Worker
try {
  const result = await runtime.runPromise(effectChain)
  postMessage({ type: 'complete', studyId, data: { anonymizedFiles: result } })
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

## Debug System

### Debug Message Interface

```typescript
export interface DebugMessage {
  id: string
  type: 'create' | 'assign' | 'progress' | 'complete' | 'error' | 'queue' | 'message'
  timestamp: string
  content: string
  workerId?: number
  studyId?: string
}
```

### Worker Status Monitoring

```typescript
export interface WorkerDetail {
  id: number
  isAvailable: boolean
  currentJob: {
    studyId: string
    fileCount: number
  } | null
}

// Access via WorkerManager
const status = workerManager.getStatus()
// Returns: { 
//   totalWorkers: number
//   activeJobs: number
//   queuedJobs: number
//   workers: WorkerDetail[]
// }
```

## Performance Characteristics

### Current Optimizations

1. **Worker Pool Sizing**: Dynamic based on hardware capabilities
2. **Batch Processing**: Files processed in configurable batches
3. **Memory Management**: OPFS used for persistence, only active files in memory
4. **Progress Granularity**: Per-file progress updates for smooth UI

### Observed Improvements

- ✅ UI remains responsive during large dataset processing
- ✅ Parallel processing across multiple CPU cores
- ✅ Real-time progress updates
- ✅ Graceful error recovery

## Configuration

### Vite Worker Support

Workers are compiled as ES modules with full TypeScript support:

```typescript
// Worker instantiation with type safety
new Worker(
  new URL('../workers/anonymizationWorker.ts', import.meta.url),
  { type: 'module' }
)
```

## Testing Considerations

### Worker Testing Challenges

1. **Module Resolution**: Workers need special handling for Effect imports
2. **OPFS Access**: Requires browser environment or mocking
3. **Message Protocol**: Async message passing needs careful testing

### Debug Panel

A debug panel component (`WorkerDebugPanel.vue`) provides:
- Real-time worker status
- Message history
- Performance metrics
- Manual worker control

## Future Enhancements

### Planned Improvements

1. **Smart Batching**: Adaptive batch sizes based on file size and memory
2. **Worker Recycling**: Periodic worker restart to prevent memory leaks
3. **Priority Queue**: Urgent studies processed first
4. **Streaming Results**: Return results as they complete rather than waiting

### Performance Targets

- Process 1000+ DICOM files without UI blocking
- Maintain <100ms UI response time during processing
- Utilize 80%+ of available CPU cores efficiently

## Architecture Benefits

### Current Implementation Advantages

1. **Non-blocking UI**: Main thread free for user interactions
2. **Scalable Processing**: Leverages multiple CPU cores
3. **Clean Separation**: Workers isolated from main app logic
4. **Effect Integration**: Services work identically in workers
5. **Observable Progress**: Real-time updates without polling

### Maintenance Benefits

1. **Generic Worker Manager**: Reusable for different job types
2. **Type Safety**: Full TypeScript support including workers
3. **Debug Visibility**: Comprehensive debugging tools
4. **Error Resilience**: Graceful failure handling

## Conclusion

The current worker architecture successfully enables parallel DICOM processing while maintaining code quality and the Effect services pattern. The system provides:

- **Performance**: Multi-core utilization for faster processing
- **User Experience**: Responsive UI with real-time progress
- **Reliability**: Error recovery and state consistency via OPFS
- **Maintainability**: Clean separation of concerns with type safety
- **Observability**: Comprehensive debugging and monitoring

The architecture is production-ready with room for optimization based on real-world usage patterns.