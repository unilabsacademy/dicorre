import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect } from 'effect'
import { sendLoggerPlugin } from './index'
import type { DicomStudy } from '@/types/dicom'

describe('SendLogger Plugin', () => {
  // Mock console methods
  const consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {})
  }

  afterEach(() => {
    consoleSpy.log.mockClear()
    consoleSpy.error.mockClear()
  })

  describe('Plugin Properties', () => {
    it('should have correct plugin metadata', () => {
      expect(sendLoggerPlugin.id).toBe('send-logger')
      expect(sendLoggerPlugin.name).toBe('Send Logger')
      expect(sendLoggerPlugin.version).toBe('1.0.0')
      expect(sendLoggerPlugin.type).toBe('hook')
      expect(sendLoggerPlugin.enabled).toBe(true)
    })

    it('should have proper hook structure', () => {
      expect(sendLoggerPlugin.hooks.afterSend).toBeDefined()
      expect(sendLoggerPlugin.hooks.beforeSend).toBeDefined()
      expect(sendLoggerPlugin.hooks.onSendError).toBeDefined()
    })
  })

  describe('Hook Functionality', () => {
    const mockStudy: DicomStudy = {
      studyInstanceUID: '1.2.3.4.5',
      patientName: 'Test Patient',
      patientId: 'TEST123',
      accessionNumber: 'ACC123',
      studyDate: '20231201',
      studyDescription: 'Test Study',
      series: [
        {
          seriesInstanceUID: '1.2.3.4.5.1',
          seriesDescription: 'Test Series',
          modality: 'CT',
          files: [
            { id: 'file1', fileName: 'test1.dcm' },
            { id: 'file2', fileName: 'test2.dcm' }
          ]
        },
        {
          seriesInstanceUID: '1.2.3.4.5.2',
          seriesDescription: 'Test Series 2',
          modality: 'MR',
          files: [
            { id: 'file3', fileName: 'test3.dcm' }
          ]
        }
      ]
    }

    it('should log before send', async () => {
      await Effect.runPromise(sendLoggerPlugin.hooks.beforeSend!(mockStudy))
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('📤 SendLogger: Preparing to send study - Patient: Test Patient (TEST123), Files: 3')
      )
    })

    it('should log after successful send', async () => {
      await Effect.runPromise(sendLoggerPlugin.hooks.afterSend!(mockStudy))
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('STUDY SENT SUCCESSFULLY')
      )
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('✅ SendLogger: Study sent - Patient: Test Patient (TEST123), Files: 3')
      )
    })

    it('should log send errors', async () => {
      const error = new Error('Network connection failed')
      
      await Effect.runPromise(sendLoggerPlugin.hooks.onSendError!(mockStudy, error))
      
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('STUDY SEND FAILED')
      )
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('❌ SendLogger: Failed to send study - Network connection failed')
      )
    })
  })
})