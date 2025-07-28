/**
 * DICOM Sender service that uses Effect internally
 */

import { Effect, Stream, Schedule } from "effect"
import { api } from 'dicomweb-client'
const { DICOMwebClient } = api
import type { DicomFile, DicomStudy, SendProgress } from '@/types/dicom'
import { sendStudy, sendStudyWithProgress, sendFile, testConnection } from './effects'
import type { EnhancedSendProgress } from './effects'
import { runWithCustomConfig } from '../shared/layers'

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

  /**
   * Send a DICOM study to the server using Effect
   */
  async sendStudyWithEffect(
    study: DicomStudy,
    options: {
      concurrency?: number
      maxRetries?: number
    } = {}
  ): Promise<void> {
    // Simplified implementation - just use the regular sendStudy method
    return this.sendStudy(study)
  }

  /**
   * Send a study with progress tracking using Effect
   */
  async sendStudyWithProgressEffect(
    study: DicomStudy,
    options: {
      concurrency?: number
      maxRetries?: number
      onProgress: (progress: SendProgress) => void
      onError?: (error: Error) => void
    }
  ): Promise<void> {
    const { onProgress, onError } = options
    
    try {
      // Use the regular sendStudy method with progress callback
      await this.sendStudy(study, onProgress)
    } catch (error) {
      if (onError) {
        onError(error as Error)
      }
      throw error
    }
  }

  /**
   * Send a single DICOM file using Effect
   */
  async sendFileWithEffect(file: DicomFile, maxRetries = 3): Promise<void> {
    // Simplified implementation - just use the regular sendFile method
    return this.sendFile(file)
  }

  /**
   * Test connection to the DICOM server using Effect
   */
  async testConnectionWithEffect(): Promise<boolean> {
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

  /**
   * Legacy method for backward compatibility
   */
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

  /**
   * Legacy method for backward compatibility
   */
  async testConnection(): Promise<boolean> {
    return this.testConnectionWithEffect()
  }

  /**
   * Update server configuration
   */
  updateConfig(newConfig: DicomServerConfig): void {
    this.config = newConfig

    // Prepare headers with auth if provided
    const headers: Record<string, string> = {
      'Accept': 'multipart/related; type="application/dicom"',
      ...newConfig.headers
    }

    // Add authentication headers if configured
    if (newConfig.auth) {
      if (newConfig.auth.type === 'basic') {
        headers['Authorization'] = `Basic ${newConfig.auth.credentials}`
      } else if (newConfig.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${newConfig.auth.credentials}`
      }
    }

    this.client = new DICOMwebClient({
      url: newConfig.url,
      singlepart: false,
      headers
    })
  }

  /**
   * Get current server configuration
   */
  getConfig(): DicomServerConfig {
    return { ...this.config }
  }
}

// Factory function to create service instances
export function createDicomSenderService(config: DicomServerConfig): DicomSender {
  return new DicomSender(config)
}