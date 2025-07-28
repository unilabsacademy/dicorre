import JSZip from 'jszip'
import type { DicomFile } from '@/types/dicom'

export class FileHandler {
  private generateFileId(): string {
    return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private isDicomFile(arrayBuffer: ArrayBuffer, fileName: string): boolean {
    const view = new DataView(arrayBuffer)
    
    // Method 1: Check for DICOM magic number "DICM" at position 128
    if (arrayBuffer.byteLength > 132) {
      const magic = String.fromCharCode(
        view.getUint8(128),
        view.getUint8(129),
        view.getUint8(130),
        view.getUint8(131)
      )
      
      if (magic === 'DICM') {
        return true
      }
    }

    // Method 2: Check for common DICOM file extensions
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    if (['dcm', 'dicom', 'dic'].includes(ext)) {
      return true
    }

    // Method 3: For files without extensions, be more permissive
    // Many DICOM files in PACS systems don't have extensions
    if (!fileName.includes('.') && arrayBuffer.byteLength > 1000) {
      // Check if the file starts with likely DICOM patterns
      try {
        // Look for DICOM group/element tags at the beginning
        const group1 = view.getUint16(0, true)
        const element1 = view.getUint16(2, true)
        
        // Common starting tags for DICOM files
        if (
          (group1 === 0x0008) || // Identifying Information
          (group1 === 0x0010) || // Patient Information
          (group1 === 0x0018) || // Acquisition Information
          (group1 === 0x0020) || // Relationship Information
          (group1 === 0x0002)    // File Meta Information
        ) {
          return true
        }

        // Also check a few bytes in for implicit VR files
        if (arrayBuffer.byteLength > 16) {
          const group2 = view.getUint16(8, true)
          const element2 = view.getUint16(10, true)
          
          if (
            (group2 === 0x0008) || 
            (group2 === 0x0010) || 
            (group2 === 0x0018) || 
            (group2 === 0x0020)
          ) {
            return true
          }
        }
      } catch (error) {
        console.debug('Error checking DICOM patterns:', error)
      }
    }

    return false
  }

  async extractZipFile(file: File): Promise<DicomFile[]> {
    const zip = new JSZip()
    const zipContent = await zip.loadAsync(file)
    const dicomFiles: DicomFile[] = []

    const filePromises = Object.keys(zipContent.files).map(async (fileName) => {
      const zipFile = zipContent.files[fileName]
      
      // Skip directories and hidden files
      if (zipFile.dir || fileName.startsWith('.') || fileName.includes('/.')) {
        return null
      }

      try {
        const arrayBuffer = await zipFile.async('arraybuffer')
        
        // Skip very small files
        if (arrayBuffer.byteLength < 100) {
          return null
        }

        // Check if this looks like a DICOM file
        if (this.isDicomFile(arrayBuffer, fileName)) {
          return {
            id: this.generateFileId(),
            fileName: fileName.split('/').pop() || fileName,
            fileSize: arrayBuffer.byteLength,
            arrayBuffer,
            anonymized: false
          } as DicomFile
        }
      } catch (error) {
        console.error(`Error processing file ${fileName}:`, error)
      }
      
      return null
    })

    const results = await Promise.all(filePromises)
    return results.filter((file): file is DicomFile => file !== null)
  }

  async readSingleDicomFile(file: File): Promise<DicomFile> {
    const arrayBuffer = await file.arrayBuffer()
    
    return {
      id: this.generateFileId(),
      fileName: file.name,
      fileSize: file.size,
      arrayBuffer,
      anonymized: false
    }
  }
}