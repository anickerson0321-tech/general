import type { ReactNode } from 'react'

const base = (children: ReactNode, fill = false) => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const I = {
  home: () => base(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  create: () => base(<><path d="M12 5v14M5 12h14" /></>),
  library: () => base(<><path d="M4 4v16M9 4v16" /><path d="m14 4 6 16" /></>),
  mic: () => base(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  studio: () => base(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" /></>),
  settings: () => base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  play: () => base(<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />, true),
  pause: () => base(<><rect x="6" y="4" width="4.2" height="16" rx="1.2" /><rect x="13.8" y="4" width="4.2" height="16" rx="1.2" /></>, true),
  next: () => base(<><path d="M5 5v14l10-7z" /><rect x="16.5" y="5" width="2.5" height="14" rx="1" /></>, true),
  prev: () => base(<><path d="M19 5v14L9 12z" /><rect x="5" y="5" width="2.5" height="14" rx="1" /></>, true),
  heart: () => base(<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />),
  heartFill: () => base(<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />, true),
  thumbDown: () => base(<><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9a2 2 0 0 0 2 2.3z" /><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" /></>),
  more: () => base(<><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>, true),
  share: () => base(<><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="m16 6-4-4-4 4M12 2v14" /></>),
  download: () => base(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>),
  trash: () => base(<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>),
  wand: () => base(<><path d="m15 4 5 5L9 20H4v-5z" /><path d="M14 5 19 10" /><path d="M3 3l2 2M8 2v2M2 8h2" /></>),
  dice: () => base(<><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" /></>),
  chevronDown: () => base(<path d="m6 9 6 6 6-6" />),
  chevronLeft: () => base(<path d="m15 18-6-6 6-6" />),
  close: () => base(<path d="M18 6 6 18M6 6l12 12" />),
  search: () => base(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  music: () => base(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  sparkle: () => base(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />, true),
  copy: () => base(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  repeat: () => base(<><path d="m17 1 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>),
  list: () => base(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>),
  plus: () => base(<path d="M12 5v14M5 12h14" />),
  volume: () => base(<><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>),
  headphones: () => base(<><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></>),
  expand: () => base(<path d="m18 15-6-6-6 6" />),
  edit: () => base(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  upload: () => base(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>),
  check: () => base(<path d="M20 6 9 17l-5-5" />),
  info: () => base(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>),
  key: () => base(<><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></>),
  wave: () => base(<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0" />),
  extend: () => base(<><path d="M5 12h14M13 6l6 6-6 6" /></>),
  scissors: () => base(<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></>),
}

export function Logo() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="#1a0710" aria-hidden="true">
        <path d="M5 8v8M9 5v14M13 9v6M17 6v12M21 10v4" stroke="#1a0710" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  )
}
