<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Folder, Link, X, Plus } from 'lucide-vue-next'
import { useProjectSharing } from '@/composables/useProjectSharing'
import type { ProjectConfig } from '@/services/config/schema'

const props = defineProps<{
  currentProject?: ProjectConfig
  isProjectMode: boolean
  onCreateProject: (name: string) => Promise<void>
  onClearProject: () => Promise<void>
}>()

const showCreateDialog = ref(false)
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
    await props.onCreateProject(projectName.value.trim())
    showCreateDialog.value = false
    projectName.value = ''
  } catch (error) {
    console.error('Failed to create project:', error)
  } finally {
    isCreating.value = false
  }
}

async function handleShareProject() {
  await copyShareableUrl()
}

async function handleClearProject() {
  if (confirm('Are you sure you want to clear the current project and return to default settings?')) {
    await props.onClearProject()
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Active Project Display -->
    <Card
      v-if="props.isProjectMode"
      class="border-primary/20 bg-primary/5"
      data-testid="project-toolbar"
    >
      <CardContent class="py-4">
        <div class="flex items-center justify-between">
          <!-- Project Info -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <Folder class="h-5 w-5 text-primary" />
              <div>
                <h2
                  class="text-lg font-semibold text-primary"
                  data-testid="project-title"
                >
                  {{ props.currentProject?.name }}
                </h2>
                <p
                  class="text-sm text-muted-foreground"
                  data-testid="project-created-at"
                >
                  Created {{ formattedCreatedAt }}
                </p>
              </div>
            </div>
            <Badge
              variant="secondary"
              class="ml-2"
            >
              Project Active
            </Badge>
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

      <Button
        @click="showCreateDialog = true"
        variant="outline"
        size="sm"
        data-testid="create-project-button"
      >
        <Plus class="mr-2 h-4 w-4" />
        Create Project
      </Button>
    </div>

    <!-- Create Project Form -->
    <Card
      v-if="showCreateDialog"
      class="border-primary/20"
      data-testid="create-project-form"
    >
      <CardHeader class="pb-3">
        <CardTitle class="text-lg">Create New Project</CardTitle>
        <CardDescription>
          Save your current configuration as a named project that can be shared with others.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div class="space-y-2">
            <label
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
          <div class="flex gap-2">
            <Button
              variant="outline"
              @click="showCreateDialog = false"
              :disabled="isCreating"
              class="flex-1"
              data-testid="cancel-create-button"
            >
              Cancel
            </Button>
            <Button
              @click="handleCreateProject"
              :disabled="isCreating || !projectName.trim()"
              class="flex-1"
              data-testid="confirm-create-button"
            >
              {{ isCreating ? 'Creating...' : 'Create Project' }}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
