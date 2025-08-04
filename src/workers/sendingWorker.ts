/**
 * Web Worker for DICOM file sending
 * Handles concurrent transmission of DICOM files to a server using dicomweb-client
 */

// Custom STOW-RS implementation for web workers
// dicomweb-client doesn't work reliably in worker contexts
import { OPFSWorkerHelper } from '@/services/opfsStorage/opfsWorkerHelper'

// Server configuration for DICOM transmission
interface ServerConfig {
  url: string
  headers?: Record<string, string>
  auth?: {
    type: 'basic' | 'bearer'
    credentials: string
  } | null
}

// Types for worker communication
interface WorkerMessage {
  type: 'send_study'
  data: {
    studyId: string
    files: FileReferenceWithMetadata[]
    serverConfig: ServerConfig
    concurrency?: number
  }
}

// File reference with metadata for DICOM validation
interface FileReferenceWithMetadata {
  id: string
  fileName: string
  opfsFileId: string
  metadata?: {
    sopInstanceUID?: string
    studyInstanceUID?: string
    seriesInstanceUID?: string
    [key: string]: any
  }
}

interface ProgressMessage {
  type: 'progress'
  studyId: string
  data: {
    total: number
    completed: number
    percentage: number
    currentFile?: string
  }
}

interface CompletionMessage {
  type: 'complete'
  studyId: string
  data: {
    sentFiles: FileReferenceWithMetadata[]
  }
}

interface ErrorMessage {
  type: 'error'
  studyId: string
  data: {
    message: string
    stack?: string
    fileName?: string
  }
}

type WorkerResponseMessage = ProgressMessage | CompletionMessage | ErrorMessage

// Helper to post messages back to main thread
function postMessage(message: WorkerResponseMessage) {
  self.postMessage(message)
}

// Send individual DICOM file using dicomweb-client
async function sendFile(fileRef: FileReferenceWithMetadata, serverConfig: ServerConfig): Promise<FileReferenceWithMetadata> {
  try {
    console.log(`[SendingWorker] Loading file ${fileRef.fileName} from OPFS (${fileRef.opfsFileId})`)
    
    // Load file data from OPFS
    const arrayBuffer = await OPFSWorkerHelper.loadFile(fileRef.opfsFileId)
    
    // Validate file has data
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error(`File ${fileRef.fileName} has no data`)
    }

    // Validate metadata if available
    if (fileRef.metadata && !fileRef.metadata.sopInstanceUID) {
      throw new Error(`File ${fileRef.fileName} has no SOP Instance UID`)
    }

    console.log(`[SendingWorker] Sending file ${fileRef.fileName} (${arrayBuffer.byteLength} bytes)`)

    // Prepare headers with auth if provided
    const headers: Record<string, string> = {
      'Accept': 'multipart/related; type="application/dicom"',
      ...serverConfig.headers
    }

    // Add authentication headers if configured
    if (serverConfig.auth) {
      if (serverConfig.auth.type === 'basic') {
        headers['Authorization'] = `Basic ${serverConfig.auth.credentials}`
      } else if (serverConfig.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${serverConfig.auth.credentials}`
      }
    }

    // Custom STOW-RS implementation using fetch
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Create multipart boundary
    const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    
    // Create multipart body
    const multipartHeader = [
      `--${boundary}`,
      'Content-Type: application/dicom',
      'Content-Transfer-Encoding: binary',
      '',
    ].join('\r\n') + '\r\n'
    
    // Combine text and binary parts
    const textPart = new TextEncoder().encode(multipartHeader)
    const endBoundary = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
    
    // Create final body
    const finalBody = new Uint8Array(textPart.length + uint8Array.length + endBoundary.length)
    finalBody.set(textPart, 0)
    finalBody.set(uint8Array, textPart.length)
    finalBody.set(endBoundary, textPart.length + uint8Array.length)
    
    // Send STOW-RS request
    const response = await fetch(`${serverConfig.url}/studies`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; type="application/dicom"; boundary=${boundary}`,
        'Accept': 'application/dicom+json',
        ...headers
      },
      body: finalBody
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`STOW-RS request failed: ${response.status} ${response.statusText} - ${errorText}`)
    }

    console.log(`[SendingWorker] Successfully sent ${fileRef.fileName} to DICOM server`)
    
    return fileRef
    
  } catch (error) {
    console.error(`[SendingWorker] Error sending file ${fileRef.fileName}:`, error)
    throw new Error(`Failed to send file ${fileRef.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Main sending function that runs in worker
async function sendStudy(
  studyId: string,
  files: FileReferenceWithMetadata[],
  serverConfig: ServerConfig,
  concurrency = 2
) {
  try {
    console.log(`[SendingWorker] Starting transmission of study ${studyId} with ${files.length} files`)
    
    const sentFiles: FileReferenceWithMetadata[] = []
    const total = files.length
    let completed = 0

    // Process files with concurrency limit
    const processFile = async (fileRef: FileReferenceWithMetadata, index: number) => {
      console.log(`[SendingWorker] Starting file ${index + 1}/${total}: ${fileRef.fileName}`)
      
      // Send progress update before starting
      const progressData = {
        total,
        completed,
        percentage: Math.round((completed / total) * 100),
        currentFile: fileRef.fileName
      }
      console.log(`[SendingWorker] Sending progress update:`, progressData)
      
      postMessage({
        type: 'progress',
        studyId,
        data: progressData
      })

      try {
        const sentFile = await sendFile(fileRef, serverConfig)
        sentFiles.push(sentFile)
        completed++

        // Send progress update after completion
        const completedProgressData = {
          total,
          completed,
          percentage: Math.round((completed / total) * 100),
          currentFile: fileRef.fileName
        }
        console.log(`[SendingWorker] Sending completion progress:`, completedProgressData)
        
        postMessage({
          type: 'progress',
          studyId,
          data: completedProgressData
        })
        
      } catch (error) {
        // For individual file errors, we still want to track them but continue with other files
        console.error(`[SendingWorker] Failed to send file ${fileRef.fileName}:`, error)
        throw error // Re-throw to be handled by batch processing
      }
    }

    // Process files in batches to respect concurrency
    const errors: Array<{ fileName: string, error: Error }> = []
    
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      
      // Process batch with individual error handling
      const batchPromises = batch.map(async (file, batchIndex) => {
        try {
          await processFile(file, i + batchIndex)
        } catch (error) {
          errors.push({ 
            fileName: file.fileName, 
            error: error instanceof Error ? error : new Error('Unknown error')
          })
        }
      })
      
      await Promise.all(batchPromises)
    }

    // Check if we had any errors
    if (errors.length > 0) {
      const errorMessage = `Failed to send ${errors.length} out of ${files.length} files: ${errors.map(e => `${e.fileName} (${e.error.message})`).join(', ')}`
      console.error(`[SendingWorker] Transmission completed with errors:`, errorMessage)
      
      postMessage({
        type: 'error',
        studyId,
        data: {
          message: errorMessage,
          stack: errors[0]?.error.stack
        }
      })
      return
    }

    // Send completion message
    console.log(`[SendingWorker] Transmission completed for study ${studyId}. Successfully sent ${sentFiles.length} files`)
    postMessage({
      type: 'complete',
      studyId,
      data: { sentFiles }
    })

  } catch (error) {
    console.error('[SendingWorker] Transmission error:', error)
    // Send error message
    postMessage({
      type: 'error',
      studyId,
      data: {
        message: error instanceof Error ? error.message : 'Unknown transmission error',
        stack: error instanceof Error ? error.stack : undefined
      }
    })
  }
}

// Listen for messages from main thread
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data
  
  console.log(`[SendingWorker] Received message of type: ${type}`)

  switch (type) {
    case 'send_study':
      console.log(`[SendingWorker] Starting transmission for study ${data.studyId} with ${data.files.length} files`)
      sendStudy(data.studyId, data.files, data.serverConfig, data.concurrency)
      break
    default:
      console.warn('[SendingWorker] Unknown message type:', type)
  }
})

// Signal that worker is ready
postMessage({
  type: 'complete',
  studyId: 'worker-ready',
  data: { sentFiles: [] }
})