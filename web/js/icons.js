export const ICONS = {
  grid: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"></rect>
      <rect x="14" y="3" width="7" height="7" rx="1"></rect>
      <rect x="3" y="14" width="7" height="7" rx="1"></rect>
      <rect x="14" y="14" width="7" height="7" rx="1"></rect>
    </svg>
  `,
  chevronLeft: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6"></path>
    </svg>
  `,
  chevronRight: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `,
  close: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    </svg>
  `,
  copy: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `,
  download: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12"></path>
      <path d="m7 10 5 5 5-5"></path>
      <path d="M5 21h14"></path>
    </svg>
  `,
  eye: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `,
  eyeOff: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m2 2 20 20"></path>
      <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.3 3.5"></path>
      <path d="M14.1 14.1A3 3 0 0 1 9.9 9.9"></path>
      <path d="M6.6 6.6C3.5 8.7 2 12 2 12s3.5 8 10 8a10.5 10.5 0 0 0 4.1-.8"></path>
    </svg>
  `,
  galleryHorizontal: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 3v18"></path>
      <rect x="6" y="3" width="12" height="18" rx="2"></rect>
      <path d="M22 3v18"></path>
    </svg>
  `,
  panelLeftClose: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <path d="M9 3v18"></path>
      <path d="m16 15-3-3 3-3"></path>
    </svg>
  `,
  panelLeftOpen: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <path d="M9 3v18"></path>
      <path d="m14 9 3 3-3 3"></path>
    </svg>
  `,
  panelRightClose: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <path d="M15 3v18"></path>
      <path d="m8 9 3 3-3 3"></path>
    </svg>
  `,
  panelRightOpen: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <path d="M15 3v18"></path>
      <path d="m10 15-3-3 3-3"></path>
    </svg>
  `,
  externalLink: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 3h6v6"></path>
      <path d="M10 14 21 3"></path>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    </svg>
  `,
  image: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <circle cx="8.5" cy="10.5" r="1.5"></circle>
      <path d="m21 15-5-5L5 19"></path>
    </svg>
  `,
  music: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
  `,
  zoomIn: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5"></circle>
      <path d="M10.5 7.5v6"></path>
      <path d="M7.5 10.5h6"></path>
      <path d="m15.5 15.5 5 5"></path>
    </svg>
  `,
  zoomOut: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5"></circle>
      <path d="M7.5 10.5h6"></path>
      <path d="m15.5 15.5 5 5"></path>
    </svg>
  `,
  pause: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H6v16h4V4Z"></path>
      <path d="M18 4h-4v16h4V4Z"></path>
    </svg>
  `,
  star: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z"></path>
    </svg>
  `,
  play: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 5 11 7-11 7V5Z"></path>
    </svg>
  `,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M19 6 18 20H6L5 6"></path>
      <path d="M10 11v5"></path>
      <path d="M14 11v5"></path>
    </svg>
  `,
  video: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m16 13 5 3V8l-5 3v2Z"></path>
      <rect x="3" y="6" width="13" height="12" rx="2"></rect>
    </svg>
  `,
};
