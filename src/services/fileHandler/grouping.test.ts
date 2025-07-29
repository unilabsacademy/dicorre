import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Effect } from 'effect'
import { FileHandler, FileHandlerLive } from './index'
import { DicomProcessor, DicomProcessorLive } from '../dicomProcessor'
import type { DicomFile } from '@/types/dicom'

// Helper to group DICOM files by patient/study/series
function groupDicomFiles(files: DicomFile[]) {
  const patients = new Map()
  
  for (const file of files) {
    if (!file.metadata) continue
    
    const patientId = file.metadata.patientId
    const studyInstanceUID = file.metadata.studyInstanceUID
    const seriesInstanceUID = file.metadata.seriesInstanceUID
    
    if (!patients.has(patientId)) {
      patients.set(patientId, {
        patientId,
        patientName: file.metadata.patientName,
        studies: new Map()
      })
    }
    
    const patient = patients.get(patientId)
    
    if (!patient.studies.has(studyInstanceUID)) {
      patient.studies.set(studyInstanceUID, {
        studyInstanceUID,
        studyDate: file.metadata.studyDate,
        studyDescription: file.metadata.studyDescription,
        series: new Map()
      })
    }
    
    const study = patient.studies.get(studyInstanceUID)
    
    if (!study.series.has(seriesInstanceUID)) {
      study.series.set(seriesInstanceUID, {
        seriesInstanceUID,
        seriesDescription: file.metadata.seriesDescription,
        modality: file.metadata.modality,
        files: []
      })
    }
    
    const series = study.series.get(seriesInstanceUID)
    series.files.push(file)
  }
  
  return patients
}

describe('DICOM File Grouping', () => {
  const runFileHandlerTest = <A, E>(effect: Effect.Effect<A, E, FileHandler>) =>
    Effect.runPromise(effect.pipe(Effect.provide(FileHandlerLive)))
    
  const runDicomProcessorTest = <A, E>(effect: Effect.Effect<A, E, DicomProcessor>) =>
    Effect.runPromise(effect.pipe(Effect.provide(DicomProcessorLive)))

  it('should correctly group files from 3_cases_each_with_3_series_6_images.zip', async () => {
    // Load and extract the test ZIP file
    const zipPath = join(process.cwd(), 'test-data/CASES/3_cases_each_with_3_series_6_images.zip')
    const zipFile = new File([readFileSync(zipPath)], '3_cases_each_with_3_series_6_images.zip')
    
    // Extract DICOM files from ZIP
    const extractedFiles = await runFileHandlerTest(Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      return yield* fileHandler.extractZipFile(zipFile)
    }))
    console.log(`Extracted ${extractedFiles.length} files from ZIP`)
    
    // Parse all DICOM files to get metadata
    const parsedFiles = await runDicomProcessorTest(Effect.gen(function* () {
      const processor = yield* DicomProcessor
      return yield* processor.parseFiles(extractedFiles)
    }))
    console.log(`Parsed ${parsedFiles.length} DICOM files`)
    
    // Group files by patient/study/series
    const patients = groupDicomFiles(parsedFiles)
    
    // Should have 3 patients
    expect(patients.size).toBe(3)
    console.log(`Found ${patients.size} patients`)
    
    // Each patient should have 1 study with 3 series
    let totalSeries = 0
    let totalFiles = 0
    
    for (const [patientId, patient] of patients.entries()) {
      console.log(`Patient ${patientId}: ${patient.patientName}`)
      
      // Each patient should have 1 study
      expect(patient.studies.size).toBe(1)
      
      for (const [studyId, study] of patient.studies.entries()) {
        console.log(`  Study ${studyId}: ${study.studyDescription}`)
        
        // Each study should have 3 series
        expect(study.series.size).toBe(3)
        totalSeries += study.series.size
        
        for (const [seriesId, series] of study.series.entries()) {
          console.log(`    Series ${seriesId}: ${series.seriesDescription} (${series.files.length} files)`)
          
          // Each series should have 2 files (6 total files / 3 series = 2 files per series)
          expect(series.files.length).toBe(2)
          totalFiles += series.files.length
        }
      }
    }
    
    // Total verification
    expect(totalSeries).toBe(9) // 3 patients × 3 series = 9 series
    expect(totalFiles).toBe(18) // 3 patients × 3 series × 2 files = 18 files
    
    console.log(`Total: ${patients.size} patients, ${totalSeries} series, ${totalFiles} files`)
  })

  it('should correctly group files from 1_case_3_series_6_images.zip', async () => {
    // Load and extract the test ZIP file
    const zipPath = join(process.cwd(), 'test-data/CASES/1_case_3_series_6_images.zip')
    const zipFile = new File([readFileSync(zipPath)], '1_case_3_series_6_images.zip')
    
    // Extract DICOM files from ZIP
    const extractedFiles = await runFileHandlerTest(Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      return yield* fileHandler.extractZipFile(zipFile)
    }))
    console.log(`Extracted ${extractedFiles.length} files from ZIP`)
    
    // Parse all DICOM files to get metadata
    const parsedFiles = await runDicomProcessorTest(Effect.gen(function* () {
      const processor = yield* DicomProcessor
      return yield* processor.parseFiles(extractedFiles)
    }))
    console.log(`Parsed ${parsedFiles.length} DICOM files`)
    
    // Group files by patient/study/series
    const patients = groupDicomFiles(parsedFiles)
    
    // Should have 1 patient
    expect(patients.size).toBe(1)
    console.log(`Found ${patients.size} patient`)
    
    // Patient should have 1 study with 3 series
    for (const [patientId, patient] of patients.entries()) {
      console.log(`Patient ${patientId}: ${patient.patientName}`)
      
      // Should have 1 study
      expect(patient.studies.size).toBe(1)
      
      for (const [studyId, study] of patient.studies.entries()) {
        console.log(`  Study ${studyId}: ${study.studyDescription}`)
        
        // Should have 3 series
        expect(study.series.size).toBe(3)
        
        let totalFiles = 0
        for (const [seriesId, series] of study.series.entries()) {
          console.log(`    Series ${seriesId}: ${series.seriesDescription} (${series.files.length} files)`)
          
          // Each series should have 2 files
          expect(series.files.length).toBe(2)
          totalFiles += series.files.length
        }
        
        // Total should be 6 files
        expect(totalFiles).toBe(6)
      }
    }
  })
})