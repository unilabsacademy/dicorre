<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
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
import { Folder, Link, X, Plus } from 'lucide-vue-next'
import { useProjectSharing } from '@/composables/useProjectSharing'
import type { ProjectConfig } from '@/services/config/schema'

const props = defineProps<{
  currentProject?: ProjectConfig
  isProjectMode: boolean
}>()

const emit = defineEmits<{
  createProject: [name: string]
  clearProject: []
}>()

const showCreateSheet = ref(false)
const projectName = ref('')
const isCreating = ref(false)

const { copyShareableUrl } = useProjectSharing()

const formattedCreatedAt = computed(() => {
  if (!props.currentProject?.createdAt) return ''
  return new Date(props.currentProject.createdAt).toLocaleDateString()
})

async function handleCreateProject() {
  if (!projectName.value.trim()) {
    return
  }

  isCreating.value = true
  try {
    emit('createProject', projectName.value.trim())
    showCreateSheet.value = false
    projectName.value = ''
  } catch (error) {
    console.error('Failed to create project:', error)
  } finally {
    isCreating.value = false
  }
}


async function handleClearProject() {
  if (confirm('Are you sure you want to clear the current project and return to default settings?')) {
    emit('clearProject')
  }
}

async function handleShareProject() {
  await copyShareableUrl()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Active Project Display -->
    <Card
      v-if="props.isProjectMode"
      class="border-primary/20 bg-primary/5 py-4"
      data-testid="project-toolbar"
    >
      <CardContent>
        <div class="flex items-center justify-between">
          <!-- Project Info -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <Folder class="h-5 w-5 text-primary" />
              <div>
                <div data-testid="project-title">
                  Active project:
                  <strong>{{ props.currentProject?.name }}</strong>
                </div>
              </div>
            </div>
          </div>

          <!-- Project Actions -->
          <div class="flex items-center gap-2">
            <Button
              @click="handleShareProject"
              variant="outline"
              size="sm"
              data-testid="share-project-button"
            >
              <Link class="mr-2 h-4 w-4" />
              Copy URL
            </Button>

            <Button
              @click="handleClearProject"
              variant="ghost"
              size="sm"
              title="Clear project"
              data-testid="clear-project-button"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Create Project Section -->
    <div
      v-if="!props.isProjectMode"
      class="flex items-center justify-between bg-muted/30 p-3 rounded-lg border-dashed border-2 border-muted-foreground/30"
    >
      <div class="flex items-center gap-2">
        <Folder class="h-4 w-4 text-muted-foreground" />
        <span class="text-sm text-muted-foreground">No active project</span>
      </div>

      <Sheet v-model:open="showCreateSheet">
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="create-project-button"
          >
            <Plus class="mr-2 h-4 w-4" />
            Create Project
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Create New Project</SheetTitle>
            <SheetDescription>
              Save your current configuration as a named project that can be shared with others.
            </SheetDescription>
          </SheetHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label
                for="project-name"
                class="text-sm font-medium"
              >Project Name</label>
              <Input
                id="project-name"
                v-model="projectName"
                placeholder="Enter project name..."
                @keyup.enter="handleCreateProject"
                :disabled="isCreating"
                data-testid="project-name-input"
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              @click="showCreateSheet = false"
              :disabled="isCreating"
              data-testid="cancel-create-button"
            >
              Cancel
            </Button>
            <Button
              @click="handleCreateProject"
              :disabled="isCreating || !projectName.trim()"
              data-testid="confirm-create-button"
            >
              {{ isCreating ? 'Creating...' : 'Create Project' }}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>

  </div>
</template>
