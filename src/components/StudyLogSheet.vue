<script setup lang="ts">
import { onMounted, computed, watch, nextTick } from 'vue'
import { useStudyLogs } from '@/composables/useStudyLogs'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

const props = defineProps<{ open: boolean, studyId?: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { getLogs, logsFor } = useStudyLogs()
const entries = computed(() => props.studyId ? logsFor(props.studyId).value : [])

const loadLogs = (studyId: string) => {
  getLogs(studyId)
}

onMounted(() => { 
  if (props.studyId) {
    loadLogs(props.studyId)
  }
})

// Watch for studyId changes (when sheet is opened with different study)
watch(() => props.studyId, (newStudyId, oldStudyId) => {
  if (newStudyId && newStudyId !== oldStudyId) {
    nextTick(() => loadLogs(newStudyId))
  }
}, { immediate: false })

// Also watch for when the sheet opens
watch(() => props.open, (newOpen) => {
  if (newOpen && props.studyId) {
    nextTick(() => loadLogs(props.studyId!))
  }
})

function formatTs(ts: number) {
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}
</script>

<template>
  <Sheet
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <SheetContent
      side="right"
      class="w-[480px]"
      data-testid="study-log-sheet"
    >
      <SheetHeader>
        <SheetTitle>Study Log</SheetTitle>
        <SheetDescription
          v-if="studyId"
          class="font-mono text-xs opacity-60"
        >ID: {{ studyId }}</SheetDescription>
      </SheetHeader>
      <div class="mt-4 space-y-2 max-h-[70vh] overflow-auto">
        <div
          v-if="entries.length === 0"
          class="text-sm text-muted-foreground"
          data-testid="log-no-entries"
        >No entries</div>
        <div
          v-for="(e, idx) in entries"
          :key="idx"
          class="text-xs"
          :data-testid="`log-entry-${e.level}`"
        >
          <div>
            <span class="font-mono text-[10px] opacity-60">{{ formatTs(e.ts) }}</span>
            <span
              class="ml-2"
              :class="e.level === 'error' ? 'text-red-600' : (e.level === 'warn' ? 'text-amber-600' : 'text-foreground')"
            >
              {{ e.message }}
            </span>
          </div>
          <div
            v-if="e.details"
            class="font-mono text-[10px] opacity-70 break-all"
          >{{ String(e.details) }}</div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

</template>
