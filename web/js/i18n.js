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
    "top.share": "Share",
    "top.share_title": "Share & iCloud",
    "top.more": "More",
    "menu.ai": "AI assistant",
    "menu.api": "API for scripts",
    "menu.clone": "Clone planner",
    "menu.help": "Help &amp; shortcuts",

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
    "toolbar.note": "Icon &amp; note",
    "toolbar.note_title": "Add an icon or comment to the selected days (N)",
    "toolbar.skip_weekends": "Skip weekends",
    "toolbar.skip_weekends_title": "Weekends are left out when filling, pasting or toggling ranges",
    "toolbar.range": "Range",
    "toolbar.range_title": "Tap a start day, enable this, then tap the end day",
    "toolbar.multi": "Multi-select",
    "toolbar.multi_title": "Tap days to add them to the selection or remove them",
    "toolbar.history": "Undo / redo",
    "toolbar.undo": "Undo",
    "toolbar.undo_title": "Undo (Ctrl/⌘+Z)",
    "toolbar.redo": "Redo",
    "toolbar.redo_title": "Redo (Ctrl/⌘+Y)",
    "toolbar.zoom": "Zoom",
    "toolbar.zoom_title": "Zoom: how many days fit in the calendar (Ctrl/⌘ + / − / 0)",
    "toolbar.zoom_days": ({ n }) => `${n} ${s(n, "day", "days")}`,
    "readonly.banner": "View-only link – ask for the edit link to make changes.",
    "grid.label": "Year calendar",
    "sel.none": "Click or drag over days to select them. Press ? for all shortcuts.",
    "sel.none_touch": "Tap a day to select it – long-press and drag for a range.",
    "sel.clear": "Clear",
    "sel.clear_title": "Remove all entries from the selected days (Del)",
    "sel.deselect": "Clear the selection",
    "sel.deselect_title": "Clear the selection (Esc)",
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
    "fill.count": ({ n }) => `Fill ${n} ${s(n, "day", "days")}`,
    "fill.drag_past": "Drag past the selection to repeat it",
    "coverage.gaps": ({ n }) => `⚠ ${n} uncovered ${s(n, "weekday", "weekdays")}`,
    "coverage.gaps_title": ({ n, names }) =>
      `${n} ${s(n, "weekday", "weekdays")} with “${names}” not covered yet`,
    "coverage.next": "Next gap →",
    "coverage.next_title": "Jump to the next uncovered day (G)",
    "coverage.ok": "✓ All covered",
    "coverage.ok_title": "All “{names}” days in {year} are covered",

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
    "sync.updating": "Updating…",
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
    "toast.copy_types_failed": "Couldn't copy types: {msg}",
    "toast.create_failed": "Couldn't create a planner: {msg}",
    "toast.clone_failed": "Couldn't clone the planner: {msg}",
    "toast.rate_limited": "Too many requests – please try again later",
    "toast.wait_saving": "Changes are still being saved – try again in a moment",
    "clone.confirm":
      "Create a copy of “{name}” with all years, types, entries and notes?\n\nThe copy gets its own new links; this planner stays unchanged.",
    "clone.name": "{name} (copy)",
    "toast.rename_failed": "Couldn't rename: {msg}",
    "toast.copied": "Copied to clipboard",

    // types dialog
    "types.title": "Entry types",
    "types.title_year": "Entry types {year}",
    "types.year_note":
      "These types belong to {year} – every year has its own. Changes are saved immediately.",
    "types.empty": "No entry types for {year} yet.",
    "types.empty_readonly": "No entry types for {year}.",
    "types.add_first": "Add types",
    "types.copy_from": "Copy types from {year}",
    "types.copy_from_title": "Start {to} with the types of {from}; you can change them afterwards",
    "types.help_needs":
      "<b>Needs cover</b> – e.g. “Day care closed”. A weekday with this entry and nothing that covers it is flagged as a gap.",
    "types.help_covers": "<b>Covers</b> – e.g. “Vacation Dad”. Covers a “needs cover” day.",
    "types.help_day_off":
      "<b>Day off</b> – e.g. “Holiday”. Covers everything and doesn't count as a used vacation day.",
    "types.roles_summary": "What do the roles do?",
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
      } in ${year}. This can't be undone.`,

    // note dialog
    "note.title": "Icon &amp; note",
    "note.days": ({ n, span }) => `${n} ${s(n, "day", "days")}: ${span}`,
    "note.icon": "Icon",
    "note.icon_other": "Or any other emoji",
    "note.comment": "Comment",
    "note.comment_placeholder": "e.g. Christmas",
    "note.replace_hint": "The selected days have different notes – saving replaces them.",
    "note.remove": "Remove",
    "note.cancel": "Cancel",
    "note.save": "Save",

    // share dialog
    "share.title": "Share &amp; subscribe",
    "share.tab_links": "Links",
    "share.tab_calendar": "Calendar &amp; iCloud",
    "share.edit": "Edit link",
    "share.edit_help":
      "Anyone with this link can view and change the planner. Bookmark it – it's the only key.",
    "share.view": "View-only link",
    "share.icloud_help":
      "A read-only calendar feed. Apple Calendar checks it for changes regularly (choose “Every hour” or “Every 5 minutes” when subscribing on a Mac).",
    "share.include": "Include",
    "share.gaps": "“⚠ Not covered” warnings",
    "share.notes": "Icons &amp; notes",
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

    // AI dialog
    "ai.title": "Let an AI manage this planner",
    "ai.intro":
      "Point an AI agent at one link: it explains the planner and the API, so the agent can read and change entries, types and notes for you. Changes show up here within seconds.",
    "ai.readonly": "This is a view-only link, so the AI can only read the planner.",
    "ai.quickstart": "Quickstart",
    "ai.quickstart_help":
      "Copy this prompt into an AI agent that can send HTTP requests, e.g. Claude Code, Codex or ChatGPT agent mode.",
    "ai.prompt_text":
      "Read {url} – it explains how to view and change my vacation planner. Then help me plan with it.",
    "ai.prompt_text_readonly":
      "Read {url} – it explains how to view my vacation planner. Then answer my questions about it.",
    "ai.prompt": "Prompt",
    "ai.copy": "Copy prompt",
    "ai.warning":
      "Like the edit link, this link is the key: anyone who has it – including the AI service – can change the planner.",

    // API dialog
    "api.intro":
      "Fill entries from scripts, shortcuts or other tools. Types can be referenced by id or name and belong to a year: a day uses the types of its year. The session id in the URL is the access key.",
    "api.read": "Read the planner (types, entries and notes of a year)",
    "api.add": "Add “{name}” from Aug 3 to Aug 14, skipping weekends",
    "api.ops": "Several operations at once (actions: add | remove | set | clear)",
    "api.notes": "Icon and comment on days (set replaces a day's note, clear removes it)",
    "api.types": "Entry types of a year (every year has its own; copy them into another year)",
    "api.feed": "Calendar feed (read-only id works too). Optional: ?types=a,b&gaps=1&notes=1",
    "api.new": "New planner",
    "api.ex_vacation": "Vacation",
    "api.ex_needs": "Day care closed",
    "api.ex_rename": "Vacation Dad",
    "api.ex_planner": "Family {year}",
    "api.ex_note": "Christmas",

    // help dialog
    "help.title": "How it works",
    "help.tap": "Tap",
    "help.tap_do": "Select a day; tap another day to move the selection",
    "help.long_press": "Long-press + drag",
    "help.long_press_do": "Select a range of days",
    "help.range": "Range",
    "help.range_do": "Tap a start day, then “Range”, then the end day",
    "help.multi": "Multi-select",
    "help.multi_do":
      "Turn it on, then tap days to add or remove them; long-press + drag adds a range",
    "help.undo_touch": "↶ / ↷",
    "help.help_do": "Show this help",
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
    "help.note": "<kbd>N</kbd> / double-click",
    "help.note_do": "Add an icon or comment to the selected days",
    "help.zoom": "<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd>",
    "help.zoom_do": "Zoom the calendar in / out (fewer or more days at once) / reset",
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
    "top.share": "Teilen",
    "top.share_title": "Teilen & iCloud",
    "top.more": "Mehr",
    "menu.ai": "KI-Assistent",
    "menu.api": "API für Skripte",
    "menu.clone": "Planer duplizieren",
    "menu.help": "Hilfe &amp; Tastenkürzel",

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
    "toolbar.note": "Symbol &amp; Notiz",
    "toolbar.note_title": "Den ausgewählten Tagen ein Symbol oder einen Kommentar geben (N)",
    "toolbar.skip_weekends": "Wochenenden auslassen",
    "toolbar.skip_weekends_title":
      "Wochenenden werden beim Füllen, Einfügen und Umschalten von Bereichen ausgelassen",
    "toolbar.range": "Bereich",
    "toolbar.range_title": "Starttag antippen, dies aktivieren, dann den Endtag antippen",
    "toolbar.multi": "Mehrfachauswahl",
    "toolbar.multi_title":
      "Tage antippen, um sie zur Auswahl hinzuzufügen oder daraus zu entfernen",
    "toolbar.history": "Rückgängig / wiederholen",
    "toolbar.undo": "Rückgängig",
    "toolbar.undo_title": "Rückgängig (Strg/⌘+Z)",
    "toolbar.redo": "Wiederholen",
    "toolbar.redo_title": "Wiederholen (Strg/⌘+Y)",
    "toolbar.zoom": "Zoom",
    "toolbar.zoom_title": "Zoom: wie viele Tage in den Kalender passen (Strg/⌘ + / − / 0)",
    "toolbar.zoom_days": ({ n }) => `${n} ${s(n, "Tag", "Tage")}`,
    "readonly.banner": "Nur-Lese-Link – frag nach dem Bearbeitungslink, um etwas zu ändern.",
    "grid.label": "Jahreskalender",
    "sel.none":
      "Tage anklicken oder darüber ziehen, um sie auszuwählen. ? zeigt alle Tastenkürzel.",
    "sel.none_touch": "Tippe auf einen Tag – lange drücken und ziehen wählt einen Bereich.",
    "sel.clear": "Leeren",
    "sel.clear_title": "Alle Einträge der ausgewählten Tage entfernen (Entf)",
    "sel.deselect": "Auswahl aufheben",
    "sel.deselect_title": "Auswahl aufheben (Esc)",
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
    "fill.count": ({ n }) => `${n} ${s(n, "Tag", "Tage")} füllen`,
    "fill.drag_past": "Über die Auswahl hinaus ziehen, um sie zu wiederholen",
    "coverage.gaps": ({ n }) => `⚠ ${n} ${s(n, "Wochentag", "Wochentage")} nicht abgedeckt`,
    "coverage.gaps_title": ({ n, names }) =>
      `${n} ${s(n, "Wochentag", "Wochentage")} mit „${names}“ noch nicht abgedeckt`,
    "coverage.next": "Nächste Lücke →",
    "coverage.next_title": "Zum nächsten nicht abgedeckten Tag springen (G)",
    "coverage.ok": "✓ Alles abgedeckt",
    "coverage.ok_title": "Alle „{names}“-Tage in {year} sind abgedeckt",

    "role.none": "Normal",
    "role.needs_cover": "Braucht Betreuung",
    "role.covers": "Betreut",
    "role.day_off": "Frei",

    "sync.saving": "Speichert…",
    "sync.saved": "Gespeichert",
    "sync.offline": "Offline",
    "sync.retrying": "Offline – neuer Versuch",
    "sync.loading": "Lädt…",
    "sync.updating": "Aktualisiert…",
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
    "toast.copy_types_failed": "Arten konnten nicht übernommen werden: {msg}",
    "toast.create_failed": "Planer konnte nicht erstellt werden: {msg}",
    "toast.clone_failed": "Planer konnte nicht dupliziert werden: {msg}",
    "toast.rate_limited": "Zu viele Anfragen – bitte später noch einmal versuchen",
    "toast.wait_saving": "Änderungen werden noch gespeichert – gleich noch einmal versuchen",
    "clone.confirm":
      "Eine Kopie von „{name}“ mit allen Jahren, Typen, Einträgen und Notizen erstellen?\n\nDie Kopie bekommt eigene, neue Links; dieser Planer bleibt unverändert.",
    "clone.name": "{name} (Kopie)",
    "toast.rename_failed": "Umbenennen fehlgeschlagen: {msg}",
    "toast.copied": "In die Zwischenablage kopiert",

    "types.title": "Eintragsarten",
    "types.title_year": "Eintragsarten {year}",
    "types.year_note":
      "Diese Arten gehören zu {year} – jedes Jahr hat eigene. Änderungen werden sofort gespeichert.",
    "types.empty": "Noch keine Eintragsarten für {year}.",
    "types.empty_readonly": "Keine Eintragsarten für {year}.",
    "types.add_first": "Arten hinzufügen",
    "types.copy_from": "Arten aus {year} übernehmen",
    "types.copy_from_title":
      "{to} mit den Arten aus {from} beginnen; sie lassen sich danach ändern",
    "types.help_needs":
      "<b>Braucht Betreuung</b> – z. B. „Kita geschlossen“. Ein Wochentag mit diesem Eintrag ohne Betreuung wird als Lücke markiert.",
    "types.help_covers":
      "<b>Betreut</b> – z. B. „Urlaub Papa“. Deckt einen Tag ab, der Betreuung braucht.",
    "types.help_day_off":
      "<b>Frei</b> – z. B. „Feiertag“. Deckt alles ab und zählt nicht als genommener Urlaubstag.",
    "types.roles_summary": "Was bewirken die Rollen?",
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
      } in ${year} verwendet. Das kann nicht rückgängig gemacht werden.`,

    "note.title": "Symbol &amp; Notiz",
    "note.days": ({ n, span }) => `${n} ${s(n, "Tag", "Tage")}: ${span}`,
    "note.icon": "Symbol",
    "note.icon_other": "Oder ein beliebiges anderes Emoji",
    "note.comment": "Kommentar",
    "note.comment_placeholder": "z. B. Weihnachten",
    "note.replace_hint":
      "Die ausgewählten Tage haben unterschiedliche Notizen – beim Speichern werden sie ersetzt.",
    "note.remove": "Entfernen",
    "note.cancel": "Abbrechen",
    "note.save": "Speichern",

    "share.title": "Teilen &amp; abonnieren",
    "share.tab_links": "Links",
    "share.tab_calendar": "Kalender &amp; iCloud",
    "share.edit": "Bearbeitungslink",
    "share.edit_help":
      "Jeder mit diesem Link kann den Planer ansehen und ändern. Setz ein Lesezeichen – er ist der einzige Schlüssel.",
    "share.view": "Nur-Lese-Link",
    "share.icloud_help":
      "Ein schreibgeschützter Kalender-Feed. Apple Kalender prüft ihn regelmäßig auf Änderungen (beim Abonnieren auf dem Mac „Jede Stunde“ oder „Alle 5 Minuten“ wählen).",
    "share.include": "Enthalten",
    "share.gaps": "„⚠ Nicht abgedeckt“-Warnungen",
    "share.notes": "Symbole &amp; Notizen",
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

    "ai.title": "Planer von einer KI verwalten lassen",
    "ai.intro":
      "Gib einem KI-Agenten einen einzigen Link: Er erklärt den Planer und die API, damit der Agent Einträge, Arten und Notizen für dich lesen und ändern kann. Änderungen erscheinen hier nach wenigen Sekunden.",
    "ai.readonly": "Das ist ein Nur-Lese-Link, die KI kann den Planer also nur lesen.",
    "ai.quickstart": "Schnellstart",
    "ai.quickstart_help":
      "Kopiere diesen Prompt in einen KI-Agenten, der HTTP-Anfragen senden kann, z. B. Claude Code, Codex oder den ChatGPT-Agentenmodus.",
    "ai.prompt_text":
      "Lies {url} – dort steht, wie du meinen Urlaubsplaner ansehen und ändern kannst. Hilf mir dann bei der Planung.",
    "ai.prompt_text_readonly":
      "Lies {url} – dort steht, wie du meinen Urlaubsplaner ansehen kannst. Beantworte mir dann Fragen dazu.",
    "ai.prompt": "Prompt",
    "ai.copy": "Prompt kopieren",
    "ai.warning":
      "Wie der Bearbeitungslink ist dieser Link der Schlüssel: Wer ihn hat – auch der KI-Dienst –, kann den Planer ändern.",

    "api.intro":
      "Einträge aus Skripten, Kurzbefehlen oder anderen Tools füllen. Arten können über ID oder Namen angegeben werden und gehören zu einem Jahr: Ein Tag nutzt die Arten seines Jahres. Die Session-ID in der URL ist der Zugangsschlüssel.",
    "api.read": "Planer lesen (Arten, Einträge und Notizen eines Jahres)",
    "api.add": "„{name}“ vom 3. bis 14. Aug. eintragen, ohne Wochenenden",
    "api.ops": "Mehrere Operationen auf einmal (Aktionen: add | remove | set | clear)",
    "api.notes":
      "Symbol und Kommentar an Tagen (set ersetzt die Notiz eines Tages, clear entfernt sie)",
    "api.types":
      "Eintragsarten eines Jahres (jedes Jahr hat eigene; in ein anderes Jahr übernehmen)",
    "api.feed":
      "Kalender-Feed (Nur-Lese-ID geht auch). Optional: ?types=a,b&gaps=1&notes=1&lang=de",
    "api.new": "Neuer Planer",
    "api.ex_vacation": "Urlaub",
    "api.ex_needs": "Kita geschlossen",
    "api.ex_rename": "Urlaub Papa",
    "api.ex_planner": "Familie {year}",
    "api.ex_note": "Weihnachten",

    "help.title": "So funktioniert's",
    "help.tap": "Tippen",
    "help.tap_do": "Tag auswählen; ein anderer Tag verschiebt die Auswahl",
    "help.long_press": "Lange drücken + ziehen",
    "help.long_press_do": "Einen Bereich von Tagen auswählen",
    "help.range": "Bereich",
    "help.range_do": "Starttag antippen, dann „Bereich“, dann den Endtag",
    "help.multi": "Mehrfachauswahl",
    "help.multi_do":
      "Einschalten, dann Tage antippen, um sie hinzuzufügen oder zu entfernen; lange drücken + ziehen fügt einen Bereich hinzu",
    "help.undo_touch": "↶ / ↷",
    "help.help_do": "Diese Hilfe zeigen",
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
    "help.note": "<kbd>N</kbd> / Doppelklick",
    "help.note_do": "Den ausgewählten Tagen ein Symbol oder einen Kommentar geben",
    "help.zoom": "<kbd>Strg</kbd>/<kbd>⌘</kbd> + <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd>",
    "help.zoom_do":
      "Kalender vergrößern / verkleinern (weniger oder mehr Tage auf einmal) / zurücksetzen",
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
