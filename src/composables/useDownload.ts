import { ref } from 'vue'
import { Effect } from 'effect'
import { DownloadService } from '@/services/downloadService'
import type { DicomStudy } from '@/types/dicom'
import type { RuntimeType } from '@/types/effects'
import { toast } from 'vue-sonner'

export function useDownload(runtime: RuntimeType) {
  const isDownloading = ref(false)

  const downloadSelectedStudies = async (studies: DicomStudy[], selectedStudies: DicomStudy[]) => {
    if (selectedStudies.length === 0) {
      toast.warning('No studies selected for download')
      return
    }

    isDownloading.value = true

    try {
      const studyIds = selectedStudies.map(study => study.studyInstanceUID)

      toast.info(`Starting download of ${selectedStudies.length} study(ies)...`)

      const blob = await runtime.runPromise(
        Effect.gen(function* () {
          const downloadService = yield* DownloadService
          return yield* downloadService.packageStudiesForDownload(studies, studyIds)
        })
      )

      // Create download link and trigger download
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[:]/g, '-')
      const filename = selectedStudies.length === 1
        ? `DICOM_Study_${selectedStudies[0].patientId || 'Unknown'}_${timestamp}.zip`
        : `DICOM_Studies_${selectedStudies.length}_${timestamp}.zip`

      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`Successfully downloaded ${selectedStudies.length} study(ies)`)
    } catch (error) {
      console.error('Download failed:', error)
      toast.error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      isDownloading.value = false
    }
  }

  return {
    isDownloading,
    downloadSelectedStudies
  }
}
