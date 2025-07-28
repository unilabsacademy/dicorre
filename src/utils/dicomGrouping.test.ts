import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { groupDicomFilesByStudy, getDicomGroupingStats } from './dicomGrouping'

describe('DICOM Grouping Utility', () => {
  let fileHandler: FileHandler
  let dicomProcessor: DicomProcessor

  beforeEach(() => {
    fileHandler = new FileHandler()
    dicomProcessor = new DicomProcessor()
  })

  it('should correctly group 3 cases with 3 series each (18 files total)', async () => {
    // Load and extract the test ZIP file
    const zipPath = join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    const zipFile = new File([readFileSync(zipPath)], '3_cases_each_with_3_series_6_images.zip')
    
    // Extract and parse DICOM files
    const extractedFiles = await fileHandler.extractZipFile(zipFile)
    expect(extractedFiles.length).toBe(18)
    
    const parsedFiles = extractedFiles.map(file => dicomProcessor.parseDicomFile(file))
    expect(parsedFiles.length).toBe(18)
    
    // Group files using our utility
    const studies = groupDicomFilesByStudy(parsedFiles)
    const stats = getDicomGroupingStats(studies)
    
    // Validate grouping results
    expect(stats.totalPatients).toBe(3) // 3 different patients
    expect(stats.totalStudies).toBe(3)  // 3 studies (1 per patient)
    expect(stats.totalSeries).toBe(9)   // 9 series (3 per study)
    expect(stats.totalFiles).toBe(18)   // 18 files total
    
    console.log('3-case file grouping stats:', stats)
    
    // Verify each study has 3 series with 2 files each
    for (const study of studies) {
      expect(study.series.length).toBe(3) // Each study should have 3 series
      
      for (const series of study.series) {
        expect(series.files.length).toBe(2) // Each series should have 2 files
        
        // All files in the series should have the same series UID
        const firstSeriesUID = series.files[0].metadata?.seriesInstanceUID
        series.files.forEach(file => {
          expect(file.metadata?.seriesInstanceUID).toBe(firstSeriesUID)
        })
      }
      
      console.log(`Patient ${study.patientId} (${study.patientName}): ${study.series.length} series`)
    }
  })

  it('should correctly group 1 case with 3 series (6 files total)', async () => {
    // Load and extract the test ZIP file
    const zipPath = join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
    const zipFile = new File([readFileSync(zipPath)], '1_case_3_series_6_images.zip')
    
    // Extract and parse DICOM files
    const extractedFiles = await fileHandler.extractZipFile(zipFile)
    expect(extractedFiles.length).toBe(6)
    
    const parsedFiles = extractedFiles.map(file => dicomProcessor.parseDicomFile(file))
    expect(parsedFiles.length).toBe(6)
    
    // Group files using our utility
    const studies = groupDicomFilesByStudy(parsedFiles)
    const stats = getDicomGroupingStats(studies)
    
    // Validate grouping results
    expect(stats.totalPatients).toBe(1) // 1 patient
    expect(stats.totalStudies).toBe(1)  // 1 study
    expect(stats.totalSeries).toBe(3)   // 3 series
    expect(stats.totalFiles).toBe(6)    // 6 files total
    
    console.log('1-case file grouping stats:', stats)
    
    // Verify the single study has 3 series with 2 files each
    const study = studies[0]
    expect(study.series.length).toBe(3)
    
    for (const series of study.series) {
      expect(series.files.length).toBe(2)
      console.log(`Series ${series.seriesDescription}: ${series.files.length} files`)
    }
  })

  it('should handle files with missing metadata gracefully', () => {
    const filesWithMissingMetadata = [
      {
        id: '1',
        fileName: 'valid.dcm',
        fileSize: 1000,
        arrayBuffer: new ArrayBuffer(1000),
        anonymized: false,
        metadata: {
          patientId: 'PAT1',
          patientName: 'Patient One',
          studyInstanceUID: 'STUDY1',
          studyDate: '20241201',
          studyDescription: 'Test Study',
          seriesInstanceUID: 'SERIES1',
          seriesDescription: 'Test Series',
          modality: 'CT',
          sopInstanceUID: 'SOP1'
        }
      },
      {
        id: '2',
        fileName: 'invalid.dcm',
        fileSize: 500,
        arrayBuffer: new ArrayBuffer(500),
        anonymized: false
        // No metadata
      }
    ]
    
    const studies = groupDicomFilesByStudy(filesWithMissingMetadata)
    const stats = getDicomGroupingStats(studies)
    
    // Should only process the file with valid metadata
    expect(stats.totalPatients).toBe(1)
    expect(stats.totalStudies).toBe(1)
    expect(stats.totalSeries).toBe(1)
    expect(stats.totalFiles).toBe(1)
  })
})