// UI translations. Static markup uses data-i18n* attributes (see applyStatic);
// code calls t(key, vars). A string value may contain {var} placeholders, a
// function value receives the vars (for plurals).

const LANG_KEY = "vp-lang";
export const LANGS = { en: "English", de: "Deutsch" };

const s = (n, one, other) => (n === 1 ? one : other);

const STRINGS = {
  en: {
    "app.title": "Vacation Planner",
    "app.description":
      "Year calendar for planning vacation, holidays and day-care closures. Share it with a link and subscribe in iCloud.",
    "lang.label": "Language",
    "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "weekdays": ["S", "M", "T", "W", "T", "F", "S"],

    // top bar
    "top.planner_name": "Planner name",
    "top.prev_year": "Previous year",
    "top.prev_year_title": "Previous year (PageUp)",
    "top.next_year": "Next year",
    "top.next_year_title": "Next year (PageDown)",
    "top.year": "Year",
    "top.share": "Share &amp; iCloud",
    "top.api": "API",
    "top.help": "Help",
    "top.help_title": "Keyboard shortcuts",

    // landing
    "landing.title": "Plan the whole year at a glance",
    "landing.lead":
      "Mark day-care closures, holidays and everybody's vacation in one shared year calendar, see which days still need cover, and subscribe to it from iCloud. No login – the link is the key.",
    "landing.create": "Create a new planner",
    "landing.config_warning":
      "The backend isn't configured yet. Add the Supabase secrets to the repository and re-run the deploy workflow (see README).",
    "landing.recent": "Recently opened on this device",
    "landing.view_only": " (view only)",
    "landing.open_label": "Open an existing planner",
    "landing.open_placeholder": "Paste a planner link or id",
    "landing.open": "Open",

    // planner
    "toolbar.label": "Entry types",
    "toolbar.edit_types": "Edit types",
    "toolbar.skip_weekends": "Skip weekends",
    "toolbar.skip_weekends_title": "Weekends are left out when filling, pasting or toggling ranges",
    "toolbar.range": "Range select",
    "toolbar.range_title": "Tap a start day, enable this, then tap the end day",
    "readonly.banner": "View-only link – ask for the edit link to make changes.",
    "grid.label": "Year calendar",
    "status.hint":
      "Then click a type or press <kbd>1</kbd>–<kbd>9</kbd> · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy/paste · drag the ▪ handle to fill · <kbd>Del</kbd> clear · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo",
    "sel.none": "Click or drag over days to select them.",
    "sel.view_only": "View-only",
    "sel.info": ({ n, work, span }) =>
      `${n} ${s(n, "day", "days")} selected (${work} ${s(work, "weekday", "weekdays")}): ${span}`,
    "chip.title": ({ name, role, days, workdays, year }) =>
      `${name} – ${role}\n${days} ${s(days, "day", "days")} in ${year}, ${workdays} ${
        s(workdays, "workday", "workdays")
      }`,
    "chip.toggle_hint": "\nClick (or press {key}) to toggle on the selected days",
    "chip.count": "{n}d",
    "fill.handle": "Drag to repeat the selected days",
    "coverage.gaps": ({ n, names }) =>
      `⚠ ${n} ${s(n, "weekday", "weekdays")} with “${names}” not covered yet`,
    "coverage.next": "Next gap →",
    "coverage.next_title": "Jump to the next uncovered day (G)",
    "coverage.ok": "✓ All “{names}” days in {year} are covered",

    // roles
    "role.none": "Normal",
    "role.needs_cover": "Needs cover",
    "role.covers": "Covers",
    "role.day_off": "Day off",

    // sync + toasts
    "sync.saving": "Saving…",
    "sync.saved": "Saved",
    "sync.offline": "Offline",
    "sync.retrying": "Offline – retrying",
    "sync.loading": "Loading…",
    "toast.save_failed": "Couldn't save: {msg}",
    "toast.load_failed": "Couldn't load: {msg}",
    "toast.not_found": "This planner doesn't exist (anymore). Check the link.",
    "toast.nothing_undo": "Nothing to undo",
    "toast.nothing_redo": "Nothing to redo",
    "toast.select_first": "Select some days first",
    "toast.select_paste": "Select where to paste first",
    "toast.copied_days": ({ n }) => `Copied ${n} ${s(n, "day", "days")}`,
    "toast.no_gaps": "No uncovered days in {year}",
    "toast.unknown_types": ({ n, names }) => `Unknown ${s(n, "type", "types")}: ${names}`,
    "toast.type_save_failed": "Couldn't save type: {msg}",
    "toast.reorder_failed": "Couldn't reorder: {msg}",
    "toast.delete_failed": "Couldn't delete: {msg}",
    "toast.add_type_failed": "Couldn't add type: {msg}",
    "toast.create_failed": "Couldn't create a planner: {msg}",
    "toast.rename_failed": "Couldn't rename: {msg}",
    "toast.copied": "Copied to clipboard",

    // types dialog
    "types.title": "Entry types",
    "types.intro": "Changes are saved immediately. The role decides how the coverage check works:",
    "types.help_needs":
      "<b>Needs cover</b> – e.g. “Day care closed”. A weekday with this entry and nothing that covers it is flagged as a gap.",
    "types.help_covers": "<b>Covers</b> – e.g. “Vacation Sascha”. Covers a “needs cover” day.",
    "types.help_day_off":
      "<b>Day off</b> – e.g. “Holiday”. Covers everything and doesn't count as a used vacation day.",
    "types.help_none": "<b>Normal</b> – just a color, no coverage logic.",
    "types.add": "+ Add type",
    "types.color": "Color",
    "types.name": "Name",
    "types.role": "Role",
    "types.up": "Move up",
    "types.down": "Move down",
    "types.delete": "Delete",
    "types.new_name": "New type {n}",
    "types.confirm_delete": "Delete “{name}”?",
    "types.confirm_delete_used": ({ name, n, year }) =>
      `Delete “${name}”? It is used on ${n} ${
        s(n, "day", "days")
      } in ${year} (and maybe other years). This can't be undone.`,

    // share dialog
    "share.title": "Share &amp; subscribe",
    "share.edit": "Edit link",
    "share.edit_help":
      "Anyone with this link can view and change the planner. Bookmark it – it's the only key.",
    "share.view": "View-only link",
    "share.icloud": "Add to iCloud / Apple Calendar",
    "share.icloud_help":
      "A read-only calendar feed. Apple Calendar checks it for changes regularly (choose “Every hour” or “Every 5 minutes” when subscribing on a Mac).",
    "share.include": "Include",
    "share.gaps": "“⚠ Not covered” warnings",
    "share.subscribe": "Subscribe on this device",
    "share.howto": "How to add it to iCloud",
    "share.howto_ios":
      "<b>iPhone / iPad:</b> tap “Subscribe on this device” above (or Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar, and paste the URL).",
    "share.howto_mac":
      "<b>Mac:</b> Calendar → File → New Calendar Subscription…, paste the URL, set <i>Location</i> to <b>iCloud</b> so it syncs to all your devices, and pick an auto-refresh interval.",
    "share.howto_sync":
      "A subscription stored in iCloud (Mac, Location “iCloud”) appears on all your Apple devices and on iCloud.com.",
    "copy": "Copy",
    "close": "Close",

    // API dialog
    "api.intro":
      "Fill entries from scripts, shortcuts or other tools. Types can be referenced by id or name. The session id in the URL is the access key.",
    "api.read": "Read the planner (types + entries of a year)",
    "api.add": "Add “{name}” from Aug 3 to Aug 14, skipping weekends",
    "api.ops": "Several operations at once (actions: add | remove | set | clear)",
    "api.types": "Entry types",
    "api.feed": "Calendar feed (read-only id works too). Optional: ?types=a,b&gaps=1",
    "api.new": "New planner",
    "api.ex_vacation": "Vacation",
    "api.ex_needs": "Day care closed",
    "api.ex_rename": "Vacation Sascha",
    "api.ex_planner": "Family {year}",

    // help dialog
    "help.title": "How it works",
    "help.click": "Click / drag",
    "help.click_do": "Select a day / a range of days (across months)",
    "help.shift": "<kbd>Shift</kbd> + click",
    "help.shift_do": "Extend the selection",
    "help.ctrl": "<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + click",
    "help.ctrl_do": "Add single days to the selection",
    "help.type": "Type button or <kbd>1</kbd>–<kbd>9</kbd>",
    "help.type_do": "Toggle that entry on the selected days (a day can have several)",
    "help.del": "<kbd>Del</kbd> / <kbd>Backspace</kbd>",
    "help.del_do": "Clear the selected days",
    "help.copy": "<kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd>",
    "help.copy_do":
      "Copy / cut / paste. Pasting onto a larger selection repeats the copied days to fill it.",
    "help.handle": "Drag the ▪ handle",
    "help.handle_do": "Repeat the selected days forwards or backwards",
    "help.arrows": "Arrow keys",
    "help.arrows_do": "Move (with <kbd>Shift</kbd>: extend the selection)",
    "help.undo": "<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>",
    "help.undo_do": "Undo / redo",
    "help.gap_do": "Jump to the next day that still needs cover",
    "help.esc": "<kbd>Esc</kbd>",
    "help.esc_do": "Clear the selection",
  },

  de: {
    "app.title": "Urlaubsplaner",
    "app.description":
      "Jahreskalender zum Planen von Urlaub, Feiertagen und Kita-Schließtagen. Per Link teilen und in iCloud abonnieren.",
    "lang.label": "Sprache",
    "months": ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    "weekdays": ["S", "M", "D", "M", "D", "F", "S"],

    "top.planner_name": "Name des Planers",
    "top.prev_year": "Vorheriges Jahr",
    "top.prev_year_title": "Vorheriges Jahr (Bild ↑)",
    "top.next_year": "Nächstes Jahr",
    "top.next_year_title": "Nächstes Jahr (Bild ↓)",
    "top.year": "Jahr",
    "top.share": "Teilen &amp; iCloud",
    "top.api": "API",
    "top.help": "Hilfe",
    "top.help_title": "Tastenkürzel",

    "landing.title": "Das ganze Jahr auf einen Blick planen",
    "landing.lead":
      "Trage Kita-Schließtage, Feiertage und den Urlaub aller in einen gemeinsamen Jahreskalender ein, sieh, welche Tage noch abgedeckt werden müssen, und abonniere ihn in iCloud. Kein Login – der Link ist der Schlüssel.",
    "landing.create": "Neuen Planer erstellen",
    "landing.config_warning":
      "Das Backend ist noch nicht eingerichtet. Lege die Supabase-Secrets im Repository an und starte den Deploy-Workflow erneut (siehe README).",
    "landing.recent": "Zuletzt auf diesem Gerät geöffnet",
    "landing.view_only": " (nur ansehen)",
    "landing.open_label": "Vorhandenen Planer öffnen",
    "landing.open_placeholder": "Link oder ID eines Planers einfügen",
    "landing.open": "Öffnen",

    "toolbar.label": "Eintragsarten",
    "toolbar.edit_types": "Arten bearbeiten",
    "toolbar.skip_weekends": "Wochenenden auslassen",
    "toolbar.skip_weekends_title":
      "Wochenenden werden beim Füllen, Einfügen und Umschalten von Bereichen ausgelassen",
    "toolbar.range": "Bereich wählen",
    "toolbar.range_title": "Starttag antippen, dies aktivieren, dann den Endtag antippen",
    "readonly.banner": "Nur-Lese-Link – frag nach dem Bearbeitungslink, um etwas zu ändern.",
    "grid.label": "Jahreskalender",
    "status.hint":
      "Dann eine Art anklicken oder <kbd>1</kbd>–<kbd>9</kbd> drücken · <kbd>Strg</kbd>+<kbd>C</kbd>/<kbd>V</kbd> kopieren/einfügen · ▪-Griff ziehen zum Füllen · <kbd>Entf</kbd> leeren · <kbd>Strg</kbd>+<kbd>Z</kbd> rückgängig",
    "sel.none": "Tage anklicken oder darüber ziehen, um sie auszuwählen.",
    "sel.view_only": "Nur ansehen",
    "sel.info": ({ n, work, span }) =>
      `${n} ${s(n, "Tag", "Tage")} ausgewählt (${work} ${
        s(work, "Wochentag", "Wochentage")
      }): ${span}`,
    "chip.title": ({ name, role, days, workdays, year }) =>
      `${name} – ${role}\n${days} ${s(days, "Tag", "Tage")} in ${year}, ${workdays} ${
        s(workdays, "Arbeitstag", "Arbeitstage")
      }`,
    "chip.toggle_hint":
      "\nKlicken (oder {key} drücken), um sie auf den ausgewählten Tagen umzuschalten",
    "chip.count": "{n} T",
    "fill.handle": "Ziehen, um die ausgewählten Tage zu wiederholen",
    "coverage.gaps": ({ n, names }) =>
      `⚠ ${n} ${s(n, "Wochentag", "Wochentage")} mit „${names}“ noch nicht abgedeckt`,
    "coverage.next": "Nächste Lücke →",
    "coverage.next_title": "Zum nächsten nicht abgedeckten Tag springen (G)",
    "coverage.ok": "✓ Alle „{names}“-Tage in {year} sind abgedeckt",

    "role.none": "Normal",
    "role.needs_cover": "Braucht Betreuung",
    "role.covers": "Betreut",
    "role.day_off": "Frei",

    "sync.saving": "Speichert…",
    "sync.saved": "Gespeichert",
    "sync.offline": "Offline",
    "sync.retrying": "Offline – neuer Versuch",
    "sync.loading": "Lädt…",
    "toast.save_failed": "Speichern fehlgeschlagen: {msg}",
    "toast.load_failed": "Laden fehlgeschlagen: {msg}",
    "toast.not_found": "Diesen Planer gibt es nicht (mehr). Prüfe den Link.",
    "toast.nothing_undo": "Nichts zum Rückgängigmachen",
    "toast.nothing_redo": "Nichts zum Wiederholen",
    "toast.select_first": "Wähle zuerst Tage aus",
    "toast.select_paste": "Wähle zuerst aus, wo eingefügt werden soll",
    "toast.copied_days": ({ n }) => `${n} ${s(n, "Tag", "Tage")} kopiert`,
    "toast.no_gaps": "Keine offenen Tage in {year}",
    "toast.unknown_types": ({ n, names }) => `Unbekannte ${s(n, "Art", "Arten")}: ${names}`,
    "toast.type_save_failed": "Art konnte nicht gespeichert werden: {msg}",
    "toast.reorder_failed": "Sortieren fehlgeschlagen: {msg}",
    "toast.delete_failed": "Löschen fehlgeschlagen: {msg}",
    "toast.add_type_failed": "Art konnte nicht hinzugefügt werden: {msg}",
    "toast.create_failed": "Planer konnte nicht erstellt werden: {msg}",
    "toast.rename_failed": "Umbenennen fehlgeschlagen: {msg}",
    "toast.copied": "In die Zwischenablage kopiert",

    "types.title": "Eintragsarten",
    "types.intro":
      "Änderungen werden sofort gespeichert. Die Rolle bestimmt, wie die Betreuungsprüfung funktioniert:",
    "types.help_needs":
      "<b>Braucht Betreuung</b> – z. B. „Kita geschlossen“. Ein Wochentag mit diesem Eintrag ohne Betreuung wird als Lücke markiert.",
    "types.help_covers":
      "<b>Betreut</b> – z. B. „Urlaub Sascha“. Deckt einen Tag ab, der Betreuung braucht.",
    "types.help_day_off":
      "<b>Frei</b> – z. B. „Feiertag“. Deckt alles ab und zählt nicht als genommener Urlaubstag.",
    "types.help_none": "<b>Normal</b> – nur eine Farbe, ohne Betreuungslogik.",
    "types.add": "+ Art hinzufügen",
    "types.color": "Farbe",
    "types.name": "Name",
    "types.role": "Rolle",
    "types.up": "Nach oben",
    "types.down": "Nach unten",
    "types.delete": "Löschen",
    "types.new_name": "Neue Art {n}",
    "types.confirm_delete": "„{name}“ löschen?",
    "types.confirm_delete_used": ({ name, n, year }) =>
      `„${name}“ löschen? Die Art wird an ${n} ${
        s(n, "Tag", "Tagen")
      } in ${year} verwendet (und evtl. in anderen Jahren). Das kann nicht rückgängig gemacht werden.`,

    "share.title": "Teilen &amp; abonnieren",
    "share.edit": "Bearbeitungslink",
    "share.edit_help":
      "Jeder mit diesem Link kann den Planer ansehen und ändern. Setz ein Lesezeichen – er ist der einzige Schlüssel.",
    "share.view": "Nur-Lese-Link",
    "share.icloud": "Zu iCloud / Apple Kalender hinzufügen",
    "share.icloud_help":
      "Ein schreibgeschützter Kalender-Feed. Apple Kalender prüft ihn regelmäßig auf Änderungen (beim Abonnieren auf dem Mac „Jede Stunde“ oder „Alle 5 Minuten“ wählen).",
    "share.include": "Enthalten",
    "share.gaps": "„⚠ Nicht abgedeckt“-Warnungen",
    "share.subscribe": "Auf diesem Gerät abonnieren",
    "share.howto": "So fügst du ihn zu iCloud hinzu",
    "share.howto_ios":
      "<b>iPhone / iPad:</b> oben auf „Auf diesem Gerät abonnieren“ tippen (oder Einstellungen → Apps → Kalender → Kalenderaccounts → Account hinzufügen → Andere → Kalenderabo hinzufügen und die URL einfügen).",
    "share.howto_mac":
      "<b>Mac:</b> Kalender → Ablage → Neues Kalenderabonnement …, URL einfügen, <i>Ort</i> auf <b>iCloud</b> stellen, damit es auf alle Geräte synchronisiert wird, und ein Aktualisierungsintervall wählen.",
    "share.howto_sync":
      "Ein in iCloud gespeichertes Abo (Mac, Ort „iCloud“) erscheint auf all deinen Apple-Geräten und auf iCloud.com.",
    "copy": "Kopieren",
    "close": "Schließen",

    "api.intro":
      "Einträge aus Skripten, Kurzbefehlen oder anderen Tools füllen. Arten können über ID oder Namen angegeben werden. Die Session-ID in der URL ist der Zugangsschlüssel.",
    "api.read": "Planer lesen (Arten + Einträge eines Jahres)",
    "api.add": "„{name}“ vom 3. bis 14. Aug. eintragen, ohne Wochenenden",
    "api.ops": "Mehrere Operationen auf einmal (Aktionen: add | remove | set | clear)",
    "api.types": "Eintragsarten",
    "api.feed": "Kalender-Feed (Nur-Lese-ID geht auch). Optional: ?types=a,b&gaps=1&lang=de",
    "api.new": "Neuer Planer",
    "api.ex_vacation": "Urlaub",
    "api.ex_needs": "Kita geschlossen",
    "api.ex_rename": "Urlaub Sascha",
    "api.ex_planner": "Familie {year}",

    "help.title": "So funktioniert's",
    "help.click": "Klicken / ziehen",
    "help.click_do": "Einen Tag / einen Zeitraum auswählen (auch über Monate hinweg)",
    "help.shift": "<kbd>Umschalt</kbd> + Klick",
    "help.shift_do": "Auswahl erweitern",
    "help.ctrl": "<kbd>Strg</kbd>/<kbd>⌘</kbd> + Klick",
    "help.ctrl_do": "Einzelne Tage zur Auswahl hinzufügen",
    "help.type": "Art-Button oder <kbd>1</kbd>–<kbd>9</kbd>",
    "help.type_do":
      "Diesen Eintrag auf den ausgewählten Tagen umschalten (ein Tag kann mehrere haben)",
    "help.del": "<kbd>Entf</kbd> / <kbd>⌫</kbd>",
    "help.del_do": "Ausgewählte Tage leeren",
    "help.copy": "<kbd>Strg</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd>",
    "help.copy_do":
      "Kopieren / ausschneiden / einfügen. Beim Einfügen in eine größere Auswahl werden die kopierten Tage wiederholt.",
    "help.handle": "▪-Griff ziehen",
    "help.handle_do": "Die ausgewählten Tage vorwärts oder rückwärts wiederholen",
    "help.arrows": "Pfeiltasten",
    "help.arrows_do": "Bewegen (mit <kbd>Umschalt</kbd>: Auswahl erweitern)",
    "help.undo": "<kbd>Strg</kbd>+<kbd>Z</kbd> / <kbd>Strg</kbd>+<kbd>Y</kbd>",
    "help.undo_do": "Rückgängig / wiederholen",
    "help.gap_do": "Zum nächsten Tag springen, der noch Betreuung braucht",
    "help.esc": "<kbd>Esc</kbd>",
    "help.esc_do": "Auswahl aufheben",
  },
};

function detect() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved in STRINGS) return saved;
  } catch {
    // storage blocked
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of prefs) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (code in STRINGS) return code;
  }
  return "en";
}

export let lang = detect();

export function setLang(next) {
  if (!(next in STRINGS)) return;
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // storage blocked
  }
}

export function t(key, vars = {}) {
  const v = STRINGS[lang][key] ?? STRINGS.en[key];
  if (v === undefined) return key;
  if (typeof v === "function") return v(vars);
  if (typeof v !== "string") return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Translates static markup: data-i18n (HTML from our own strings, so markup
 * like <kbd> is kept) and data-i18n-<attr>="key" for attributes such as
 * title, aria-label and placeholder.
 */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      if (name === "data-i18n") el.innerHTML = t(value);
      else if (name.startsWith("data-i18n-")) el.setAttribute(name.slice(10), t(value));
    }
  }
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    t("app.description"),
  );
}
