import React from 'react'
import { UploadCloud, FolderSearch } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/ui/Card'

interface PageNoSnapshotStateProps {
  title?: string
  description?: string
}

export function PageNoSnapshotState({
  title = "No snapshot available",
  description = "Upload an Excel file in Data Uploads to get started",
}: PageNoSnapshotStateProps) {
  const navigate = useNavigate()

  return (
    <div className="p-8 flex items-center justify-center min-h-[360px]">
      <Card className="max-w-md w-full p-8 text-center shadow-md border-[var(--border)] bg-[var(--bg-card)]">
        <div className="w-14 h-14 rounded-2xl bg-teal-500/10 text-[#00A3AD] flex items-center justify-center mx-auto mb-4">
          <UploadCloud className="w-7 h-7" />
        </div>
        <h3 className="text-base font-bold text-[var(--text-primary)] mb-2">
          {title}
        </h3>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-6">
          {description}
        </p>
        <button
          type="button"
          onClick={() => navigate('/data-uploads')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#12284C] dark:bg-[#00A3AD] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          <span>Go to Data Uploads</span>
        </button>
      </Card>
    </div>
  )
}

export default PageNoSnapshotState
