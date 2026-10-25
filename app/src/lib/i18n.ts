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
      "One place for your family's plans: vacation, holidays and day-care closures in a shared year calendar, with a coverage check and iCloud subscriptions. Plus a transactions log for the family's finances and an AI assistant that researches and plans with you. No login – the link is the key.",
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
    "page.share": "Share",
    "page.undo": "Undo (Ctrl/⌘+Z)",
    "page.redo": "Redo (Ctrl/⌘+Y)",
    "settings.title": "Settings",
    "settings.general": "General",
    "settings.sharing": "Sharing",
    "settings.vacation": "Vacation",
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
    // ---- Finance
    "settings.finance": "Finance",
    "finance.calendar_only":
      "This link only opens the calendar. Ask for the view-only or edit link to see the finances.",
    "finance.transactions": "Transactions",
    "finance.overview": "Overview",
    "finance.add": "Add",
    "finance.add_title": "New transaction",
    "finance.edit_title": "Edit transaction",
    "finance.import": "Import CSV",
    "finance.period": "Period",
    "finance.month": "Month",
    "finance.year": "Year",
    "finance.all_time": "All time",
    "finance.previous": "Previous",
    "finance.next": "Next",
    "finance.income": "Income",
    "finance.expense": "Expense",
    "finance.expenses": "Expenses",
    "finance.net": "Balance",
    "finance.savings_rate": ({ n }) => `${n} % kept`,
    "finance.search": "Search payee, description, note",
    "finance.category": "Category",
    "finance.categories": "Categories",
    "finance.categories_help":
      "Used to sort transactions. Income categories show for money coming in, expense categories for money going out, “both” for either.",
    "finance.all_categories": "All categories",
    "finance.uncategorized": "Uncategorized",
    "finance.kind": "Kind",
    "finance.all_kinds": "In and out",
    "finance.kind_expense": "Expense",
    "finance.kind_income": "Income",
    "finance.kind_both": "Both",
    "finance.empty": "No transactions in this period. Add one or import a bank statement (CSV).",
    "finance.empty_readonly": "No transactions in this period.",
    "finance.show_more": ({ n }) => `Show more (${n} left)`,
    "finance.edit": "Edit",
    "finance.delete": "Delete",
    "finance.imported_row": "Imported from a bank statement",
    "finance.amount": "Amount",
    "finance.amount_invalid": "Enter an amount, e.g. 12.50",
    "finance.date": "Date",
    "finance.date_invalid": "Pick a date",
    "finance.payee": "Payee",
    "finance.payer": "From",
    "finance.description": "Description",
    "finance.note": "Note",
    "finance.added": "Transaction added",
    "finance.saved": "Saved",
    "finance.deleted": "Transaction deleted",
    "finance.undo": "Undo",
    "finance.undone": "Undone",
    "finance.save_failed": "Couldn't save: {msg}",
    "finance.per_month": "Per month",
    "finance.by_category": "By category",
    "finance.as_table": "Show as table",
    "finance.no_data": "No transactions in this period yet.",
    "finance.currency": "Currency",
    "finance.add_category": "Add category",
    "finance.add_defaults": "Add the default categories",
    "finance.new_category": "Category {n}",
    "finance.category_delete_confirm":
      "Delete the category “{name}”?\n\nIts transactions stay, without a category.",
    "finance.mappings": "Saved bank formats",
    "finance.mappings_help":
      "How the columns of a bank's CSV files map, remembered by their header row. Remove one to set it up again on the next import.",
    "finance.danger_zone": "Danger zone",
    "finance.clear": "Delete all finance data",
    "finance.clear_help":
      "Deletes all transactions, accounts, categories and saved bank formats of this family and resets the currency. The calendar stays as it is.",
    "finance.clear_confirm":
      "Delete all finance data?\n\nAll transactions, accounts, categories and saved bank formats are deleted for everyone in this family. This can't be undone — export the family first under Data if you might need them again.",
    "finance.cleared": "All finance data deleted",
    "finance.import_title": "Import a bank statement",
    "finance.import_help":
      "Export the transactions from your online banking as a CSV file and pick it here. Rows that were imported before are skipped.",
    "finance.import_pick": "Choose a CSV file",
    "finance.encoding": "Encoding",
    "finance.delimiter": "Separator",
    "finance.skip_rows": "Lines before the table",
    "finance.has_header": "First line has column names",
    "finance.date_format": "Date format",
    "finance.amounts": "Amounts",
    "finance.amount_single": "One column (+/−)",
    "finance.amount_split": "Debit and credit",
    "finance.debit": "Debit (out)",
    "finance.credit": "Credit (in)",
    "finance.decimal": "Number format",
    "finance.column": "Column {n}",
    "finance.import_counts": ({ ok, errors }) =>
      `${ok} ${s(ok, "row", "rows")} read` + (Number(errors) ? `, ${errors} couldn't be read` : ""),
    "finance.import_next": "Next",
    "finance.import_back": "Back",
    "finance.import_new": ({ n }) => `${n} new ${s(n, "transaction", "transactions")}`,
    "finance.import_dupes": ({ n }) => `${n} already imported – skipped`,
    "finance.import_skipped": ({ n }) =>
      `${n} ${s(n, "row", "rows")} without a date or amount – skipped`,
    "finance.import_remember": "Remember this format for the next statement",
    "finance.import_run": ({ n }) => `Import ${n}`,
    "finance.import_failed": "Couldn't import: {msg}",
    "finance.imported": ({ n, skipped }) =>
      `Imported ${n} ${s(n, "transaction", "transactions")}` +
      (Number(skipped) ? ` (${skipped} already there)` : ""),
    "finance.imported_none": ({ skipped }) => `Nothing new: all ${skipped} were already there`,
    // Accounts and transfers
    "finance.account": "Account",
    "finance.accounts": "Accounts",
    "finance.accounts_help":
      "Your bank accounts, cash or cards. A transaction can belong to one; the balance is the opening balance plus all of its transactions.",
    "finance.all_accounts": "All accounts",
    "finance.no_account": "No account",
    "finance.add_account": "Add account",
    "finance.new_account": "Account {n}",
    "finance.account_delete_confirm":
      "Delete the account “{name}”?\n\nAll its transactions are deleted too. This can't be undone.",
    "finance.opening": "Opening balance",
    "finance.balance": "Balance",
    "finance.transfer": "Transfer",
    "finance.transfers": "Transfers",
    "finance.transfer_amount_hint":
      "Part of a transfer: it counts only once, as the sum of its bookings",
    "finance.unlink": "Split up the transfer",
    "finance.unlinked": "Transfer split up",
    "finance.linked": "Combined as a transfer",
    "finance.linked_pairs": ({ n }) => `${n} ${s(n, "transfer", "transfers")} combined`,
    "finance.select": "Select",
    "finance.selected": "{n} selected · net {net}",
    "finance.combine": "Combine as transfer",
    "finance.combine_zero": "Adds up to 0: it won't count as income or expense.",
    "finance.combine_income": "It will count once, as {amount} of income.",
    "finance.combine_expense": "It will count once, as {amount} of expenses.",
    "finance.clear_selection": "Clear selection",
    "finance.find_transfers": "Find transfers",
    "finance.find_transfers_help":
      "The same amount leaving one of your accounts and arriving in another within a few days. Combined, the two count as nothing: the money stayed in the family.",
    "finance.no_suggestions":
      "No likely transfers in this period. A transfer is the same amount going out of one account and into another, at most 4 days apart.",
    "finance.combine_n": ({ n }) => `Combine ${n}`,
    "finance.auto_combine": "Auto-combine",
    "finance.auto_combine_help":
      "Combine every split booking with its parts (e.g. an order's items, also booked one by one) and every likely transfer between your accounts in this period, without a review",
    "finance.nothing_to_combine": "No transfers or split bookings found",
    "finance.auto_combined": ({ transfers, splits }) =>
      [
        Number(transfers) ? `${transfers} ${s(transfers, "transfer", "transfers")}` : "",
        Number(splits) ? `${splits} split ${s(splits, "booking", "bookings")}` : "",
      ].filter(Boolean).join(" and ") + " combined",
    "finance.import_auto_transfers": "Combine transfers and split bookings automatically",
    "finance.import_transfers": ({ n }) => `${n} ${s(n, "transfer", "transfers")} will be combined`,
    "finance.import_splits": ({ n }) =>
      `${n} split ${s(n, "booking", "bookings")} will be combined`,
    // Split bookings
    "finance.part_of": "Part of {name}",
    "finance.part_of_split": "Part of a split booking",
    "finance.split_into": ({ n }) => `Split into ${n} ${s(n, "part", "parts")}`,
    "finance.split_remainder": "remainder {amount}",
    "finance.split_amount_hint":
      "Split booking: it counts only through its parts and what they leave over",
    "finance.combine_split": "Combine as split booking",
    "finance.combine_split_help":
      "{name} ({amount}) becomes the booking, the others its parts: they count on their own, the booking only with what they leave over",
    "finance.combine_split_blocked":
      "Only transactions that aren't in a transfer or a split booking yet can be combined",
    "finance.combine_transfer_blocked": "Parts and split bookings can't be in a transfer",
    "finance.split_done": "Combined as a split booking",
    "finance.unsplit": "Undo the split",
    "finance.unsplit_part": "Take out of the split booking",
    "finance.unsplit_done": "Split undone",
    "finance.unsplit_part_done": "Taken out of the split booking",
    "finance.import_categorize":
      "Sort the new transactions into categories (like similar ones, the rest with AI)",
    "finance.import_categorize_similar":
      "Sort the new transactions into categories like similar earlier ones",
    "finance.auto_categorize": "Auto-categorize",
    "finance.auto_categorize_help":
      "Sort this period's uncategorized transactions into your categories: like similar earlier ones, the rest with AI (it may look up unknown payees on the web)",
    "finance.auto_categorize_similar":
      "Sort this period's uncategorized transactions like similar earlier ones (set up the AI assistant to sort the rest too)",
    "finance.categorizing": ({ done, total }) => `Categorizing… ${done} of ${total}`,
    "finance.categorized": ({ n, matched }) =>
      `Sorted ${n} ${s(n, "transaction", "transactions")} into categories` +
      (Number(matched) ? ` (${matched} like similar ones)` : ""),
    "finance.categorized_none": "Nothing could be categorized",
    "finance.categorize_failed": "The AI couldn't categorize: {msg}",
    // ---- AI assistant
    "settings.ai": "AI assistant",
    "chat.history": "Chats",
    "chat.no_history": "No chats yet",
    "chat.new": "New chat",
    "chat.delete": "Delete chat",
    "chat.stop": "Stop",
    "chat.send": "Send",
    "chat.thinking": "Thinking…",
    "chat.cut_off": "The connection to the assistant broke off.",
    "chat.interrupted": "Interrupted",
    "chat.placeholder": "Ask about your calendar or finances…",
    "chat.setup_first": "Set up the assistant in the settings first",
    "chat.hint": "Enter sends, Shift+Enter for a new line. Paste or attach screenshots and files.",
    "chat.attach": "Attach images or text files",
    "chat.drop": "Drop files to attach",
    "chat.remove_attachment": "Remove {name}",
    "chat.attach_processing": "Preparing {name}…",
    "chat.attach_unsupported":
      "Can't attach “{name}”: only images and text files (like .txt, .csv, .json) are supported.",
    "chat.attach_too_big": "“{name}” is too big (max. {max} MB).",
    "chat.attach_unreadable": "Couldn't read “{name}”.",
    "chat.attach_limit": "At most {n} attachments per message.",
    "chat.attach_cut": "“{name}” is long: only the first 50,000 characters are sent.",
    "chat.image_gone": "The image is no longer stored on this device.",
    "chat.setup_title": "Set up the AI assistant",
    "chat.setup_text":
      "Connect any OpenAI-compatible AI (OpenAI, OpenRouter, Mistral, a local model …) under Settings. It can then look things up on the web and plan in your calendar and finances.",
    "chat.setup_button": "Open the settings",
    "chat.intro": "Ask me anything about your family's plans, for example:",
    "chat.example_gaps": "Which days this year still need cover, and who could take them?",
    "chat.example_holidays":
      "Look up next year's public holidays here and add them to the calendar.",
    "chat.example_spending": "How much did we spend on groceries this year, per month?",
    "chat.undone": "Undone",
    "chat.undo_failed": "Couldn't undo: {msg}",
    "chat.tool.web_search": "Searching the web: {q}",
    "chat.tool.fetch_page": "Reading {host}",
    "chat.tool.get_calendar": "Reading the calendar",
    "chat.tool.change_entries": "Changing calendar entries",
    "chat.tool.set_notes": "Changing day notes",
    "chat.tool.manage_entry_types": "Changing entry types",
    "chat.tool.list_transactions": "Reading transactions",
    "chat.tool.finance_summary": "Summing up the finances",
    "chat.tool.manage_categories": "Changing categories",
    "chat.tool.change_transactions": "Changing transactions",
    "chat.tool.combine_transfers": "Combining transfers and split bookings",
    "chat.copy.chat": "Copy the chat, with all tool results",
    "chat.copy.answer": "Copy the answer, with all tool results",
    "chat.copy.you": "You",
    "chat.status.writing": "Writing…",
    "chat.status.retrying": "Connection lost – trying again ({n}/{max})…",
    "chat.detail.since": "from {d}",
    "chat.detail.until": "until {d}",
    "chat.detail.from_row": "from row {n}",
    "chat.detail.changes": ({ n }) => `${n} ${s(n, "change", "changes")}`,
    "ai_settings.edit_only": "The AI assistant can only be set up and used with the edit link.",
    "ai_settings.server_not_ready":
      "The server has no AI_CONFIG_KEY yet, so it can't store API keys. Add it as described in the README (a keyless local model still works).",
    "ai_settings.endpoint": "AI model",
    "ai_settings.endpoint_help":
      "Any API that speaks OpenAI's chat format with tool calls. Everyone with the edit link uses this setup.",
    "ai_settings.base_url": "API URL",
    "ai_settings.base_url_help": "Including the version, e.g. …/v1",
    "ai_settings.api_key": "API key",
    "ai_settings.key_help": "Stored encrypted on the server and never shown again.",
    "ai_settings.key_saved": "A key ending in {hint} is saved. Type a new one to replace it.",
    "ai_settings.remove_key": "Remove",
    "ai_settings.model": "Model",
    "ai_settings.model_help":
      "Load the list from the API, or type a model name. It needs to support tool calls.",
    "ai_settings.pick_model": "Pick a model",
    "ai_settings.load_models": "Load models",
    "ai_settings.no_models": "The API returned no models",
    "ai_settings.test": "Test",
    "ai_settings.test_ok": "{model} answered: {reply}",
    "ai_settings.saved": "Saved",
    "ai_settings.save_failed": "Couldn't save: {msg}",
    "ai_settings.search": "Web search",
    "ai_settings.search_help":
      "Lets the assistant search the web (e.g. for school holidays). Without it, it can still read pages you link.",
    "ai_settings.search_provider": "Search provider",
    "ai_settings.search_off": "Off",
    "ai_settings.search_key": "Search API key",
    "ai_settings.permissions": "Permissions",
    "ai_settings.allow_writes": "Allow changes",
    "ai_settings.allow_writes_help":
      "The assistant may change the calendar and transactions (every change can be undone). Off: it can only read.",
    "ai_settings.privacy":
      "Your messages and the calendar and finance data the assistant looks at are sent to the AI API you set up above.",
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
      "Ein Ort für die Pläne deiner Familie: Urlaub, Feiertage und Kita-Schließtage in einem gemeinsamen Jahreskalender, mit Betreuungs-Check und iCloud-Abo. Dazu ein Haushaltsbuch für die Finanzen der Familie und ein KI-Assistent, der mit dir recherchiert und plant. Kein Login – der Link ist der Schlüssel.",
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
    "page.share": "Teilen",
    "page.undo": "Rückgängig (Strg/⌘+Z)",
    "page.redo": "Wiederholen (Strg/⌘+Y)",
    "settings.title": "Einstellungen",
    "settings.general": "Allgemein",
    "settings.sharing": "Teilen",
    "settings.vacation": "Urlaub",
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
    // ---- Finance
    "settings.finance": "Finanzen",
    "finance.calendar_only":
      "Dieser Link öffnet nur den Kalender. Frag nach dem Nur-Lese- oder Bearbeitungslink, um die Finanzen zu sehen.",
    "finance.transactions": "Buchungen",
    "finance.overview": "Übersicht",
    "finance.add": "Hinzufügen",
    "finance.add_title": "Neue Buchung",
    "finance.edit_title": "Buchung bearbeiten",
    "finance.import": "CSV importieren",
    "finance.period": "Zeitraum",
    "finance.month": "Monat",
    "finance.year": "Jahr",
    "finance.all_time": "Gesamt",
    "finance.previous": "Zurück",
    "finance.next": "Weiter",
    "finance.income": "Einnahmen",
    "finance.expense": "Ausgabe",
    "finance.expenses": "Ausgaben",
    "finance.net": "Saldo",
    "finance.savings_rate": ({ n }) => `${n} % übrig`,
    "finance.search": "Empfänger, Beschreibung, Notiz suchen",
    "finance.category": "Kategorie",
    "finance.categories": "Kategorien",
    "finance.categories_help":
      "Zum Einordnen der Buchungen. Einnahme-Kategorien erscheinen bei Geld, das hereinkommt, Ausgabe-Kategorien bei Geld, das hinausgeht, „beides“ bei beidem.",
    "finance.all_categories": "Alle Kategorien",
    "finance.uncategorized": "Ohne Kategorie",
    "finance.kind": "Art",
    "finance.all_kinds": "Ein und aus",
    "finance.kind_expense": "Ausgabe",
    "finance.kind_income": "Einnahme",
    "finance.kind_both": "Beides",
    "finance.empty":
      "Keine Buchungen in diesem Zeitraum. Füge eine hinzu oder importiere einen Kontoauszug (CSV).",
    "finance.empty_readonly": "Keine Buchungen in diesem Zeitraum.",
    "finance.show_more": ({ n }) => `Mehr anzeigen (noch ${n})`,
    "finance.edit": "Bearbeiten",
    "finance.delete": "Löschen",
    "finance.imported_row": "Aus einem Kontoauszug importiert",
    "finance.amount": "Betrag",
    "finance.amount_invalid": "Gib einen Betrag ein, z. B. 12,50",
    "finance.date": "Datum",
    "finance.date_invalid": "Wähle ein Datum",
    "finance.payee": "Empfänger",
    "finance.payer": "Von",
    "finance.description": "Beschreibung",
    "finance.note": "Notiz",
    "finance.added": "Buchung hinzugefügt",
    "finance.saved": "Gespeichert",
    "finance.deleted": "Buchung gelöscht",
    "finance.undo": "Rückgängig",
    "finance.undone": "Rückgängig gemacht",
    "finance.save_failed": "Speichern fehlgeschlagen: {msg}",
    "finance.per_month": "Pro Monat",
    "finance.by_category": "Nach Kategorie",
    "finance.as_table": "Als Tabelle anzeigen",
    "finance.no_data": "Noch keine Buchungen in diesem Zeitraum.",
    "finance.currency": "Währung",
    "finance.add_category": "Kategorie hinzufügen",
    "finance.add_defaults": "Standard-Kategorien hinzufügen",
    "finance.new_category": "Kategorie {n}",
    "finance.category_delete_confirm":
      "Die Kategorie „{name}“ löschen?\n\nIhre Buchungen bleiben erhalten, ohne Kategorie.",
    "finance.mappings": "Gespeicherte Bankformate",
    "finance.mappings_help":
      "Wie die Spalten der CSV-Dateien einer Bank zugeordnet werden, erkannt an der Kopfzeile. Entferne eins, um es beim nächsten Import neu einzustellen.",
    "finance.danger_zone": "Gefahrenzone",
    "finance.clear": "Alle Finanzdaten löschen",
    "finance.clear_help":
      "Löscht alle Buchungen, Konten, Kategorien und gespeicherten Bankformate dieser Familie und setzt die Währung zurück. Der Kalender bleibt unverändert.",
    "finance.clear_confirm":
      "Alle Finanzdaten löschen?\n\nAlle Buchungen, Konten, Kategorien und gespeicherten Bankformate werden für alle in dieser Familie gelöscht. Das lässt sich nicht rückgängig machen – exportiere die Familie vorher unter Daten, falls du sie noch brauchst.",
    "finance.cleared": "Alle Finanzdaten gelöscht",
    "finance.import_title": "Kontoauszug importieren",
    "finance.import_help":
      "Exportiere die Umsätze aus deinem Online-Banking als CSV-Datei und wähle sie hier aus. Schon importierte Zeilen werden übersprungen.",
    "finance.import_pick": "CSV-Datei auswählen",
    "finance.encoding": "Zeichensatz",
    "finance.delimiter": "Trennzeichen",
    "finance.skip_rows": "Zeilen vor der Tabelle",
    "finance.has_header": "Erste Zeile enthält Spaltennamen",
    "finance.date_format": "Datumsformat",
    "finance.amounts": "Beträge",
    "finance.amount_single": "Eine Spalte (+/−)",
    "finance.amount_split": "Soll und Haben",
    "finance.debit": "Soll (aus)",
    "finance.credit": "Haben (ein)",
    "finance.decimal": "Zahlenformat",
    "finance.column": "Spalte {n}",
    "finance.import_counts": ({ ok, errors }) =>
      `${ok} ${s(ok, "Zeile", "Zeilen")} gelesen` +
      (Number(errors) ? `, ${errors} nicht lesbar` : ""),
    "finance.import_next": "Weiter",
    "finance.import_back": "Zurück",
    "finance.import_new": ({ n }) => `${n} neue ${s(n, "Buchung", "Buchungen")}`,
    "finance.import_dupes": ({ n }) => `${n} schon importiert – übersprungen`,
    "finance.import_skipped": ({ n }) =>
      `${n} ${s(n, "Zeile", "Zeilen")} ohne Datum oder Betrag – übersprungen`,
    "finance.import_remember": "Dieses Format für den nächsten Auszug merken",
    "finance.import_run": ({ n }) => `${n} importieren`,
    "finance.import_failed": "Import fehlgeschlagen: {msg}",
    "finance.imported": ({ n, skipped }) =>
      `${n} ${s(n, "Buchung", "Buchungen")} importiert` +
      (Number(skipped) ? ` (${skipped} waren schon da)` : ""),
    "finance.imported_none": ({ skipped }) => `Nichts Neues: alle ${skipped} waren schon da`,
    // Konten und Umbuchungen
    "finance.account": "Konto",
    "finance.accounts": "Konten",
    "finance.accounts_help":
      "Eure Bankkonten, Bargeld oder Karten. Eine Buchung kann zu einem gehören; der Kontostand ist der Anfangsstand plus alle seine Buchungen.",
    "finance.all_accounts": "Alle Konten",
    "finance.no_account": "Ohne Konto",
    "finance.add_account": "Konto hinzufügen",
    "finance.new_account": "Konto {n}",
    "finance.account_delete_confirm":
      "Das Konto „{name}“ löschen?\n\nAlle seine Buchungen werden ebenfalls gelöscht. Das lässt sich nicht rückgängig machen.",
    "finance.opening": "Anfangsstand",
    "finance.balance": "Kontostand",
    "finance.transfer": "Umbuchung",
    "finance.transfers": "Umbuchungen",
    "finance.transfer_amount_hint":
      "Teil einer Umbuchung: sie zählt nur einmal, als Summe ihrer Buchungen",
    "finance.unlink": "Umbuchung auflösen",
    "finance.unlinked": "Umbuchung aufgelöst",
    "finance.linked": "Als Umbuchung zusammengefasst",
    "finance.linked_pairs": ({ n }) => `${n} ${s(n, "Umbuchung", "Umbuchungen")} zusammengefasst`,
    "finance.select": "Auswählen",
    "finance.selected": "{n} ausgewählt · Summe {net}",
    "finance.combine": "Als Umbuchung zusammenfassen",
    "finance.combine_zero": "Ergibt 0: zählt weder als Einnahme noch als Ausgabe.",
    "finance.combine_income": "Zählt einmal, als Einnahme von {amount}.",
    "finance.combine_expense": "Zählt einmal, als Ausgabe von {amount}.",
    "finance.clear_selection": "Auswahl aufheben",
    "finance.find_transfers": "Umbuchungen finden",
    "finance.find_transfers_help":
      "Derselbe Betrag geht von einem eurer Konten ab und kommt innerhalb weniger Tage auf einem anderen an. Zusammengefasst zählen beide nichts: das Geld ist in der Familie geblieben.",
    "finance.no_suggestions":
      "Keine wahrscheinlichen Umbuchungen in diesem Zeitraum. Eine Umbuchung ist derselbe Betrag, der von einem Konto abgeht und auf einem anderen ankommt, höchstens 4 Tage auseinander.",
    "finance.combine_n": ({ n }) => `${n} zusammenfassen`,
    "finance.auto_combine": "Automatisch zusammenfassen",
    "finance.auto_combine_help":
      "Alle Aufteilungen mit ihren Teilen (z. B. die auch einzeln gebuchten Posten einer Bestellung) und alle wahrscheinlichen Umbuchungen zwischen euren Konten in diesem Zeitraum zusammenfassen, ohne Prüfung",
    "finance.nothing_to_combine": "Keine Umbuchungen oder Aufteilungen gefunden",
    "finance.auto_combined": ({ transfers, splits }) =>
      [
        Number(transfers) ? `${transfers} ${s(transfers, "Umbuchung", "Umbuchungen")}` : "",
        Number(splits) ? `${splits} ${s(splits, "Aufteilung", "Aufteilungen")}` : "",
      ].filter(Boolean).join(" und ") + " zusammengefasst",
    "finance.import_auto_transfers": "Umbuchungen und Aufteilungen automatisch zusammenfassen",
    "finance.import_transfers": ({ n }) =>
      `${n} ${s(n, "Umbuchung wird", "Umbuchungen werden")} zusammengefasst`,
    "finance.import_splits": ({ n }) =>
      `${n} ${s(n, "Aufteilung wird", "Aufteilungen werden")} zusammengefasst`,
    // Aufteilungen
    "finance.part_of": "Teil von {name}",
    "finance.part_of_split": "Teil einer Aufteilung",
    "finance.split_into": ({ n }) => `Aufgeteilt in ${n} ${s(n, "Teil", "Teile")}`,
    "finance.split_remainder": "Rest {amount}",
    "finance.split_amount_hint":
      "Aufgeteilte Buchung: sie zählt nur über ihre Teile und den Rest, den diese übrig lassen",
    "finance.combine_split": "Als Aufteilung zusammenfassen",
    "finance.combine_split_help":
      "{name} ({amount}) wird die Buchung, die anderen ihre Teile: sie zählen einzeln, die Buchung nur mit dem, was sie übrig lassen",
    "finance.combine_split_blocked":
      "Nur Buchungen, die noch zu keiner Umbuchung oder Aufteilung gehören, lassen sich zusammenfassen",
    "finance.combine_transfer_blocked":
      "Teile und aufgeteilte Buchungen können nicht zu einer Umbuchung gehören",
    "finance.split_done": "Als Aufteilung zusammengefasst",
    "finance.unsplit": "Aufteilung aufheben",
    "finance.unsplit_part": "Aus der Aufteilung nehmen",
    "finance.unsplit_done": "Aufteilung aufgehoben",
    "finance.unsplit_part_done": "Aus der Aufteilung genommen",
    "finance.import_categorize":
      "Die neuen Buchungen in Kategorien einsortieren (wie ähnliche, den Rest mit KI)",
    "finance.import_categorize_similar":
      "Die neuen Buchungen wie ähnliche frühere in Kategorien einsortieren",
    "finance.auto_categorize": "Automatisch einsortieren",
    "finance.auto_categorize_help":
      "Die Buchungen ohne Kategorie in diesem Zeitraum einsortieren: wie ähnliche frühere, den Rest mit KI (sie kann unbekannte Empfänger im Web nachschlagen)",
    "finance.auto_categorize_similar":
      "Die Buchungen ohne Kategorie in diesem Zeitraum wie ähnliche frühere einsortieren (mit eingerichtetem KI-Assistenten auch den Rest)",
    "finance.categorizing": ({ done, total }) => `Sortiere ein… ${done} von ${total}`,
    "finance.categorized": ({ n, matched }) =>
      `${n} ${s(n, "Buchung", "Buchungen")} in Kategorien einsortiert` +
      (Number(matched) ? ` (${matched} wie ähnliche)` : ""),
    "finance.categorized_none": "Keine Buchung konnte einsortiert werden",
    "finance.categorize_failed": "Die KI konnte nicht einsortieren: {msg}",
    // ---- AI assistant
    "settings.ai": "KI-Assistent",
    "chat.history": "Chats",
    "chat.no_history": "Noch keine Chats",
    "chat.new": "Neuer Chat",
    "chat.delete": "Chat löschen",
    "chat.stop": "Stopp",
    "chat.send": "Senden",
    "chat.thinking": "Denkt nach…",
    "chat.cut_off": "Die Verbindung zum Assistenten ist abgebrochen.",
    "chat.interrupted": "Unterbrochen",
    "chat.placeholder": "Frag nach Kalender oder Finanzen…",
    "chat.setup_first": "Richte den Assistenten zuerst in den Einstellungen ein",
    "chat.hint":
      "Enter sendet, Umschalt+Enter für eine neue Zeile. Screenshots und Dateien einfügen oder anhängen.",
    "chat.attach": "Bilder oder Textdateien anhängen",
    "chat.drop": "Dateien zum Anhängen hier ablegen",
    "chat.remove_attachment": "{name} entfernen",
    "chat.attach_processing": "{name} wird vorbereitet…",
    "chat.attach_unsupported":
      "„{name}“ lässt sich nicht anhängen: Nur Bilder und Textdateien (etwa .txt, .csv, .json) werden unterstützt.",
    "chat.attach_too_big": "„{name}“ ist zu groß (max. {max} MB).",
    "chat.attach_unreadable": "„{name}“ konnte nicht gelesen werden.",
    "chat.attach_limit": "Höchstens {n} Anhänge pro Nachricht.",
    "chat.attach_cut": "„{name}“ ist lang: Nur die ersten 50.000 Zeichen werden gesendet.",
    "chat.image_gone": "Das Bild ist auf diesem Gerät nicht mehr gespeichert.",
    "chat.setup_title": "KI-Assistent einrichten",
    "chat.setup_text":
      "Verbinde eine beliebige OpenAI-kompatible KI (OpenAI, OpenRouter, Mistral, ein lokales Modell …) in den Einstellungen. Dann kann sie im Web recherchieren und in Kalender und Finanzen planen.",
    "chat.setup_button": "Einstellungen öffnen",
    "chat.intro": "Frag mich alles zu den Plänen deiner Familie, zum Beispiel:",
    "chat.example_gaps":
      "Welche Tage brauchen dieses Jahr noch Betreuung, und wer könnte sie übernehmen?",
    "chat.example_holidays":
      "Such die Feiertage des nächsten Jahres hier heraus und trag sie in den Kalender ein.",
    "chat.example_spending":
      "Wie viel haben wir dieses Jahr pro Monat für Lebensmittel ausgegeben?",
    "chat.undone": "Rückgängig gemacht",
    "chat.undo_failed": "Rückgängig machen fehlgeschlagen: {msg}",
    "chat.tool.web_search": "Sucht im Web: {q}",
    "chat.tool.fetch_page": "Liest {host}",
    "chat.tool.get_calendar": "Liest den Kalender",
    "chat.tool.change_entries": "Ändert Kalendereinträge",
    "chat.tool.set_notes": "Ändert Tagesnotizen",
    "chat.tool.manage_entry_types": "Ändert Arten",
    "chat.tool.list_transactions": "Liest Buchungen",
    "chat.tool.finance_summary": "Rechnet die Finanzen zusammen",
    "chat.tool.manage_categories": "Ändert Kategorien",
    "chat.tool.change_transactions": "Ändert Buchungen",
    "chat.tool.combine_transfers": "Fasst Umbuchungen und Splitbuchungen zusammen",
    "chat.copy.chat": "Chat kopieren, mit allen Tool-Ergebnissen",
    "chat.copy.answer": "Antwort kopieren, mit allen Tool-Ergebnissen",
    "chat.copy.you": "Du",
    "chat.status.writing": "Schreibt…",
    "chat.status.retrying": "Verbindung unterbrochen – neuer Versuch ({n}/{max})…",
    "chat.detail.since": "ab {d}",
    "chat.detail.until": "bis {d}",
    "chat.detail.from_row": "ab Zeile {n}",
    "chat.detail.changes": ({ n }) => `${n} ${s(n, "Änderung", "Änderungen")}`,
    "ai_settings.edit_only":
      "Der KI-Assistent lässt sich nur mit dem Bearbeitungslink einrichten und nutzen.",
    "ai_settings.server_not_ready":
      "Der Server hat noch keinen AI_CONFIG_KEY und kann daher keine API-Schlüssel speichern. Füge ihn wie in der README beschrieben hinzu (ein lokales Modell ohne Schlüssel geht trotzdem).",
    "ai_settings.endpoint": "KI-Modell",
    "ai_settings.endpoint_help":
      "Jede API, die OpenAIs Chat-Format mit Tool-Aufrufen spricht. Alle mit dem Bearbeitungslink nutzen diese Einrichtung.",
    "ai_settings.base_url": "API-URL",
    "ai_settings.base_url_help": "Mit Version, z. B. …/v1",
    "ai_settings.api_key": "API-Schlüssel",
    "ai_settings.key_help":
      "Wird verschlüsselt auf dem Server gespeichert und nie wieder angezeigt.",
    "ai_settings.key_saved":
      "Ein Schlüssel mit der Endung {hint} ist gespeichert. Gib einen neuen ein, um ihn zu ersetzen.",
    "ai_settings.remove_key": "Entfernen",
    "ai_settings.model": "Modell",
    "ai_settings.model_help":
      "Lade die Liste von der API oder gib einen Modellnamen ein. Es muss Tool-Aufrufe können.",
    "ai_settings.pick_model": "Modell wählen",
    "ai_settings.load_models": "Modelle laden",
    "ai_settings.no_models": "Die API hat keine Modelle geliefert",
    "ai_settings.test": "Testen",
    "ai_settings.test_ok": "{model} antwortet: {reply}",
    "ai_settings.saved": "Gespeichert",
    "ai_settings.save_failed": "Speichern fehlgeschlagen: {msg}",
    "ai_settings.search": "Websuche",
    "ai_settings.search_help":
      "Damit kann der Assistent im Web suchen (z. B. nach Schulferien). Ohne kann er trotzdem Seiten lesen, die du verlinkst.",
    "ai_settings.search_provider": "Suchanbieter",
    "ai_settings.search_off": "Aus",
    "ai_settings.search_key": "API-Schlüssel der Suche",
    "ai_settings.permissions": "Berechtigungen",
    "ai_settings.allow_writes": "Änderungen erlauben",
    "ai_settings.allow_writes_help":
      "Der Assistent darf Kalender und Buchungen ändern (jede Änderung lässt sich rückgängig machen). Aus: Er kann nur lesen.",
    "ai_settings.privacy":
      "Deine Nachrichten und die Kalender- und Finanzdaten, die der Assistent ansieht, gehen an die oben eingerichtete KI-API.",
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
