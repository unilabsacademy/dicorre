<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RuntimeType } from '@/types/effects'
import { getAllTagNames } from '@/utils/dicom-tag-dictionary'

const props = defineProps<{
  open: boolean
  runtime: RuntimeType
  initialOverrides?: Record<string, string>
  initialAssignedPatientId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [overrides: Record<string, string>]
  'assign-patient-id': [patientId: string]
}>()

type Row = { key: string; value: string }
const rows = ref<Row[]>([])
const patientId = ref('')
const isProcessing = ref(false)

const allTagNames = getAllTagNames()
const search = ref('')
const filtered = computed(() => {
  const t = search.value.trim().toLowerCase()
  if (!t) return allTagNames
  return allTagNames.filter(n => n.toLowerCase().includes(t))
})

function addRow() {
  rows.value = [...rows.value, { key: '', value: '' }]
}

function removeRow(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
}

function setKey(index: number, key: string) {
  const next = [...rows.value]
  next[index] = { ...next[index], key }
  rows.value = next
}

function setValue(index: number, value: string) {
  const next = [...rows.value]
  next[index] = { ...next[index], value }
  rows.value = next
}

function toRecord(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows.value) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

function fromRecord(rec: Record<string, string>): Row[] {
  return Object.entries(rec).map(([key, value]) => ({ key, value: String(value) }))
}

async function handleSave() {
  isProcessing.value = true
  try {
    if (patientId.value.trim()) {
      emit('assign-patient-id', patientId.value.trim())
    }
    emit('save', toRecord())
    emit('update:open', false)
  } finally {
    isProcessing.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    rows.value = fromRecord(props.initialOverrides ?? {})
    patientId.value = props.initialAssignedPatientId ?? ''
  }
})
</script>

<template>
  <Sheet
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <SheetContent
      side="left"
      class="w-[520px] sm:max-w-[520px] overflow-y-auto"
    >
      <SheetHeader>
        <SheetTitle>Edit Custom DICOM Fields</SheetTitle>
        <SheetDescription>
          Select DICOM fields and set values to override during anonymization.
        </SheetDescription>
      </SheetHeader>

      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <Label>Assigned Patient ID</Label>
          <Input
            v-model="patientId"
            placeholder="Enter Patient ID"
            data-testid="custom-fields-patient-id-input"
          />
        </div>

        <div class="space-y-2">
          <Label>Search Fields</Label>
          <Input
            v-model="search"
            placeholder="Search DICOM fields..."
          />
        </div>

        <div class="space-y-3">
          <div
            v-for="(row, idx) in rows"
            :key="idx"
            class="grid grid-cols-12 gap-2 items-center"
          >
            <div class="col-span-6">
              <select
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                :value="row.key"
                @change="setKey(idx, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Select Field</option>
                <option
                  v-for="name in filtered"
                  :key="name"
                  :value="name"
                >{{ name }}</option>
              </select>
            </div>
            <div class="col-span-5">
              <Input
                :model-value="row.value"
                @update:model-value="(v) => setValue(idx, String(v))"
                placeholder="Value"
              />
            </div>
            <div class="col-span-1">
              <Button
                variant="outline"
                size="icon"
                @click="removeRow(idx)"
              >✕</Button>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            @click="addRow"
          >Add Field</Button>
        </div>
      </div>

      <SheetFooter class="flex sm:justify-between">
        <Button
          variant="outline"
          @click="$emit('update:open', false)"
        >Cancel</Button>
        <Button
          :disabled="isProcessing"
          @click="handleSave"
        >{{ isProcessing ? 'Saving...' : 'Save' }}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>

</template>
