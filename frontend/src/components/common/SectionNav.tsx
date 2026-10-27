import React, { useEffect, useState } from 'react'

export interface SectionItem {
  id: string
  title: string
}

interface SectionNavProps {
  sections: SectionItem[]
  className?: string
}

export default function SectionNav({ sections, className = '' }: SectionNavProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id || '')

  useEffect(() => {
    if (!sections || sections.length < 3) return
    if (typeof IntersectionObserver === 'undefined') return

    // IntersectionObserver to observe sections and highlight active section
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      }
    )

    sections.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [sections])

  if (!sections || sections.length < 3) {
    return null
  }

  const handleScrollTo = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  return (
    <nav
      aria-label="On this page"
      style={{ backgroundColor: 'var(--bg-card)' }}
      className={`sticky top-0 z-30 border-b border-[var(--border)] -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 mb-4 shadow-xs ${className}`}
    >
      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-none text-xs">
        <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mr-1 flex-shrink-0 select-none">
          On this page:
        </span>
        {sections.map(({ id, title }) => {
          const isActive = activeId === id
          return (
            <button
              key={id}
              type="button"
              onClick={(e) => handleScrollTo(e, id)}
              className={`px-2.5 py-1 rounded-full text-xs transition-all flex-shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[#12284C] text-white dark:bg-[#00A3AD] dark:text-white font-semibold shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] font-medium'
              }`}
            >
              {title}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
