import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Een pagina die er niet is.
 *
 * Ook de uitkomst van notFound(), dat op zes plekken wordt aangeroepen: bij een
 * id dat geen uuid is, bij een dossier dat niet van deze behandelaar is, en bij
 * "ingelogd maar geen behandelaar". Dat laatste is in lib/review/access.ts
 * bewust een 404 en geen inlogscherm, want het bestaan van een dossier is zelf
 * al informatie.
 *
 * De terugkoppeling gaat naar de wortel en niet naar /coach. app/page.tsx stuurt
 * door op basis van wie er is, dus een atleet die hier belandt komt op zijn
 * thuisscherm en niet op een werklijst die hij niet mag zien.
 */
export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFound")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("notFoundNote")}</p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-sm underline">
        {t("backHome")}
      </Link>
    </main>
  );
}
