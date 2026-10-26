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
    "landing.create": "Create a family",
    "landing.config_warning":
      "The backend isn't configured yet. Add the Supabase secrets to the repository and re-run the deploy workflow (see README).",

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
    "toast.not_found": "This family doesn't exist (anymore), or you're not a member of it.",
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
      "Create a copy of “{name}” with all years, types, entries, notes and finances?\n\nYou'll be the copy's editor and can add others; this family stays unchanged.",
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
    "share.tab_links": "Links",
    "share.tab_calendar": "Calendar & iCloud",
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
    "family.new": "New family",
    "family.view_only": "view only",
    "family.loading": "Loading…",
    "chat.title": "AI assistant",
    "chat.open": "AI assistant (Ctrl/⌘+J)",
    "chat.close": "Close the AI assistant",
    "page.share": "Share",
    "page.undo": "Undo (Ctrl/⌘+Z)",
    "page.redo": "Redo (Ctrl/⌘+Y)",
    "settings.title": "Settings",
    "settings.general": "General",
    "settings.sharing": "Calendar feed",
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
    "settings.readonly":
      "You can view this family, but not change it: ask one of its editors to make you an editor.",
    "settings.calendar_view": "Calendar view",
    "settings.skip_weekends_title":
      "Weekends are left out when filling, pasting or toggling ranges",
    "settings.types_readonly": "Only editors of the family can change entry types.",
    "settings.year": "Year",
    "share.rotate": "New link",
    "share.rotate_feed_confirm":
      "Make a new feed link? Calendar subscriptions with the current one stop updating and need to be added again.",
    "share.rotated": "New link made",
    "share.rotate_failed": "Couldn't make a new link: {msg}",
    "share.legacy": "Old calendar link",
    "share.legacy_help":
      "Shared before the rename to Family Planner. Calendar subscriptions made with it keep working; it doesn't open anything else any more.",
    "share.legacy_remove": "Remove",
    "share.legacy_confirm":
      "Remove the old calendar link? Calendar subscriptions made with it stop updating.",
    "share.legacy_removed": "Old link removed",
    "share.feed": "Calendar subscription",
    "share.feed_help":
      "The only link that works without signing in: it opens the calendar feed, nothing else.",
    "data.export_help": "All years, types, entries, notes and finances as a JSON file.",
    "data.import_help":
      "Replaces all years, types, entries and notes of this family (and its finances, if the file has them) with an exported file; the name and members stay. Can't be undone.",
    "data.clone_help": "A copy of this family with all its data, with you as its editor.",
    "data.imported": "Imported",
    // ---- Finance
    "settings.finance": "Finance",
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
      "Used to sort transactions. Income categories show for money coming in, expense categories for money going out, “both” for either. Categories can have subcategories, as deep as you like: a subcategory has the kind of its top category, and a category's totals include its subcategories.",
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
    "finance.compare.title": "Comparison",
    "finance.compare.per_month": "all per month",
    "finance.compare.month": "This month",
    "finance.compare.last_month": "Last month",
    "finance.compare.year": "This year",
    "finance.compare.last_year": "Last year",
    "finance.compare.all": "All time",
    "finance.compare.months": ({ n }) => `${n} ${s(n, "month", "months")}`,
    "finance.compare.nothing_yet": "nothing to compare yet",
    "finance.compare.expenses_by_category": "Expenses by category",
    "finance.compare.income_by_category": "Income by category",
    "finance.compare.delta_title": "{first}: {diff} per month",
    "finance.compare.delta_hint":
      "Ø = average of the completed months. The percentages show how “{first}” differs from each column.",
    "finance.benchmark": "Statistic average",
    "finance.benchmark_help":
      "Figures the overview shows your months against, e.g. the household spending of a statistics office. Each amount is a range per month in {currency}, from the lower to the upper households; one end alone is a single average. Leave out what you don't know. Not set, the overview doesn't show it.",
    "finance.benchmark_label": "Source",
    "finance.benchmark_label_placeholder":
      "e.g. Federal Statistical Office 2024, couple with 2 children",
    "finance.benchmark_income": "Income per month",
    "finance.benchmark_expense": "Expenses per month",
    "finance.benchmark_categories": "Per category",
    "finance.benchmark_save": "Save",
    "finance.benchmark_remove": "Remove",
    "finance.benchmark_invalid": "Amounts must be numbers of at least 0, “from” not above “to”.",
    "finance.benchmark_from": "from",
    "finance.benchmark_to": "to",
    "finance.benchmark.basis": "{period} ({detail})",
    "finance.benchmark.below": ({ n }) => `${n} % below`,
    "finance.benchmark.above": ({ n }) => `${n} % above`,
    "finance.benchmark.above_zero": "above",
    "finance.benchmark.on": "on average",
    "finance.benchmark.lower_half": "in range, lower half",
    "finance.benchmark.upper_half": "in range, upper half",
    "finance.benchmark.legend_range": "statistic range",
    "finance.benchmark.legend_value": "{period}",
    "finance.benchmark_ai_hint":
      "Or ask the assistant, e.g. “Look up the average spending of a family like ours and set it as statistic average.”",
    "finance.currency": "Currency",
    "finance.add_category": "Add category",
    "finance.add_defaults": "Add the default categories",
    "finance.new_category": "Category {n}",
    "finance.add_subcategory": "Add subcategory",
    "finance.move_to": "Move to",
    "finance.top_level": "Top level",
    "finance.category_actions": "More for this category",
    "finance.show_subcategories": "Show subcategories",
    "finance.hide_subcategories": "Hide subcategories",
    "finance.directly_in": "Directly in “{name}”",
    "finance.category_delete_confirm":
      "Delete the category “{name}”?\n\nIts transactions stay, without a category. Its subcategories move up to the top level.",
    "finance.subcategory_delete_confirm":
      "Delete the category “{name}”?\n\nIts transactions and subcategories move to “{parent}”.",
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
    "finance.balance_on": ({ date }) => `Balances on ${date}`,
    "finance.balance_now": "Now",
    "finance.balance_now_below": "(below: now)",
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
    "chat.queue": "Send after this answer",
    "chat.queued": "Queued",
    "chat.unqueue": "Take back this message",
    "chat.queue_wait": "Just a moment, the chat is starting.",
    "chat.placeholder_queue": "Next message – sent once this answer is done…",
    "chat.thinking": "Thinking…",
    "chat.interrupted": "Interrupted",
    "chat.placeholder": "Ask me anything…",
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
    "chat.image_gone": "The image is no longer stored.",
    "chat.setup_title": "Set up the AI assistant",
    "chat.setup_text":
      "Connect any OpenAI-compatible AI (OpenAI, OpenRouter, Mistral, a local model …) under Settings. It can then look things up on the web and plan in your calendar and finances.",
    "chat.setup_button": "Open the settings",
    "chat.intro": "Ask me anything about your family's plans, for example:",
    "chat.example_gaps": "Which days this year still need cover, and who could take them?",
    "chat.example_holidays":
      "Look up next year's public holidays here and add them to the calendar.",
    "chat.example_spending": "How much did we spend on groceries this year, per month?",
    "chat.example_uncategorized": "Sort our uncategorized transactions into categories.",
    "chat.example_types":
      "Set up this year's entry types: day care closed, each parent's vacation and public holidays.",
    "chat.example_categories": "Suggest categories for our finances and add them.",
    "chat.elsewhere": "This chat belongs to {page}.",
    "chat.move_here": "Move to {page}",
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
    "chat.tool.analyze_transactions": "Analyzing transactions",
    "chat.tool.analyze_calendar": "Counting calendar days",
    "chat.tool.calculate": "Calculating",
    "chat.tool.manage_categories": "Changing categories",
    "chat.tool.change_transactions": "Changing transactions",
    "chat.tool.set_statistic_average": "Setting the statistic average",
    "chat.tool.combine_transfers": "Combining transfers and split bookings",
    "chat.tool.ask_user": "Asking a question",
    "chat.question.pick_one": "Pick one, or write your own answer",
    "chat.question.pick_several": "Pick one or more, or write your own answer",
    "chat.question.own": "Your own answer…",
    "chat.question.send": "Answer",
    "chat.question.skipped": "Not answered",
    "chat.copy.chat": "Copy the chat, with all tool results",
    "chat.copy.answer": "Copy the answer, with all tool results",
    "chat.copy.you": "You",
    "chat.status.writing": "Writing…",
    "chat.status.retrying": "The model didn't answer – trying again ({n}/{max})…",
    "chat.status.compacting": "Condensing the earlier conversation…",
    "chat.compacted": "Earlier messages condensed for the model",
    "chat.context": "Context: {used} of {max} tokens ({pct}%)",
    "chat.context_help":
      "How much of the model's context window this chat uses. Before it is full, older messages are condensed into a summary, so long tasks can go on.",
    "chat.detail.since": "from {d}",
    "chat.detail.until": "until {d}",
    "chat.detail.from_row": "from row {n}",
    "chat.detail.changes": ({ n }) => `${n} ${s(n, "change", "changes")}`,
    "chat.detail.queries": ({ n }) => `${n} ${s(n, "query", "queries")}`,
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
    "ai_settings.context_window": "Context window (tokens)",
    "ai_settings.context_window_help":
      "How many tokens the model takes at once. Empty: from the API's model list if it says, else 128,000. Long chats are condensed before it is full.",
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
    // ---- Accounts
    "nav.admin": "Administration",
    "family.yours": "Your families",
    "settings.members": "Members",
    "user.menu": "Account menu",
    "user.account": "Account",
    "user.sign_out": "Sign out",
    "auth.title": "Sign in",
    "auth.lead":
      "Plan your family's year: vacation, holidays, day-care closures and finances in one place.",
    "auth.passkey": "Sign in with a passkey",
    "auth.or_password": "or with your password",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.sign_in": "Sign in",
    "auth.wrong": "Wrong email or password.",
    "auth.passkey_unknown":
      "This passkey isn't known here. Sign in with your password, or ask an admin for a new setup link.",
    "auth.failed": "Couldn't sign in: {msg}",
    "auth.no_account":
      "No account yet? Accounts are made by an admin of this Family Planner: ask them for a setup link.",
    "auth.load_failed": "Couldn't load your account: {msg}",
    "auth.retry": "Try again",
    "setup.title": "Setting up your account",
    "home.welcome": "Welcome, {name}",
    "home.no_family":
      "You aren't a member of a family yet. Ask someone who edits your family to add you (your account is {email}), or create a new family.",
    "account.back": "Back to the planner",
    "account.change_title": "Choose your own password",
    "account.change_lead":
      "You signed in with the initial password. Choose a new one before you continue: everyone knows the initial one.",
    "account.setup_title": "Welcome, {name}",
    "account.setup_lead":
      "Choose how you'll sign in from now on ({email}): with a passkey (your fingerprint, face or device PIN – nothing to remember), or with a password.",
    "account.reset_lead":
      "Set a new way to sign in ({email}): add a passkey, or choose a new password.",
    "account.passkey_title": "Passkey (recommended)",
    "account.passkey_help":
      "Signs you in with your fingerprint, face or device PIN. It's kept on this device or in your password manager, and works only for this site.",
    "account.passkey_create": "Create a passkey",
    "account.passkey_failed": "Couldn't add the passkey: {msg}",
    "account.or_password": "Or set a password",
    "account.password": "Password",
    "account.current_password": "Current password",
    "account.new_password": "New password",
    "account.repeat_password": "Repeat the new password",
    "account.password_help": "At least {n} characters.",
    "account.password_short": "The password needs at least {n} characters.",
    "account.password_mismatch": "The two passwords aren't the same.",
    "account.current_wrong": "The current password is wrong.",
    "account.password_saved": "Password saved. Your other devices are signed out.",
    "account.save_password": "Save password",
    "account.change_password": "Change password",
    "account.password_set": "Changing it signs out your other devices.",
    "account.password_none":
      "You sign in with passkeys only. A password is a way in from devices without your passkeys.",
    "account.password_remove": "Remove password (passkeys only)",
    "account.password_remove_confirm":
      "Remove your password? You'll only be able to sign in with your passkeys.",
    "account.profile": "Profile",
    "account.name": "Name",
    "account.email_help": "What you sign in with, and how others add you to their family.",
    "account.email_taken": "There is already an account with this email.",
    "account.save": "Save",
    "account.saved": "Saved",
    "account.save_failed": "Couldn't save: {msg}",
    "account.passkeys": "Passkeys",
    "account.passkeys_help":
      "Sign in with your fingerprint, face or device PIN. Add one on each device you use (or keep them in your password manager).",
    "account.passkey_add": "Add a passkey",
    "account.passkey_added": "Passkey added",
    "account.passkey_unsupported": "This browser can't use passkeys.",
    "account.passkey_delete_confirm":
      "Delete the passkey “{name}”? It can't be used to sign in any more.",
    "account.used": "Added {created} · last used {used}",
    "account.delete": "Delete",
    "account.tokens": "API tokens",
    "account.tokens_help":
      "For scripts and AI agents using the API: they act as you, in all your families. Send one as “Authorization: Bearer <token>” to",
    "account.token_name": "Name, e.g. “Home Assistant”",
    "account.token_create": "Create",
    "account.token_created": "Your new API token",
    "account.token_once":
      "Copy it now: it's only shown this once. Anyone with it can do what you can in your families.",
    "account.token_delete_confirm": "Delete the API token “{name}”? Scripts using it stop working.",
    "account.done": "Done",
    "admin.users": "Users",
    "admin.families": "Families",
    "admin.users_help":
      "Everyone who can sign in. New people get a one-time link to set up their passkey or password.",
    "admin.families_help":
      "All families and their members. Being an admin doesn't open a family: add yourself as a member for that.",
    "admin.user_new": "New user",
    "admin.user_new_help":
      "You'll get a link to send them: with it they set up a passkey or a password.",
    "admin.user_edit": "Edit user",
    "admin.email_help": "What they sign in with: an email address (or a simple name).",
    "admin.admin": "Admin",
    "admin.admin_help": "Admins manage users and families.",
    "admin.you": "You",
    "admin.create": "Create",
    "admin.edit": "Edit",
    "admin.setup_link": "New setup link",
    "admin.actions": "Actions",
    "admin.passkeys": ({ n }) => `${s(n, "Passkey", `${n} passkeys`)}`,
    "admin.setup_pending": "Not set up yet (link sent)",
    "admin.not_set_up": "Can't sign in: make a new setup link",
    "admin.last_sign_in": "last signed in {date}",
    "admin.link_title": "Setup link",
    "admin.link_help":
      "Send this link to {name}. It works once, for 7 days: opening it signs in and asks for a passkey or a password. Their current way to sign in keeps working.",
    "admin.user_delete_confirm":
      "Delete the account of {name}? They can't sign in any more and leave all their families. Their families and data stay.",
    "admin.family_new_help":
      "With the default entry types and finance categories. Choose who belongs to it.",
    "admin.family_lang_help": "For the default entry types and categories.",
    "admin.family_delete_confirm":
      "Delete the family “{name}” with all its calendars, notes and finances? This can't be undone – export it first if you might need it.",
    "admin.members_of": "Members of {name}",
    "admin.no_members": "No members",
    "admin.no_families": "No families yet.",
    "admin.not_member": "Not a member",
    "admin.pick_user": "Add a user…",
    "admin.rename": "Rename",
    "admin.open": "Open",
    "admin.failed": "That didn't work: {msg}",
    "members.title": "Members",
    "members.roles_help": "Editors can change everything and add people; viewers can only look.",
    "members.editor": "Editor",
    "members.viewer": "Viewer",
    "members.role": "Role",
    "members.you": "(you)",
    "members.email": "Email of their account",
    "members.add": "Add",
    "members.remove": "Remove",
    "members.remove_confirm": "Remove {name} from this family?",
    "members.leave": "Leave the family",
    "members.leave_confirm":
      "Leave “{name}”? You can only come back if one of its editors adds you again.",
    "members.no_account": "There is no account with this email. Ask an admin to make one.",
    "members.failed": "That didn't work: {msg}",
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

    "landing.create": "Familie erstellen",
    "landing.config_warning":
      "Das Backend ist noch nicht eingerichtet. Lege die Supabase-Secrets im Repository an und starte den Deploy-Workflow erneut (siehe README).",

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
    "toast.not_found": "Diese Familie gibt es nicht (mehr), oder du bist kein Mitglied.",
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
      "Eine Kopie von „{name}“ mit allen Jahren, Typen, Einträgen, Notizen und Finanzen erstellen?\n\nDu bearbeitest die Kopie und kannst andere hinzufügen; diese Familie bleibt unverändert.",
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

    "share.tab_links": "Links",
    "share.tab_calendar": "Kalender & iCloud",
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
    "family.new": "Neue Familie",
    "family.view_only": "nur lesen",
    "family.loading": "Wird geladen…",
    "chat.title": "KI-Assistent",
    "chat.open": "KI-Assistent (Strg/⌘+J)",
    "chat.close": "KI-Assistent schließen",
    "page.share": "Teilen",
    "page.undo": "Rückgängig (Strg/⌘+Z)",
    "page.redo": "Wiederholen (Strg/⌘+Y)",
    "settings.title": "Einstellungen",
    "settings.general": "Allgemein",
    "settings.sharing": "Kalender-Abo",
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
      "Du kannst diese Familie ansehen, aber nicht ändern: Bitte jemanden, der sie bearbeitet, dich zum Bearbeiter zu machen.",
    "settings.calendar_view": "Kalenderansicht",
    "settings.skip_weekends_title":
      "Wochenenden werden beim Füllen, Einfügen und Umschalten von Bereichen ausgelassen",
    "settings.types_readonly": "Nur wer die Familie bearbeiten darf, kann die Arten ändern.",
    "settings.year": "Jahr",
    "share.rotate": "Neuer Link",
    "share.rotate_feed_confirm":
      "Einen neuen Abo-Link erstellen? Kalender-Abos mit dem bisherigen werden nicht mehr aktualisiert und müssen neu hinzugefügt werden.",
    "share.rotated": "Neuer Link erstellt",
    "share.rotate_failed": "Neuer Link konnte nicht erstellt werden: {msg}",
    "share.legacy": "Alter Kalender-Link",
    "share.legacy_help":
      "Vor der Umbenennung in Familienplaner geteilt. Damit angelegte Kalender-Abos funktionieren weiter; sonst öffnet er nichts mehr.",
    "share.legacy_remove": "Entfernen",
    "share.legacy_confirm":
      "Den alten Kalender-Link entfernen? Damit angelegte Kalender-Abos werden nicht mehr aktualisiert.",
    "share.legacy_removed": "Alter Link entfernt",
    "share.feed": "Kalender-Abo",
    "share.feed_help":
      "Der einzige Link, der ohne Anmeldung funktioniert: Er öffnet nur das Kalender-Abo, sonst nichts.",
    "data.export_help": "Alle Jahre, Arten, Einträge, Notizen und Finanzen als JSON-Datei.",
    "data.import_help":
      "Ersetzt alle Jahre, Arten, Einträge und Notizen dieser Familie (und die Finanzen, wenn die Datei sie enthält) durch eine exportierte Datei; Name und Mitglieder bleiben. Lässt sich nicht rückgängig machen.",
    "data.clone_help": "Eine Kopie dieser Familie mit allen Daten, die du bearbeitest.",
    "data.imported": "Importiert",
    // ---- Finance
    "settings.finance": "Finanzen",
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
      "Zum Einordnen der Buchungen. Einnahme-Kategorien erscheinen bei Geld, das hereinkommt, Ausgabe-Kategorien bei Geld, das hinausgeht, „beides“ bei beidem. Kategorien können Unterkategorien haben, beliebig tief: Eine Unterkategorie hat die Art ihrer obersten Kategorie, und die Summen einer Kategorie enthalten ihre Unterkategorien.",
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
    "finance.compare.title": "Vergleich",
    "finance.compare.per_month": "alles pro Monat",
    "finance.compare.month": "Dieser Monat",
    "finance.compare.last_month": "Letzter Monat",
    "finance.compare.year": "Dieses Jahr",
    "finance.compare.last_year": "Letztes Jahr",
    "finance.compare.all": "Gesamt",
    "finance.compare.months": ({ n }) => `${n} ${s(n, "Monat", "Monate")}`,
    "finance.compare.nothing_yet": "noch nichts zum Vergleichen",
    "finance.compare.expenses_by_category": "Ausgaben nach Kategorie",
    "finance.compare.income_by_category": "Einnahmen nach Kategorie",
    "finance.compare.delta_title": "{first}: {diff} pro Monat",
    "finance.compare.delta_hint":
      "Ø = Durchschnitt der abgeschlossenen Monate. Die Prozente zeigen, wie „{first}“ von der jeweiligen Spalte abweicht.",
    "finance.benchmark": "Statistischer Durchschnitt",
    "finance.benchmark_help":
      "Zahlen, an denen die Übersicht eure Monate misst, z. B. die Haushaltsausgaben laut Statistikamt. Jeder Betrag ist eine Spanne pro Monat in {currency}, von den unteren bis zu den oberen Haushalten; nur ein Wert ist ein einzelner Durchschnitt. Was ihr nicht wisst, bleibt leer. Ohne Angaben zeigt die Übersicht ihn nicht.",
    "finance.benchmark_label": "Quelle",
    "finance.benchmark_label_placeholder": "z. B. Destatis 2024, Paar mit 2 Kindern",
    "finance.benchmark_income": "Einnahmen pro Monat",
    "finance.benchmark_expense": "Ausgaben pro Monat",
    "finance.benchmark_categories": "Pro Kategorie",
    "finance.benchmark_save": "Speichern",
    "finance.benchmark_remove": "Entfernen",
    "finance.benchmark_invalid": "Beträge müssen Zahlen ab 0 sein, „von“ nicht über „bis“.",
    "finance.benchmark_from": "von",
    "finance.benchmark_to": "bis",
    "finance.benchmark.basis": "{period} ({detail})",
    "finance.benchmark.below": ({ n }) => `${n} % darunter`,
    "finance.benchmark.above": ({ n }) => `${n} % darüber`,
    "finance.benchmark.above_zero": "darüber",
    "finance.benchmark.on": "im Durchschnitt",
    "finance.benchmark.lower_half": "in der Spanne, untere Hälfte",
    "finance.benchmark.upper_half": "in der Spanne, obere Hälfte",
    "finance.benchmark.legend_range": "statistische Spanne",
    "finance.benchmark.legend_value": "{period}",
    "finance.benchmark_ai_hint":
      "Oder frag den Assistenten, z. B. „Recherchiere die durchschnittlichen Ausgaben einer Familie wie unserer und setze sie als statistischen Durchschnitt.“",
    "finance.currency": "Währung",
    "finance.add_category": "Kategorie hinzufügen",
    "finance.add_defaults": "Standard-Kategorien hinzufügen",
    "finance.new_category": "Kategorie {n}",
    "finance.add_subcategory": "Unterkategorie hinzufügen",
    "finance.move_to": "Verschieben nach",
    "finance.top_level": "Oberste Ebene",
    "finance.category_actions": "Mehr zu dieser Kategorie",
    "finance.show_subcategories": "Unterkategorien zeigen",
    "finance.hide_subcategories": "Unterkategorien ausblenden",
    "finance.directly_in": "Direkt in „{name}“",
    "finance.category_delete_confirm":
      "Die Kategorie „{name}“ löschen?\n\nIhre Buchungen bleiben erhalten, ohne Kategorie. Ihre Unterkategorien rücken auf die oberste Ebene.",
    "finance.subcategory_delete_confirm":
      "Die Kategorie „{name}“ löschen?\n\nIhre Buchungen und Unterkategorien wandern nach „{parent}“.",
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
    "finance.balance_on": ({ date }) => `Kontostände am ${date}`,
    "finance.balance_now": "Aktuell",
    "finance.balance_now_below": "(darunter: aktuell)",
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
    "chat.queue": "Nach dieser Antwort senden",
    "chat.queued": "Wartet",
    "chat.unqueue": "Nachricht zurücknehmen",
    "chat.queue_wait": "Einen Moment, der Chat startet gerade.",
    "chat.placeholder_queue": "Nächste Nachricht – wird nach dieser Antwort gesendet…",
    "chat.thinking": "Denkt nach…",
    "chat.interrupted": "Unterbrochen",
    "chat.placeholder": "Frag mich etwas…",
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
    "chat.image_gone": "Das Bild ist nicht mehr gespeichert.",
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
    "chat.example_uncategorized": "Ordne unsere Buchungen ohne Kategorie passenden Kategorien zu.",
    "chat.example_types":
      "Leg die Arten für dieses Jahr an: Kita geschlossen, Urlaub für jedes Elternteil und Feiertage.",
    "chat.example_categories": "Schlag Kategorien für unsere Finanzen vor und leg sie an.",
    "chat.elsewhere": "Dieser Chat gehört zu {page}.",
    "chat.move_here": "Zu {page} verschieben",
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
    "chat.tool.analyze_transactions": "Wertet Buchungen aus",
    "chat.tool.analyze_calendar": "Zählt Kalendertage",
    "chat.tool.calculate": "Rechnet",
    "chat.tool.manage_categories": "Ändert Kategorien",
    "chat.tool.change_transactions": "Ändert Buchungen",
    "chat.tool.set_statistic_average": "Setzt den statistischen Durchschnitt",
    "chat.tool.combine_transfers": "Fasst Umbuchungen und Splitbuchungen zusammen",
    "chat.tool.ask_user": "Stellt eine Frage",
    "chat.question.pick_one": "Wähle eine Antwort oder schreib deine eigene",
    "chat.question.pick_several": "Wähle eine oder mehrere Antworten oder schreib deine eigene",
    "chat.question.own": "Eigene Antwort…",
    "chat.question.send": "Antworten",
    "chat.question.skipped": "Nicht beantwortet",
    "chat.copy.chat": "Chat kopieren, mit allen Tool-Ergebnissen",
    "chat.copy.answer": "Antwort kopieren, mit allen Tool-Ergebnissen",
    "chat.copy.you": "Du",
    "chat.status.writing": "Schreibt…",
    "chat.status.retrying": "Das Modell hat nicht geantwortet – neuer Versuch ({n}/{max})…",
    "chat.status.compacting": "Fasst den bisherigen Verlauf zusammen…",
    "chat.compacted": "Ältere Nachrichten für das Modell zusammengefasst",
    "chat.context": "Kontext: {used} von {max} Tokens ({pct} %)",
    "chat.context_help":
      "Wie viel vom Kontextfenster des Modells dieser Chat belegt. Bevor es voll ist, werden ältere Nachrichten zu einer Zusammenfassung verdichtet, damit lange Aufgaben weiterlaufen können.",
    "chat.detail.since": "ab {d}",
    "chat.detail.until": "bis {d}",
    "chat.detail.from_row": "ab Zeile {n}",
    "chat.detail.changes": ({ n }) => `${n} ${s(n, "Änderung", "Änderungen")}`,
    "chat.detail.queries": ({ n }) => `${n} ${s(n, "Abfrage", "Abfragen")}`,
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
    "ai_settings.context_window": "Kontextfenster (Tokens)",
    "ai_settings.context_window_help":
      "Wie viele Tokens das Modell auf einmal verarbeitet. Leer: aus der Modellliste der API, wenn sie es angibt, sonst 128.000. Lange Chats werden zusammengefasst, bevor es voll ist.",
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
    // ---- Accounts
    "nav.admin": "Verwaltung",
    "family.yours": "Deine Familien",
    "settings.members": "Mitglieder",
    "user.menu": "Kontomenü",
    "user.account": "Konto",
    "user.sign_out": "Abmelden",
    "auth.title": "Anmelden",
    "auth.lead":
      "Das Jahr deiner Familie planen: Urlaub, Feiertage, Kita-Schließtage und Finanzen an einem Ort.",
    "auth.passkey": "Mit Passkey anmelden",
    "auth.or_password": "oder mit deinem Passwort",
    "auth.email": "E-Mail",
    "auth.password": "Passwort",
    "auth.sign_in": "Anmelden",
    "auth.wrong": "E-Mail oder Passwort ist falsch.",
    "auth.passkey_unknown":
      "Dieser Passkey ist hier nicht bekannt. Melde dich mit deinem Passwort an oder bitte eine Admin-Person um einen neuen Einrichtungslink.",
    "auth.failed": "Anmeldung fehlgeschlagen: {msg}",
    "auth.no_account":
      "Noch kein Konto? Konten legt eine Admin-Person dieses Familienplaners an: Bitte sie um einen Einrichtungslink.",
    "auth.load_failed": "Dein Konto konnte nicht geladen werden: {msg}",
    "auth.retry": "Erneut versuchen",
    "setup.title": "Dein Konto wird eingerichtet",
    "home.welcome": "Willkommen, {name}",
    "home.no_family":
      "Du bist noch in keiner Familie. Bitte jemanden, der deine Familie bearbeitet, dich hinzuzufügen (dein Konto ist {email}), oder erstelle eine neue Familie.",
    "account.back": "Zurück zum Planer",
    "account.change_title": "Wähle dein eigenes Passwort",
    "account.change_lead":
      "Du hast dich mit dem Anfangspasswort angemeldet. Wähle ein neues, bevor es weitergeht: Das Anfangspasswort kennt jeder.",
    "account.setup_title": "Willkommen, {name}",
    "account.setup_lead":
      "Wähle, wie du dich künftig anmeldest ({email}): mit einem Passkey (Fingerabdruck, Gesicht oder Geräte-PIN – nichts zu merken) oder mit einem Passwort.",
    "account.reset_lead":
      "Richte einen neuen Weg zum Anmelden ein ({email}): Füge einen Passkey hinzu oder wähle ein neues Passwort.",
    "account.passkey_title": "Passkey (empfohlen)",
    "account.passkey_help":
      "Meldet dich mit Fingerabdruck, Gesicht oder Geräte-PIN an. Er liegt auf diesem Gerät oder in deinem Passwortmanager und funktioniert nur für diese Seite.",
    "account.passkey_create": "Passkey erstellen",
    "account.passkey_failed": "Der Passkey konnte nicht hinzugefügt werden: {msg}",
    "account.or_password": "Oder ein Passwort festlegen",
    "account.password": "Passwort",
    "account.current_password": "Aktuelles Passwort",
    "account.new_password": "Neues Passwort",
    "account.repeat_password": "Neues Passwort wiederholen",
    "account.password_help": "Mindestens {n} Zeichen.",
    "account.password_short": "Das Passwort braucht mindestens {n} Zeichen.",
    "account.password_mismatch": "Die beiden Passwörter sind nicht gleich.",
    "account.current_wrong": "Das aktuelle Passwort ist falsch.",
    "account.password_saved": "Passwort gespeichert. Deine anderen Geräte sind abgemeldet.",
    "account.save_password": "Passwort speichern",
    "account.change_password": "Passwort ändern",
    "account.password_set": "Eine Änderung meldet deine anderen Geräte ab.",
    "account.password_none":
      "Du meldest dich nur mit Passkeys an. Ein Passwort ist ein Weg hinein von Geräten ohne deine Passkeys.",
    "account.password_remove": "Passwort entfernen (nur Passkeys)",
    "account.password_remove_confirm":
      "Dein Passwort entfernen? Du kannst dich dann nur noch mit deinen Passkeys anmelden.",
    "account.profile": "Profil",
    "account.name": "Name",
    "account.email_help":
      "Damit meldest du dich an, und damit fügen andere dich ihrer Familie hinzu.",
    "account.email_taken": "Es gibt schon ein Konto mit dieser E-Mail.",
    "account.save": "Speichern",
    "account.saved": "Gespeichert",
    "account.save_failed": "Speichern fehlgeschlagen: {msg}",
    "account.passkeys": "Passkeys",
    "account.passkeys_help":
      "Anmelden mit Fingerabdruck, Gesicht oder Geräte-PIN. Füge auf jedem Gerät einen hinzu (oder bewahre sie in deinem Passwortmanager auf).",
    "account.passkey_add": "Passkey hinzufügen",
    "account.passkey_added": "Passkey hinzugefügt",
    "account.passkey_unsupported": "Dieser Browser kann keine Passkeys verwenden.",
    "account.passkey_delete_confirm":
      "Den Passkey „{name}“ löschen? Damit kannst du dich dann nicht mehr anmelden.",
    "account.used": "Hinzugefügt {created} · zuletzt benutzt {used}",
    "account.delete": "Löschen",
    "account.tokens": "API-Tokens",
    "account.tokens_help":
      "Für Skripte und KI-Agenten, die die API nutzen: Sie handeln als du, in all deinen Familien. Sende einen als „Authorization: Bearer <token>“ an",
    "account.token_name": "Name, z. B. „Home Assistant“",
    "account.token_create": "Erstellen",
    "account.token_created": "Dein neues API-Token",
    "account.token_once":
      "Kopiere es jetzt: Es wird nur dieses eine Mal angezeigt. Wer es hat, kann in deinen Familien alles, was du kannst.",
    "account.token_delete_confirm":
      "Das API-Token „{name}“ löschen? Skripte, die es nutzen, funktionieren dann nicht mehr.",
    "account.done": "Fertig",
    "admin.users": "Benutzer",
    "admin.families": "Familien",
    "admin.users_help":
      "Alle, die sich anmelden können. Neue Personen bekommen einen einmaligen Link, um ihren Passkey oder ihr Passwort einzurichten.",
    "admin.families_help":
      "Alle Familien und ihre Mitglieder. Als Admin öffnest du eine Familie nicht automatisch: Füge dich dafür als Mitglied hinzu.",
    "admin.user_new": "Neuer Benutzer",
    "admin.user_new_help":
      "Du bekommst einen Link zum Weitergeben: Damit richtet die Person einen Passkey oder ein Passwort ein.",
    "admin.user_edit": "Benutzer bearbeiten",
    "admin.email_help":
      "Damit meldet sich die Person an: eine E-Mail-Adresse (oder ein einfacher Name).",
    "admin.admin": "Admin",
    "admin.admin_help": "Admins verwalten Benutzer und Familien.",
    "admin.you": "Du",
    "admin.create": "Erstellen",
    "admin.edit": "Bearbeiten",
    "admin.setup_link": "Neuer Einrichtungslink",
    "admin.actions": "Aktionen",
    "admin.passkeys": ({ n }) => `${s(n, "Passkey", `${n} Passkeys`)}`,
    "admin.setup_pending": "Noch nicht eingerichtet (Link verschickt)",
    "admin.not_set_up": "Kann sich nicht anmelden: Erstelle einen neuen Einrichtungslink",
    "admin.last_sign_in": "zuletzt angemeldet am {date}",
    "admin.link_title": "Einrichtungslink",
    "admin.link_help":
      "Schicke diesen Link an {name}. Er funktioniert einmal, 7 Tage lang: Er meldet an und fragt nach einem Passkey oder Passwort. Der bisherige Weg zum Anmelden funktioniert weiter.",
    "admin.user_delete_confirm":
      "Das Konto von {name} löschen? Die Person kann sich nicht mehr anmelden und verlässt all ihre Familien. Die Familien und ihre Daten bleiben.",
    "admin.family_new_help": "Mit den Standard-Arten und Finanzkategorien. Wähle, wer dazugehört.",
    "admin.family_lang_help": "Für die Standard-Arten und Kategorien.",
    "admin.family_delete_confirm":
      "Die Familie „{name}“ mit allen Kalendern, Notizen und Finanzen löschen? Das lässt sich nicht rückgängig machen – exportiere sie vorher, falls du sie noch brauchst.",
    "admin.members_of": "Mitglieder von {name}",
    "admin.no_members": "Keine Mitglieder",
    "admin.no_families": "Noch keine Familien.",
    "admin.not_member": "Kein Mitglied",
    "admin.pick_user": "Benutzer hinzufügen…",
    "admin.rename": "Umbenennen",
    "admin.open": "Öffnen",
    "admin.failed": "Das hat nicht geklappt: {msg}",
    "members.title": "Mitglieder",
    "members.roles_help":
      "Wer bearbeitet, kann alles ändern und Personen hinzufügen; wer nur ansieht, kann nichts ändern.",
    "members.editor": "Bearbeiten",
    "members.viewer": "Ansehen",
    "members.role": "Rolle",
    "members.you": "(du)",
    "members.email": "E-Mail ihres Kontos",
    "members.add": "Hinzufügen",
    "members.remove": "Entfernen",
    "members.remove_confirm": "{name} aus dieser Familie entfernen?",
    "members.leave": "Familie verlassen",
    "members.leave_confirm":
      "„{name}“ verlassen? Du kommst nur zurück, wenn dich jemand, der sie bearbeitet, wieder hinzufügt.",
    "members.no_account":
      "Es gibt kein Konto mit dieser E-Mail. Bitte eine Admin-Person, eines anzulegen.",
    "members.failed": "Das hat nicht geklappt: {msg}",
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
