<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

interface Props {
  fileName: string
  currentStep: string
  progress: number
  totalFiles?: number
  currentFileIndex?: number
}

const props = defineProps<Props>()

const progressText = computed(() => {
  if (props.totalFiles && props.currentFileIndex !== undefined) {
    return `${props.currentFileIndex + 1} of ${props.totalFiles} files`
  }
  return `${Math.round(props.progress)}%`
})
</script>

<template>
  <Card class="mb-4 border-primary/20 bg-primary/5">
    <CardContent class="py-4">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
            <span class="font-medium text-sm">Processing {{ fileName }}</span>
          </div>
          <span class="text-xs text-muted-foreground">{{ progressText }}</span>
        </div>
        
        <Progress :model-value="progress" class="h-2" />
        
        <div class="text-xs text-muted-foreground">
          {{ currentStep }}
        </div>
      </div>
    </CardContent>
  </Card>
</template>