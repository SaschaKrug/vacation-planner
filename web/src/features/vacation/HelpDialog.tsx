import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t, useLang } from "@/lib/i18n";
import { setHelpOpen, useHelpOpen } from "@/lib/ui";

// [what, does, shown for]: touch gestures or mouse + keyboard, whichever this device has.
const ROWS: [string, string, "touch" | "mouse" | "both"][] = [
  ["help.tap", "help.tap_do", "touch"],
  ["help.long_press", "help.long_press_do", "touch"],
  ["help.range", "help.range_do", "touch"],
  ["help.multi", "help.multi_do", "touch"],
  ["help.undo_touch", "help.undo_do", "touch"],
  ["help.click", "help.click_do", "mouse"],
  ["help.shift", "help.shift_do", "mouse"],
  ["help.ctrl", "help.ctrl_do", "mouse"],
  ["help.type", "help.type_do", "both"],
  ["help.del", "help.del_do", "mouse"],
  ["help.copy", "help.copy_do", "mouse"],
  ["help.handle", "help.handle_do", "both"],
  ["help.arrows", "help.arrows_do", "mouse"],
  ["help.undo", "help.undo_do", "mouse"],
  ["help.note", "help.note_do", "mouse"],
  ["help.zoom", "help.zoom_do", "mouse"],
  ["<kbd>G</kbd>", "help.gap_do", "mouse"],
  ["<kbd>?</kbd>", "help.help_do", "mouse"],
  ["help.esc", "help.esc_do", "mouse"],
];

/** How the calendar works: gestures and keyboard shortcuts. */
export function HelpDialog() {
  const open = useHelpOpen();
  useLang();
  const touch = matchMedia("(hover: none) and (pointer: coarse)").matches;
  const rows = ROWS.filter(([, , on]) => on === "both" || (on === "touch") === touch);
  return (
    <Dialog open={open} onOpenChange={setHelpOpen}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("help.title")}</DialogTitle>
        </DialogHeader>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map(([what, does]) => (
              <tr key={does + what} className="border-b last:border-0">
                {/* Our own strings, with <kbd> markup. */}
                <td
                  className="py-2 pr-2.5 align-top font-medium whitespace-nowrap"
                  dangerouslySetInnerHTML={{
                    __html: what.startsWith("<") ? what : t(what),
                  }}
                />
                <td
                  className="py-2 text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: t(does) }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
