<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Pencil } from 'lucide-vue-next'
import type { ProjectConfig } from '@/services/config/schema'

const props = defineProps<{
  currentProject?: ProjectConfig
  open?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  createProject: [name: string]
}>()

const projectName = ref('')
const isProcessing = ref(false)

watch(() => props.open, (newOpen) => {
  if (newOpen) {
    // Set default project name when opening - only if there's a current project
    projectName.value = props.currentProject?.name || ''
  }
})

async function handleSaveProject() {
  if (!projectName.value.trim()) {
    return
  }

  isProcessing.value = true
  try {
    emit('createProject', projectName.value.trim())
    emit('update:open', false)
  } catch (error) {
    console.error('Failed to save project:', error)
  } finally {
    isProcessing.value = false
  }
}

function handleCancel() {
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" @update:open="$emit('update:open', $event)">
    <SheetTrigger asChild>
      <Button
        variant="outline"
        data-testid="edit-project-button"
      >
        <Pencil class="w-4 h-4" />
      </Button>
    </SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>
          {{ currentProject ? 'Edit Project' : 'Create New Project' }}
        </SheetTitle>
        <SheetDescription>
          {{ currentProject 
            ? 'Edit your project configuration.'
            : 'Save your current configuration as a named project that can be shared with others.'
          }}
        </SheetDescription>
      </SheetHeader>
      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <Label
            for="project-name"
            class="text-sm font-medium"
          >Project Name</Label>
          <Input
            id="project-name"
            v-model="projectName"
            :placeholder="currentProject ? 'Enter project name...' : 'Enter project name (e.g., Untitled)...'"
            @keyup.enter="handleSaveProject"
            :disabled="isProcessing"
            data-testid="project-name-input"
          />
        </div>
      </div>
      <SheetFooter>
        <Button
          variant="outline"
          @click="handleCancel"
          :disabled="isProcessing"
          data-testid="cancel-project-button"
        >
          Cancel
        </Button>
        <Button
          @click="handleSaveProject"
          :disabled="isProcessing || !projectName.trim()"
          data-testid="save-project-button"
        >
          {{ isProcessing ? 'Creating...' : 'Create Project' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>