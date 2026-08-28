import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'alert'
  | 'archive'
  | 'calendar'
  | 'check'
  | 'chevron-right'
  | 'clock'
  | 'close'
  | 'grid'
  | 'inbox'
  | 'key'
  | 'logout'
  | 'menu'
  | 'plus'
  | 'download'
  | 'settings'
  | 'search'
  | 'wallet';

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

const paths: Record<IconName, ReactNode> = {
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.7v4.7" />
      <path d="M12 15.7h.01" />
    </>
  ),
  archive: (
    <>
      <path d="M4.5 7.5h15" />
      <path d="M6.2 7.5v9.8h11.6V7.5" />
      <path d="M5.3 4.7h13.4v2.8H5.3z" />
      <path d="M9.3 11.4h5.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="4.3" y="5.5" width="15.4" height="14" rx="1.7" />
      <path d="M7.8 3.8v3.4M16.2 3.8v3.4M4.3 9.3h15.4" />
      <path d="M8.1 13h.01M12 13h.01M15.9 13h.01M8.1 16h.01M12 16h.01" />
    </>
  ),
  check: <path d="m5.2 12.3 4.2 4.1 9.3-9.3" />,
  'chevron-right': <path d="m9.2 5.7 6.1 6.3-6.1 6.3" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2v5l3.5 2" />
    </>
  ),
  close: <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />,
  grid: (
    <>
      <rect x="4.5" y="4.5" width="5.8" height="5.8" rx=".8" />
      <rect x="13.7" y="4.5" width="5.8" height="5.8" rx=".8" />
      <rect x="4.5" y="13.7" width="5.8" height="5.8" rx=".8" />
      <rect x="13.7" y="13.7" width="5.8" height="5.8" rx=".8" />
    </>
  ),
  inbox: (
    <>
      <path d="M4.5 6.2h15v11.6h-15z" />
      <path d="m4.5 14.2 3.2-3.4h2.6l1.7 2.2h2.3l1.7-2.2h.5l3 3.4" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="15.5" r="3.2" />
      <path d="m11 13 8-8M15 5h4v4M15.1 8.9l2 2" />
    </>
  ),
  logout: (
    <>
      <path d="M10.2 5.1H5.6v13.8h4.6" />
      <path d="M13.5 8.1 17.4 12l-3.9 3.9M17.1 12H8.8" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v10.3M8.2 11.2 12 15l3.8-3.8" />
      <path d="M5 18.3h14" />
    </>
  ),
  menu: <path d="M4.7 7.2h14.6M4.7 12h14.6M4.7 16.8h14.6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M19.1 13.6a7.7 7.7 0 0 0 .1-1.6 7.7 7.7 0 0 0-.1-1.6l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.7-1.6L13.7 2h-3.9l-.4 2.8a7.6 7.6 0 0 0-2.7 1.6l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0-.1 1.6 7.7 7.7 0 0 0 .1 1.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.7 1.6l.4 2.8h3.9l.4-2.8a7.6 7.6 0 0 0 2.7-1.6l2.4 1 2-3.4-2.1-1.6Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="5.6" />
      <path d="m15 15 4.2 4.2" />
    </>
  ),
  wallet: (
    <>
      <path d="M4.4 7.2h14.2a1.5 1.5 0 0 1 1.5 1.5v8.1a1.5 1.5 0 0 1-1.5 1.5H5.4A1.5 1.5 0 0 1 3.9 16.8V6.2a1.5 1.5 0 0 1 1.5-1.5h12.1" />
      <path d="M15.4 12.7h4.7v3.1h-4.7a1.6 1.6 0 1 1 0-3.1Z" />
    </>
  ),
};

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
