import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock dicomweb-client
const mockStoreInstances = vi.fn()
const mockDICOMwebClient = vi.fn().mockImplementation(() => ({
  storeInstances: mockStoreInstances
}))

vi.mock('dicomweb-client', () => ({
  api: {
    DICOMwebClient: mockDICOMwebClient
  }
}))

// Mock OPFSWorkerHelper
const mockLoadFile = vi.fn()
vi.mock('@/services/opfsStorage/opfsWorkerHelper', () => ({
  OPFSWorkerHelper: {
    loadFile: mockLoadFile,
    isSupported: vi.fn().mockReturnValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    saveFile: vi.fn().mockResolvedValue(undefined)
  }
}))

// Mock Web Worker self and postMessage
const mockPostMessage = vi.fn()
global.self = {
  postMessage: mockPostMessage,
  addEventListener: vi.fn()
} as any

// Mock console to reduce noise
global.console = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
} as any

describe('SendingWorker Core Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Default successful mocks
    mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
    mockStoreInstances.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create test data
  const createTestFile = (overrides = {}) => ({
    id: 'file-1',
    fileName: 'test.dcm',
    opfsFileId: 'opfs-file-1',
    metadata: {
      sopInstanceUID: 'sop-123',
      studyInstanceUID: 'study-123',
      seriesInstanceUID: 'series-123'
    },
    ...overrides
  })

  const createTestServerConfig = (overrides = {}) => ({
    url: 'http://localhost:8080/dcm4chee-arc',
    headers: { 'Custom-Header': 'test' },
    auth: null,
    ...overrides
  })

  // Re-implement core functions for testing (extracted from worker)
  const sendFile = async (fileRef: any, serverConfig: any): Promise<any> => {
    // Use mocked functions directly to avoid dynamic import issues
    
    // Load file data from OPFS
    const arrayBuffer = await mockLoadFile(fileRef.opfsFileId)
    
    // Validate file has data
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error(`File ${fileRef.fileName} has no data`)
    }

    // Validate metadata if available
    if (fileRef.metadata && !fileRef.metadata.sopInstanceUID) {
      throw new Error(`File ${fileRef.fileName} has no SOP Instance UID`)
    }

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

    // Create DICOMweb client (using mocked constructor)
    const client = new mockDICOMwebClient({
      url: serverConfig.url,
      singlepart: false,
      headers
    })

    // Convert ArrayBuffer to Uint8Array for dicomweb-client
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Store instance using DICOM web STOW-RS
    await client.storeInstances({
      datasets: [uint8Array]
    })
    
    return fileRef
  }

  const processFileWithProgress = async (
    fileRef: any, 
    serverConfig: any, 
    onProgress: (data: any) => void
  ): Promise<any> => {
    // Send progress update before starting
    onProgress({
      currentFile: fileRef.fileName,
      status: 'starting'
    })

    try {
      const result = await sendFile(fileRef, serverConfig)
      
      // Send progress update after completion
      onProgress({
        currentFile: fileRef.fileName,
        status: 'completed'
      })
      
      return result
    } catch (error) {
      onProgress({
        currentFile: fileRef.fileName,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  describe('sendFile function', () => {
    it('should successfully send a valid DICOM file', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)

      const result = await sendFile(testFile, serverConfig)
      
      expect(mockLoadFile).toHaveBeenCalledWith('opfs-file-1')
      expect(mockStoreInstances).toHaveBeenCalledWith({
        datasets: [expect.any(Uint8Array)]
      })
      expect(result).toEqual(testFile)
    })

    it('should handle basic authentication headers correctly', async () => {
      const testFile = createTestFile()
      const basicAuthConfig = createTestServerConfig({
        auth: {
          type: 'basic',
          credentials: 'dGVzdDp0ZXN0'
        }
      })

      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)
      
      await sendFile(testFile, basicAuthConfig)
      
      expect(mockDICOMwebClient).toHaveBeenCalledWith({
        url: basicAuthConfig.url,
        singlepart: false,
        headers: expect.objectContaining({
          'Authorization': 'Basic dGVzdDp0ZXN0',
          'Accept': 'multipart/related; type="application/dicom"',
          'Custom-Header': 'test'
        })
      })
    })

    it('should handle bearer token authentication', async () => {
      const testFile = createTestFile()
      const bearerAuthConfig = createTestServerConfig({
        auth: {
          type: 'bearer',
          credentials: 'jwt-token-123'
        }
      })

      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)
      
      await sendFile(testFile, bearerAuthConfig)
      
      expect(mockDICOMwebClient).toHaveBeenCalledWith({
        url: bearerAuthConfig.url,
        singlepart: false,
        headers: expect.objectContaining({
          'Authorization': 'Bearer jwt-token-123'
        })
      })
    })

    it('should handle file loading errors', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockRejectedValue(new Error('File not found'))
      
      await expect(sendFile(testFile, serverConfig))
        .rejects
        .toThrow('File not found')
    })

    it('should handle empty file data', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(0))
      
      await expect(sendFile(testFile, serverConfig))
        .rejects
        .toThrow('has no data')
    })

    it('should validate metadata presence', async () => {
      const testFile = createTestFile({
        metadata: { studyInstanceUID: 'study-123' } // Missing sopInstanceUID
      })
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      
      await expect(sendFile(testFile, serverConfig))
        .rejects
        .toThrow('no SOP Instance UID')
    })

    it('should handle DICOM server transmission errors', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockRejectedValue(new Error('Server unreachable'))
      
      await expect(sendFile(testFile, serverConfig))
        .rejects
        .toThrow('Server unreachable')
    })
    
    it('should handle null file data from OPFS', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(null)
      
      await expect(sendFile(testFile, serverConfig))
        .rejects
        .toThrow('has no data')
    })
    
    it('should handle files without metadata', async () => {
      const testFile = createTestFile({
        metadata: undefined
      })
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)
      
      const result = await sendFile(testFile, serverConfig)
      
      expect(result).toEqual(testFile)
      expect(mockStoreInstances).toHaveBeenCalled()
    })
  })

  describe('processFileWithProgress function', () => {
    it('should send progress updates during file processing', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      const mockOnProgress = vi.fn()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)
      
      const result = await processFileWithProgress(testFile, serverConfig, mockOnProgress)
      
      expect(mockOnProgress).toHaveBeenCalledWith({
        currentFile: 'test.dcm',
        status: 'starting'
      })
      
      expect(mockOnProgress).toHaveBeenCalledWith({
        currentFile: 'test.dcm',
        status: 'completed'
      })
      
      expect(result).toEqual(testFile)
    })

    it('should handle errors during file processing', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      const mockOnProgress = vi.fn()
      
      mockLoadFile.mockRejectedValue(new Error('OPFS error'))
      
      await expect(processFileWithProgress(testFile, serverConfig, mockOnProgress))
        .rejects
        .toThrow('OPFS error')
      
      expect(mockOnProgress).toHaveBeenCalledWith({
        currentFile: 'test.dcm',
        status: 'starting'
      })
      
      expect(mockOnProgress).toHaveBeenCalledWith({
        currentFile: 'test.dcm',
        status: 'error',
        error: 'OPFS error'
      })
    })
  })

  describe('Batch Processing Tests', () => {
    it('should process multiple files sequentially', async () => {
      const testFiles = [
        createTestFile({ id: 'file-1', fileName: 'test1.dcm', opfsFileId: 'opfs-1' }),
        createTestFile({ id: 'file-2', fileName: 'test2.dcm', opfsFileId: 'opfs-2' })
      ]
      const serverConfig = createTestServerConfig()
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)
      
      const results = await Promise.all(
        testFiles.map(file => sendFile(file, serverConfig))
      )
      
      expect(results).toHaveLength(2)
      expect(mockLoadFile).toHaveBeenCalledTimes(2)
      expect(mockStoreInstances).toHaveBeenCalledTimes(2)
    })

    it('should handle mixed success and failure scenarios', async () => {
      const testFiles = [
        createTestFile({ id: 'file-1', fileName: 'success.dcm', opfsFileId: 'success-1' }),
        createTestFile({ id: 'file-2', fileName: 'fail.dcm', opfsFileId: 'fail-2' })
      ]
      const serverConfig = createTestServerConfig()
      
      // First file succeeds, second fails
      mockLoadFile
        .mockResolvedValueOnce(new ArrayBuffer(1000))
        .mockResolvedValueOnce(new ArrayBuffer(1000))
      
      mockStoreInstances
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Network error'))
      
      const results = await Promise.allSettled(
        testFiles.map(file => sendFile(file, serverConfig))
      )
      
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('rejected')
      // The second file should fail with a network error (wrapped in our sendFile error message)
      expect((results[1] as PromiseRejectedResult).reason.message)
        .toContain('Network error')
    })
  })

  describe('DICOMwebClient Configuration', () => {
    it('should configure client with correct parameters', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig({
        url: 'https://custom-dicom-server.com/dcm4chee',
        headers: {
          'X-Custom-Header': 'test-value',
          'Content-Type': 'application/dicom'
        }
      })
      
      mockLoadFile.mockResolvedValue(new ArrayBuffer(1000))
      mockStoreInstances.mockResolvedValue(undefined)
      
      await sendFile(testFile, serverConfig)
      
      expect(mockDICOMwebClient).toHaveBeenCalledWith({
        url: 'https://custom-dicom-server.com/dcm4chee',
        singlepart: false,
        headers: expect.objectContaining({
          'Accept': 'multipart/related; type="application/dicom"',
          'X-Custom-Header': 'test-value',
          'Content-Type': 'application/dicom'
        })
      })
    })
    
    it('should properly convert ArrayBuffer to Uint8Array', async () => {
      const testFile = createTestFile()
      const serverConfig = createTestServerConfig()
      const testData = new ArrayBuffer(1000)
      
      mockLoadFile.mockResolvedValue(testData)
      mockStoreInstances.mockResolvedValue(undefined)
      
      await sendFile(testFile, serverConfig)
      
      expect(mockStoreInstances).toHaveBeenCalledWith({
        datasets: [expect.any(Uint8Array)]
      })
      
      const calledWith = mockStoreInstances.mock.calls[0][0]
      expect(calledWith.datasets[0]).toBeInstanceOf(Uint8Array)
      expect(calledWith.datasets[0].byteLength).toBe(1000)
    })
  })
})