<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Effect } from 'effect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Settings2, X, Plus, Trash2 } from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { appConfigEditSchema, type FieldSchema, type ConfigEditSchema, shouldShowField } from '@/services/config/editSchema'
import type { RuntimeType } from '@/types/effects'
import { toast } from 'vue-sonner'
import type { ProjectConfig } from '@/services/config/schema'

const props = defineProps<{
  open: boolean
  runtime: RuntimeType
  currentProject?: ProjectConfig
  isProjectMode: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'config-updated': []
  'create-project': [name: string]
  'update-project': [project: ProjectConfig]
}>()

const isProcessing = ref(false)
const editedConfig = ref<any>({})
const expandedSections = ref<Set<string>>(new Set(['project', 'dicomServer']))

// Project-specific state
const projectName = ref('')
type ParamRow = { key: string; value: string }
const params = ref<ParamRow[]>([])

function toggleSection(section: string) {
  if (expandedSections.value.has(section)) {
    expandedSections.value.delete(section)
  } else {
    expandedSections.value.add(section)
  }
}

// Project-related functions
watch(() => props.open, (newOpen) => {
  if (newOpen) {
    // Set project data when opening
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
          ...props.currentProject.plugins,
          settings: {
            ...((props.currentProject.plugins as any)?.settings),
            ['sent-notifier']: {
              ...(((props.currentProject.plugins as any)?.settings) || {})['sent-notifier'],
              params: toRecord(params.value)
            }
          }
        }
      }
      emit('update-project', next)
    } else {
      emit('create-project', projectName.value.trim())
    }
    toast.success('Project saved successfully')
  } catch (error) {
    console.error('Failed to save project:', error)
    toast.error('Failed to save project', {
      description: error instanceof Error ? error.message : 'Unknown error'
    })
  } finally {
    isProcessing.value = false
  }
}

function getFieldValue(path: string): any {
  const parts = path.split('.')
  let value = editedConfig.value
  for (const part of parts) {
    value = value?.[part]
  }
  return value
}

function setFieldValue(path: string, value: any) {
  const parts = path.split('.')
  const lastPart = parts.pop()!
  let obj = editedConfig.value
  for (const part of parts) {
    if (!obj[part]) obj[part] = {}
    obj = obj[part]
  }
  obj[lastPart] = value
}

function addArrayItem(path: string) {
  const current = getFieldValue(path) || []
  setFieldValue(path, [...current, ''])
}

function removeArrayItem(path: string, index: number) {
  const current = getFieldValue(path) || []
  setFieldValue(path, current.filter((_: any, i: number) => i !== index))
}

function updateArrayItem(path: string, index: number, value: string) {
  const current = getFieldValue(path) || []
  const updated = [...current]
  updated[index] = value
  setFieldValue(path, updated)
}

function addRecordItem(path: string) {
  const current = getFieldValue(path) || {}
  const newKey = `key_${Date.now()}`
  setFieldValue(path, { ...current, [newKey]: '' })
}

function removeRecordItem(path: string, key: string | number) {
  const current = getFieldValue(path) || {}
  const { [key]: _, ...rest } = current
  setFieldValue(path, rest)
}

function updateRecordKey(path: string, oldKey: string | number, newKey: string) {
  const current = getFieldValue(path) || {}
  if (oldKey === newKey) return

  const value = current[oldKey]
  const { [oldKey]: _, ...rest } = current
  setFieldValue(path, { ...rest, [newKey]: value })
}

function updateRecordValue(path: string, key: string | number, value: string) {
  const current = getFieldValue(path) || {}
  setFieldValue(path, { ...current, [key]: value })
}

function toggleMultiselectOption(path: string, option: string) {
  const current = getFieldValue(path) || []
  const index = current.indexOf(option)
  if (index === -1) {
    setFieldValue(path, [...current, option])
  } else {
    setFieldValue(path, current.filter((v: string) => v !== option))
  }
}

async function handleSaveConfig() {
  isProcessing.value = true
  try {
    // Clean up the config before saving
    const configToSave = { ...editedConfig.value }

    // Handle auth - if type is 'none', set auth to null
    if (configToSave.dicomServer?.auth?.type === 'none') {
      configToSave.dicomServer.auth = null
    }

    // Update config through the config service
    await props.runtime.runPromise(
      Effect.gen(function* () {
        const configModule = yield* Effect.tryPromise({
          try: () => import('@/services/config'),
          catch: () => new Error('Failed to import ConfigService')
        })

        const configService = yield* configModule.ConfigService
        yield* configService.loadConfig(configToSave)
      })
    )

    toast.success('Configuration saved successfully')
    emit('config-updated')
    emit('update:open', false)
  } catch (error) {
    console.error('Failed to save configuration:', error)
    toast.error('Failed to save configuration', {
      description: error instanceof Error ? error.message : 'Unknown error'
    })
  } finally {
    isProcessing.value = false
  }
}

function handleCancel() {
  emit('update:open', false)
}

// Render different field types
function renderField(schema: FieldSchema, path: string, level: number = 0): any {
  const value = getFieldValue(path)

  if (!shouldShowField(path, editedConfig.value)) {
    return null
  }

  switch (schema.type) {
    case 'text':
      return {
        component: 'input',
        value,
        placeholder: schema.placeholder,
        pattern: schema.pattern,
        required: schema.required
      }

    case 'number':
      return {
        component: 'number',
        value,
        min: schema.min,
        max: schema.max,
        placeholder: schema.placeholder,
        required: schema.required
      }

    case 'boolean':
      return {
        component: 'checkbox',
        value
      }

    case 'select':
      return {
        component: 'select',
        value: value || 'none',
        options: schema.options
      }

    case 'multiselect':
      return {
        component: 'multiselect',
        value: value || [],
        options: schema.options
      }

    case 'array':
      return {
        component: 'array',
        value: value || [],
        itemType: schema.itemType
      }

    case 'record':
      return {
        component: 'record',
        value: value || {},
        valueType: schema.valueType
      }

    default:
      return null
  }
}
</script>

<template>
  <Sheet :open="open">
    <SheetContent
      side="left"
      class="w-[600px] sm:max-w-[600px] overflow-y-auto"
    >
      <SheetHeader>
        <SheetTitle>Settings</SheetTitle>
        <SheetDescription>
          Configure project settings and application configuration.
        </SheetDescription>
      </SheetHeader>

      <div
        class="space-y-4 py-4"
        v-if="editedConfig"
      >
        <!-- Project Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('project')"
          >
            <CardTitle class="text-base">Project Settings</CardTitle>
            <CardDescription>Configure project name and plugin parameters</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('project')">
            <div class="space-y-4">
              <!-- Project Name -->
              <div class="space-y-2">
                <Label
                  for="project-name"
                  class="text-sm font-medium"
                >Project Name</Label>
                <div class="flex gap-2">
                  <Input
                    id="project-name"
                    v-model="projectName"
                    :placeholder="currentProject ? 'Enter project name...' : 'Enter project name (e.g., Untitled)...'"
                    :disabled="isProcessing"
                    class="flex-1"
                  />
                  <Button
                    @click="handleSaveProject"
                    :disabled="isProcessing || !projectName.trim()"
                    size="sm"
                  >
                    {{ isProcessing ? '...' : (currentProject ? 'Update' : 'Create') }}
                  </Button>
                </div>
              </div>

              <!-- Sent Notifier Parameters -->
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
                    size="sm"
                    @click="addParam"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Parameter
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <!-- DICOM Server Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('dicomServer')"
          >
            <CardTitle class="text-base">DICOM Server</CardTitle>
            <CardDescription>Configure DICOM server connection settings</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('dicomServer')">
            <div class="space-y-4">
              <!-- Server URL -->
              <div class="space-y-2">
                <Label>Server URL</Label>
                <Input
                  :value="getFieldValue('dicomServer.url')"
                  @input="setFieldValue('dicomServer.url', ($event.target as HTMLInputElement).value)"
                  placeholder="/api/orthanc/dicom-web"
                  :disabled="isProcessing"
                />
                <p class="text-xs text-muted-foreground">Must start with / or http</p>
              </div>

              <!-- Timeout -->
              <div class="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  :value="getFieldValue('dicomServer.timeout')"
                  @input="setFieldValue('dicomServer.timeout', parseInt(($event.target as HTMLInputElement).value) || 30000)"
                  placeholder="30000"
                  min="1000"
                  max="600000"
                  :disabled="isProcessing"
                />
              </div>

              <!-- Authentication -->
              <div class="space-y-2">
                <Label>Authentication Type</Label>
                <select
                  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  :value="getFieldValue('dicomServer.auth.type') || 'none'"
                  @change="setFieldValue('dicomServer.auth.type', ($event.target as HTMLSelectElement).value)"
                  :disabled="isProcessing"
                >
                  <option value="none">None</option>
                  <option value="basic">Basic Auth</option>
                  <option value="bearer">Bearer Token</option>
                </select>
              </div>

              <!-- Credentials (shown only if auth type is not 'none') -->
              <div
                v-if="getFieldValue('dicomServer.auth.type') && getFieldValue('dicomServer.auth.type') !== 'none'"
                class="space-y-2"
              >
                <Label>Credentials</Label>
                <Input
                  :value="getFieldValue('dicomServer.auth.credentials')"
                  @input="setFieldValue('dicomServer.auth.credentials', ($event.target as HTMLInputElement).value)"
                  :placeholder="getFieldValue('dicomServer.auth.type') === 'basic' ? 'username:password' : 'Bearer token'"
                  :disabled="isProcessing"
                />
              </div>

              <!-- Description -->
              <div class="space-y-2">
                <Label>Description</Label>
                <Input
                  :value="getFieldValue('dicomServer.description')"
                  @input="setFieldValue('dicomServer.description', ($event.target as HTMLInputElement).value)"
                  placeholder="Optional server description"
                  :disabled="isProcessing"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Anonymization Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('anonymization')"
          >
            <CardTitle class="text-base">Anonymization</CardTitle>
            <CardDescription>Configure DICOM anonymization settings</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('anonymization')">
            <div class="space-y-4">
              <!-- Profile Options -->
              <div class="space-y-2">
                <Label>Anonymization Profiles</Label>
                <div class="space-y-2 max-h-60 overflow-y-auto border rounded-md p-2">
                  <div
                    v-for="option in ((appConfigEditSchema.anonymization as ConfigEditSchema).profileOptions as FieldSchema).options || []"
                    :key="option.value"
                    class="flex items-start space-x-2"
                  >
                    <Checkbox
                      :checked="(getFieldValue('anonymization.profileOptions') || []).includes(option.value)"
                      @update:checked="toggleMultiselectOption('anonymization.profileOptions', option.value)"
                      :disabled="isProcessing"
                    />
                    <Label class="text-sm font-normal cursor-pointer">{{ option.label }}</Label>
                  </div>
                </div>
              </div>

              <!-- Boolean options -->
              <div class="space-y-2">
                <div class="flex items-center space-x-2">
                  <Checkbox
                    :checked="getFieldValue('anonymization.removePrivateTags')"
                    @update:checked="setFieldValue('anonymization.removePrivateTags', $event)"
                    :disabled="isProcessing"
                  />
                  <Label>Remove Private Tags</Label>
                </div>

                <div class="flex items-center space-x-2">
                  <Checkbox
                    :checked="getFieldValue('anonymization.useCustomHandlers')"
                    @update:checked="setFieldValue('anonymization.useCustomHandlers', $event)"
                    :disabled="isProcessing"
                  />
                  <Label>Use Custom Handlers</Label>
                </div>
              </div>

              <!-- Date Jitter -->
              <div class="space-y-2">
                <Label>Date Jitter (days)</Label>
                <Input
                  type="number"
                  :value="getFieldValue('anonymization.dateJitterDays')"
                  @input="setFieldValue('anonymization.dateJitterDays', parseInt(($event.target as HTMLInputElement).value) || 0)"
                  placeholder="31"
                  min="0"
                  max="365"
                  :disabled="isProcessing"
                />
              </div>

              <!-- Organization Root -->
              <div class="space-y-2">
                <Label>Organization Root OID</Label>
                <Input
                  :value="getFieldValue('anonymization.organizationRoot')"
                  @input="setFieldValue('anonymization.organizationRoot', ($event.target as HTMLInputElement).value)"
                  placeholder="1.2.826.0.1.3680043.8.498"
                  :disabled="isProcessing"
                />
                <p class="text-xs text-muted-foreground">Must be a valid OID (digits and dots only)</p>
              </div>

              <!-- Replacements -->
              <div class="space-y-2">
                <Label>Tag Replacements</Label>
                <div class="space-y-2">
                  <div
                    v-for="(value, key) in (getFieldValue('anonymization.replacements') || {})"
                    :key="key"
                    class="flex gap-2"
                  >
                    <Input
                      :value="key"
                      @input="updateRecordKey('anonymization.replacements', String(key), ($event.target as HTMLInputElement).value)"
                      placeholder="Tag name"
                      :disabled="isProcessing"
                    />
                    <Input
                      :value="value"
                      @input="updateRecordValue('anonymization.replacements', String(key), ($event.target as HTMLInputElement).value)"
                      placeholder="Replacement value"
                      :disabled="isProcessing"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      @click="removeRecordItem('anonymization.replacements', String(key))"
                      :disabled="isProcessing"
                    >
                      <X class="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addRecordItem('anonymization.replacements')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Replacement
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">Use {random} for random values</p>
              </div>

              <!-- Preserve Tags -->
              <div class="space-y-2">
                <Label>Preserve Tags</Label>
                <div class="space-y-2">
                  <div
                    v-for="(tag, index) in (getFieldValue('anonymization.preserveTags') || [])"
                    :key="index"
                    class="flex gap-2"
                  >
                    <Input
                      :value="tag"
                      @input="updateArrayItem('anonymization.preserveTags', index, ($event.target as HTMLInputElement).value)"
                      placeholder="Tag name or hex"
                      :disabled="isProcessing"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      @click="removeArrayItem('anonymization.preserveTags', index)"
                      :disabled="isProcessing"
                    >
                      <X class="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addArrayItem('anonymization.preserveTags')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Tag
                  </Button>
                </div>
              </div>

              <!-- Tags to Remove -->
              <div class="space-y-2">
                <Label>Tags to Remove</Label>
                <div class="space-y-2">
                  <div
                    v-for="(tag, index) in (getFieldValue('anonymization.tagsToRemove') || [])"
                    :key="index"
                    class="flex gap-2"
                  >
                    <Input
                      :value="tag"
                      @input="updateArrayItem('anonymization.tagsToRemove', index, ($event.target as HTMLInputElement).value)"
                      placeholder="Tag pattern"
                      :disabled="isProcessing"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      @click="removeArrayItem('anonymization.tagsToRemove', index)"
                      :disabled="isProcessing"
                    >
                      <X class="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="addArrayItem('anonymization.tagsToRemove')"
                    :disabled="isProcessing"
                  >
                    <Plus class="w-4 h-4 mr-2" />
                    Add Pattern
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">Supports patterns like "startswith:", "contains:"</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Plugins Configuration -->
        <Card>
          <CardHeader
            class="cursor-pointer"
            @click="toggleSection('plugins')"
          >
            <CardTitle class="text-base">Plugins</CardTitle>
            <CardDescription>Configure plugin settings</CardDescription>
          </CardHeader>
          <CardContent v-if="expandedSections.has('plugins')">
            <div class="space-y-4">
              <!-- Enabled Plugins -->
              <div class="space-y-2">
                <Label>Enabled Plugins</Label>
                <div class="space-y-2 border rounded-md p-2">
                  <div
                    v-for="option in ((appConfigEditSchema.plugins as ConfigEditSchema).enabled as FieldSchema).options || []"
                    :key="option.value"
                    class="flex items-center space-x-2"
                  >
                    <Checkbox
                      :checked="(getFieldValue('plugins.enabled') || []).includes(option.value)"
                      @update:checked="toggleMultiselectOption('plugins.enabled', option.value)"
                      :disabled="isProcessing"
                    />
                    <Label class="text-sm font-normal cursor-pointer">{{ option.label }}</Label>
                  </div>
                </div>
              </div>

              <p class="text-sm text-muted-foreground">
                Plugin-specific settings can be configured through project settings.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <SheetFooter>
        <Button
          variant="outline"
          @click="handleCancel"
          :disabled="isProcessing"
        >
          Cancel
        </Button>
        <Button
          @click="handleSaveConfig"
          :disabled="isProcessing"
        >
          {{ isProcessing ? 'Saving...' : 'Save Configuration' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
