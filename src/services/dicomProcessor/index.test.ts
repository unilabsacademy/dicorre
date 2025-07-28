import { describe, it, expect } from 'vitest'
import { DicomProcessor } from './index'
import type { DicomFile } from '@/types/dicom'

describe('DicomProcessor', () => {
  it('should create a DicomProcessor instance', () => {
    const processor = new DicomProcessor()
    expect(processor).toBeDefined()
  })

  it('should have async parseFile method', () => {
    const processor = new DicomProcessor()
    expect(typeof processor.parseFile).toBe('function')
  })

  it('should have async parseFiles method', () => {
    const processor = new DicomProcessor()
    expect(typeof processor.parseFiles).toBe('function')
  })

  it('should have async validateFile method', () => {
    const processor = new DicomProcessor()
    expect(typeof processor.validateFile).toBe('function')
  })

  it('should have legacy parseDicomFile method', () => {
    const processor = new DicomProcessor()
    expect(typeof processor.parseDicomFile).toBe('function')
  })
})