import { Effect, ManagedRuntime } from 'effect'
import { DicomSender } from '@/services/dicomSender'
import { OPFSStorage } from '@/services/opfsStorage'
import type { DicomFile } from '@/types/dicom'
import { AppLayer } from '@/services/shared/layers'

const runtime = ManagedRuntime.make(AppLayer)

// Message types
interface ServerConfig {
  url: string
  headers?: Record<string, string>
  auth?: { type: 'basic' | 'bearer'; credentials: string } | null
}

interface WorkerMessage {
  type: 'send_study'
  data: {
    studyId: string
    files: Array<{ id: string; fileName: string; fileSize: number; opfsFileId: string; metadata?: any }>
    serverConfig: ServerConfig
    concurrency?: number
  }
}

type WorkerResponse =
  | { type: 'progress'; studyId: string; data: { total: number; completed: number; percentage: number; currentFile?: string } }
  | { type: 'complete'; studyId: string; data: { sentFiles: DicomFile[] } }
  | { type: 'error'; studyId: string; data: { message: string; stack?: string } }

// Main worker function
async function sendStudy(studyId: string, fileRefs: Array<{ id: string; fileName: string; fileSize: number; opfsFileId: string; metadata?: any }>, serverConfig: ServerConfig, _concurrency = 2) {
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const opfs = yield* OPFSStorage
        const sender = yield* DicomSender

        // Load files from OPFS and send them
        const total = fileRefs.length
        let completed = 0
        const sentFiles: DicomFile[] = []

        for (const fileRef of fileRefs) {
          // Progress update
          self.postMessage({
            type: 'progress',
            studyId,
            data: { total, completed, percentage: Math.round((completed / total) * 100), currentFile: fileRef.fileName }
          } as WorkerResponse)

          // Load file from OPFS
          const arrayBuffer = yield* opfs.loadFile(fileRef.opfsFileId)

          // Create DicomFile from OPFS data
          const dicomFile: DicomFile = {
            id: fileRef.id,
            fileName: fileRef.fileName,
            fileSize: fileRef.fileSize,
            arrayBuffer,
            metadata: fileRef.metadata,
            opfsFileId: fileRef.opfsFileId
          }

          // Send file using service with passed config
          yield* sender.sendFile(dicomFile, serverConfig)

          // Mark as sent and add to results
          dicomFile.sent = true
          sentFiles.push({
            ...dicomFile,
            arrayBuffer: new ArrayBuffer(0) // Empty ArrayBuffer since main thread will reload from OPFS
          })
          completed++

          // Progress update after completion
          self.postMessage({
            type: 'progress',
            studyId,
            data: { total, completed, percentage: Math.round((completed / total) * 100), currentFile: fileRef.fileName }
          } as WorkerResponse)
        }

        // Send completion
        self.postMessage({ type: 'complete', studyId, data: { sentFiles } } as WorkerResponse)
      })
    )
  } catch (error) {
    self.postMessage({
      type: 'error',
      studyId,
      data: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }
    } as WorkerResponse)
  }
}

// Message listener
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data

  if (type === 'send_study') {
    sendStudy(data.studyId, data.files, data.serverConfig, data.concurrency)
  }
})

// Ready signal
self.postMessage({ type: 'complete', studyId: 'worker-ready', data: { sentFiles: [] } } as WorkerResponse)
