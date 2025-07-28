import * as dcmjs from 'dcmjs'
import type { DicomFile, DicomMetadata, DicomStudy } from '@/types/dicom'

export class DicomProcessor {
  parseDicomFile(file: DicomFile): DicomFile {
    try {
      // Check if ArrayBuffer has proper DICOM structure
      if (file.arrayBuffer.byteLength < 132) {
        throw new Error('File too small to be a valid DICOM file')
      }

      // Verify DICOM magic number
      const view = new DataView(file.arrayBuffer)
      const magic = String.fromCharCode(
        view.getUint8(128),
        view.getUint8(129),
        view.getUint8(130),
        view.getUint8(131)
      )
      
      if (magic !== 'DICM') {
        console.warn(`File ${file.fileName} missing DICM header, attempting to parse anyway`)
      }

      const dicomData = dcmjs.data.DicomMessage.readFile(file.arrayBuffer)
      const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
      
      const metadata: DicomMetadata = {
        patientName: dataset.PatientName?.Alphabetic || 'Unknown',
        patientId: dataset.PatientID || 'Unknown',
        studyInstanceUID: dataset.StudyInstanceUID,
        studyDate: dataset.StudyDate,
        studyDescription: dataset.StudyDescription || '',
        seriesInstanceUID: dataset.SeriesInstanceUID,
        seriesDescription: dataset.SeriesDescription || '',
        modality: dataset.Modality || '',
        sopInstanceUID: dataset.SOPInstanceUID
      }

      return {
        ...file,
        metadata
      }
    } catch (error) {
      console.error(`Error parsing DICOM file ${file.fileName}:`, error)
      console.error('File size:', file.arrayBuffer.byteLength)
      // Log first few bytes for debugging
      const view = new DataView(file.arrayBuffer)
      const firstBytes = Array.from({length: Math.min(16, file.arrayBuffer.byteLength)}, (_, i) => 
        view.getUint8(i).toString(16).padStart(2, '0')
      ).join(' ')
      console.error('First 16 bytes:', firstBytes)
      
      throw new Error(`Failed to parse DICOM file: ${file.fileName}`)
    }
  }

  groupFilesByStudy(files: DicomFile[]): DicomStudy[] {
    const studyMap = new Map<string, DicomStudy>()

    files.forEach(file => {
      if (!file.metadata?.studyInstanceUID) return

      const studyUID = file.metadata.studyInstanceUID
      
      if (!studyMap.has(studyUID)) {
        studyMap.set(studyUID, {
          studyInstanceUID: studyUID,
          patientName: file.metadata.patientName,
          patientId: file.metadata.patientId,
          studyDate: file.metadata.studyDate,
          studyDescription: file.metadata.studyDescription,
          series: []
        })
      }

      const study = studyMap.get(studyUID)!
      let series = study.series.find(s => s.seriesInstanceUID === file.metadata?.seriesInstanceUID)

      if (!series && file.metadata?.seriesInstanceUID) {
        series = {
          seriesInstanceUID: file.metadata.seriesInstanceUID,
          seriesDescription: file.metadata.seriesDescription,
          modality: file.metadata.modality,
          files: []
        }
        study.series.push(series)
      }

      if (series) {
        series.files.push(file)
      }
    })

    return Array.from(studyMap.values())
  }

  getDicomDataFromFile(file: DicomFile): dcmjs.data.DicomMessage {
    return dcmjs.data.DicomMessage.readFile(file.arrayBuffer)
  }
}