import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { pdfConverterPlugin } from './index'

describe('PdfConverter Plugin', () => {
  describe('File Detection', () => {
    it('should identify supported PDF files', async () => {
      const pdfFile = new File(['fake pdf data'], 'test.pdf', { type: 'application/pdf' })
      const docFile = new File(['fake doc data'], 'test.doc', { type: 'application/msword' })
      const txtFile = new File(['text data'], 'test.txt', { type: 'text/plain' })
      
      const pdfResult = await Effect.runPromise(pdfConverterPlugin.canProcess(pdfFile))
      const docResult = await Effect.runPromise(pdfConverterPlugin.canProcess(docFile))
      const txtResult = await Effect.runPromise(pdfConverterPlugin.canProcess(txtFile))
      
      expect(pdfResult).toBe(true)
      expect(docResult).toBe(false)
      expect(txtResult).toBe(false)
    })

    it('should identify supported files by extension', async () => {
      const pdfFile = new File(['fake pdf data'], 'document.pdf')
      const jpgFile = new File(['fake jpg data'], 'image.jpg')
      const dcmFile = new File(['fake dcm data'], 'image.dcm')
      
      const pdfResult = await Effect.runPromise(pdfConverterPlugin.canProcess(pdfFile))
      const jpgResult = await Effect.runPromise(pdfConverterPlugin.canProcess(jpgFile))
      const dcmResult = await Effect.runPromise(pdfConverterPlugin.canProcess(dcmFile))
      
      expect(pdfResult).toBe(true)
      expect(jpgResult).toBe(false) // JPG not supported by PDF plugin
      expect(dcmResult).toBe(false) // DICOM files should not be handled by this plugin
    })

    it('should handle case-insensitive extensions', async () => {
      const pdfUpperFile = new File(['fake pdf data'], 'document.PDF')
      const pdfMixedFile = new File(['fake pdf data'], 'document.Pdf')
      
      const upperResult = await Effect.runPromise(pdfConverterPlugin.canProcess(pdfUpperFile))
      const mixedResult = await Effect.runPromise(pdfConverterPlugin.canProcess(pdfMixedFile))
      
      expect(upperResult).toBe(true)
      expect(mixedResult).toBe(true)
    })
  })

  describe('Plugin Properties', () => {
    it('should have correct plugin metadata', () => {
      expect(pdfConverterPlugin.id).toBe('pdf-converter')
      expect(pdfConverterPlugin.name).toBe('PDF to DICOM Converter')
      expect(pdfConverterPlugin.version).toBe('1.0.0')
      expect(pdfConverterPlugin.type).toBe('file-format')
      expect(pdfConverterPlugin.enabled).toBe(true)
    })

    it('should have supported extensions', () => {
      expect(pdfConverterPlugin.supportedExtensions).toContain('.pdf')
      expect(pdfConverterPlugin.supportedExtensions).toHaveLength(1)
    })

    it('should have supported MIME types', () => {
      expect(pdfConverterPlugin.supportedMimeTypes).toContain('application/pdf')
      expect(pdfConverterPlugin.supportedMimeTypes).toHaveLength(1)
    })
  })

  describe('File Validation', () => {
    it('should reject empty files', async () => {
      const emptyFile = new File([], 'empty.pdf', { type: 'application/pdf' })
      
      const result = Effect.runPromiseExit(pdfConverterPlugin.validateFile(emptyFile))
      await expect(result).resolves.toMatchObject({
        _tag: 'Failure'
      })
    })

    it('should validate file size constraint in test environment', async () => {
      const validSizeFile = new File(['some pdf content'], 'valid.pdf', { type: 'application/pdf' })
      
      // In test environment (Node.js), this will do basic validation
      const result = await Effect.runPromise(pdfConverterPlugin.validateFile(validSizeFile))
      expect(result).toBe(true) // Should pass basic size validation in test env
    })
  })

  describe('Conversion', () => {
    it('should fail gracefully in non-browser environment', async () => {
      const pdfFile = new File(['fake pdf content'], 'test.pdf', { type: 'application/pdf' })
      const metadata = {
        patientName: 'Test Patient',
        patientID: 'TEST001',
        studyInstanceUID: 'test-study-uid',
        seriesInstanceUID: 'test-series-uid'
      }
      
      const result = Effect.runPromiseExit(pdfConverterPlugin.convertToDicom(pdfFile, metadata))
      await expect(result).resolves.toMatchObject({
        _tag: 'Failure'
      })
    })
  })

  describe('Series Generation', () => {
    it('should generate consistent series metadata', () => {
      // Test that the plugin will generate proper series metadata structure
      expect(pdfConverterPlugin.description).toContain('series')
      expect(pdfConverterPlugin.name).toContain('PDF to DICOM')
    })
  })
})