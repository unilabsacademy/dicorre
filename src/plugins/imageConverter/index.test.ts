import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { imageConverterPlugin } from './index'

describe('ImageConverter Plugin', () => {
  describe('File Detection', () => {
    it('should identify supported image files', async () => {
      const jpgFile = new File(['fake jpg data'], 'test.jpg', { type: 'image/jpeg' })
      const pngFile = new File(['fake png data'], 'test.png', { type: 'image/png' })
      const bmpFile = new File(['fake bmp data'], 'test.bmp', { type: 'image/bmp' })
      const txtFile = new File(['text data'], 'test.txt', { type: 'text/plain' })
      
      const jpgResult = await Effect.runPromise(imageConverterPlugin.canProcess(jpgFile))
      const pngResult = await Effect.runPromise(imageConverterPlugin.canProcess(pngFile))
      const bmpResult = await Effect.runPromise(imageConverterPlugin.canProcess(bmpFile))
      const txtResult = await Effect.runPromise(imageConverterPlugin.canProcess(txtFile))
      
      expect(jpgResult).toBe(true)
      expect(pngResult).toBe(true)
      expect(bmpResult).toBe(true)
      expect(txtResult).toBe(false)
    })

    it('should identify supported files by extension', async () => {
      const jpegFile = new File(['fake jpeg data'], 'image.jpeg')
      const gifFile = new File(['fake gif data'], 'image.gif')
      const dcmFile = new File(['fake dcm data'], 'image.dcm')
      
      const jpegResult = await Effect.runPromise(imageConverterPlugin.canProcess(jpegFile))
      const gifResult = await Effect.runPromise(imageConverterPlugin.canProcess(gifFile))
      const dcmResult = await Effect.runPromise(imageConverterPlugin.canProcess(dcmFile))
      
      expect(jpegResult).toBe(true)
      expect(gifResult).toBe(false) // GIF not supported
      expect(dcmResult).toBe(false) // DICOM files should not be handled by this plugin
    })
  })

  describe('Plugin Properties', () => {
    it('should have correct plugin metadata', () => {
      expect(imageConverterPlugin.id).toBe('image-converter')
      expect(imageConverterPlugin.name).toBe('Image to DICOM Converter')
      expect(imageConverterPlugin.version).toBe('1.0.0')
      expect(imageConverterPlugin.type).toBe('file-format')
      expect(imageConverterPlugin.enabled).toBe(true)
    })

    it('should have supported extensions', () => {
      expect(imageConverterPlugin.supportedExtensions).toContain('.jpg')
      expect(imageConverterPlugin.supportedExtensions).toContain('.jpeg')
      expect(imageConverterPlugin.supportedExtensions).toContain('.png')
      expect(imageConverterPlugin.supportedExtensions).toContain('.bmp')
    })
  })

})