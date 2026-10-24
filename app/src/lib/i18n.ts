// UI translations. Components call t(key, vars) and re-render on a language switch through
// useLang(). A string value may contain {var} placeholders, a function value receives the vars
// (for plurals). Strings with markup (<b>, <kbd>) are our own and rendered as HTML.

import { useSyncExternalStore } from "react";

export type Lang = "en" | "de";
export const LANGS: Record<Lang, string> = { en: "English", de: "Deutsch" };
const LANG_KEY = "fp-lang";
const OLD_LANG_KEY = "vp-lang"; // from before the rename

type Vars = Record<string, string | number>;
type Value = string | string[] | ((vars: Vars) => string);
type Dict = Record<string, Value>;

const s = (
  n: string | number,
  one: string,
  other: string,
) => (Number(n) === 1 ? one : other);

const STRINGS: Record<Lang, Dict> = {
  en: {
    "app.title": "Family Planner",
    "app.description":
      "Plan your family's year: vacation, holidays and day-care closures in one shared calendar. Share it with a link and subscribe in iCloud.",
    "lang.label": "Language",
    "months": [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    "weekdays": ["S", "M", "T", "W", "T", "F", "S"],

    // top bar
    "top.planner_name": "Family name",
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
    "menu.clone": "Clone family",
    "menu.export": "Export (JSON)",
    "menu.import": "Import from file…",
    "menu.help": "Help & shortcuts",
    "menu.weekdays": "Always show weekdays",
    "menu.weekdays_title": "Show the weekday letters on the days at every zoom level",
    "menu.undo_key": "Ctrl/⌘+Z",
    "menu.redo_key": "Ctrl/⌘+Y",

    // landing
    "landing.title": "Plan your family's year",
    "landing.lead":
      "One place for your family's plans: vacation, holidays and day-care closures in a shared year calendar, with a coverage check and iCloud subscriptions. Finances and an AI assistant are next. No login – the link is the key.",
    "landing.create": "Create a family",
    "landing.config_warning":
      "The backend isn't configured yet. Add the Supabase secrets to the repository and re-run the deploy workflow (see README).",
    "landing.recent": "Recently opened on this device",
    "landing.view_only": " (view only)",
    "landing.open_label": "Open an existing family",
    "landing.open_placeholder": "Paste a link or id",
    "landing.open": "Open",

    // vacation calendar
    "toolbar.label": "Entry types",
    "toolbar.edit_types": "Edit types",
    "toolbar.note": "Icon & note",
    "toolbar.note_title": "Add an icon or comment to the selected days (N)",
    "toolbar.skip_weekends": "Skip weekends",
    "toolbar.skip_weekends_title": "Weekends are left out when filling, pasting or toggling ranges",
    "toolbar.range": "Range",
    "toolbar.range_title": "Tap a start day, enable this, then tap the end day",
    "toolbar.multi": "Multi-select",
    "toolbar.multi_title": "Tap days to add them to the selection or remove them",
    "toolbar.history": "Undo / redo",
    "toolbar.undo": "Undo",
    "toolbar.redo": "Redo",
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
    "toast.not_found": "This family doesn't exist (anymore). Check the link.",
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
    "toast.create_failed": "Couldn't create a family: {msg}",
    "toast.clone_failed": "Couldn't clone the family: {msg}",
    "toast.rate_limited": "Too many requests – please try again later",
    "toast.wait_saving": "Changes are still being saved – try again in a moment",
    "clone.confirm":
      "Create a copy of “{name}” with all years, types, entries and notes?\n\nThe copy gets its own new links; this family stays unchanged.",
    "clone.name": "{name} (copy)",
    "toast.export_failed": "Couldn't export the family: {msg}",
    "toast.import_invalid":
      "This isn't a Family Planner export (a .json file from Settings → Data → Export)",
    "toast.import_failed": "Couldn't import the file: {msg}",
    "import.confirm":
      "Replace everything in “{name}” with the contents of “{file}”?\n\nAll years, types, entries and notes of this family are overwritten; the name and the links stay. This can't be undone – export first to keep a copy.",
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
    "note.title": "Icon & note",
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
    "share.title": "Share & subscribe",
    "share.tab_links": "Links",
    "share.tab_calendar": "Calendar & iCloud",
    "share.edit": "Edit link",
    "share.edit_help":
      "Anyone with this link can view and change everything. Bookmark it – it's the only key.",
    "share.view": "View-only link",
    "share.icloud_help":
      "A read-only calendar feed. Apple Calendar checks it for changes regularly (choose “Every hour” or “Every 5 minutes” when subscribing on a Mac).",
    "share.include": "Include",
    "share.gaps": "“⚠ Not covered” warnings",
    "share.notes": "Icons & notes",
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
    "ai.title": "Let an AI manage this family's calendar",
    "ai.intro":
      "Point an AI agent at one link: it explains the calendar and the API, so the agent can read and change entries, types and notes for you. Changes show up here within seconds.",
    "ai.readonly": "This is a view-only link, so the AI can only read the calendar.",
    "ai.quickstart": "Quickstart",
    "ai.quickstart_help":
      "Copy this prompt into an AI agent that can send HTTP requests, e.g. Claude Code, Codex or ChatGPT agent mode.",
    "ai.prompt_text":
      "Read {url} – it explains how to view and change my family's vacation calendar. Then help me plan with it.",
    "ai.prompt_text_readonly":
      "Read {url} – it explains how to view my family's vacation calendar. Then answer my questions about it.",
    "ai.prompt": "Prompt",
    "ai.copy": "Copy prompt",
    "ai.warning":
      "Like the edit link, this link is the key: anyone who has it – including the AI service – can change the calendar.",

    // API dialog
    "api.intro":
      "Fill entries from scripts, shortcuts or other tools. Types can be referenced by id or name and belong to a year: a day uses the types of its year. The session id in the URL is the access key.",
    "api.read": "Read the calendar (types, entries and notes of a year)",
    "api.add": "Add “{name}” from Aug 3 to Aug 14, skipping weekends",
    "api.ops": "Several operations at once (actions: add | remove | set | clear)",
    "api.notes": "Icon and comment on days (set replaces a day's note, clear removes it)",
    "api.types": "Entry types of a year (every year has its own; copy them into another year)",
    "api.feed": "Calendar feed (read-only id works too). Optional: ?types=a,b&gaps=1&notes=1",
    "api.new": "New family",
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
    "help.undo_touch": "↶ / ↷ at the top",
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
    // ---- Family Planner shell
    "nav.vacation": "Vacation",
    "nav.finance": "Finance",
    "nav.settings": "Settings",
    "nav.help": "Help & shortcuts",
    "nav.soon": "Soon",
    "nav.planning": "Planning",
    "family.switch": "Switch family",
    "family.recent": "Opened on this device",
    "family.new": "New family",
    "family.open": "Open a link…",
    "family.open_title": "Open a family",
    "family.open_help": "Paste a Family Planner link or id.",
    "family.view_only": "view only",
    "family.calendar_only": "calendar only",
    "family.loading": "Loading…",
    "chat.title": "AI assistant",
    "chat.open": "AI assistant (Ctrl/⌘+J)",
    "chat.close": "Close the AI assistant",
    "chat.soon":
      "Soon you can chat with an AI here: it researches on the web and changes the calendar for you. You'll set it up under Settings.",
    "page.share": "Share",
    "page.undo": "Undo (Ctrl/⌘+Z)",
    "page.redo": "Redo (Ctrl/⌘+Y)",
    "settings.title": "Settings",
    "settings.general": "General",
    "settings.sharing": "Sharing",
    "settings.vacation": "Vacation",
    "settings.integrations": "Integrations",
    "settings.data": "Data",
    "settings.family_scope": "For the whole family",
    "settings.device_scope": "Only on this device",
    "settings.name": "Family name",
    "settings.name_help":
      "Shown in the family switcher, the page title and calendar subscriptions.",
    "settings.language": "Language",
    "settings.theme": "Appearance",
    "theme.system": "Like the system",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "settings.readonly": "This is a view-only link: you can look at everything, but not change it.",
    "settings.calendar_view": "Calendar view",
    "settings.skip_weekends_title":
      "Weekends are left out when filling, pasting or toggling ranges",
    "settings.types_readonly": "Entry types can only be changed with the edit link.",
    "settings.year": "Year",
    "share.view_help": "Anyone with this link can see everything, but not change anything.",
    "share.rotate": "New link",
    "share.rotate_view_confirm":
      "Make a new view-only link? The current one stops working for everyone who has it.",
    "share.rotate_feed_confirm":
      "Make a new feed link? Calendar subscriptions with the current one stop updating and need to be added again.",
    "share.rotated": "New link made",
    "share.rotate_failed": "Couldn't make a new link: {msg}",
    "share.legacy": "Old view-only link",
    "share.legacy_help":
      "Shared before the rename to Family Planner. It still opens the calendar (read-only) and the calendar subscriptions made with it, but nothing else.",
    "share.legacy_remove": "Remove",
    "share.legacy_confirm":
      "Remove the old view-only link? Everyone who has it, and calendar subscriptions made with it, lose access.",
    "share.legacy_removed": "Old link removed",
    "share.feed": "Calendar subscription",
    "share.feed_help": "This link only opens the calendar feed, nothing else.",
    "data.export_help": "All years, types, entries and notes as a JSON file (without the links).",
    "data.import_help":
      "Replaces all years, types, entries and notes of this family with an exported file; the name and the links stay. Can't be undone.",
    "data.clone_help": "A copy of this family with all its data and its own new links.",
    "data.imported": "Imported",
    "integrations.ai": "AI agents",
    "integrations.api": "API for scripts",
  },

  de: {
    "app.title": "Familienplaner",
    "app.description":
      "Plane das Jahr deiner Familie: Urlaub, Feiertage und Kita-Schließtage in einem gemeinsamen Kalender. Per Link teilen und in iCloud abonnieren.",
    "lang.label": "Sprache",
    "months": [
      "Jan",
      "Feb",
      "Mär",
      "Apr",
      "Mai",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Okt",
      "Nov",
      "Dez",
    ],
    "weekdays": ["S", "M", "D", "M", "D", "F", "S"],

    "top.planner_name": "Name der Familie",
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
    "menu.clone": "Familie duplizieren",
    "menu.export": "Exportieren (JSON)",
    "menu.import": "Aus Datei importieren…",
    "menu.help": "Hilfe & Tastenkürzel",
    "menu.weekdays": "Wochentage immer anzeigen",
    "menu.weekdays_title": "Die Wochentag-Buchstaben in jeder Zoomstufe auf den Tagen anzeigen",
    "menu.undo_key": "Strg/⌘+Z",
    "menu.redo_key": "Strg/⌘+Y",

    "landing.title": "Das Jahr deiner Familie planen",
    "landing.lead":
      "Ein Ort für die Pläne deiner Familie: Urlaub, Feiertage und Kita-Schließtage in einem gemeinsamen Jahreskalender, mit Betreuungs-Check und iCloud-Abo. Finanzen und ein KI-Assistent kommen als Nächstes. Kein Login – der Link ist der Schlüssel.",
    "landing.create": "Familie erstellen",
    "landing.config_warning":
      "Das Backend ist noch nicht eingerichtet. Lege die Supabase-Secrets im Repository an und starte den Deploy-Workflow erneut (siehe README).",
    "landing.recent": "Zuletzt auf diesem Gerät geöffnet",
    "landing.view_only": " (nur ansehen)",
    "landing.open_label": "Vorhandene Familie öffnen",
    "landing.open_placeholder": "Link oder ID einfügen",
    "landing.open": "Öffnen",

    "toolbar.label": "Eintragsarten",
    "toolbar.edit_types": "Arten bearbeiten",
    "toolbar.note": "Symbol & Notiz",
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
    "toolbar.redo": "Wiederholen",
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
    "toast.not_found": "Diese Familie gibt es nicht (mehr). Prüfe den Link.",
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
    "toast.create_failed": "Familie konnte nicht erstellt werden: {msg}",
    "toast.clone_failed": "Familie konnte nicht dupliziert werden: {msg}",
    "toast.rate_limited": "Zu viele Anfragen – bitte später noch einmal versuchen",
    "toast.wait_saving": "Änderungen werden noch gespeichert – gleich noch einmal versuchen",
    "clone.confirm":
      "Eine Kopie von „{name}“ mit allen Jahren, Typen, Einträgen und Notizen erstellen?\n\nDie Kopie bekommt eigene, neue Links; diese Familie bleibt unverändert.",
    "clone.name": "{name} (Kopie)",
    "toast.export_failed": "Familie konnte nicht exportiert werden: {msg}",
    "toast.import_invalid":
      "Das ist kein Familienplaner-Export (eine .json-Datei aus Einstellungen → Daten → Exportieren)",
    "toast.import_failed": "Datei konnte nicht importiert werden: {msg}",
    "import.confirm":
      "Alles in „{name}“ durch den Inhalt von „{file}“ ersetzen?\n\nAlle Jahre, Typen, Einträge und Notizen dieser Familie werden überschrieben; Name und Links bleiben. Das lässt sich nicht rückgängig machen – vorher exportieren, um eine Kopie zu behalten.",
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

    "note.title": "Symbol & Notiz",
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

    "share.title": "Teilen & abonnieren",
    "share.tab_links": "Links",
    "share.tab_calendar": "Kalender & iCloud",
    "share.edit": "Bearbeitungslink",
    "share.edit_help":
      "Jeder mit diesem Link kann alles ansehen und ändern. Setz ein Lesezeichen – er ist der einzige Schlüssel.",
    "share.view": "Nur-Lese-Link",
    "share.icloud_help":
      "Ein schreibgeschützter Kalender-Feed. Apple Kalender prüft ihn regelmäßig auf Änderungen (beim Abonnieren auf dem Mac „Jede Stunde“ oder „Alle 5 Minuten“ wählen).",
    "share.include": "Enthalten",
    "share.gaps": "„⚠ Nicht abgedeckt“-Warnungen",
    "share.notes": "Symbole & Notizen",
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

    "ai.title": "Den Kalender der Familie von einer KI verwalten lassen",
    "ai.intro":
      "Gib einem KI-Agenten einen einzigen Link: Er erklärt den Kalender und die API, damit der Agent Einträge, Arten und Notizen für dich lesen und ändern kann. Änderungen erscheinen hier nach wenigen Sekunden.",
    "ai.readonly": "Das ist ein Nur-Lese-Link, die KI kann den Kalender also nur lesen.",
    "ai.quickstart": "Schnellstart",
    "ai.quickstart_help":
      "Kopiere diesen Prompt in einen KI-Agenten, der HTTP-Anfragen senden kann, z. B. Claude Code, Codex oder den ChatGPT-Agentenmodus.",
    "ai.prompt_text":
      "Lies {url} – dort steht, wie du den Urlaubskalender meiner Familie ansehen und ändern kannst. Hilf mir dann bei der Planung.",
    "ai.prompt_text_readonly":
      "Lies {url} – dort steht, wie du den Urlaubskalender meiner Familie ansehen kannst. Beantworte mir dann Fragen dazu.",
    "ai.prompt": "Prompt",
    "ai.copy": "Prompt kopieren",
    "ai.warning":
      "Wie der Bearbeitungslink ist dieser Link der Schlüssel: Wer ihn hat – auch der KI-Dienst –, kann den Kalender ändern.",

    "api.intro":
      "Einträge aus Skripten, Kurzbefehlen oder anderen Tools füllen. Arten können über ID oder Namen angegeben werden und gehören zu einem Jahr: Ein Tag nutzt die Arten seines Jahres. Die Session-ID in der URL ist der Zugangsschlüssel.",
    "api.read": "Kalender lesen (Arten, Einträge und Notizen eines Jahres)",
    "api.add": "„{name}“ vom 3. bis 14. Aug. eintragen, ohne Wochenenden",
    "api.ops": "Mehrere Operationen auf einmal (Aktionen: add | remove | set | clear)",
    "api.notes":
      "Symbol und Kommentar an Tagen (set ersetzt die Notiz eines Tages, clear entfernt sie)",
    "api.types":
      "Eintragsarten eines Jahres (jedes Jahr hat eigene; in ein anderes Jahr übernehmen)",
    "api.feed":
      "Kalender-Feed (Nur-Lese-ID geht auch). Optional: ?types=a,b&gaps=1&notes=1&lang=de",
    "api.new": "Neue Familie",
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
    "help.undo_touch": "↶ / ↷ oben",
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
    // ---- Family Planner shell
    "nav.vacation": "Urlaub",
    "nav.finance": "Finanzen",
    "nav.settings": "Einstellungen",
    "nav.help": "Hilfe & Tastenkürzel",
    "nav.soon": "Bald",
    "nav.planning": "Planen",
    "family.switch": "Familie wechseln",
    "family.recent": "Auf diesem Gerät geöffnet",
    "family.new": "Neue Familie",
    "family.open": "Link öffnen…",
    "family.open_title": "Familie öffnen",
    "family.open_help": "Füge einen Link oder eine ID des Familienplaners ein.",
    "family.view_only": "nur lesen",
    "family.calendar_only": "nur Kalender",
    "family.loading": "Wird geladen…",
    "chat.title": "KI-Assistent",
    "chat.open": "KI-Assistent (Strg/⌘+J)",
    "chat.close": "KI-Assistent schließen",
    "chat.soon":
      "Bald kannst du hier mit einer KI chatten: Sie recherchiert im Web und ändert den Kalender für dich. Einrichten wirst du sie in den Einstellungen.",
    "page.share": "Teilen",
    "page.undo": "Rückgängig (Strg/⌘+Z)",
    "page.redo": "Wiederholen (Strg/⌘+Y)",
    "settings.title": "Einstellungen",
    "settings.general": "Allgemein",
    "settings.sharing": "Teilen",
    "settings.vacation": "Urlaub",
    "settings.integrations": "Integrationen",
    "settings.data": "Daten",
    "settings.family_scope": "Für die ganze Familie",
    "settings.device_scope": "Nur auf diesem Gerät",
    "settings.name": "Name der Familie",
    "settings.name_help": "Erscheint im Familienwechsler, im Seitentitel und in Kalender-Abos.",
    "settings.language": "Sprache",
    "settings.theme": "Darstellung",
    "theme.system": "Wie das System",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "settings.readonly":
      "Das ist ein Nur-Lese-Link: Du kannst dir alles ansehen, aber nichts ändern.",
    "settings.calendar_view": "Kalenderansicht",
    "settings.skip_weekends_title":
      "Wochenenden werden beim Füllen, Einfügen und Umschalten von Bereichen ausgelassen",
    "settings.types_readonly": "Arten lassen sich nur mit dem Bearbeitungslink ändern.",
    "settings.year": "Jahr",
    "share.view_help": "Jeder mit diesem Link kann alles ansehen, aber nichts ändern.",
    "share.rotate": "Neuer Link",
    "share.rotate_view_confirm":
      "Einen neuen Nur-Lese-Link erstellen? Der bisherige funktioniert dann für niemanden mehr.",
    "share.rotate_feed_confirm":
      "Einen neuen Abo-Link erstellen? Kalender-Abos mit dem bisherigen werden nicht mehr aktualisiert und müssen neu hinzugefügt werden.",
    "share.rotated": "Neuer Link erstellt",
    "share.rotate_failed": "Neuer Link konnte nicht erstellt werden: {msg}",
    "share.legacy": "Alter Nur-Lese-Link",
    "share.legacy_help":
      "Vor der Umbenennung in Familienplaner geteilt. Er öffnet weiterhin den Kalender (nur lesen) und die damit angelegten Kalender-Abos, aber sonst nichts.",
    "share.legacy_remove": "Entfernen",
    "share.legacy_confirm":
      "Den alten Nur-Lese-Link entfernen? Alle, die ihn haben, und damit angelegte Kalender-Abos verlieren den Zugriff.",
    "share.legacy_removed": "Alter Link entfernt",
    "share.feed": "Kalender-Abo",
    "share.feed_help": "Dieser Link öffnet nur das Kalender-Abo, sonst nichts.",
    "data.export_help": "Alle Jahre, Arten, Einträge und Notizen als JSON-Datei (ohne die Links).",
    "data.import_help":
      "Ersetzt alle Jahre, Arten, Einträge und Notizen dieser Familie durch eine exportierte Datei; Name und Links bleiben. Lässt sich nicht rückgängig machen.",
    "data.clone_help": "Eine Kopie dieser Familie mit allen Daten und eigenen, neuen Links.",
    "data.imported": "Importiert",
    "integrations.ai": "KI-Agenten",
    "integrations.api": "API für Skripte",
  },
};

function stored(): string | null {
  try {
    return localStorage.getItem(LANG_KEY) ?? localStorage.getItem(OLD_LANG_KEY);
  } catch {
    return null; // storage blocked
  }
}

function detect(): Lang {
  const saved = stored();
  if (saved && saved in STRINGS) return saved as Lang;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of prefs) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (code in STRINGS) return code as Lang;
  }
  return "en";
}

let lang: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  if (!(next in STRINGS) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // storage blocked
  }
  applyDocument();
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current language; the component re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang);
}

export function t(key: string, vars: Vars = {}): string {
  const v = STRINGS[lang][key] ?? STRINGS.en[key];
  if (v === undefined) return key;
  if (typeof v === "function") return v(vars);
  if (typeof v !== "string") return String(v);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** A list value, e.g. the month names. */
export function tList(key: string): string[] {
  const v = STRINGS[lang][key] ?? STRINGS.en[key];
  return Array.isArray(v) ? v : [];
}

/** Keeps <html lang> and the meta description in line with the language. */
export function applyDocument() {
  document.documentElement.lang = lang;
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    t("app.description"),
  );
}
