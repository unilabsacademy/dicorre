<script setup lang="ts">
import { ref, computed } from 'vue'
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
  Upload,
  Layers,
  MoreVertical
} from 'lucide-vue-next'
import { useProjectSharing } from '@/composables/useProjectSharing'
import ConfigLoader from '@/components/ConfigLoader.vue'
import ProjectEditSheet from '@/components/ProjectEditSheet.vue'
import type { ProjectConfig } from '@/services/config/schema'
import type { DicomStudy } from '@/types/dicom'
import { Input } from '@/components/ui/input'

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
  groupSelected: []
  assignPatientId: [patientId: string]
  sendSelected: []
  downloadSelected: []
  clearAll: []
  clearSelected: []
  testConnection: []
  configLoaded: []
  addFiles: [files: File[]]
}>()

const showProjectEditSheet = ref(false)
const showClearProjectDialog = ref(false)
const showClearDialog = ref(false)
const showEditDialog = ref(false)
const editPatientId = ref('')

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

function handleFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  if (files.length > 0) {
    emit('addFiles', files)
    target.value = ''
  }
}

function handleClearConfirm() {
  if (props.selectedStudiesCount > 0) {
    emit('clearSelected')
  } else {
    emit('clearAll')
  }
  showClearDialog.value = false
}

const clearButtonText = computed(() => {
  return props.selectedStudiesCount > 0
    ? 'Clear Selected'
    : 'Clear All'
})

const clearDialogTitle = computed(() => {
  return props.selectedStudiesCount > 0
    ? 'Clear Selected Studies'
    : 'Clear All Studies'
})

const clearDialogDescription = computed(() => {
  return props.selectedStudiesCount > 0
    ? `Are you sure you want to clear the ${props.selectedStudiesCount} selected ${props.selectedStudiesCount === 1 ? 'study' : 'studies'}? This action cannot be undone.`
    : 'Are you sure you want to clear all studies? This action cannot be undone.'
})
</script>

<template>
  <div
    class="flex items-center justify-between"
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

        <AlertDialog
          :open="showClearProjectDialog"
          @update:open="showClearProjectDialog = $event"
        >
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
      <input
        type="file"
        multiple
        @change="handleFileInput"
        class="hidden"
        id="toolbar-file-input"
        data-testid="toolbar-file-input"
      >
      <Button
        asChild
        variant="outline"
        size="sm"
      >
        <label
          for="toolbar-file-input"
          class="cursor-pointer"
          data-testid="toolbar-add-button"
        >
          <Plus class="w-4 h-4 mr-2" />
          Add Files
        </label>
      </Button>
      <Button
        @click="emit('anonymizeSelected')"
        :disabled="props.selectedStudiesCount === 0"
        variant="outline"
        size="sm"
        data-testid="anonymize-button"
      >
        <Shield class="w-4 h-4 mr-2" />
        Anonymize
      </Button>

      <Button
        @click="emit('sendSelected')"
        :disabled="props.isProcessing || props.selectedStudiesCount === 0"
        variant="outline"
        size="sm"
        data-testid="send-button"
      >
        <Send class="w-4 h-4 mr-2" />
        Send
      </Button>

      <Button
        @click="emit('downloadSelected')"
        :disabled="props.isDownloading || props.selectedStudiesCount === 0"
        variant="outline"
        size="sm"
        data-testid="download-button"
      >
        <Download class="w-4 h-4 mr-2" />
        Download
      </Button>

      <AlertDialog
        :open="showClearDialog"
        @update:open="showClearDialog = $event"
      >
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="clear-all-button"
          >
            <Trash2 class="w-4 h-4 mr-2" />
            {{ clearButtonText }}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ clearDialogTitle }}</AlertDialogTitle>
            <AlertDialogDescription>
              {{ clearDialogDescription }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              @click="handleClearConfirm"
              variant="destructive"
              data-testid="confirm-clear"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <!-- Settings Dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="settings-menu-button"
          >
            <MoreVertical class="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            @click="emit('groupSelected')"
            :disabled="props.selectedStudiesCount < 2"
            data-testid="group-menu-item"
          >
            <Layers class="w-4 h-4 mr-2" />
            Group Studies
          </DropdownMenuItem>

          <DropdownMenuItem
            @click="showEditDialog = true"
            :disabled="props.selectedStudiesCount === 0"
            data-testid="edit-patient-id-menu-item"
          >
            <Pencil class="w-4 h-4 mr-2" />
            Edit Patient ID
          </DropdownMenuItem>

          <DropdownMenuSeparator />

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

      <!-- Edit Assigned Patient ID Dialog (moved outside dropdown) -->
      <AlertDialog
        :open="showEditDialog"
        @update:open="showEditDialog = $event"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Assigned Patient ID</AlertDialogTitle>
            <AlertDialogDescription>
              Set the assigned Patient ID for all selected studies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div class="py-2">
            <Input
              placeholder="Enter Patient ID"
              :model-value="editPatientId"
              @update:model-value="(v) => editPatientId = v as string"
              data-testid="edit-patient-id-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              :disabled="!editPatientId"
              @click="emit('assignPatientId', editPatientId); editPatientId = ''; showEditDialog = false"
              data-testid="confirm-assign-patient-id"
            >
              Assign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </div>
</template>
