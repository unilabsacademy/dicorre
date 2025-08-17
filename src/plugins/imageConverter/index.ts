import { Effect } from "effect"
import * as dcmjs from 'dcmjs'
import type { FileFormatPlugin, ConversionOptions } from '@/types/plugins'
import type { DicomFile } from '@/types/dicom'
import { PluginError } from '@/types/effects'

/**
 * Image to DICOM Secondary Capture Converter Plugin
 * Converts common image formats (JPG, PNG, BMP) to DICOM Secondary Capture objects
 */
export class ImageConverterPlugin implements FileFormatPlugin {
  id = 'image-converter'
  name = 'Image to DICOM Converter'
  version = '1.0.0'
  description = 'Converts JPG, PNG, and BMP images to DICOM Secondary Capture format'
  type = 'file-format' as const
  enabled = true

  supportedExtensions = ['.jpg', '.jpeg', '.png', '.bmp']
  supportedMimeTypes = ['image/jpeg', 'image/png', 'image/bmp']

  /**
   * Check if this plugin can process the given file
   */
  canProcess = (file: File): Effect.Effect<boolean, PluginError> =>
    Effect.sync(() => {
      // Check file extension
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (this.supportedExtensions.includes(fileExtension)) {
        return true
      }

      // Check MIME type
      if (file.type && this.supportedMimeTypes.includes(file.type)) {
        return true
      }

      return false
    })

  /**
   * Validate that the file is a valid image
   */
  validateFile = (file: File): Effect.Effect<boolean, PluginError> => {
    const pluginId = this.id
    return Effect.gen(function* () {
      // Basic validation - check file size
      if (file.size === 0) {
        return yield* Effect.fail(new PluginError({
          message: `File ${file.name} is empty`,
          pluginId
        }))
      }

      // Check if it's actually an image by trying to load it
      return yield* Effect.tryPromise({
        try: async () => {
          return new Promise<boolean>((resolve) => {
            const img = new Image()
            img.onload = () => resolve(true)
            img.onerror = () => resolve(false)
            img.src = URL.createObjectURL(file)
          })
        },
        catch: (error) => new PluginError({
          message: `Failed to validate image file: ${file.name}`,
          pluginId,
          cause: error
        })
      })
    })
  }

  /**
   * Convert image to DICOM Secondary Capture
   */
  convertToDicom = (file: File, options?: ConversionOptions): Effect.Effect<DicomFile[], PluginError> => {
    const pluginId = this.id
    const self = this
    
    return Effect.gen(function* () {
      console.log(`Converting image ${file.name} to DICOM using ImageConverterPlugin`)

      // Load image data
      const imageDataUrl = yield* Effect.tryPromise({
        try: () => self.readFileAsDataURL(file),
        catch: (error) => new PluginError({
          message: `Failed to read image file: ${file.name}`,
          pluginId,
          cause: error
        })
      })

      // Load image to get dimensions
      const imageInfo = yield* Effect.tryPromise({
        try: () => self.loadImage(imageDataUrl),
        catch: (error) => new PluginError({
          message: `Failed to load image: ${file.name}`,
          pluginId,
          cause: error
        })
      }) as Effect.Effect<{ img: HTMLImageElement; width: number; height: number }, PluginError>

      // Convert image to pixel data
      const pixelData = yield* Effect.tryPromise({
        try: () => self.getPixelData(imageInfo.img, imageInfo.width, imageInfo.height),
        catch: (error) => new PluginError({
          message: `Failed to extract pixel data from image: ${file.name}`,
          pluginId,
          cause: error
        })
      })

      // Create DICOM dataset
      const dataset = self.createDicomDataset(
        file.name,
        imageInfo.width,
        imageInfo.height,
        pixelData,
        options
      )

      // Convert dataset to ArrayBuffer using DicomMessage
      const dicomMessage = new dcmjs.data.DicomMessage(dataset)
      const dicomBuffer = dicomMessage.write()

      // Generate file ID
      const fileId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      // Create DicomFile object
      const dicomFile: DicomFile = {
        id: fileId,
        fileName: file.name.replace(/\.(jpg|jpeg|png|bmp)$/i, '.dcm'),
        fileSize: dicomBuffer.byteLength,
        arrayBuffer: dicomBuffer,
        anonymized: false
      }

      console.log(`Successfully converted ${file.name} to DICOM (${dicomBuffer.byteLength} bytes)`)

      return [dicomFile]
    })
  }

  /**
   * Read file as data URL
   */
  private readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /**
   * Load image and get dimensions
   */
  private loadImage(dataUrl: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve({
          img,
          width: img.width,
          height: img.height
        })
      }
      img.onerror = reject
      img.src = dataUrl
    })
  }

  /**
   * Extract pixel data from image
   */
  private getPixelData(img: HTMLImageElement, width: number, height: number): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, width, height)
      
      // Convert RGBA to RGB
      const rgbData = new Uint8Array(width * height * 3)
      let rgbIndex = 0
      
      for (let i = 0; i < imageData.data.length; i += 4) {
        rgbData[rgbIndex++] = imageData.data[i]     // R
        rgbData[rgbIndex++] = imageData.data[i + 1] // G
        rgbData[rgbIndex++] = imageData.data[i + 2] // B
        // Skip alpha channel
      }
      
      resolve(rgbData)
    })
  }

  /**
   * Create DICOM dataset for Secondary Capture
   */
  private createDicomDataset(
    fileName: string,
    width: number,
    height: number,
    pixelData: Uint8Array,
    options?: ConversionOptions
  ): any {
    // Generate UIDs using proper UID generation
    const studyInstanceUID = `2.25.${Math.floor(Math.random() * 1e15)}`
    const seriesInstanceUID = `2.25.${Math.floor(Math.random() * 1e15)}`
    const sopInstanceUID = `2.25.${Math.floor(Math.random() * 1e15)}`

    // Get current date/time
    const now = new Date()
    const studyDate = options?.studyDate || now.toISOString().slice(0, 10).replace(/-/g, '')
    const studyTime = now.toISOString().slice(11, 19).replace(/:/g, '')

    // Build DICOM dataset
    const dataset = {
      _meta: {
        FileMetaInformationVersion: {
          Value: [new Uint8Array([0, 1])],
          vr: 'OB'
        },
        MediaStorageSOPClassUID: {
          Value: ['1.2.840.10008.5.1.4.1.1.7'], // Secondary Capture
          vr: 'UI'
        },
        MediaStorageSOPInstanceUID: {
          Value: [sopInstanceUID],
          vr: 'UI'
        },
        TransferSyntaxUID: {
          Value: ['1.2.840.10008.1.2.1'], // Explicit VR Little Endian
          vr: 'UI'
        },
        ImplementationClassUID: {
          Value: ['1.2.826.0.1.3680043.8.1055.1'],
          vr: 'UI'
        }
      },
      PatientName: {
        Value: [options?.patientName || 'Image^Converted'],
        vr: 'PN'
      },
      PatientID: {
        Value: [options?.patientId || 'IMG-' + Date.now()],
        vr: 'LO'
      },
      StudyInstanceUID: {
        Value: [studyInstanceUID],
        vr: 'UI'
      },
      SeriesInstanceUID: {
        Value: [seriesInstanceUID],
        vr: 'UI'
      },
      SOPInstanceUID: {
        Value: [sopInstanceUID],
        vr: 'UI'
      },
      SOPClassUID: {
        Value: ['1.2.840.10008.5.1.4.1.1.7'], // Secondary Capture
        vr: 'UI'
      },
      StudyDate: {
        Value: [studyDate],
        vr: 'DA'
      },
      StudyTime: {
        Value: [studyTime],
        vr: 'TM'
      },
      AccessionNumber: {
        Value: [options?.accessionNumber || ''],
        vr: 'SH'
      },
      Modality: {
        Value: [options?.modality || 'OT'], // Other
        vr: 'CS'
      },
      ConversionType: {
        Value: ['WSD'], // Workstation
        vr: 'CS'
      },
      StudyDescription: {
        Value: [options?.studyDescription || `Converted from ${fileName}`],
        vr: 'LO'
      },
      SeriesDescription: {
        Value: [options?.seriesDescription || 'Image Conversion'],
        vr: 'LO'
      },
      PatientOrientation: {
        Value: [''],
        vr: 'CS'
      },
      SamplesPerPixel: {
        Value: [3], // RGB
        vr: 'US'
      },
      PhotometricInterpretation: {
        Value: ['RGB'],
        vr: 'CS'
      },
      Rows: {
        Value: [height],
        vr: 'US'
      },
      Columns: {
        Value: [width],
        vr: 'US'
      },
      BitsAllocated: {
        Value: [8],
        vr: 'US'
      },
      BitsStored: {
        Value: [8],
        vr: 'US'
      },
      HighBit: {
        Value: [7],
        vr: 'US'
      },
      PixelRepresentation: {
        Value: [0], // Unsigned
        vr: 'US'
      },
      PlanarConfiguration: {
        Value: [0], // Color-by-pixel (RGBRGBRGB...)
        vr: 'US'
      },
      PixelData: {
        Value: [pixelData],
        vr: 'OB'
      },
      InstanceNumber: {
        Value: [1],
        vr: 'IS'
      }
    }

    return dataset
  }
}

// Export singleton instance
export const imageConverterPlugin = new ImageConverterPlugin()