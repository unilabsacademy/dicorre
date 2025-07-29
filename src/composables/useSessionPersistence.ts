import { ref, watch, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { opfsStorage } from '@/services/runtime/opfsStorage'
import { groupDicomFilesByStudy } from '@/utils/dicomGrouping'
import type { DicomFile, DicomFileMetadata, DicomStudy } from '@/types/dicom'

interface PersistedSession {
  files: DicomFileMetadata[]
}

const STORAGE_KEY = 'dicom-session'

export function useSessionPersistence(
  extractedDicomFiles: Ref<DicomFile[]>,
  studies: Ref<DicomStudy[]>
) {
  const isRestoring = ref(false)
  const restoreProgress = ref(0)

  const persisted = useStorage<PersistedSession>(STORAGE_KEY, { files: [] })

  /**
   * Persist current session to localStorage + OPFS
   */
  async function persist() {
    if (extractedDicomFiles.value.length === 0) return

    const existingIds = new Set(persisted.value.files.map((m) => m.id))

    // Persist binary files that have not yet been stored in OPFS
    for (const file of extractedDicomFiles.value) {
      if (!existingIds.has(file.id)) {
        try {
          await opfsStorage.saveFile(file.id, file.arrayBuffer)
        } catch (e) {
          console.warn('Failed to save file to OPFS', file.id, e)
        }
      }
    }

    // Update metadata in localStorage
    persisted.value = {
      files: extractedDicomFiles.value.map<DicomFileMetadata>((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSize: f.fileSize,
        metadata: f.metadata,
        anonymized: f.anonymized
      }))
    }
  }

  // Watch for changes to extracted files and persist automatically
  watch(extractedDicomFiles, persist, { deep: true })

  /**
   * Restore previous session (if any)
   */
  async function restore() {
    if (!persisted.value || !persisted.value.files || persisted.value.files.length === 0) return

    isRestoring.value = true
    const restored: DicomFile[] = []

    for (let idx = 0; idx < persisted.value.files.length; idx++) {
      const meta = persisted.value.files[idx]
      try {
        const arrayBuffer = await opfsStorage.loadFile(meta.id)
        restored.push({
          id: meta.id,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          arrayBuffer,
          metadata: meta.metadata,
          anonymized: meta.anonymized
        })
      } catch (e) {
        console.warn('Failed to load file from OPFS', meta.id, e)
        // Fallback: create placeholder to keep UI counts consistent
        restored.push({
          id: meta.id,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          arrayBuffer: new ArrayBuffer(0),
          metadata: meta.metadata,
          anonymized: meta.anonymized
        })
      }
      restoreProgress.value = Math.round(((idx + 1) / persisted.value.files.length) * 100)
    }

    extractedDicomFiles.value = restored
    studies.value = groupDicomFilesByStudy(restored)
    isRestoring.value = false
  }

  /**
   * Clear persisted session (localStorage + OPFS)
   */
  async function clear() {
    persisted.value = { files: [] }
    try {
      await opfsStorage.clearAllFiles()
    } catch (e) {
      console.warn('Failed to clear OPFS', e)
    }
  }

  return {
    restore,
    clear,
    isRestoring,
    restoreProgress
  }
}
