/**
 * Iconen voor de atleetschermen. Zelfde afweging als components/intake/icons:
 * een handvol paden is geen dependency waard, en alles erft currentColor.
 */

interface IconProps {
  className?: string;
}

function props(className?: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };
}

/** Het merkteken uit het ontwerp: een cirkel met een opening. */
export function BrandMark({ className }: IconProps) {
  return (
    <svg {...props(className)} strokeWidth={2}>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...props(className)}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...props(className)}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...props(className)} strokeWidth={2.5}>
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...props(className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="M4 17.5 9.5 12l3.5 3.5L16 12l4 4.5" />
    </svg>
  );
}

export function PdfIcon({ className }: IconProps) {
  return (
    <svg {...props(className)}>
      <path d="M14 2.5H7.8A1.8 1.8 0 0 0 6 4.3v15.4a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8V7Z" />
      <path d="M14 2.5V7h4" />
      <path d="M9.5 17v-3h1a1 1 0 0 1 0 2h-1" />
      <path d="M13.5 17v-3h.7a1.5 1.5 0 0 1 0 3Z" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg {...props(className)}>
      <path d="M20 14.2a2.5 2.5 0 0 1-2.5 2.5H8.4L4.5 20V6.8a2.5 2.5 0 0 1 2.5-2.5h10.5A2.5 2.5 0 0 1 20 6.8Z" />
    </svg>
  );
}
