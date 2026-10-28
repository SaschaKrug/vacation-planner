import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers / no permission: fall back to a selected textarea.
    const area = Object.assign(document.createElement("textarea"), {
      value: text,
    });
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(t("toast.copied"));
}

/** A read-only value (a link) with a Copy button. */
export function CopyField(
  { value, label, className }: {
    value: string;
    label?: string;
    className?: string;
  },
) {
  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="bg-muted font-mono text-xs"
        onFocus={(e) => e.target.select()}
      />
      <Button variant="outline" onClick={() => copyText(value)}>
        <Copy /> {t("copy")}
      </Button>
    </div>
  );
}
