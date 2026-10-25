// Passkeys (WebAuthn) with @simplewebauthn/server: options for the browser, and checks of its
// answers. The relying party is the app's own host, taken from the request's Origin header
// (the app and the API live on different hosts); APP_ORIGIN can pin the allowed origins.
// Each passkey remembers its host, and only signs in from there.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.3.3";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.3.3/helpers";
import { HttpError, randomToken } from "./http.ts";
import type { ChallengeRow, PasskeyRow, Store, UserRow } from "./store.ts";

const RP_NAME = "Family Planner";
const CHALLENGE_MS = 5 * 60_000;

/** The app's origin and host for a passkey request. */
export function relyingParty(req: Request, allowed?: string[]): { origin: string; rpId: string } {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") throw new HttpError(400, "Passkeys need the app's origin");
  if (allowed?.length && !allowed.includes(origin)) {
    throw new HttpError(400, `Passkeys can't be used from ${origin}`);
  }
  return { origin, rpId: new URL(origin).hostname };
}

async function saveChallenge(
  store: Store,
  challenge: string,
  rp: { origin: string; rpId: string },
  userId: string | null,
): Promise<string> {
  const id = randomToken(32);
  await store.saveChallenge({
    id,
    challenge,
    user_id: userId,
    rp_id: rp.rpId,
    origin: rp.origin,
    expires_at: new Date(Date.now() + CHALLENGE_MS).toISOString(),
  });
  return id;
}

async function takeChallenge(store: Store, id: unknown): Promise<ChallengeRow> {
  const challenge = typeof id === "string" && id ? await store.takeChallenge(id) : null;
  if (!challenge || challenge.expires_at < new Date().toISOString()) {
    throw new HttpError(400, "The passkey request has expired, try again");
  }
  return challenge;
}

function responseOf(raw: unknown) {
  if (!raw || typeof raw !== "object" || typeof (raw as { id?: unknown }).id !== "string") {
    throw new HttpError(400, "response must be the passkey's answer");
  }
  return raw as any;
}

/** Options to make a new passkey for the user (registration). */
export async function registrationOptions(
  store: Store,
  user: UserRow,
  rp: { origin: string; rpId: string },
) {
  const existing = await store.listPasskeys(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpId,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    // The same authenticator twice is no second way in.
    excludeCredentials: existing.filter((p) => p.rp_id === rp.rpId)
      .map((p) => ({ id: p.id, transports: p.transports as any })),
    // Discoverable, so signing in needs no email first.
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  return { challengeId: await saveChallenge(store, options.challenge, rp, user.id), options };
}

/** Checks the browser's answer to registrationOptions and returns the new passkey. */
export async function verifyRegistration(
  store: Store,
  user: UserRow,
  challengeId: unknown,
  raw: unknown,
  name: string,
): Promise<PasskeyRow> {
  const challenge = await takeChallenge(store, challengeId);
  if (challenge.user_id !== user.id) {
    throw new HttpError(400, "The passkey request has expired, try again");
  }
  const response = responseOf(raw);
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rp_id,
      requireUserVerification: false,
    });
  } catch (err) {
    throw new HttpError(400, `The passkey couldn't be checked: ${(err as Error).message}`);
  }
  if (!result.verified || !result.registrationInfo) {
    throw new HttpError(400, "The passkey couldn't be checked");
  }
  const { credential } = result.registrationInfo;
  const taken = await store.getPasskey(credential.id);
  if (taken && taken.user_id !== user.id) {
    throw new HttpError(400, "This passkey belongs to another account");
  }
  const now = new Date().toISOString();
  return {
    id: credential.id,
    user_id: user.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? response.response?.transports ?? [],
    rp_id: challenge.rp_id,
    name,
    created_at: now,
    last_used_at: null,
  };
}

/** Options to sign in with any passkey of this host (no email needed). */
export async function authenticationOptions(
  store: Store,
  rp: { origin: string; rpId: string },
) {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: "preferred",
  });
  return { challengeId: await saveChallenge(store, options.challenge, rp, null), options };
}

/** Checks a sign-in with a passkey; returns the passkey with its new counter. */
export async function verifyAuthentication(
  store: Store,
  challengeId: unknown,
  raw: unknown,
): Promise<PasskeyRow> {
  const challenge = await takeChallenge(store, challengeId);
  const response = responseOf(raw);
  const passkey = await store.getPasskey(response.id);
  if (!passkey || passkey.rp_id !== challenge.rp_id) {
    throw new HttpError(401, "This passkey isn't known here");
  }
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rp_id,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    throw new HttpError(401, `The passkey couldn't be checked: ${(err as Error).message}`);
  }
  if (!result.verified) throw new HttpError(401, "The passkey couldn't be checked");
  return {
    ...passkey,
    counter: result.authenticationInfo.newCounter,
    last_used_at: new Date().toISOString(),
  };
}
