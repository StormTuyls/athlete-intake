/**
 * De omhulling van de lichte authenticatieschermen: inloggen als behandelaar,
 * een herstelmail aanvragen, een nieuw wachtwoord kiezen.
 *
 * Alle drie hadden dezelfde main: een kolom van max-w-sm, verticaal gecentreerd,
 * op de witte pagina. Op een telefoon is dat precies goed. Op een laptop is het
 * een smal formulier dat in het niets zweeft, want er is geen vlak dat zegt waar
 * het scherm ophoudt.
 *
 * Vanaf lg ligt het formulier daarom als kaart op de backdrop, dezelfde taal als
 * /home, /profile en /report. Onder lg verandert er niets: geen achtergrond,
 * geen rand, geen extra padding.
 *
 * De binnenste laag blijft een flexkolom. De schermen erin rekenen daarop: een
 * <Link> met text-center of w-full is als flex-item blokniveau, en in een gewone
 * div zou diezelfde link inline worden en links uitlijnen.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-10 lg:bg-backdrop">
      <div className="mx-auto flex w-full max-w-sm flex-col lg:rounded-card lg:bg-surface lg:p-8 lg:shadow-card lg:ring-1 lg:ring-hairline">
        {children}
      </div>
    </main>
  );
}
