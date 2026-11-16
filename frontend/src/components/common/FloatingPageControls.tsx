import React, { useState, useEffect } from 'react'
import { ArrowUp, ChevronUp, ChevronDown } from 'lucide-react'

interface FloatingPageControlsProps {
  scrollContainerRef?: React.RefObject<HTMLElement>
}

export const FloatingPageControls: React.FC<FloatingPageControlsProps> = ({ scrollContainerRef }) => {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const getScrollTop = () => {
      if (scrollContainerRef?.current) {
        return scrollContainerRef.current.scrollTop
      }
      return window.pageYOffset || document.documentElement.scrollTop
    }

    const handleScroll = () => {
      const top = getScrollTop()
      setIsVisible(top > 250)
    }

    const container = scrollContainerRef?.current
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll)
      }
      window.removeEventListener('scroll', handleScroll)
    }
  }, [scrollContainerRef])

  if (!isVisible) {
    return null
  }

  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const scrollToTop = () => {
    if (scrollContainerRef?.current) {
      scrollContainerRef.current.scrollTo({
        top: 0,
        behavior: prefersReduced ? 'auto' : 'smooth',
      })
    }
    window.scrollTo({
      top: 0,
      behavior: prefersReduced ? 'auto' : 'smooth',
    })
  }

  const scrollBySection = (direction: 'up' | 'down') => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[id^="overview-"], [id^="regions-"], [id^="approvals-"], [id^="bu-"], [id^="delayed-"], [id^="expiry-"], [id^="exec-"]')
    ).filter((el) => el.offsetParent !== null)

    if (sections.length === 0) {
      scrollToTop()
      return
    }

    const currentScroll = scrollContainerRef?.current ? scrollContainerRef.current.scrollTop : window.pageYOffset
    const targetOffset = 80 // topbar offset

    if (direction === 'down') {
      const nextSection = sections.find((s) => {
        const top = s.offsetTop - targetOffset
        return top > currentScroll + 30
      })
      if (nextSection) {
        nextSection.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' })
      }
    } else {
      const prevSections = sections.filter((s) => {
        const top = s.offsetTop - targetOffset
        return top < currentScroll - 30
      })
      if (prevSections.length > 0) {
        const prevSection = prevSections[prevSections.length - 1]
        prevSection.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' })
      } else {
        scrollToTop()
      }
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 hidden sm:flex items-center gap-1 p-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-full shadow-lg backdrop-blur-md text-[var(--text-secondary)]">
      <button
        type="button"
        onClick={() => scrollBySection('up')}
        className="p-1.5 rounded-full hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        title="Previous section"
        aria-label="Previous section"
      >
        <ChevronUp className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => scrollBySection('down')}
        className="p-1.5 rounded-full hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        title="Next section"
        aria-label="Next section"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      <div className="w-px h-3.5 bg-[var(--border)] my-auto mx-0.5" />

      <button
        type="button"
        onClick={scrollToTop}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full hover:bg-[var(--bg-secondary)] hover:text-[var(--brand-teal)] transition-colors cursor-pointer"
        title="Back to top"
        aria-label="Back to top"
      >
        <ArrowUp className="w-3.5 h-3.5 text-[var(--brand-teal)]" />
        <span>Top</span>
      </button>
    </div>
  )
}

export default FloatingPageControls
