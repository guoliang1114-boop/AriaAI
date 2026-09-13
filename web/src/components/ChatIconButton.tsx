import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './ChatIconButton.module.css'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> & {
  label: string
  children: ReactNode
}

/** Shared secondary chat action. The label stays accessible, not permanently visible. */
export function ChatIconButton({ label, children, className, onFocus, onBlur, onPointerEnter, onPointerLeave, ...props }: Props) {
  const [anchor, setAnchor] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const id = useId()
  const show = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect()
    const above = rect.top >= 56
    setAnchor({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
      top: above ? rect.top - 6 : rect.bottom + 6, above })
  }
  useEffect(() => {
    if (!anchor) return
    const hide = () => setAnchor(null)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('keydown', escape)
    }
  }, [anchor])
  return <>
    <button {...props} type={props.type || 'button'} aria-label={label}
      className={`${styles.button}${className ? ` ${className}` : ''}`}
      onPointerEnter={event => { if (event.pointerType !== 'touch') show(event.currentTarget); onPointerEnter?.(event) }}
      onPointerLeave={event => { setAnchor(null); onPointerLeave?.(event) }}
      onFocus={event => { show(event.currentTarget); onFocus?.(event) }}
      onBlur={event => { setAnchor(null); onBlur?.(event) }}>
      {children}
    </button>
    {anchor && createPortal(<div id={`${id}-tooltip`} role="tooltip" className={styles.tooltip}
      style={{ left: anchor.left, top: anchor.top, transform: anchor.above ? 'translateY(-100%)' : undefined }}>
      {label}
    </div>, document.body)}
  </>
}
