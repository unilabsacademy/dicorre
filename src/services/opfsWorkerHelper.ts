/**
 * OPFS Helper for Worker Threads
 * Provides direct OPFS access without Effect framework dependencies
 */

export interface OPFSFile {
  id: string
  size: number
  handle?: FileSystemFileHandle
}

export class OPFSWorkerHelper {
  private static rootDirName = 'dicom-files'
  private static rootDirHandle: FileSystemDirectoryHandle | null = null

  /**
   * Check if OPFS is supported
   */
  static isSupported(): boolean {
    return 'storage' in navigator && 'getDirectory' in navigator.storage
  }

  /**
   * Initialize OPFS root directory
   */
  static async init(): Promise<void> {
    if (this.rootDirHandle) return

    if (!this.isSupported()) {
      throw new Error('OPFS is not supported in this browser')
    }

    const root = await navigator.storage.getDirectory()
    this.rootDirHandle = await root.getDirectoryHandle(this.rootDirName, { create: true })
    console.log('[OPFS] Initialized root directory')
  }

  /**
   * Save file to OPFS
   */
  static async saveFile(fileId: string, arrayBuffer: ArrayBuffer): Promise<void> {
    await this.init()
    
    const fileHandle = await this.rootDirHandle!.getFileHandle(fileId, { create: true })
    const writable = await fileHandle.createWritable()
    
    try {
      await writable.write(arrayBuffer)
      console.log(`[OPFS] Saved file ${fileId} (${arrayBuffer.byteLength} bytes)`)
    } finally {
      await writable.close()
    }
  }

  /**
   * Load file from OPFS
   */
  static async loadFile(fileId: string): Promise<ArrayBuffer> {
    await this.init()
    
    try {
      const fileHandle = await this.rootDirHandle!.getFileHandle(fileId)
      const file = await fileHandle.getFile()
      const arrayBuffer = await file.arrayBuffer()
      console.log(`[OPFS] Loaded file ${fileId} (${arrayBuffer.byteLength} bytes)`)
      return arrayBuffer
    } catch (error) {
      throw new Error(`Failed to load file ${fileId} from OPFS: ${error.message}`)
    }
  }

  /**
   * Delete file from OPFS
   */
  static async deleteFile(fileId: string): Promise<void> {
    await this.init()
    
    try {
      await this.rootDirHandle!.removeEntry(fileId)
      console.log(`[OPFS] Deleted file ${fileId}`)
    } catch (error) {
      console.warn(`[OPFS] Failed to delete file ${fileId}:`, error)
    }
  }

  /**
   * Check if file exists in OPFS
   */
  static async fileExists(fileId: string): Promise<boolean> {
    await this.init()
    
    try {
      await this.rootDirHandle!.getFileHandle(fileId)
      return true
    } catch {
      return false
    }
  }

  /**
   * List all files in OPFS
   */
  static async listFiles(): Promise<string[]> {
    await this.init()
    
    const files: string[] = []
    for await (const [name, handle] of this.rootDirHandle!.entries()) {
      if (handle.kind === 'file') {
        files.push(name)
      }
    }
    return files
  }

  /**
   * Get storage info
   */
  static async getStorageInfo(): Promise<{ used: number; quota: number }> {
    const estimate = await navigator.storage.estimate()
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0
    }
  }

  /**
   * Clear all files from OPFS
   */
  static async clearAllFiles(): Promise<void> {
    await this.init()
    
    const files = await this.listFiles()
    await Promise.all(files.map(fileId => this.deleteFile(fileId)))
    console.log(`[OPFS] Cleared ${files.length} files`)
  }

  /**
   * Load file data into DicomFile object (on-demand loading)
   */
  static async loadIntoFile(file: any): Promise<any> {
    if (!file.opfsFileId) {
      throw new Error(`File ${file.id} has no OPFS file ID`)
    }

    if (file.arrayBuffer.byteLength > 0) {
      // Already loaded
      return file
    }

    console.log(`[OPFS] Loading file data on-demand: ${file.fileName} (${file.opfsFileId})`)
    const arrayBuffer = await this.loadFile(file.opfsFileId)
    
    return {
      ...file,
      arrayBuffer,
      fileSize: arrayBuffer.byteLength
    }
  }

  /**
   * Get current file state from OPFS (source of truth)
   */
  static async getCurrentFileState(fileId: string, fileName: string, possibleOpfsIds: string[]): Promise<any | null> {
    for (const opfsFileId of possibleOpfsIds) {
      if (await this.fileExists(opfsFileId)) {
        const arrayBuffer = await this.loadFile(opfsFileId)
        return {
          id: fileId,
          fileName,
          fileSize: arrayBuffer.byteLength,
          arrayBuffer,
          anonymized: opfsFileId.includes('_anonymized'),
          opfsFileId
        }
      }
    }
    return null
  }
}