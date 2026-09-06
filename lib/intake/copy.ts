/**
 * Alle Engelse UI-teksten van de atleetschermen, op een plek.
 *
 * Geen next-intl. Dat is in de App Router URL-gedreven (middleware, een
 * [locale]-segment over de hele boom), terwijl onze locale geen URL-segment is
 * maar een kolom op `intakes` die uit de sessiecookie komt. next-intl nu
 * opzetten zou het verkeerde mechanisme aanzetten voor de ene taal die we
 * uitleveren.
 *
 * Komt Nederlands terug, dan is het werk hetzelfde als het nu zou zijn:
 * messages/{nl,en}.json plus een getRequestConfig die session.locale leest.
 * Vooruit bouwen levert dus niets op. Wat wel telt is dat er geen losse strings
 * in de componenten staan, en dat regelt dit bestand.
 */

export const APP_NAME = "unbound";

/**
 * Sectienamen zoals de atleet ze leest, per sleutel uit `field_definitions`.
 *
 * Bewust andere woorden dan de databanksleutel: `current_status` zegt een
 * atleet niets, "Pain & complaints" wel. De sleutels zijn de zeven secties uit
 * supabase/seed.sql en die lijst is bevroren.
 */
export const SECTION_LABELS: Record<string, string> = {
  consent: "Consent",
  identity: "About you",
  biometrics: "Body measurements",
  training: "Training",
  medical_history: "Medical history",
  current_status: "Pain & complaints",
  uploads: "Documents",
};

export function sectionLabel(key: string | null | undefined): string {
  if (!key) return "";
  return SECTION_LABELS[key] ?? key;
}

export const chat = {
  title: "Intake assistant",
  back: "Back",
  collecting: (section: string) => `Collecting: ${section.toLowerCase()}`,
  collectingIdle: "All questions answered",
  today: "Today",
  fieldCaptured: "Field captured",
  placeholder: "Type your answer...",
  send: "Send",
  addFile: "Add a document",
  thinking: "The assistant is typing",
  confirm: "Confirm",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  /** Toegankelijke naam per knop, anders hoort een schermlezer een stapel identieke "Confirm". */
  confirmField: (label: string) => `Confirm ${label.toLowerCase()}`,
  editField: (label: string) => `Edit ${label.toLowerCase()}`,
  finish: "Finish intake",
  progressLabel: (sectionsDone: number, sectionsTotal: number, required: number, requiredTotal: number) =>
    `${sectionsDone} of ${sectionsTotal} sections done, ${required} of ${requiredTotal} required fields complete`,
} as const;

export const confidenceLabels = {
  high: "High",
  medium: "Quote not found",
  low: "Inferred",
} as const;

export const errors = {
  generic: "Something went wrong",
  fileKept: "The file is kept, nothing was lost",
} as const;

/**
 * Consenttekst. Twee verplicht, de rest optioneel.
 *
 * De sleutels zijn de doelen die de server kent (zie KNOWN_PURPOSES in de
 * consent-route) en de eerste drie zijn ook dossiervelden. Loopt deze lijst uit
 * de pas met die van de server, dan weigert de server met een 400 in plaats van
 * stil iets anders vast te leggen.
 */
export const CONSENT_ITEMS = [
  {
    key: "medical_processing",
    required: true,
    label: "I consent to my medical data being processed",
    detail:
      "Needed to record your injury history, complaints and test results in your file.",
  },
  {
    key: "share_with_practitioners",
    required: false,
    label: "My data may be shared with my practitioners",
    // Dit vinkje is de grond waarop de samenvatting naar de werkomgeving van de
    // behandelaar gaat. Het moet dus zeggen wat er werkelijk gedeeld wordt en
    // wat er gebeurt als je het niet aanvinkt, niet alleen dat er "gedeeld" mag
    // worden. Zonder die precisie is het geen geldige toestemming.
    detail:
      "Your physiotherapist or sports physician then receives a summary of your intake in the secure workspace they use. Without this box, your medical information stays with your coach only, and your practitioner receives just your contact details.",
  },
  {
    key: "retention_acknowledged",
    required: true,
    label: "I understand how long my file is kept",
    detail:
      "Your file is kept for as long as your care continues, and after that as a health record. You can ask for it to be deleted at any time.",
  },
] as const;

export const consent = {
  name: "Name",
  email: "Email",
  continue: "Continue",
  busy: "Working",
} as const;

/**
 * De schermen rond het gesprek: kop, voortgang, uploaden, afronden.
 *
 * De upload- en chatteksten hieronder verdwijnen zodra uploaden in het gesprek
 * zit en ChatScreen de chatstap overneemt. Ze staan hier omdat de app tot dat
 * moment anders half Nederlands en half Engels is.
 */
export const intake = {
  title: "Intake",
  intro:
    "Send us what you already have. The assistant reads it and only asks about what is still missing.",

  fieldsKnown: (filled: number, total: number) => `${filled} of ${total} fields known`,
  requiredCount: (filled: number, total: number) => `${filled}/${total} required`,
  conflicts: (count: number) =>
    count === 1
      ? "1 contradiction between your documents. The assistant will ask you which value is right."
      : `${count} contradictions between your documents. The assistant will ask you which values are right.`,

  documents: "Documents",
  documentsHint:
    "Medical reports, scans, your training plan, test results, screenshots or a WhatsApp export. PDF, JPEG, PNG, text or CSV.",
  documentFailed: "processing failed",
  documentKept: "the file is kept",
  documentSummary: (fields: number, verified: number) =>
    `${fields} field${fields === 1 ? "" : "s"} found, ${verified} with a verified quote`,
  injuriesFound: (count: number) => `${count} injur${count === 1 ? "y" : "ies"}`,
  toQuestions: "Continue to the questions",

  answerPlaceholder: "Your answer",
  sendAnswer: "Send",

  submitted: "Submitted",
  submittedBody:
    "Your coach will review your file and get in touch. The documents you sent stay stored alongside the data taken from them.",
  submittedNotion: "A follow-up task and an invoice line were created for your coach.",

  notComplete: "not complete yet",
} as const;
