import React, { useEffect, useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

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
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const checkScroll = () => {
    const el = containerRef.current
    if (el) {
      setCanScrollLeft(el.scrollLeft > 2)
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2)
    }
  }

  useEffect(() => {
    checkScroll()
    window.addEventListener('resize', checkScroll)
    return () => window.removeEventListener('resize', checkScroll)
  }, [sections])

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
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  const scrollContainer = (direction: 'left' | 'right') => {
    if (containerRef.current) {
      const offset = direction === 'left' ? -200 : 200
      containerRef.current.scrollBy({ left: offset, behavior: 'smooth' })
      setTimeout(checkScroll, 250)
    }
  }

  return (
    <nav
      aria-label="On this page"
      style={{ backgroundColor: 'var(--bg-card)' }}
      className={`sticky top-0 z-20 border-b border-[var(--border)] -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 mb-4 shadow-xs relative flex items-center ${className}`}
    >
      {/* Left overflow arrow */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollContainer('left')}
          className="absolute left-2 z-30 p-1 rounded-full bg-[var(--bg-card)] border border-[var(--border)] shadow-md text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      )}

      <div
        ref={containerRef}
        onScroll={checkScroll}
        className="flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-none text-xs w-full py-0.5"
      >
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

      {/* Right overflow arrow */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollContainer('right')}
          className="absolute right-2 z-30 p-1 rounded-full bg-[var(--bg-card)] border border-[var(--border)] shadow-md text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Scroll right"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </nav>
  )
}
