<script setup lang="ts" generic="TData, TValue">
import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from '@tanstack/vue-table'
import {
  FlexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
} from '@tanstack/vue-table'

import { ref, computed } from 'vue'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

interface DataTableProps {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
}

const props = defineProps<DataTableProps>()
const emit = defineEmits<{
  anonymizeSelected: [studies: TData[]]
  sendSelected: [studies: TData[]]
}>()

const sorting = ref<SortingState>([])
const columnFilters = ref<ColumnFiltersState>([])
const columnVisibility = ref<VisibilityState>({})
const rowSelection = ref({})

const table = useVueTable({
  get data() {
    return props.data
  },
  get columns() {
    return props.columns
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  enableRowSelection: true,
  onSortingChange: updaterOrValue => {
    sorting.value = typeof updaterOrValue === 'function' 
      ? updaterOrValue(sorting.value) 
      : updaterOrValue
  },
  onColumnFiltersChange: updaterOrValue => {
    columnFilters.value = typeof updaterOrValue === 'function' 
      ? updaterOrValue(columnFilters.value) 
      : updaterOrValue
  },
  onColumnVisibilityChange: updaterOrValue => {
    columnVisibility.value = typeof updaterOrValue === 'function' 
      ? updaterOrValue(columnVisibility.value) 
      : updaterOrValue
  },
  onRowSelectionChange: updaterOrValue => {
    rowSelection.value = typeof updaterOrValue === 'function' 
      ? updaterOrValue(rowSelection.value) 
      : updaterOrValue
  },
  state: {
    get sorting() {
      return sorting.value
    },
    get columnFilters() {
      return columnFilters.value
    },
    get columnVisibility() {
      return columnVisibility.value
    },
    get rowSelection() {
      return rowSelection.value
    },
  },
})

// Computed properties for button states
const isAllSelectedAnonymized = computed(() => {
  const selectedRows = table.getFilteredSelectedRowModel().rows
  if (selectedRows.length === 0) return false
  
  return selectedRows.every(row => {
    const study = row.original as any
    return study.series.every((s: any) => s.files.every((f: any) => f.anonymized))
  })
})

// Event handlers
const anonymizeSelected = () => {
  const selectedStudies = table.getFilteredSelectedRowModel().rows.map(row => row.original)
  emit('anonymizeSelected', selectedStudies)
}

const sendSelected = () => {
  const selectedStudies = table.getFilteredSelectedRowModel().rows.map(row => row.original)
  emit('sendSelected', selectedStudies)
}

// Expose selected rows to parent
defineExpose({
  getSelectedRows: () => {
    return table.getFilteredSelectedRowModel().rows.map(row => row.original)
  },
  clearSelection: () => {
    rowSelection.value = {}
  }
})
</script>

<template>
  <div class="w-full">
    <div class="flex items-center py-4">
      <Input
        placeholder="Search by accession number or study UID..."
        :model-value="(table.getColumn('studyInstanceUID')?.getFilterValue() as string) ?? ''"
        @update:model-value="table.getColumn('studyInstanceUID')?.setFilterValue($event)"
        class="max-w-sm"
      />
      <div class="ml-auto text-sm text-muted-foreground">
        {{ table.getFilteredSelectedRowModel().rows.length }} of {{ table.getFilteredRowModel().rows.length }} row(s) selected
      </div>
    </div>
    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <TableHead
              v-for="header in headerGroup.headers"
              :key="header.id"
            >
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="table.getRowModel().rows?.length">
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :data-state="row.getIsSelected() && 'selected'"
            >
              <TableCell
                v-for="cell in row.getVisibleCells()"
                :key="cell.id"
              >
                <FlexRender
                  :render="cell.column.columnDef.cell"
                  :props="cell.getContext()"
                />
              </TableCell>
            </TableRow>
          </template>

          <TableRow v-else>
            <TableCell
              :col-span="columns.length"
              class="h-24 text-center"
            >
              No studies found.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <div class="flex items-center justify-between py-4">
      <div class="text-sm text-muted-foreground">
        {{ table.getFilteredSelectedRowModel().rows.length }} of {{ table.getFilteredRowModel().rows.length }} row(s) selected
      </div>
      <div class="space-x-2" v-if="table.getFilteredSelectedRowModel().rows.length > 0">
        <Button
          @click="anonymizeSelected"
          :disabled="isAllSelectedAnonymized"
          variant="default"
          size="sm"
        >
          Anonymize Selected
        </Button>
        <Button
          @click="sendSelected"
          :disabled="!isAllSelectedAnonymized"
          variant="secondary"
          size="sm"
        >
          Send Selected
        </Button>
      </div>
    </div>
  </div>
</template>