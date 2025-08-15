import { Effect, Context, Layer, Schedule } from "effect"
import { StorageError, ValidationError, type StorageErrorType } from '@/types/effects'

export class OPFSStorage extends Context.Tag("OPFSStorage")<
  OPFSStorage,
  {
    readonly saveFile: (fileId: string, arrayBuffer: ArrayBuffer) => Effect.Effect<void, StorageErrorType>
    readonly loadFile: (fileId: string) => Effect.Effect<ArrayBuffer, StorageErrorType>
    readonly fileExists: (fileId: string) => Effect.Effect<boolean, StorageErrorType>
    readonly deleteFile: (fileId: string) => Effect.Effect<void, StorageErrorType>
    readonly listFiles: Effect.Effect<string[], StorageErrorType>
    readonly clearAllFiles: Effect.Effect<void, StorageErrorType>
    readonly getStorageInfo: Effect.Effect<{ used: number; quota: number }, StorageErrorType>
  }
>() {
  static isSupported(): boolean {
    return 'storage' in navigator && 'getDirectory' in navigator.storage
  }
}

class OPFSStorageImpl {
  private static rootDirName = 'dicom-files'
  private static rootDirHandle: FileSystemDirectoryHandle | null = null

  private static initEffect(): Effect.Effect<void, StorageErrorType> {
    return Effect.gen(function* () {
      if (!OPFSStorage.isSupported()) {
        return yield* Effect.fail(new StorageError({
          message: 'OPFS is not supported in this browser',
          operation: 'init'
        }))
      }

      const root = yield* Effect.tryPromise({
        try: () => navigator.storage.getDirectory(),
        catch: (error) => new StorageError({
          message: 'Failed to access OPFS root directory',
          operation: 'init',
          cause: error
        })
      })

      const rootDir = yield* Effect.tryPromise({
        try: () => root.getDirectoryHandle(OPFSStorageImpl.rootDirName, { create: true }),
        catch: (error) => new StorageError({
          message: `Failed to create/access directory: ${OPFSStorageImpl.rootDirName}`,
          operation: 'init',
          cause: error
        })
      })

      OPFSStorageImpl.rootDirHandle = rootDir
    })
  }

  static saveFile = (fileId: string, arrayBuffer: ArrayBuffer): Effect.Effect<void, StorageErrorType> =>
    Effect.gen(function* () {
      // Validate inputs
      if (!fileId || fileId.trim() === '') {
        return yield* Effect.fail(new ValidationError({
          message: 'File ID cannot be empty',
          fileName: fileId
        }))
      }

      if (arrayBuffer.byteLength === 0) {
        return yield* Effect.fail(new ValidationError({
          message: `Cannot save empty file: ${fileId}`,
          fileName: fileId
        }))
      }

      // Ensure initialized
      if (!OPFSStorageImpl.rootDirHandle) {
        yield* OPFSStorageImpl.initEffect()
      }

      // Create file handle
      const fileHandle = yield* Effect.tryPromise({
        try: () => OPFSStorageImpl.rootDirHandle!.getFileHandle(`${fileId}.dcm`, { create: true }),
        catch: (error) => new StorageError({
          message: `Failed to create file handle for: ${fileId}`,
          operation: 'save',
          fileName: fileId,
          cause: error
        })
      })

      // Create writable stream
      const writable = yield* Effect.tryPromise({
        try: () => fileHandle.createWritable(),
        catch: (error) => new StorageError({
          message: `Failed to create writable stream for: ${fileId}`,
          operation: 'save',
          fileName: fileId,
          cause: error
        })
      })

      // Write and close
      yield* Effect.tryPromise({
        try: async () => {
          await writable.write(arrayBuffer)
          await writable.close()
        },
        catch: (error) => new StorageError({
          message: `Failed to write file: ${fileId}`,
          operation: 'save',
          fileName: fileId,
          cause: error
        })
      })
    })

  // Core file loading logic without retry
  private static loadFileCore = (fileId: string): Effect.Effect<ArrayBuffer, StorageErrorType> =>
    Effect.gen(function* () {
      // Validate input
      if (!fileId || fileId.trim() === '') {
        return yield* Effect.fail(new ValidationError({
          message: 'File ID cannot be empty',
          fileName: fileId
        }))
      }

      // Ensure initialized
      if (!OPFSStorageImpl.rootDirHandle) {
        yield* OPFSStorageImpl.initEffect()
      }

      // Get file handle
      const fileHandle = yield* Effect.tryPromise({
        try: () => OPFSStorageImpl.rootDirHandle!.getFileHandle(`${fileId}.dcm`),
        catch: (error) => new StorageError({
          message: `File not found: ${fileId}`,
          operation: 'load',
          fileName: fileId,
          cause: error
        })
      })

      // Get file
      const file = yield* Effect.tryPromise({
        try: () => fileHandle.getFile(),
        catch: (error) => new StorageError({
          message: `Failed to access file: ${fileId}`,
          operation: 'load',
          fileName: fileId,
          cause: error
        })
      })

      // Read as ArrayBuffer
      const arrayBuffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (error) => new StorageError({
          message: `Failed to read file: ${fileId}`,
          operation: 'load',
          fileName: fileId,
          cause: error
        })
      })

      return arrayBuffer
    })

  // Public loadFile with retry logic for race condition protection
  static loadFile = (fileId: string): Effect.Effect<ArrayBuffer, StorageErrorType> =>
    OPFSStorageImpl.loadFileCore(fileId).pipe(
      Effect.retry(
        Schedule.exponential("100 millis").pipe(
          Schedule.intersect(Schedule.recurs(3))
        )
      ),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // Log the final failure after all retries
          yield* Effect.logWarning(`Failed to load file ${fileId} after retries: ${error.message}`)
          return yield* Effect.fail(error)
        })
      )
    )

  // Check if a file exists in OPFS
  static fileExists = (fileId: string): Effect.Effect<boolean, StorageErrorType> =>
    Effect.gen(function* () {
      // Validate input
      if (!fileId || fileId.trim() === '') {
        return yield* Effect.fail(new ValidationError({
          message: 'File ID cannot be empty',
          fileName: fileId
        }))
      }

      // Ensure initialized
      if (!OPFSStorageImpl.rootDirHandle) {
        yield* OPFSStorageImpl.initEffect()
      }

      // Try to get file handle - if it exists, return true, otherwise false
      return yield* Effect.tryPromise({
        try: async () => {
          await OPFSStorageImpl.rootDirHandle!.getFileHandle(`${fileId}.dcm`)
          return true
        },
        catch: () => false // File doesn't exist
      }).pipe(
        Effect.orElse(() => Effect.succeed(false))
      )
    })

  static deleteFile = (fileId: string): Effect.Effect<void, StorageErrorType> =>
    Effect.gen(function* () {
      if (!fileId || fileId.trim() === '') {
        return yield* Effect.fail(new ValidationError({
          message: 'File ID cannot be empty',
          fileName: fileId
        }))
      }

      if (!OPFSStorageImpl.rootDirHandle) {
        yield* OPFSStorageImpl.initEffect()
      }

      yield* Effect.tryPromise({
        try: () => OPFSStorageImpl.rootDirHandle!.removeEntry(`${fileId}.dcm`),
        catch: (error) => new StorageError({
          message: `Failed to delete file: ${fileId}`,
          operation: 'delete',
          fileName: fileId,
          cause: error
        })
      })
    })

  static listFiles: Effect.Effect<string[], StorageErrorType> = Effect.gen(function* () {
    if (!OPFSStorageImpl.rootDirHandle) {
      yield* OPFSStorageImpl.initEffect()
    }

    const fileIds: string[] = []

    const entries = yield* Effect.tryPromise({
      try: async () => {
        const entries = []
        // @ts-expect-error - values() exists but TypeScript types might be outdated
        for await (const entry of OPFSStorageImpl.rootDirHandle!.values()) {
          entries.push(entry)
        }
        return entries
      },
      catch: (error) => new StorageError({
        message: 'Failed to list directory entries',
        operation: 'list',
        cause: error
      })
    })

    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.endsWith('.dcm')) {
        fileIds.push(entry.name.slice(0, -4))
      }
    }

    return fileIds
  })

  static clearAllFiles: Effect.Effect<void, StorageErrorType> = Effect.gen(function* () {
    if (!OPFSStorageImpl.rootDirHandle) {
      yield* OPFSStorageImpl.initEffect()
    }

    const entries = yield* Effect.tryPromise({
      try: async () => {
        const entries = []
        // @ts-expect-error - values() exists but TypeScript types might be outdated
        for await (const entry of OPFSStorageImpl.rootDirHandle!.values()) {
          entries.push(entry)
        }
        return entries
      },
      catch: (error) => new StorageError({
        message: 'Failed to list directory entries for clearing',
        operation: 'clear',
        cause: error
      })
    })

    // Delete files concurrently with Effect
    const deleteOperations = entries
      .filter(entry => entry.kind === 'file')
      .map(entry =>
        Effect.tryPromise({
          try: () => OPFSStorageImpl.rootDirHandle!.removeEntry(entry.name),
          catch: (error) => new StorageError({
            message: `Failed to delete file: ${entry.name}`,
            operation: 'clear',
            fileName: entry.name,
            cause: error
          })
        })
      )

    yield* Effect.all(deleteOperations, { concurrency: 5, batching: true })
  })

  static getStorageInfo: Effect.Effect<{ used: number; quota: number }, StorageErrorType> = Effect.gen(function* () {
    const estimate = yield* Effect.tryPromise({
      try: () => navigator.storage.estimate(),
      catch: (error) => new StorageError({
        message: 'Failed to get storage estimate',
        operation: 'info',
        cause: error
      })
    })

    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0
    }
  })
}

export const OPFSStorageLive = Layer.succeed(
  OPFSStorage,
  OPFSStorage.of({
    saveFile: OPFSStorageImpl.saveFile,
    loadFile: OPFSStorageImpl.loadFile,
    fileExists: OPFSStorageImpl.fileExists,
    deleteFile: OPFSStorageImpl.deleteFile,
    listFiles: OPFSStorageImpl.listFiles,
    clearAllFiles: OPFSStorageImpl.clearAllFiles,
    getStorageInfo: OPFSStorageImpl.getStorageInfo
  })
)

