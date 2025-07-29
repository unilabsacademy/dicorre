import { computed, onUnmounted } from 'vue'
import type { DicomFile, DicomStudy, AnonymizationConfig } from '@/types/dicom'
import { useDicomProcessor } from './useDicomProcessor'
import { useAnonymizer } from './useAnonymizer'
import { useDicomSender } from './useDicomSender'

export function useDicomWorkflow() {
  const processor = useDicomProcessor()
  const anonymizer = useAnonymizer()
  const sender = useDicomSender()

  const loading = computed(() =>
    processor.loading.value || anonymizer.loading.value || sender.loading.value
  )

  const errors = computed(() => {
    const err: Error[] = []
    if (processor.error.value) err.push(processor.error.value)
    if (anonymizer.error.value) err.push(anonymizer.error.value)
    if (sender.error.value) err.push(sender.error.value)
    return err
  })

  const processAnonymizeAndSend = async (
    files: File[],
    config: AnonymizationConfig,
    studyInfo: Partial<DicomStudy>,
    options: { concurrency?: number; maxRetries?: number } = {}
  ): Promise<boolean> => {
    try {
      const dicomFiles: DicomFile[] = await Promise.all(
        files.map(async (file, idx) => ({
          id: `file-${idx}-${Date.now()}`,
          fileName: file.name,
          fileSize: file.size,
          arrayBuffer: await file.arrayBuffer(),
          anonymized: false
        }))
      )

      const parsed = await processor.parseFiles(dicomFiles, options.concurrency)
      if (parsed.length === 0) return false

      const anonymized = await anonymizer.anonymizeFiles(parsed, config, options.concurrency)
      if (anonymized.length === 0) return false

      const study: DicomStudy = {
        studyInstanceUID: studyInfo.studyInstanceUID || `1.2.3.4.5.${Date.now()}`,
        patientName: studyInfo.patientName || 'Anonymous',
        patientId: studyInfo.patientId || `PAT${Date.now()}`,
        studyDate: studyInfo.studyDate || new Date().toISOString().split('T')[0].replace(/-/g, ''),
        studyDescription: studyInfo.studyDescription || 'Processed Study',
        series: [
          {
            seriesInstanceUID: `1.2.3.4.6.${Date.now()}`,
            seriesDescription: 'Processed Series',
            modality: 'CT',
            files: anonymized
          }
        ]
      }

      return await sender.sendStudyWithProgress(study, options)
    } catch (e) {
      console.error('Workflow error:', e)
      return false
    }
  }

  const resetAll = () => {
    processor.error.value = null
    anonymizer.reset()
    sender.reset()
  }

  onUnmounted(() => resetAll())

  return {
    processor,
    anonymizer,
    sender,
    loading,
    errors,
    processAnonymizeAndSend,
    resetAll
  }
}
