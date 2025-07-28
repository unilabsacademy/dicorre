import { describe, it, expect } from 'vitest'
import { DicomSender, createDicomSenderService, type DicomServerConfig } from './index'

const mockConfig: DicomServerConfig = {
  url: 'http://localhost:8042',
  description: 'Test server'
}

describe('DicomSender', () => {
  it('should create a DicomSender instance', () => {
    const sender = new DicomSender(mockConfig)
    expect(sender).toBeDefined()
  })

  it('should have async sendStudy method', () => {
    const sender = new DicomSender(mockConfig)
    expect(typeof sender.sendStudy).toBe('function')
  })

  it('should have async testConnection method', () => {
    const sender = new DicomSender(mockConfig)
    expect(typeof sender.testConnection).toBe('function')
  })

  it('should have updateConfig method', () => {
    const sender = new DicomSender(mockConfig)
    expect(typeof sender.updateConfig).toBe('function')
  })

  it('should have getConfig method', () => {
    const sender = new DicomSender(mockConfig)
    expect(typeof sender.getConfig).toBe('function')
  })

  it('should create service using factory function', () => {
    const sender = createDicomSenderService(mockConfig)
    expect(sender).toBeInstanceOf(DicomSender)
  })
})