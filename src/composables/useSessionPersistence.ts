import { ref, watch, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { Effect, Layer } from 'effect'
import { OPFSStorage, OPFSStorageLive } from '@/services/opfsStorage'
import { DicomProcessor, DicomProcessorLive } from '@/services/dicomProcessor'
import { ConfigServiceLive } from '@/services/config'
import type { DicomFile, DicomFileMetadata, DicomStudy } from '@/types/dicom'

interface PersistedSession {
  files: DicomFileMetadata[]
}

const STORAGE_KEY = 'dicom-session'

// Create the Effect layers for DicomProcessor and OPFSStorage
const processorLayer = Layer.mergeAll(
  DicomProcessorLive,
  ConfigServiceLive
)

const storageLayer = OPFSStorageLive

// Helper to execute an Effect with the processor environment
const runProcessor = <A>(effect: Effect.Effect<A, any, any>) =>
  // @ts-ignore – Effect typing for provideLayer narrows env to never which conflicts with Vue TS config
  Effect.runPromise(effect.pipe(Effect.provide(processorLayer)))

// Helper to execute an Effect with the storage environment
const runStorage = <A>(effect: Effect.Effect<A, any, any>) =>
  // @ts-ignore – Effect typing for provideLayer narrows env to never which conflicts with Vue TS config
  Effect.runPromise(effect.pipe(Effect.provide(storageLayer)))

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

    // Persist binary files that have not yet been stored in OPFS with consistency verification
    for (const file of extractedDicomFiles.value) {
      if (!existingIds.has(file.id)) {
        try {
          await runStorage(
            Effect.gen(function* () {
              const storage = yield* OPFSStorage
              
              // Save file to OPFS
              yield* storage.saveFile(file.id, file.arrayBuffer)
              
              // Verify file was saved correctly by checking it exists
              // This helps ensure OPFS has fully committed the file
              const exists = yield* storage.fileExists(file.id)
              if (!exists) {
                throw new Error(`File verification failed after save: ${file.id}`)
              }
              
              console.log(`File ${file.id} successfully saved and verified in OPFS`)
            })
          )
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
        const arrayBuffer = await runStorage(
          Effect.gen(function* () {
            const storage = yield* OPFSStorage
            return yield* storage.loadFile(meta.id)
          })
        )
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
    
    // Group files using the DicomProcessor service
    const groupedStudies = await runProcessor(
      Effect.gen(function* () {
        const processor = yield* DicomProcessor
        return yield* processor.groupFilesByStudy(restored)
      })
    )
    
    studies.value = groupedStudies
    isRestoring.value = false
  }

  /**
   * Clear persisted session (localStorage + OPFS)
   */
  async function clear() {
    persisted.value = { files: [] }
    try {
      await runStorage(
        Effect.gen(function* () {
          const storage = yield* OPFSStorage
          return yield* storage.clearAllFiles
        })
      )
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
