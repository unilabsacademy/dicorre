<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X } from 'lucide-vue-next'
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
  updateProject: [project: ProjectConfig]
}>()

const projectName = ref('')
const isProcessing = ref(false)
type ParamRow = { key: string; value: string }
const params = ref<ParamRow[]>([])

watch(() => props.open, (newOpen) => {
  if (newOpen) {
    // Set default project name when opening - only if there's a current project
    projectName.value = props.currentProject?.name || ''
    const existing = ((props.currentProject as any)?.plugins?.settings?.['sent-notifier']?.params || {}) as Record<string, string>
    params.value = Object.entries(existing).map(([key, value]) => ({ key, value: String(value ?? '') }))
  }
})

function toRecord(rows: ParamRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

function addParam() {
  params.value = [...params.value, { key: '', value: '' }]
}

function removeParam(index: number) {
  params.value = params.value.filter((_, i) => i !== index)
}

async function handleSaveProject() {
  if (!projectName.value.trim()) {
    return
  }

  isProcessing.value = true
  try {
    if (props.currentProject) {
      const next: ProjectConfig = {
        ...props.currentProject,
        name: projectName.value.trim(),
        plugins: {
          ...(props.currentProject.plugins || {}),
          settings: {
            ...(((props.currentProject.plugins as any)?.settings) || {}),
            ['sent-notifier']: {
              ...((((props.currentProject.plugins as any)?.settings) || {})['sent-notifier'] || {}),
              params: toRecord(params.value)
            }
          }
        }
      }
      emit('updateProject', next)
    } else {
      emit('createProject', projectName.value.trim())
    }
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
  <Sheet
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
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
        <div class="space-y-2">
          <Label class="text-sm font-medium">Sent Notifier Parameters</Label>
          <div class="space-y-2">
            <div
              v-for="(row, idx) in params"
              :key="idx"
              class="flex gap-2"
            >
              <Input
                v-model="row.key"
                placeholder="Key"
                :disabled="isProcessing"
              />
              <Input
                v-model="row.value"
                placeholder="Value"
                :disabled="isProcessing"
              />
              <Button
                size="icon"
                variant="outline"
                @click="removeParam(idx)"
                :disabled="isProcessing"
              >
                <X class="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              class="w-full"
              @click="addParam"
              :disabled="isProcessing"
            >Add Parameter</Button>
          </div>
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
          {{ isProcessing ? '...' : 'Save' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
