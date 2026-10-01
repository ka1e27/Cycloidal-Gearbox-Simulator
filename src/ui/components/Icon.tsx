// Thin line icons, used only where they do a job (theme, menu, disclosure, transport controls).

const PATHS = {
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2.5v2', 'M12 19.5v2', 'M4.6 4.6 6 6', 'M18 18l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M4.6 19.4 6 18', 'M18 6l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  chevron: ['m6 9 6 6 6-6'],
  play: ['M7 4.5v15l12-7.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  download: ['M20 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  upload: ['M20 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  reset: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  arrow: ['M4 12h16', 'm14 6 6 6-6 6'],
  back: ['M20 12H4', 'm10 6-6 6 6 6'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
