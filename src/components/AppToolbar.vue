<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Shield,
  Send,
  Trash2,
  Settings2,
  Wifi,
  Download,
  Folder,
  Link,
  X,
  Plus,
  Pencil,
  Upload
} from 'lucide-vue-next'
import { useProjectSharing } from '@/composables/useProjectSharing'
import ConfigLoader from '@/components/ConfigLoader.vue'
import ProjectEditSheet from '@/components/ProjectEditSheet.vue'
import type { ProjectConfig } from '@/services/config/schema'
import type { DicomStudy } from '@/types/dicom'

const props = defineProps<{
  currentProject?: ProjectConfig
  isProjectMode: boolean
  selectedStudiesCount: number
  isProcessing: boolean
  isDownloading: boolean
}>()

const emit = defineEmits<{
  createProject: [name: string]
  clearProject: []
  anonymizeSelected: []
  sendSelected: []
  downloadSelected: []
  clearAll: []
  testConnection: []
  configLoaded: []
}>()

const showProjectEditSheet = ref(false)
const showClearProjectDialog = ref(false)

const { copyShareableUrl } = useProjectSharing()

async function handleCreateProject(name: string) {
  emit('createProject', name)
}

async function handleClearProject() {
  emit('clearProject')
  showClearProjectDialog.value = false
}

async function handleShareProject() {
  await copyShareableUrl()
}
</script>

<template>
  <div
    class="flex items-center justify-between bg-muted/50 p-4 rounded-lg border"
    data-testid="app-toolbar"
  >
    <!-- Left Side: Project Info -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <div class="mr-4 flex gap-2 items-center">
          <Folder class="h-5 w-5 text-primary" />
          <span data-testid="project-title">
            <strong>{{ props.currentProject?.name || 'No active project' }}</strong>
          </span>
        </div>

        <ProjectEditSheet
          :current-project="props.currentProject"
          :open="showProjectEditSheet"
          @update:open="showProjectEditSheet = $event"
          @create-project="handleCreateProject"
        />

        <Button
          @click="handleShareProject"
          variant="outline"
          size="sm"
          :disabled="!isProjectMode"
          data-testid="share-project-button"
        >
          <Link class="h-4 w-4" />
        </Button>

        <AlertDialog :open="showClearProjectDialog" @update:open="showClearProjectDialog = $event">
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              title="Clear project"
              :disabled="!isProjectMode"
              data-testid="clear-project-button"
            >
              <X class="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear Project</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to clear the current project and return to default settings?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                @click="handleClearProject"
                variant="destructive"
                data-testid="confirm-clear-project"
              >
                Clear Project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>

    <!-- Right Side: Actions -->
    <div class="flex items-center gap-2">
      <Button
        @click="emit('anonymizeSelected')"
        :disabled="props.selectedStudiesCount === 0"
        variant="default"
        size="sm"
        data-testid="anonymize-button"
      >
        <Shield class="w-4 h-4 mr-2" />
        Anonymize ({{ props.selectedStudiesCount }})
      </Button>

      <Button
        @click="emit('sendSelected')"
        :disabled="props.isProcessing || props.selectedStudiesCount === 0"
        variant="secondary"
        size="sm"
        data-testid="send-button"
      >
        <Send class="w-4 h-4 mr-2" />
        Send ({{ props.selectedStudiesCount }})
      </Button>

      <Button
        @click="emit('downloadSelected')"
        :disabled="props.isDownloading || props.selectedStudiesCount === 0"
        variant="outline"
        size="sm"
        data-testid="download-button"
      >
        <Download class="w-4 h-4 mr-2" />
        Download ({{ props.selectedStudiesCount }})
      </Button>

      <Button
        @click="emit('clearAll')"
        variant="destructive"
        size="sm"
        data-testid="clear-all-button"
      >
        <Trash2 class="w-4 h-4 mr-2" />
        Clear All
      </Button>

      <!-- Settings Dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="settings-menu-button"
          >
            <Settings2 class="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            @click="emit('testConnection')"
            data-testid="test-connection-menu-item"
          >
            <Wifi class="w-4 h-4 mr-2" />
            Test Connection
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <!-- Load Config in dropdown -->
          <ConfigLoader
            @config-loaded="emit('configLoaded')"
            :as-menu-item="true"
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
