import type { ColumnDef } from '@tanstack/vue-table'
import type { DicomStudy } from '@/types/dicom'
import { h } from 'vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowUp, ArrowDown } from 'lucide-vue-next'
import StudyProgressIndicator from '@/components/StudyProgressIndicator.vue'
import { h as createElement } from 'vue'
import { Badge as UiBadge } from '@/components/ui/badge'
import { Pencil } from 'lucide-vue-next'

export const columns: ColumnDef<DicomStudy>[] = [
  {
    id: 'select',
    header: ({ table }) => h(Checkbox, {
      'modelValue': table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate'),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!value),
      'ariaLabel': 'Select all',
    }),
    cell: ({ row }) => h(Checkbox, {
      'modelValue': row.getIsSelected(),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value),
      'ariaLabel': 'Select row',
    }),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'customFields',
    header: () => h('span', {}, 'Overrides'),
    cell: ({ row }) => {
      const study = row.original
      const hasOverrides = study.customFields && Object.keys(study.customFields).length > 0
      return hasOverrides
        ? h(Badge, { variant: 'secondary', class: 'flex items-center gap-1' }, () => [
          h(Pencil, { class: 'w-3 h-3' }),
          'Custom'
        ])
        : h('span', { class: 'text-muted-foreground' }, '-')
    },
    enableSorting: false,
  },
  {
    accessorKey: 'accessionNumber',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Accession Number'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const accessionNumber = row.getValue('accessionNumber') as string
      return h('div', { class: 'font-medium' }, accessionNumber || 'Unknown Accession Number')
    },
  },
  {
    accessorKey: 'patientId',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Patient ID'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const patientId = row.getValue('patientId') as string
      return h('div', { class: 'text-muted-foreground' }, patientId || 'Unknown')
    },
  },
  {
    accessorKey: 'assignedPatientId',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Assigned Patient ID'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const pid = row.getValue('assignedPatientId') as string
      return h('div', { class: 'font-medium' }, pid || '-')
    },
  },
  {
    accessorKey: 'studyDate',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Study Date'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const date = row.getValue('studyDate') as string
      if (date && date.length === 8) {
        // Format YYYYMMDD to YYYY-MM-DD
        const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        return h('div', formatted)
      }
      return h('div', { class: 'text-muted-foreground' }, date || 'Unknown Date')
    },
  },
  {
    accessorKey: 'studyDescription',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Study Description'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const description = row.getValue('studyDescription') as string
      return h('div', { class: 'max-w-[200px] truncate' }, description || 'No description')
    },
  },
  {
    id: 'seriesCount',
    accessorFn: row => row.series.length,
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Series'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      return h(Badge, { variant: 'secondary' }, () => study.series.length.toString())
    },
  },
  {
    id: 'fileCount',
    accessorFn: row => row.series.reduce((sum, s) => sum + s.files.length, 0),
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Files'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      const fileCount = study.series.reduce((sum, s) => sum + s.files.length, 0)
      return h(Badge, { variant: 'outline' }, () => fileCount.toString())
    },
  },
  {
    accessorKey: 'studyInstanceUID',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Study UID'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const uid = row.getValue('studyInstanceUID') as string
      return h('div', {
        class: 'font-mono text-xs text-muted-foreground max-w-[150px] truncate',
        title: uid
      }, uid)
    },
  },
  {
    id: 'anonymized',
    accessorFn: row => {
      const totalFiles = row.series.reduce((sum, s) => sum + s.files.length, 0)
      const anonymizedFiles = row.series.reduce((sum, s) => sum + s.files.filter(f => f.anonymized).length, 0)
      return totalFiles > 0 ? (anonymizedFiles / totalFiles) : 0
    },
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Anonymized'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      const totalFiles = study.series.reduce((sum, s) => sum + s.files.length, 0)
      const anonymizedFiles = study.series.reduce((sum, s) => sum + s.files.filter(f => f.anonymized).length, 0)

      return h(StudyProgressIndicator, {
        studyId: study.studyInstanceUID,
        totalFiles,
        anonymizedFiles,
        showOnly: 'anonymization'
      })
    },
  },
  {
    id: 'sent',
    accessorFn: row => {
      const totalFiles = row.series.reduce((sum, s) => sum + s.files.length, 0)
      const sentFiles = row.series.reduce((sum, s) => sum + s.files.filter(f => f.sent).length, 0)
      return totalFiles > 0 ? (sentFiles / totalFiles) : 0
    },
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Sent'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      const totalFiles = study.series.reduce((sum, s) => sum + s.files.length, 0)
      const sentFiles = study.series.reduce((sum, s) => sum + s.files.filter(f => f.sent).length, 0)

      return h(StudyProgressIndicator, {
        studyId: study.studyInstanceUID,
        totalFiles,
        sentFiles,
        showOnly: 'sending'
      })
    },
  },
]
