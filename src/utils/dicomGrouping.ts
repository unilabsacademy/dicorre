import type { DicomFile, DicomStudy } from '@/types/dicom'

/**
 * Groups DICOM files by patient, study, and series
 * Returns an array of DicomStudy objects with proper hierarchy
 */
export function groupDicomFilesByStudy(files: DicomFile[]): DicomStudy[] {
  const studyMap = new Map<string, DicomStudy>()
  
  for (const file of files) {
    if (!file.metadata) {
      console.warn(`File ${file.fileName} has no metadata, skipping`)
      continue
    }
    
    const {
      patientId,
      patientName,
      studyInstanceUID,
      studyDate,
      studyDescription,
      seriesInstanceUID,
      seriesDescription,
      modality
    } = file.metadata
    
    // Create study key that includes both patient and study info
    const studyKey = `${patientId}|${studyInstanceUID}`
    
    // Get or create study
    if (!studyMap.has(studyKey)) {
      studyMap.set(studyKey, {
        studyInstanceUID,
        patientName: patientName || 'Unknown',
        patientId: patientId || 'Unknown',
        studyDate: studyDate || new Date().toISOString().split('T')[0].replace(/-/g, ''),
        studyDescription: studyDescription || 'Unknown Study',
        series: []
      })
    }
    
    const study = studyMap.get(studyKey)!
    
    // Find or create series
    let series = study.series.find(s => s.seriesInstanceUID === seriesInstanceUID)
    if (!series) {
      series = {
        seriesInstanceUID,
        seriesDescription: seriesDescription || 'Unknown Series',
        modality: modality || 'Unknown',
        files: []
      }
      study.series.push(series)
    }
    
    // Add file to series
    series.files.push(file)
  }
  
  // Convert map to array and sort
  const studies = Array.from(studyMap.values())
  
  // Sort studies by patient ID and study date
  studies.sort((a, b) => {
    const patientCompare = a.patientId.localeCompare(b.patientId)
    if (patientCompare !== 0) return patientCompare
    return a.studyDate.localeCompare(b.studyDate)
  })
  
  // Sort series within each study
  studies.forEach(study => {
    study.series.sort((a, b) => a.seriesInstanceUID.localeCompare(b.seriesInstanceUID))
  })
  
  return studies
}

/**
 * Get summary statistics for grouped DICOM files
 */
export function getDicomGroupingStats(studies: DicomStudy[]) {
  const stats = {
    patients: new Set<string>(),
    totalStudies: studies.length,
    totalSeries: 0,
    totalFiles: 0
  }
  
  for (const study of studies) {
    stats.patients.add(study.patientId)
    stats.totalSeries += study.series.length
    
    for (const series of study.series) {
      stats.totalFiles += series.files.length
    }
  }
  
  return {
    ...stats,
    totalPatients: stats.patients.size
  }
}