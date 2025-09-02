<script setup lang="ts">
import { computed } from 'vue'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useAnonymizationProgress } from '@/composables/useAnonymizationProgress'
import { useSendingProgress } from '@/composables/useSendingProgress'

interface Props {
  studyId: string
  totalFiles: number
  anonymizedFiles?: number
  sentFiles?: number
  showOnly?: 'anonymization' | 'sending'
}

const props = defineProps<Props>()
const { getStudyProgress } = useAnonymizationProgress()
const { getStudySendingProgress } = useSendingProgress()

// Get real-time progress from global state
const progressInfo = getStudyProgress(props.studyId)
const sendingProgressInfo = getStudySendingProgress(props.studyId)

const status = computed(() => {
  // Handle showOnly logic
  if (props.showOnly === 'sending') {
    // Sending-only column
    if (sendingProgressInfo.value?.isProcessing) {
      return {
        showProgress: true,
        text: `${Math.round(sendingProgressInfo.value.progress || 0)}%`,
        variant: 'secondary' as const
      }
    }

    if (props.sentFiles === props.totalFiles && props.sentFiles > 0) {
      return {
        showProgress: false,
        text: 'Sent',
        variant: 'default' as const
      }
    }

    if ((props.sentFiles || 0) > 0) {
      return {
        showProgress: false,
        text: 'Partial',
        variant: 'secondary' as const
      }
    }

    return {
      showProgress: false,
      text: 'Not Sent',
      variant: 'destructive' as const
    }
  }

  if (props.showOnly === 'anonymization') {
    // Anonymization-only column
    if (progressInfo.value?.isProcessing) {
      return {
        showProgress: true,
        text: `${Math.round(progressInfo.value.progress || 0)}%`,
        variant: 'secondary' as const
      }
    }

    if (props.anonymizedFiles === props.totalFiles && props.anonymizedFiles > 0) {
      return {
        showProgress: false,
        text: 'Anonymized',
        variant: 'default' as const
      }
    }

    if ((props.anonymizedFiles || 0) > 0) {
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
  }

  // Original combined logic (fallback)
  if (sendingProgressInfo.value?.isProcessing) {
    return {
      showProgress: true,
      text: `Sending ${Math.round(sendingProgressInfo.value.progress || 0)}%`,
      variant: 'secondary' as const
    }
  }

  if (progressInfo.value?.isProcessing) {
    return {
      showProgress: true,
      text: `${Math.round(progressInfo.value.progress || 0)}%`,
      variant: 'secondary' as const
    }
  }

  if (props.sentFiles === props.totalFiles && props.sentFiles > 0) {
    return {
      showProgress: false,
      text: 'Sent',
      variant: 'default' as const
    }
  }

  if ((props.sentFiles || 0) > 0) {
    return {
      showProgress: false,
      text: 'Partial Sent',
      variant: 'secondary' as const
    }
  }

  if ((props.anonymizedFiles || 0) === props.totalFiles && (props.anonymizedFiles || 0) > 0) {
    return {
      showProgress: false,
      text: 'Anonymized',
      variant: 'default' as const
    }
  }

  if ((props.anonymizedFiles || 0) > 0) {
    return {
      showProgress: false,
      text: 'Partial',
      variant: 'secondary' as const
    }
  }

  return {
    showProgress: false,
    text: 'Not Processed',
    variant: 'destructive' as const
  }
})

const progressValue = computed(() => {
  if (props.showOnly === 'sending') {
    if (sendingProgressInfo.value?.isProcessing) {
      return sendingProgressInfo.value.progress || 0
    }
    return ((props.sentFiles || 0) / props.totalFiles) * 100
  }

  if (props.showOnly === 'anonymization') {
    if (progressInfo.value?.isProcessing) {
      return progressInfo.value.progress || 0
    }
    return ((props.anonymizedFiles || 0) / props.totalFiles) * 100
  }

  // Original combined logic
  if (sendingProgressInfo.value?.isProcessing) {
    return sendingProgressInfo.value.progress || 0
  }
  if (progressInfo.value?.isProcessing) {
    return progressInfo.value.progress || 0
  }
  return ((props.anonymizedFiles || 0) / props.totalFiles) * 100
})
</script>

<template>
  <div class="min-w-[120px]">
    <div
      v-if="status.showProgress"
      class="space-y-1"
    >
      <div class="flex justify-between items-center text-xs">
        <span class="text-muted-foreground">Processing...</span>
        <span class="font-medium">{{ status.text }}</span>
      </div>
      <Progress
        :model-value="progressValue"
        class="h-1.5"
      />
    </div>

    <Badge
      v-else
      :variant="status.variant"
      class="min-w-[80px] justify-center"
    >
      {{ status.text }}
    </Badge>
  </div>
</template>
