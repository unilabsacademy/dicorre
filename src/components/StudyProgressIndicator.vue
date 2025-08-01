<script setup lang="ts">
import { computed } from 'vue'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'

interface Props {
  studyId: string
  totalFiles: number
  anonymizedFiles: number
}

const props = defineProps<Props>()
const { getStudyProgress } = useAnonymizationProgress()

// Get real-time progress from global state
const progressInfo = getStudyProgress(props.studyId)

const status = computed(() => {
  // Use real-time progress info from global state (highest priority)
  if (progressInfo.value?.isProcessing) {
    return {
      showProgress: true,
      text: `${Math.round(progressInfo.value.progress || 0)}%`,
      variant: 'secondary' as const
    }
  }
  
  // Check if all files are anonymized (use actual file data, not stale props)
  if (props.anonymizedFiles === props.totalFiles && props.anonymizedFiles > 0) {
    return {
      showProgress: false,
      text: 'Anonymized',
      variant: 'default' as const
    }
  }
  
  // Check if some files are anonymized
  if (props.anonymizedFiles > 0) {
    return {
      showProgress: false,
      text: 'Partial',
      variant: 'secondary' as const
    }
  }
  
  return {
    showProgress: false,
    text: 'Not Anonymized',
    variant: 'destructive' as const
  }
})

const progressValue = computed(() => {
  if (progressInfo.value?.isProcessing) {
    return progressInfo.value.progress || 0
  }
  return (props.anonymizedFiles / props.totalFiles) * 100
})
</script>

<template>
  <div class="min-w-[120px]">
    <div v-if="status.showProgress" class="space-y-1">
      <div class="flex justify-between items-center text-xs">
        <span class="text-muted-foreground">Processing...</span>
        <span class="font-medium">{{ status.text }}</span>
      </div>
      <Progress :model-value="progressValue" class="h-1.5" />
    </div>
    
    <Badge v-else :variant="status.variant" class="min-w-[80px] justify-center">
      {{ status.text }}
    </Badge>
  </div>
</template>