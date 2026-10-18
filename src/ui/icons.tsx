/** Icônes simples dessinées en SVG (24 × 24, trait), embarquées dans l'application. */
import type { JSX } from 'preact';

const PATHS: Record<string, JSX.Element> = {
  sketch: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
      <path d="M14 20h6" />
    </>
  ),
  extrude: (
    <>
      <path d="M4 15.5l8 4 8-4" />
      <path d="M4 15.5v-3l8-4 8 4v3" />
      <path d="M12 2.5v9" />
      <path d="M9 5.5l3-3 3 3" />
    </>
  ),
  pocket: (
    <>
      <path d="M3.5 9.5l8.5-4.2 8.5 4.2-8.5 4.2z" />
      <path d="M3.5 9.5v5.8l8.5 4.2 8.5-4.2V9.5" />
      <ellipse cx="12" cy="9.5" rx="3.2" ry="1.6" />
      <path d="M12 11.1v4.6" />
    </>
  ),
  drawing: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M7 8h6v5H7z" />
      <path d="M7 16.5h6M7 15.5v2M13 15.5v2" opacity="0.6" />
      <path d="M15.5 8h2M15.5 11h2M15.5 14h2" opacity="0.6" />
    </>
  ),
  pattern: (
    <>
      <rect x="3" y="9" width="5" height="6" rx="1" />
      <rect x="9.5" y="9" width="5" height="6" rx="1" opacity="0.7" />
      <rect x="16" y="9" width="5" height="6" rx="1" opacity="0.45" />
      <path d="M5.5 5.5h13M16 3.5l2.5 2-2.5 2" />
    </>
  ),
  mirror: (
    <>
      <path d="M12 3v18" stroke-dasharray="2 2" />
      <path d="M9 6L3 18h6z" />
      <path d="M15 6l6 12h-6z" opacity="0.55" />
    </>
  ),
  offset: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="2.5 2" />
    </>
  ),
  sheet: (
    <>
      <path d="M2.5 14.5l9.5-5 9.5 5-9.5 5z" />
      <path d="M2.5 14.5v1.8l9.5 5 9.5-5v-1.8" opacity="0.6" />
    </>
  ),
  flange: (
    <>
      <path d="M3 19h12a4 4 0 0 0 4-4V4" />
      <path d="M3 16h11.5a1.5 1.5 0 0 0 1.5-1.5V4" opacity="0.6" />
    </>
  ),
  fold: (
    <>
      <path d="M2.5 19h9.5l7.5-12" />
      <path d="M12 19l-4.5-12" opacity="0.45" stroke-dasharray="2 2" />
      <path d="M12 21.5v-5" stroke-dasharray="1.5 1.5" />
    </>
  ),
  thicken: (
    <>
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <rect x="4" y="4" width="16" height="16" rx="4" opacity="0.55" />
    </>
  ),
  draft: (
    <>
      <path d="M3 20h18" />
      <path d="M7 20l2-14h6l2 14" />
      <path d="M7 6v14" stroke-dasharray="2 2" opacity="0.55" />
    </>
  ),
  split: (
    <>
      <path d="M5 13h14v6H5z" />
      <path d="M5 5h14v5H5z" opacity="0.55" />
      <path d="M2 11.5h20" stroke-dasharray="2 2" />
    </>
  ),
  polygon: <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />,
  slot: (
    <>
      <path d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z" />
      <path d="M8 12h8" stroke-dasharray="1.5 1.5" opacity="0.6" />
    </>
  ),
  'joint-fixed': (
    <>
      <path d="M4 14h16v6H4z" />
      <path d="M9 14V6h6v8" />
      <path d="M7 17h2M11 17h2M15 17h2" opacity="0.6" />
    </>
  ),
  'joint-revolute': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V3M5 18l4.5-4" />
      <path d="M18.5 8.5a8 8 0 0 1-1 9.5" opacity="0.7" />
      <path d="M18.8 15.4l-1.3 2.6-2.6-.9" opacity="0.7" />
    </>
  ),
  'joint-slider': (
    <>
      <path d="M3 15h18M3 19h18" opacity="0.6" />
      <path d="M8 9h8v6H8z" />
      <path d="M17 6h4M19 4l2 2-2 2M7 6H3M5 4L3 6l2 2" />
    </>
  ),
  'joint-cylindrical': (
    <>
      <path d="M12 3v18" />
      <path d="M8 9h8v6H8z" />
      <path d="M5 6.5a7 3 0 0 0 14 0" opacity="0.7" />
      <path d="M17.5 4.8l1.5 1.7-2.2.7" opacity="0.7" />
    </>
  ),
  'joint-spherical': (
    <>
      <circle cx="12" cy="15" r="4" />
      <path d="M12 11L17 3" />
      <path d="M8 21h8" opacity="0.6" />
      <path d="M6.5 9a7 7 0 0 1 3-4" opacity="0.7" />
    </>
  ),
  collision: (
    <>
      <rect x="3" y="7" width="10" height="10" rx="1" />
      <rect x="10" y="4" width="10" height="10" rx="1" opacity="0.7" />
      <path d="M10 7h3v7h-3z" fill="currentColor" opacity="0.5" />
    </>
  ),
  sweep: (
    <>
      <path d="M5 20V12a6 6 0 0 1 6-6h9" stroke-dasharray="2 1.6" opacity="0.6" />
      <ellipse cx="5" cy="19" rx="3" ry="1.2" />
      <path d="M2 19v-7a9 9 0 0 1 9-9h9M8 19v-7a3 3 0 0 1 3-3h9" />
    </>
  ),
  loft: (
    <>
      <path d="M5 19h10l4-3H9z" />
      <ellipse cx="13" cy="6" rx="5" ry="2" />
      <path d="M5 19L8 6M15 19l3-13M19 16l-1-10" opacity="0.6" />
    </>
  ),
  section: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" opacity="0.5" />
      <path d="M3 13l18-4" />
      <path d="M12 12l8-4v8l-8 4z" fill="currentColor" opacity="0.25" />
    </>
  ),
  shell: (
    <>
      <path d="M4 7v11l8 3 8-3V7" />
      <path d="M7 8.5v8l5 2 5-2v-8" opacity="0.6" />
      <path d="M4 7l8-3 8 3-8 3z" stroke-dasharray="2 1.5" />
    </>
  ),
  primitive: (
    <>
      <path d="M3 9l5-3 5 3v6l-5 3-5-3z" />
      <path d="M3 9l5 3 5-3M8 12v6" opacity="0.6" />
      <circle cx="17.5" cy="15.5" r="3.5" />
      <path d="M14 15.5a3.5 1.2 0 0 0 7 0" opacity="0.6" />
    </>
  ),
  'prim-box': (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v8" opacity="0.6" />
    </>
  ),
  'prim-cylinder': (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12a7 2.5 0 0 0 14 0V6" />
    </>
  ),
  'prim-sphere': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12a8 3 0 0 0 16 0" opacity="0.6" />
    </>
  ),
  'prim-torus': (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="5" />
      <ellipse cx="12" cy="11.5" rx="3.5" ry="1.6" />
    </>
  ),
  hand: (
    <>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V14" />
      <path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.5 15.5a1.6 1.6 0 0 1 2.4-2.1L8 14.5" />
    </>
  ),
  trim: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 7.5L20 16M8 16.5L20 8" />
    </>
  ),
  laser: (
    <>
      <path d="M12 3v7" />
      <path d="M9 3h6" />
      <path d="M12 10l-1.5 3h3z" fill="currentColor" />
      <path d="M4 18h16M4 21h16" opacity="0.5" />
      <path d="M12 13v5" stroke-dasharray="1.5 1.5" />
    </>
  ),
  revolve: (
    <>
      <ellipse cx="12" cy="17" rx="7" ry="2.5" />
      <path d="M5 17V9c0-1.4 3.1-2.5 7-2.5S19 7.6 19 9v8" />
      <path d="M12 3v18" stroke-dasharray="2 2" opacity="0.6" />
      <path d="M16 4.5a5 2 0 01-2.5 3.6" />
      <path d="M13 6.5l.5 1.6 1.7-.3" />
    </>
  ),
  line: (
    <>
      <path d="M5.5 18.5l13-13" />
      <rect x="3" y="16" width="5" height="5" rx="1" />
      <rect x="16" y="3" width="5" height="5" rx="1" />
    </>
  ),
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1" />,
  'center-rectangle': (
    <>
      <rect x="4" y="6" width="16" height="12" rx="1" />
      <path d="M4 6l16 12M20 6L4 18" opacity="0.4" stroke-dasharray="2 2" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  arc: (
    <>
      <path d="M5 18a9 9 0 0115.5-9" />
      <circle cx="13" cy="18" r="0.9" fill="currentColor" />
      <path d="M17.5 5.5l3 3.5-4 1.2" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 12h7.5" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  dimension: (
    <>
      <path d="M4 7v10M20 7v10" />
      <path d="M4.5 12h15" />
      <path d="M7.5 9.5L4.5 12l3 2.5M16.5 9.5l3 2.5-3 2.5" />
    </>
  ),
  coincident: (
    <>
      <circle cx="8.5" cy="12" r="3.5" />
      <circle cx="15.5" cy="12" r="3.5" />
    </>
  ),
  horizontal: (
    <>
      <path d="M4 12h16" />
      <path d="M7 6v12M17 6v12" opacity="0.45" />
    </>
  ),
  vertical: (
    <>
      <path d="M12 4v16" />
      <path d="M6 7h12M6 17h12" opacity="0.45" />
    </>
  ),
  select: <path d="M6 3.5l12 7.2-5.2 1.5 3.2 6.3-2.3 1.1-3.1-6.3L6 17.5z" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  undo: (
    <>
      <path d="M9 13.5L4.5 9 9 4.5" />
      <path d="M4.5 9h10a5 5 0 010 10H11" />
    </>
  ),
  redo: (
    <>
      <path d="M15 13.5L19.5 9 15 4.5" />
      <path d="M19.5 9h-10a5 5 0 000 10H13" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4" />
      <rect x="8" y="13" width="8" height="5" />
    </>
  ),
  open: (
    <>
      <path d="M3.5 7.5v11h17V9.5h-8l-2-2z" />
    </>
  ),
  new: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  import: (
    <>
      <path d="M12 3.5v11" />
      <path d="M8 10.5l4 4 4-4" />
      <path d="M4.5 15.5v4h15v-4" />
    </>
  ),
  export: (
    <>
      <path d="M12 14.5v-11" />
      <path d="M8 7.5l4-4 4 4" />
      <path d="M4.5 15.5v4h15v-4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 114 2c-.9.6-1.6 1.2-1.6 2.3" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-20 12 12)" />,
  spline: (
    <>
      <path d="M3 17c3-9 6-9 9-4s6 4 9-5" />
      <circle cx="3" cy="17" r="1.4" />
      <circle cx="12" cy="13" r="1.4" />
      <circle cx="21" cy="8" r="1.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
  isolate: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" opacity="0.4" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M10.1 6A9.9 9.9 0 0112 5.8c6 0 9.5 6.2 9.5 6.2a16 16 0 01-2.8 3.5M6.5 7.6A16 16 0 002.5 12s3.5 6.2 9.5 6.2a9.6 9.6 0 004.3-1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-up': <path d="M6 14.5l6-6 6 6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  part: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  iso: (
    <>
      <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" />
      <path d="M12 12l7.5-4.3M12 12v8.5M12 12L4.5 7.7" />
    </>
  ),
  front: (
    <>
      <rect x="5" y="6" width="14" height="13" rx="1" />
      <path d="M5 6l3-2.5h14L19 6M22 3.5v13L19 19" opacity="0.4" />
    </>
  ),
  top: (
    <>
      <path d="M3.5 10l8.5-5 8.5 5-8.5 5z" />
      <path d="M3.5 10v5l8.5 5 8.5-5v-5" opacity="0.4" />
    </>
  ),
  right: (
    <>
      <path d="M8 4l11 3.5v13L8 17z" />
      <path d="M8 4L3 6.5v13L8 17" opacity="0.4" />
    </>
  ),
  perspective: (
    <>
      <path d="M4 5l16 3v8L4 19z" />
      <path d="M4 12h16" opacity="0.45" />
    </>
  ),
  orthographic: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1" />
      <path d="M4 12h16M12 5v14" opacity="0.45" />
    </>
  ),
  grid: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" opacity="0.6" />
    </>
  ),
  fillet: (
    <>
      <path d="M4 20V11a7 7 0 017-7h9" />
      <path d="M4 20h16V4" opacity="0.45" />
    </>
  ),
  chamfer: (
    <>
      <path d="M4 20V10l6-6h10" />
      <path d="M4 20h16V4" opacity="0.45" />
    </>
  ),
  construction: (
    <>
      <path d="M5.5 18.5l13-13" stroke-dasharray="2.6 2.6" />
      <rect x="3" y="16" width="5" height="5" rx="1" />
      <rect x="16" y="3" width="5" height="5" rx="1" />
    </>
  ),
  project: (
    <>
      <path d="M4 9.5l8-4.5 8 4.5" />
      <path d="M12 7.5v8" stroke-dasharray="2 2" />
      <path d="M9.5 13.5l2.5 2.5 2.5-2.5" />
      <path d="M4 19.5h16" />
    </>
  ),
  constraints: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="1.5" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  parallel: (
    <>
      <path d="M4 16L14 6" />
      <path d="M10 19L20 9" />
    </>
  ),
  perpendicular: (
    <>
      <path d="M4 19h16" />
      <path d="M11 19V4" />
      <path d="M11 15h4v4" opacity="0.6" />
    </>
  ),
  equal: (
    <>
      <path d="M5 9h14" />
      <path d="M5 15h14" />
    </>
  ),
  collinear: (
    <>
      <path d="M3 20l6-6" />
      <path d="M15 8l6-6" />
      <path d="M10.5 12.5l3-3" opacity="0.45" stroke-dasharray="1.5 2" />
    </>
  ),
  tangent: (
    <>
      <circle cx="12" cy="13.5" r="6" />
      <path d="M3 7.5h18" />
    </>
  ),
  'point-on': (
    <>
      <path d="M4 18L20 6" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </>
  ),
  midpoint: (
    <>
      <path d="M4 12h16" />
      <path d="M4 8.5v7M20 8.5v7" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </>
  ),
  concentric: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  'tl-first': (
    <>
      <path d="M6 5v14" />
      <path d="M18 5l-9 7 9 7z" />
    </>
  ),
  'tl-prev': <path d="M15 5l-8 7 8 7" />,
  'tl-next': <path d="M9 5l8 7-8 7" />,
  'tl-last': (
    <>
      <path d="M18 5v14" />
      <path d="M6 5l9 7-9 7z" />
    </>
  ),
  pivot: (
    <>
      <circle cx="9" cy="15" r="5.5" />
      <circle cx="9" cy="15" r="1.4" fill="currentColor" />
      <path d="M12.5 11l7-7" />
      <path d="M15 4h4.5v4.5" />
    </>
  ),
  measure: (
    <>
      <path d="M3.5 15.5l12-12 5 5-12 12z" />
      <path d="M7 12l2 2M9.5 9.5l1.5 1.5M12 7l2 2M14.5 4.5l1.5 1.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5l9 16H3z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  blocked: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h7" />
    </>
  ),
  ok: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.3l2.6 2.6 5-5.2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </>
  ),
  rename: (
    <>
      <path d="M4 7h11M4 12h7M4 17h5" />
      <path d="M14 19.5l1-3.5 5-5 2.5 2.5-5 5z" />
    </>
  ),
  /** Visserie, vue de côté (tête en haut) : CHC, BHC, FHC, H ; écrou et rondelle vus de dessus. */
  'fastener-iso4762': (
    <>
      <rect x="7" y="3" width="10" height="6" rx="1" />
      <path d="M10.5 3v2.5h3V3" />
      <path d="M10 9v11.5h4V9" />
      <path d="M10 13h4M10 16.5h4" />
    </>
  ),
  'fastener-iso7380': (
    <>
      <path d="M5 9a7 5.5 0 0 1 14 0z" />
      <path d="M10.5 4.5v2h3v-2" />
      <path d="M10 9v11.5h4V9" />
      <path d="M10 13h4M10 16.5h4" />
    </>
  ),
  'fastener-iso10642': (
    <>
      <path d="M4.5 4h15L14 9.5h-4z" />
      <path d="M10.5 4v1.5h3V4" />
      <path d="M10 9.5v11h4v-11" />
      <path d="M10 13.5h4M10 17h4" />
    </>
  ),
  'fastener-iso4017': (
    <>
      <path d="M5.5 3.5h13l1.5 2.75-1.5 2.75h-13L4 6.25z" />
      <path d="M9.5 3.5v5.5M14.5 3.5v5.5" />
      <path d="M10 9v11.5h4V9" />
      <path d="M10 13h4M10 16.5h4" />
    </>
  ),
  'fastener-iso4032': (
    <>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
      <circle cx="12" cy="12" r="3.6" />
    </>
  ),
  'fastener-iso7089': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.6" />
    </>
  ),
  /** Déplacer : flèches dans les quatre directions. */
  /** Plan de construction : un plan vu en perspective et sa copie décalée (pointillés). */
  'datum-plane': (
    <>
      <path d="M2.5 19l4-7h15l-4 7z" />
      <path d="M2.5 11l4-7h15l-4 7z" stroke-dasharray="2 2" />
    </>
  ),
  /** Affichage des pièces : un cube dont une moitié est pleine et l'autre en fil de fer. */
  display: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9" />
      <path d="M12 12L4 7.5" stroke-dasharray="2 2" />
      <path d="M4 7.5L12 12v9l-8-4.5z" fill="currentColor" fill-opacity="0.25" />
    </>
  ),
  /** Case vide (alignement des menus à cocher). */
  blank: <></>,
  /** Point d'esquisse : une croix et son centre. */
  point: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </>
  ),
  /** Vue éclatée : deux blocs écartés, avec des flèches. */
  explode: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <path d="M11.5 11.5l1 1" />
      <path d="M17.5 3.5h3v3M3.5 17.5v3h3" />
    </>
  ),
  /** Axe de construction : une droite en traits d'axe, avec une flèche de rotation. */
  'datum-axis': (
    <>
      <path d="M12 2v20" stroke-dasharray="4 2 1 2" />
      <path d="M5 12.5a7 3 0 0 0 14 0" />
      <path d="M16.5 15.5l2.5-3 1 3.5" />
    </>
  ),
  /** Perçage : trou lamé vu en coupe, avec son axe. */
  hole: (
    <>
      <path d="M3 5h5v5h2v10H3z" />
      <path d="M21 5h-5v5h-2v10h7z" />
      <path d="M12 2v20" stroke-dasharray="1.5 2.5" />
    </>
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  /** Engrenage (générateur). */
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
  'gear-spur': (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M10.5 3h3l.6 2.5 2.3 1 2.2-1.4 2.1 2.1-1.4 2.2 1 2.3 2.5.6v3l-2.5.6-1 2.3 1.4 2.2-2.1 2.1-2.2-1.4-2.3 1-.6 2.5h-3l-.6-2.5-2.3-1-2.2 1.4-2.1-2.1 1.4-2.2-1-2.3L3 13.5v-3l2.5-.6 1-2.3-1.4-2.2 2.1-2.1 2.2 1.4 2.3-1z" />
    </>
  ),
  'gear-rack': (
    <>
      <path d="M2 18h20v3H2z" />
      <path d="M2 18l1-4h2l1 4M8 18l1-4h2l1 4M14 18l1-4h2l1 4M20 18l1-4h1" />
    </>
  ),
  'gear-pulley': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M6 18l1.8-1.8M16.2 7.8L18 6" />
    </>
  ),
  /** Plus d'outils (trois points). */
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" />
    </>
  ),
  /** Lecture (animer). */
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  /** Visserie : vis à tête cylindrique, vue de côté. */
  screw: (
    <>
      <path d="M8 3h8v5H8z" />
      <path d="M10.5 8v11.5l1.5 1.5 1.5-1.5V8" />
      <path d="M10.5 11l3-1M10.5 14l3-1M10.5 17l3-1" />
    </>
  ),
  /** Simulation : poutre qui fléchit sous une flèche. */
  simulate: (
    <>
      <path d="M3 9v8M3 13c6 0 11 1 18 4" />
      <path d="M17 3v7M14.5 7.5L17 10l2.5-2.5" />
    </>
  ),
  /** Face fixée : encastrement hachuré. */
  anchor: (
    <>
      <path d="M8 3v18" />
      <path d="M8 6L4 10M8 11l-4 4M8 16l-4 4" />
      <path d="M8 12h12" />
    </>
  ),
  /** Charge : flèche qui appuie sur une surface. */
  load: (
    <>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M4 19h16" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M9 4.5v15" />
    </>
  ),
  graduation: (
    <>
      <path d="M2.5 9.5L12 5l9.5 4.5L12 14z" />
      <path d="M6.5 11.5v4.5c3 2.5 8 2.5 11 0v-4.5" />
      <path d="M21.5 9.5v5" />
    </>
  ),
  offline: (
    <>
      <path d="M7 18.5a4.5 4.5 0 01-.8-8.9 6 6 0 0111.6 1.4A3.8 3.8 0 0117.5 18.5z" />
      <path d="M9.5 14l2 2 3.5-3.8" />
    </>
  ),
  print3d: (
    <>
      <path d="M5 4h14v4H5z" />
      <path d="M12 8v3" />
      <path d="M10.5 11h3l-1.5 2z" fill="currentColor" />
      <path d="M6 20h12M8 20v-3h8v3" />
    </>
  ),
  stl: (
    <>
      <path d="M12 3l8 14H4z" />
      <path d="M12 3l-2.5 14M12 3l2.5 14M6.5 12.5h11" opacity="0.5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS | string;

export function Icon({ name, title, class: className }: { name: IconName; title?: string; class?: string }) {
  return (
    <svg
      class={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name] ?? PATHS.info}
    </svg>
  );
}
