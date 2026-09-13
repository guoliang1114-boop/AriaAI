import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, Copy } from 'lucide-react'
import { ChatIconButton } from './ChatIconButton'

export function MessageCopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  const copy = async () => {
    if (inFlight.current) return
    inFlight.current = true
    clearTimeout(timer.current)
    setStatus('copying')
    try {
      await navigator.clipboard.writeText(text)
      if (!mounted.current) return
      setStatus('copied')
      timer.current = setTimeout(() => setStatus('idle'), 1800)
    } catch {
      if (mounted.current) setStatus('error')
    } finally {
      inFlight.current = false
    }
  }
  const label = status === 'copied' ? '已复制' : status === 'error' ? '复制失败，请重试' : status === 'copying' ? '复制中…' : '复制'
  return <>
    <ChatIconButton label={label} onClick={() => { void copy() }} disabled={status === 'copying'}
      data-tone={status === 'copied' ? 'success' : status === 'error' ? 'error' : undefined}>
      {status === 'copied' ? <Check aria-hidden="true" /> : status === 'error' ? <CircleAlert aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </ChatIconButton>
    <span className="sr-only" role="status">{status === 'copied' || status === 'error' ? label : ''}</span>
  </>
}
