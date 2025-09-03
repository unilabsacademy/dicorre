<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface Props {
  fileName: string
  currentStep: string
  progress: number
  totalFiles?: number
  currentFileIndex?: number
  error?: string
  isIndividualFile?: boolean
  showCancelButton?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  cancel: []
}>()

const progressText = computed(() => {
  if (props.error) {
    return 'Failed'
  }
  if (props.isIndividualFile) {
    return `${Math.round(props.progress)}%`
  }
  if (props.totalFiles && props.currentFileIndex !== undefined) {
    return `${props.currentFileIndex + 1} of ${props.totalFiles} files`
  }
  return `${Math.round(props.progress)}%`
})

const cardClass = computed(() => {
  if (props.error) {
    return 'mb-1 border-destructive/20 bg-destructive/5'
  }
  if (props.isIndividualFile) {
    return 'mb-1 border-primary/15 bg-primary/5'
  }
  return 'mb-2 border-primary/15 bg-primary/5'
})
</script>

<template>
  <Card
    :class="cardClass"
    data-testid="file-processing-progress-card"
  >
    <CardContent :class="isIndividualFile ? 'py-2' : 'py-3'">
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <div
              v-if="!error"
              class="animate-spin h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full"
            ></div>
            <div
              v-else
              class="h-3.5 w-3.5 rounded-full bg-destructive flex items-center justify-center"
            >
              <span class="text-xs text-destructive-foreground">✕</span>
            </div>
            <span class="font-medium text-xs">
              {{ isIndividualFile ? fileName : `Processing ${fileName}` }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <Button
              v-if="showCancelButton && !error"
              variant="outline"
              size="sm"
              class="h-6 px-2 text-xs"
              @click="emit('cancel')"
            >
              Cancel
            </Button>
            <div class="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{{ progressText }}</span>
            </div>
          </div>
        </div>

        <Progress
          :model-value="progress"
          :class="isIndividualFile ? 'h-1' : 'h-1.5'"
        />

        <div class="text-[11px] text-muted-foreground">
          {{ currentStep }}
        </div>

        <Alert
          v-if="error"
          class="mt-2 py-2"
        >
          <AlertDescription class="text-xs">
            {{ error }}
          </AlertDescription>
        </Alert>
      </div>
    </CardContent>
  </Card>
</template>
