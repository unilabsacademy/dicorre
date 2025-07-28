import { api } from 'dicomweb-client'
const { DICOMwebClient } = api
import type { DicomFile, DicomStudy, SendProgress } from '@/types/dicom'

export interface DicomServerConfig {
  url: string
  headers?: Record<string, string>
  timeout?: number
  auth?: {
    type: 'basic' | 'bearer'
    credentials: string
  } | null
  description?: string
}

export class DicomSender {
  private client: any
  private config: DicomServerConfig

  constructor(config: DicomServerConfig) {
    this.config = config

    // Prepare headers with auth if provided
    const headers: Record<string, string> = {
      'Accept': 'multipart/related; type="application/dicom"',
      ...config.headers
    }

    // Add authentication headers if configured
    if (config.auth) {
      if (config.auth.type === 'basic') {
        headers['Authorization'] = `Basic ${config.auth.credentials}`
      } else if (config.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${config.auth.credentials}`
      }
    }

    this.client = new DICOMwebClient({
      url: config.url,
      singlepart: false,
      headers
    })
  }

  async sendStudy(
    study: DicomStudy, 
    onProgress?: (progress: SendProgress) => void
  ): Promise<void> {
    const allFiles = study.series.flatMap(series => series.files)
    let sentFiles = 0

    const progress: SendProgress = {
      studyUID: study.studyInstanceUID,
      totalFiles: allFiles.length,
      sentFiles: 0,
      status: 'sending'
    }

    try {
      onProgress?.(progress)

      // Send each file individually for progress tracking
      for (const file of allFiles) {
        await this.sendFile(file)
        sentFiles++
        
        progress.sentFiles = sentFiles
        onProgress?.(progress)
      }

      progress.status = 'completed'
      onProgress?.(progress)
    } catch (error) {
      progress.status = 'error'
      progress.error = error instanceof Error ? error.message : 'Unknown error'
      onProgress?.(progress)
      throw error
    }
  }

  async sendFile(file: DicomFile): Promise<void> {
    try {
      // For Orthanc, use the REST API to upload instances
      const response = await fetch(`${this.config.url}/instances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/dicom',
          ...this.config.headers
        },
        body: file.arrayBuffer
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      console.error(`Error sending file ${file.fileName}:`, error)
      throw new Error(`Failed to send file ${file.fileName}: ${error}`)
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection by getting system info
      const response = await fetch(`${this.config.url}/system`, {
        headers: this.config.headers
      })
      return response.ok
    } catch (error) {
      console.error('Connection test failed:', error)
      return false
    }
  }
}