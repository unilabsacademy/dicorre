<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { Effect, ManagedRuntime } from 'effect'
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
} from '@/components/ui/sheet'
import { ConfigService } from '@/services/config'
import type { DicomFieldOverrides } from '@/types/dicom'

defineProps<{
  open?: boolean
  selectedStudiesCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'apply-overrides': [overrides: DicomFieldOverrides]
}>()

const runtime = inject<ManagedRuntime.ManagedRuntime<any, never>>('appRuntime')
const fieldValues = ref<Record<string, string>>({})
const exposedFields = ref<Array<{
  fieldName: string
  displayName: string
  defaultValue?: string
  type?: string
  options?: readonly string[]
}>>([])

onMounted(() => {
  if (runtime) {
    runtime.runPromise(
      Effect.gen(function* () {
        const configService = yield* ConfigService
        const anonymizationConfig = yield* configService.getAnonymizationConfig
        exposedFields.value = [...(anonymizationConfig.exposedFields || [])]
      })
    ).catch(console.error)
  }
})

function handleApplyOverrides() {
  const overrides: DicomFieldOverrides = {}

  for (const [fieldName, value] of Object.entries(fieldValues.value)) {
    if (value && value.trim()) {
      overrides[fieldName] = value.trim()
    }
  }

  emit('apply-overrides', overrides)
  emit('update:open', false)

  // Clear form after applying
  fieldValues.value = {}
}

function handleCancel() {
  fieldValues.value = {}
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open">
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Edit DICOM Fields</SheetTitle>
        <SheetDescription>
          Override specific DICOM field values for the {{ selectedStudiesCount }} selected {{ selectedStudiesCount === 1
            ? 'study' : 'studies' }}.
          Leave fields empty to use default anonymization values.
        </SheetDescription>
      </SheetHeader>
      <div class="space-y-4 py-4">
        <div
          v-for="field in exposedFields"
          :key="field.fieldName"
          class="space-y-2"
        >
          <Label
            :for="`field-${field.fieldName}`"
            class="text-sm font-medium"
          >
            {{ field.displayName }}
          </Label>
          <Input
            :id="`field-${field.fieldName}`"
            v-model="fieldValues[field.fieldName]"
            :data-testid="`field-override-${field.fieldName}`"
          />
        </div>
      </div>
      <SheetFooter>
        <Button
          variant="outline"
          @click="handleCancel"
          data-testid="field-override-cancel"
        >
          Cancel
        </Button>
        <Button
          @click="handleApplyOverrides"
          data-testid="field-override-apply"
        >
          Apply Overrides
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
