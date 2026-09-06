/**
 * Inline SVG's in plaats van een icoonpakket.
 *
 * Het zijn er een handvol en ze zijn allemaal klein. Een dependency erbij in een
 * codebase die medische data verwerkt is een bewuste keuze, en voor tien paden
 * is die keuze nee. Alles erft currentColor, zodat de kleur uit de tekstklasse
 * van de ouder komt en er geen tweede plek is waar kleur bepaald wordt.
 *
 * Iconen zijn decoratief: aria-hidden staat aan, en de betekenis staat in de
 * tekst ernaast of in een aria-label op de knop.
 */

interface IconProps {
  className?: string;
}

function svgProps(className?: string) {
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

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TagIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M20.6 13.4 12 4.8V2H4v8h2.8l8.6 8.6a2 2 0 0 0 2.8 0l2.4-2.4a2 2 0 0 0 0-2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 2.4 17.3A2 2 0 0 0 4.1 20.3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

/** Het documentsilhouet dat alle bestandsiconen delen. */
function FileOutline() {
  return (
    <>
      <path d="M14 2H6.8A1.8 1.8 0 0 0 5 3.8v16.4A1.8 1.8 0 0 0 6.8 22h10.4a1.8 1.8 0 0 0 1.8-1.8V7Z" />
      <path d="M14 2v5h5" />
    </>
  );
}

export function FilePdfIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <FileOutline />
      <path d="M8.6 17.6v-3.2h1.1a.9.9 0 0 1 0 1.8H8.6" />
      <path d="M12.9 17.6v-3.2h.8a1.6 1.6 0 0 1 0 3.2Z" />
    </svg>
  );
}

export function FileImageIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <FileOutline />
      <circle cx="9.2" cy="13.4" r="1" />
      <path d="M7 18.5 10 15.6l2 1.9 2-2.1 2.2 3.1Z" />
    </svg>
  );
}

export function FileSheetIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <FileOutline />
      <path d="M7.5 13.6h9M7.5 16.4h9M11.2 12.4v6" />
    </svg>
  );
}

export function FileTextIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <FileOutline />
      <path d="M8 13.5h6M8 16.5h4" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5Z" />
    </svg>
  );
}

/**
 * Bestandsicoon op mimetype. Onbekend valt terug op tekst.
 *
 * Een component en geen functie die een componenttype teruggeeft. Dat laatste
 * maakt tijdens het renderen een nieuw componenttype aan, waardoor React de
 * subtree bij elke render weggooit en opnieuw opbouwt; de React Compiler wijst
 * dat patroon terecht af.
 */
export function FileIcon({
  mimeType,
  className,
}: {
  mimeType: string;
  className?: string;
}) {
  if (mimeType === "application/pdf") return <FilePdfIcon className={className} />;
  if (mimeType.startsWith("image/")) return <FileImageIcon className={className} />;
  if (mimeType === "text/csv") return <FileSheetIcon className={className} />;
  return <FileTextIcon className={className} />;
}
