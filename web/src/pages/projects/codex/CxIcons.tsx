import type { CSSProperties, ReactElement } from 'react'

/**
 * Inline-SVG icon registry mirroring the design handoff's `I({ name })`
 * function. Each glyph is line-icon style with stroke 1.5 by default.
 *
 * Kept as a single switch (not a per-icon export) because the handoff
 * JSX references icons by string name in maps + arrays; keeping the same
 * API means the ported pages stay readable next to the design source.
 */
export type CxIconName =
  | 'home' | 'chat' | 'wrench' | 'folder' | 'building' | 'user' | 'book'
  | 'settings' | 'bell' | 'search' | 'plus' | 'arrow-right' | 'arrow-up-right'
  | 'chevron-right' | 'chevron-down' | 'sparkle' | 'target' | 'zap' | 'clock'
  | 'calendar' | 'send' | 'paperclip' | 'file' | 'check' | 'dot' | 'quote'
  | 'more' | 'filter' | 'grid' | 'list' | 'logout' | 'star' | 'tag' | 'lock'
  | 'mail' | 'moon' | 'sun' | 'edit' | 'archive' | 'trash' | 'truck'
  | 'trending'

interface CxIconProps {
  name: CxIconName | string
  size?: number
  stroke?: number
  style?: CSSProperties
}

export function CxIcon({ name, size = 16, stroke = 1.5, style }: CxIconProps): ReactElement {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  }
  switch (name) {
    case 'home':
      return (
        <svg {...props}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
      )
    case 'chat':
      return <svg {...props}><path d="M4 5h16v11H8l-4 4z" /></svg>
    case 'wrench':
      return (
        <svg {...props}>
          <path d="M14.7 6.3a4 4 0 015.3 5.3l-2-2-2 2-2-2 2-2-1.3-1.3z" />
          <path d="M14 11l-7 7-3 3-1-1 3-3 7-7" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...props}>
          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      )
    case 'building':
      return (
        <svg {...props}>
          <rect x="4" y="3" width="16" height="18" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" />
        </svg>
      )
    case 'user':
      return (
        <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>
      )
    case 'book':
      return (
        <svg {...props}>
          <path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4z" />
          <path d="M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12l1.5-2-1.5-3-2.4.6-1.7-1L14 4h-4l-.9 2.6-1.7 1L5 7l-1.5 3L5 12l-1.5 2L5 17l2.4-.6 1.7 1L10 20h4l.9-2.6 1.7-1L19 17l1.5-3z" />
        </svg>
      )
    case 'bell':
      return (
        <svg {...props}>
          <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" />
          <path d="M10 21a2 2 0 004 0" />
        </svg>
      )
    case 'search':
      return (
        <svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      )
    case 'plus':
      return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
    case 'arrow-right':
      return <svg {...props}><path d="M5 12h14M13 5l7 7-7 7" /></svg>
    case 'arrow-up-right':
      return <svg {...props}><path d="M7 17L17 7M9 7h8v8" /></svg>
    case 'chevron-right':
      return <svg {...props}><path d="M9 6l6 6-6 6" /></svg>
    case 'chevron-down':
      return <svg {...props}><path d="M6 9l6 6 6-6" /></svg>
    case 'sparkle':
      return <svg {...props}><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" /></svg>
    case 'target':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      )
    case 'zap':
      return <svg {...props}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
    case 'clock':
      return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    case 'calendar':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="1" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
      )
    case 'send':
      return <svg {...props}><path d="M3 12l18-8-7 18-3-7z" /></svg>
    case 'paperclip':
      return (
        <svg {...props}>
          <path d="M21 12l-8.5 8.5a5 5 0 01-7-7L14 5a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 8" />
        </svg>
      )
    case 'file':
      return (
        <svg {...props}>
          <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <path d="M14 3v6h6" />
        </svg>
      )
    case 'check':
      return <svg {...props}><path d="M5 12l5 5L20 7" /></svg>
    case 'dot':
      return (
        <svg {...props} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor" /></svg>
      )
    case 'quote':
      return (
        <svg {...props}><path d="M6 7h4v6a4 4 0 01-4 4M14 7h4v6a4 4 0 01-4 4" /></svg>
      )
    case 'more':
      return (
        <svg {...props}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'filter':
      return <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4z" /></svg>
    case 'grid':
      return (
        <svg {...props}>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <rect x="14" y="14" width="6" height="6" />
        </svg>
      )
    case 'list':
      return (
        <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01" /></svg>
      )
    case 'logout':
      return (
        <svg {...props}>
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      )
    case 'star':
      return (
        <svg {...props}>
          <path d="M12 3l2.7 6 6.3.5-4.7 4.2 1.4 6.3L12 16.8 6.3 20l1.4-6.3L3 9.5 9.3 9z" />
        </svg>
      )
    case 'tag':
      return <svg {...props}><path d="M3 12V3h9l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
    case 'lock':
      return <svg {...props}><rect x="4" y="11" width="16" height="10" rx="1" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
    case 'mail':
      return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 7l9 7 9-7" /></svg>
    case 'moon':
      return <svg {...props}><path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z" /></svg>
    case 'sun':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...props}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      )
    case 'archive':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...props}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
      )
    case 'trending':
      return <svg {...props}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
    case 'truck':
      return (
        <svg {...props}>
          <path d="M3 16V6h12v10" />
          <path d="M15 9h4l2 4v3h-2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      )
    default:
      return <svg {...props}><rect x="4" y="4" width="16" height="16" /></svg>
  }
}
