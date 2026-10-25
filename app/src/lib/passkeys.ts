// Passkeys in the browser: signing in (also from the email field's autofill) and adding one to
// the account. The server makes the options and checks the answers (see the API's webauthn.ts).

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { api } from "./api";
import { type Me, setMe, setSession } from "./auth";

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

/** Whether the user closed the browser's dialog (no message needed then). */
export function cancelled(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

/** Signs in with a passkey. `autofill`: waits for the user to pick one in the email field's
 *  suggestions, until another sign-in starts. */
export async function signInWithPasskey(autofill = false): Promise<Me> {
  if (autofill && !(await browserSupportsWebAuthnAutofill())) {
    throw Object.assign(new Error("no autofill"), { name: "AbortError" });
  }
  const { challengeId, options } = await api.passkeyLoginOptions();
  const response = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill: autofill,
  });
  const { token, ...me } = await api.passkeyLogin(challengeId, response);
  setSession(token, me);
  return me;
}

/** Stops a waiting autofill sign-in (before a sign-in with a password or the button). */
export function stopPasskeyAutofill() {
  WebAuthnAbortService.cancelCeremony();
}

/** Adds a passkey to the signed-in account, named after this device. */
export async function addPasskey(name: string): Promise<void> {
  const { challengeId, options } = await api.passkeyOptions();
  const response = await startRegistration({ optionsJSON: options });
  await api.addPasskey(challengeId, response, name);
  setMe(await api.me());
}

/** A name for a new passkey: the kind of device it is made on. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
    ? "iPad"
    : /Android/.test(ua)
    ? "Android"
    : /Mac OS X/.test(ua)
    ? "Mac"
    : /Windows/.test(ua)
    ? "Windows"
    : /Linux/.test(ua)
    ? "Linux"
    : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /Chrome\//.test(ua)
    ? "Chrome"
    : /Safari\//.test(ua)
    ? "Safari"
    : "";
  return [os, browser].filter(Boolean).join(" · ") || "Passkey";
}
