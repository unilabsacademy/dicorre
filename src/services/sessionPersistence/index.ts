import { Effect, Context, Layer } from "effect"
import { OPFSStorage } from "@/services/opfsStorage"
import { DicomProcessor } from "@/services/dicomProcessor"
import type { DicomFile, DicomFileMetadata, DicomStudy } from "@/types/dicom"

interface PersistedSession {
  files: DicomFileMetadata[]
}

const STORAGE_KEY = 'dicom-session'

export class SessionPersistence extends Context.Tag("SessionPersistence")<
  SessionPersistence,
  {
    readonly persist: (files: ReadonlyArray<DicomFile>) => Effect.Effect<void, never>
    readonly restore: (onProgress?: (progress: number) => void) => Effect.Effect<{ files: DicomFile[]; studies: DicomStudy[] }, never>
    readonly clear: Effect.Effect<void, never>
  }
>() { }

export const SessionPersistenceLive = Layer.scoped(
  SessionPersistence,
  Effect.gen(function* () {
    const storage = yield* OPFSStorage
    const processor = yield* DicomProcessor

    const readPersisted = Effect.sync(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return { files: [] } as PersistedSession
        const parsed = JSON.parse(raw) as PersistedSession
        if (!parsed || !Array.isArray(parsed.files)) return { files: [] }
        return parsed
      } catch {
        return { files: [] }
      }
    })

    const writePersisted = (files: ReadonlyArray<DicomFile>) =>
      Effect.sync(() => {
        const payload: PersistedSession = {
          files: files.map<DicomFileMetadata>((f) => ({
            id: f.id,
            fileName: f.fileName,
            fileSize: f.fileSize,
            metadata: f.metadata,
            anonymized: f.anonymized
          }))
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
        } catch {
          // ignore
        }
      })

    const persist = (files: ReadonlyArray<DicomFile>): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        if (files.length === 0) return

        const existingIds = new Set((yield* readPersisted).files.map((m) => m.id))

        for (const file of files) {
          if (!existingIds.has(file.id)) {
            try {
              const exists = yield* storage.fileExists(file.id)
              if (!exists) {
                yield* storage.saveFile(file.id, file.arrayBuffer)
                const verify = yield* storage.fileExists(file.id)
                if (!verify) {
                  // best-effort; do not fail the persistence effect
                }
              }
            } catch {
              // ignore OPFS failures in persist
            }
          }
        }

        yield* writePersisted(files)
      })

    const restore = (onProgress?: (progress: number) => void): Effect.Effect<{ files: DicomFile[]; studies: DicomStudy[] }, never> =>
      Effect.gen(function* () {
        const persisted = yield* readPersisted
        if (!persisted.files || persisted.files.length === 0) {
          return { files: [], studies: [] }
        }

        const restored: DicomFile[] = []
        for (let idx = 0; idx < persisted.files.length; idx++) {
          const meta = persisted.files[idx]
          try {
            const arrayBuffer = yield* storage.loadFile(meta.id)
            restored.push({
              id: meta.id,
              fileName: meta.fileName,
              fileSize: meta.fileSize,
              arrayBuffer,
              metadata: meta.metadata,
              anonymized: meta.anonymized
            })
          } catch {
            restored.push({
              id: meta.id,
              fileName: meta.fileName,
              fileSize: meta.fileSize,
              arrayBuffer: new ArrayBuffer(0),
              metadata: meta.metadata,
              anonymized: meta.anonymized
            })
          }
          if (onProgress) {
            try {
              onProgress(Math.round(((idx + 1) / persisted.files.length) * 100))
            } catch { }
          }
        }

        const studies = yield* processor.groupFilesByStudy(restored)
        return { files: restored, studies }
      })

    const clear: Effect.Effect<void, never> = Effect.gen(function* () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ files: [] } satisfies PersistedSession))
      } catch { }
      try {
        yield* storage.clearAllFiles
      } catch { }
    })

    return {
      persist,
      restore,
      clear
    } as const
  })
)


