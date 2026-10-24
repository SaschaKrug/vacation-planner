// localStorage that never throws: it can be blocked (private windows, site settings).

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked or full
  }
}

export function readFlag(key: string, oldKey?: string): boolean {
  try {
    return (localStorage.getItem(key) ??
      (oldKey ? localStorage.getItem(oldKey) : null)) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // storage blocked
  }
}
