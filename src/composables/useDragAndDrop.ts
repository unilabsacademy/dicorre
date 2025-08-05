import { ref } from 'vue'

export function useDragAndDrop() {
  // Drag and drop state
  const isDragOver = ref(false)
  const isGlobalDragOver = ref(false)
  const dragCounter = ref(0)

  // Local drag and drop handlers (for drop zone)
  const handleDrop = async (
    event: DragEvent,
    options: {
      onFilesAdded: (files: File[]) => void
      onProcessFiles: (files: File[]) => Promise<void>
    }
  ) => {
    event.preventDefault()
    isDragOver.value = false

    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      const fileArray = Array.from(files)
      options.onFilesAdded(fileArray)

      // Auto-process only the new files
      await options.onProcessFiles(fileArray)
    }
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = true
  }

  const handleDragLeave = () => {
    isDragOver.value = false
  }

  // Global drag and drop handlers (for whole page)
  const handleGlobalDragEnter = (event: DragEvent) => {
    event.preventDefault()
    dragCounter.value++
    if (event.dataTransfer?.types.includes('Files')) {
      isGlobalDragOver.value = true
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    event.preventDefault()
    dragCounter.value--
    if (dragCounter.value === 0) {
      isGlobalDragOver.value = false
    }
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    event.preventDefault()
  }

  const handleGlobalDrop = async (
    event: DragEvent,
    options: {
      onFilesAdded: (files: File[]) => void
      onProcessFiles: (files: File[]) => Promise<void>
    }
  ) => {
    event.preventDefault()
    dragCounter.value = 0
    isGlobalDragOver.value = false

    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      const fileArray = Array.from(files)
      options.onFilesAdded(fileArray)
      await options.onProcessFiles(fileArray)
    }
  }

  // File input handler
  const handleFileInput = async (
    event: Event,
    options: {
      onFilesAdded: (files: File[]) => void
      onProcessFiles: (files: File[]) => Promise<void>
    }
  ) => {
    const target = event.target as HTMLInputElement
    if (target.files) {
      const files = Array.from(target.files)
      options.onFilesAdded(files)

      // Auto-process only the new files
      await options.onProcessFiles(files)
    }
  }

  const resetDragState = () => {
    isDragOver.value = false
    isGlobalDragOver.value = false
    dragCounter.value = 0
  }

  return {
    // State
    isDragOver,
    isGlobalDragOver,
    dragCounter,
    // Event handlers
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleGlobalDragEnter,
    handleGlobalDragLeave,
    handleGlobalDragOver,
    handleGlobalDrop,
    handleFileInput,
    // Utilities
    resetDragState
  }
}