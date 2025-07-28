/**
 * OPFS (Origin Private File System) storage service for binary DICOM files
 * Requires modern browsers (Chrome 86+, Firefox 111+, Safari 15.2+)
 */

export class OPFSStorage {
  private rootDirName = 'dicom-files'
  private rootDirHandle: FileSystemDirectoryHandle | null = null

  /**
   * Initialize the OPFS storage and create root directory
   */
  async init(): Promise<void> {
    try {
      // Get the OPFS root
      const root = await navigator.storage.getDirectory()
      
      // Create or get our app's directory
      this.rootDirHandle = await root.getDirectoryHandle(this.rootDirName, { create: true })
    } catch (error) {
      console.error('Failed to initialize OPFS:', error)
      throw new Error('OPFS is not available. Please use a modern browser.')
    }
  }

  /**
   * Save a binary file to OPFS
   */
  async saveFile(fileId: string, arrayBuffer: ArrayBuffer): Promise<void> {
    if (!this.rootDirHandle) {
      await this.init()
    }

    try {
      // Create file handle
      const fileHandle = await this.rootDirHandle!.getFileHandle(`${fileId}.dcm`, { create: true })
      
      // Create writable stream
      const writable = await fileHandle.createWritable()
      
      // Write the data
      await writable.write(arrayBuffer)
      
      // Close the file
      await writable.close()
    } catch (error) {
      console.error(`Failed to save file ${fileId}:`, error)
      throw error
    }
  }

  /**
   * Load a binary file from OPFS
   */
  async loadFile(fileId: string): Promise<ArrayBuffer> {
    if (!this.rootDirHandle) {
      await this.init()
    }

    try {
      // Get file handle
      const fileHandle = await this.rootDirHandle!.getFileHandle(`${fileId}.dcm`)
      
      // Get file
      const file = await fileHandle.getFile()
      
      // Read as ArrayBuffer
      return await file.arrayBuffer()
    } catch (error) {
      console.error(`Failed to load file ${fileId}:`, error)
      throw error
    }
  }

  /**
   * Delete a file from OPFS
   */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.rootDirHandle) {
      await this.init()
    }

    try {
      await this.rootDirHandle!.removeEntry(`${fileId}.dcm`)
    } catch (error) {
      console.error(`Failed to delete file ${fileId}:`, error)
      throw error
    }
  }

  /**
   * List all stored file IDs
   */
  async listFiles(): Promise<string[]> {
    if (!this.rootDirHandle) {
      await this.init()
    }

    const fileIds: string[] = []
    
    try {
      // Iterate through directory entries
      // @ts-expect-error - values() exists but TypeScript types might be outdated
      for await (const entry of this.rootDirHandle!.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.dcm')) {
          // Remove .dcm extension to get file ID
          fileIds.push(entry.name.slice(0, -4))
        }
      }
    } catch (error) {
      console.error('Failed to list files:', error)
      throw error
    }

    return fileIds
  }

  /**
   * Clear all files from storage
   */
  async clearAllFiles(): Promise<void> {
    if (!this.rootDirHandle) {
      await this.init()
    }

    try {
      // Delete each file
      // @ts-expect-error - values() exists but TypeScript types might be outdated
      for await (const entry of this.rootDirHandle!.values()) {
        if (entry.kind === 'file') {
          await this.rootDirHandle!.removeEntry(entry.name)
        }
      }
    } catch (error) {
      console.error('Failed to clear files:', error)
      throw error
    }
  }

  /**
   * Check if OPFS is supported in the current browser
   */
  static isSupported(): boolean {
    return 'storage' in navigator && 'getDirectory' in navigator.storage
  }

  /**
   * Get storage estimate (used and total quota)
   */
  async getStorageInfo(): Promise<{ used: number; quota: number }> {
    const estimate = await navigator.storage.estimate()
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0
    }
  }
}

// Export singleton instance
export const opfsStorage = new OPFSStorage()