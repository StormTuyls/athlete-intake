import {
  createTranslator,
  type Messages,
  type NamespaceKeys,
  type NestedKeyOf,
} from "use-intl/core";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import nl from "@/messages/nl.json";
import en from "@/messages/en.json";

/**
 * Teksten buiten een aanvraag om.
 *
 * next-intl/server werkt alleen binnen een render of een route handler. Twee
 * plekken in deze codebase zitten daarbuiten en dat is geen detail:
 *
 * - evals/chat.test.ts roept runChatTurn aan vanuit een gewoon tsx-script
 * - evals/run.ts en evals/conflict.test.ts doen hetzelfde met processDocument
 *
 * In zo'n script is de react-server-conditie niet gezet en heeft de Next-plugin
 * de alias `next-intl/config` nooit gelegd, dus getTranslations gooit daar. Alles
 * wat een script kan bereiken moet dus hierlangs.
 *
 * Niet importeren uit een "use client"-module: dan gaan beide catalogi mee in de
 * bundel van de browser.
 */

const CATALOGS = { nl, en } as const;

export function translator<
  Namespace extends NamespaceKeys<Messages, NestedKeyOf<Messages>>,
>(locale: Locale | undefined, namespace: Namespace) {
  const resolved = locale ?? DEFAULT_LOCALE;
  const other = resolved === "nl" ? "en" : "nl";

  // Zelfde terugval als in i18n/request.ts: een ontbrekende sleutel levert de
  // andere taal op en geen dotted pad. De cast is nodig omdat een spread van
  // twee catalogi een eigen objecttype oplevert, terwijl de sleuteltypes uit
  // Messages moeten komen; de pariteitstest houdt die twee gelijk.
  const messages = { ...CATALOGS[other], ...CATALOGS[resolved] } as Messages;

  return createTranslator<Messages, Namespace>({
    locale: resolved,
    messages,
    namespace,
    timeZone: "Europe/Brussels",
  });
}
