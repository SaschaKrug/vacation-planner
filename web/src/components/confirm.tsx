import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { t } from "@/lib/i18n";

// A promise-based replacement for window.confirm(): `if (await confirm(text)) …`.

type Request = {
  message: string;
  action?: string;
  resolve: (ok: boolean) => void;
};
let current: Request | null = null;
const listeners = new Set<() => void>();

function set(next: Request | null) {
  current = next;
  for (const l of listeners) l();
}

export function confirm(message: string, action?: string): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => set({ message, action, resolve }));
}

/** Rendered once at the root; shows the pending confirm(), if any. */
export function ConfirmHost() {
  const req = useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => current);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    set(null);
  };
  const [title, ...rest] = (req?.message ?? "").split("\n\n");
  return (
    <AlertDialog
      open={!!req}
      onOpenChange={(open) => !open && close(false)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base leading-snug">
            {title}
          </AlertDialogTitle>
          {rest.length > 0 && (
            <AlertDialogDescription className="whitespace-pre-line">
              {rest.join("\n\n")}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {t("note.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => close(true)}>
            {req?.action ?? "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
