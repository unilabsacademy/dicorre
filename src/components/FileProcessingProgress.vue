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
  startTime?: number
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

const elapsedTime = computed(() => {
  if (!props.startTime) return null
  const elapsed = Math.floor((Date.now() - props.startTime) / 1000)
  if (elapsed < 60) {
    return `${elapsed}s`
  }
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return `${minutes}m ${seconds}s`
})

const cardClass = computed(() => {
  if (props.error) {
    return 'mb-2 border-destructive/20 bg-destructive/5'
  }
  if (props.isIndividualFile) {
    return 'mb-2 border-primary/20 bg-primary/5'
  }
  return 'mb-4 border-primary/20 bg-primary/5'
})
</script>

<template>
  <Card
    :class="cardClass"
    data-testid="file-processing-progress-card"
  >
    <CardContent :class="isIndividualFile ? 'py-3' : 'py-4'">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div 
              v-if="!error"
              class="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"
            ></div>
            <div 
              v-else 
              class="h-4 w-4 rounded-full bg-destructive flex items-center justify-center"
            >
              <span class="text-xs text-destructive-foreground">✕</span>
            </div>
            <span class="font-medium text-sm">
              {{ isIndividualFile ? fileName : `Processing ${fileName}` }}
            </span>
          </div>
          <div class="flex items-center gap-2">
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
              <span v-if="elapsedTime">{{ elapsedTime }}</span>
              <span>{{ progressText }}</span>
            </div>
          </div>
        </div>

        <Progress
          :model-value="progress"
          :class="isIndividualFile ? 'h-1.5' : 'h-2'"
        />

        <div class="text-xs text-muted-foreground">
          {{ currentStep }}
        </div>

        <Alert v-if="error" class="mt-2 py-2">
          <AlertDescription class="text-xs">
            {{ error }}
          </AlertDescription>
        </Alert>
      </div>
    </CardContent>
  </Card>
</template>
