import type { ColumnDef } from '@tanstack/vue-table'
import type { DicomStudy } from '@/types/dicom'
import { h } from 'vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'

export const columns: ColumnDef<DicomStudy>[] = [
  {
    id: 'select',
    header: ({ table }) => h(Checkbox, {
      'checked': table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate'),
      'onUpdate:checked': (value: boolean) => table.toggleAllPageRowsSelected(!!value),
      'ariaLabel': 'Select all',
    }),
    cell: ({ row }) => h(Checkbox, {
      'checked': row.getIsSelected(),
      'onUpdate:checked': (value: boolean) => row.toggleSelected(!!value),
      'ariaLabel': 'Select row',
    }),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'patientName',
    header: 'Patient Name',
    cell: ({ row }) => {
      const patientName = row.getValue('patientName') as string
      return h('div', { class: 'font-medium' }, patientName || 'Unknown Patient')
    },
  },
  {
    accessorKey: 'patientId',
    header: 'Patient ID',
    cell: ({ row }) => {
      const patientId = row.getValue('patientId') as string
      return h('div', { class: 'text-muted-foreground' }, patientId || 'Unknown')
    },
  },
  {
    accessorKey: 'studyDate',
    header: 'Study Date',
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
    header: 'Study Description',
    cell: ({ row }) => {
      const description = row.getValue('studyDescription') as string
      return h('div', { class: 'max-w-[200px] truncate' }, description || 'No description')
    },
  },
  {
    id: 'seriesCount',
    header: 'Series',
    cell: ({ row }) => {
      const study = row.original
      return h(Badge, { variant: 'secondary' }, () => study.series.length.toString())
    },
  },
  {
    id: 'fileCount',
    header: 'Files',
    cell: ({ row }) => {
      const study = row.original
      const fileCount = study.series.reduce((sum, s) => sum + s.files.length, 0)
      return h(Badge, { variant: 'outline' }, () => fileCount.toString())
    },
  },
  {
    id: 'anonymized',
    header: 'Status',
    cell: ({ row }) => {
      const study = row.original
      const allAnonymized = study.series.every(s => s.files.every(f => f.anonymized))
      const someAnonymized = study.series.some(s => s.files.some(f => f.anonymized))

      if (allAnonymized) {
        return h(Badge, { variant: 'default' }, () => 'Anonymized')
      } else if (someAnonymized) {
        return h(Badge, { variant: 'secondary' }, () => 'Partial')
      } else {
        return h(Badge, { variant: 'destructive' }, () => 'Not Anonymized')
      }
    },
  },
  {
    accessorKey: 'studyInstanceUID',
    header: 'Accession/Study UID',
    cell: ({ row }) => {
      const uid = row.getValue('studyInstanceUID') as string
      return h('div', {
        class: 'font-mono text-xs text-muted-foreground max-w-[150px] truncate',
        title: uid
      }, uid)
    },
  },
]
