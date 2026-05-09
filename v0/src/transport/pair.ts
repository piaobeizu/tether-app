// Pair protocol — TS shim wrapping the Rust-side Tauri commands defined
// in `src-tauri/src/wt/pair.rs`. Mirror of `transport/client.ts` for WT.
//
// The exact Tauri command names + payload shapes match the
// `#[tauri::command] pair_*` functions registered in
// `src-tauri/src/lib.rs::invoke_handler`.

import { invoke } from "@tauri-apps/api/core";

export interface PairStartArgs {
  /** Open WT bidi stream id (control channel) — caller already opened it
   *  via `wt.openBidi({ channelId: 0x01 })`. */
  streamId: string;
  /** Caller-stable initiator deviceId (spec §3.1). */
  selfDeviceId: string;
  deviceMetadata: PairDeviceMetadata;
}

export interface PairDeviceMetadata {
  kind: "desktop" | "mobile";
  model?: string;
  displayName: string;
  osVersion?: string;
  appVersion?: string;
}

export interface PairHandle {
  /** Opaque handle identifying the in-flight pair. Use for confirm/abort. */
  handleId: string;
  /** Six-char base32 SAS string (spec §4) — render to user for compare. */
  sas: string;
  /** Echoed peer fields so the UI can show what's being paired. */
  peerDeviceId: string;
  peerDisplayName: string;
  peerKind: string;
}

export interface PairResult {
  peerDeviceId: string;
  longTermKeyId: string;
  /** base64url no-pad — same encoding as the on-disk record. */
  longTermKeyB64: string;
  displayName: string;
}

export interface PairedDevice {
  v: number;
  deviceId: string;
  kind: string;
  displayName: string;
  model?: string;
  longTermKey: string;
  transportBindingKey: string;
  longTermKeyId: string;
  pushToken?: { type: string; payload: unknown };
  pairedAt: string;
  lastSeen: string;
}

/** Drives the initiator FSM up to the SAS state. Returns the SAS string +
 *  a handle the UI uses to confirm or abort. */
export async function pairStart(args: PairStartArgs): Promise<PairHandle> {
  return (await invoke("pair_start", { args })) as PairHandle;
}

/** User clicked "It matches" — Rust side emits sas-confirm, awaits peer
 *  confirm + pair.complete, derives long-term key, persists the device
 *  record. `force` overrides the spec §10 default reject-on-dup. */
export async function pairConfirm(
  handleId: string,
  force = false,
): Promise<PairResult> {
  return (await invoke("pair_confirm", { handleId, force })) as PairResult;
}

/** User clicked Cancel / "doesn't match". Always-idempotent: double-call
 *  is a no-op. `reason` strings come from spec §3.5 enum. */
export async function pairAbort(
  handleId: string,
  reason: string,
): Promise<void> {
  await invoke("pair_abort", { handleId, reason });
}

export async function pairListDevices(): Promise<PairedDevice[]> {
  return (await invoke("pair_list_devices")) as PairedDevice[];
}

export async function pairForgetDevice(
  deviceId: string,
  force = false,
): Promise<boolean> {
  return (await invoke("pair_forget_device", { deviceId, force })) as boolean;
}
