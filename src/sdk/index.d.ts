export interface SyncCalmOptions {
  /**
   * Host machine running `npx synccalm`.
   * Defaults to "localhost", or "10.0.2.2" automatically on the Android
   * emulator. Override with your machine's LAN IP when testing on a
   * physical device.
   */
  host?: string;
  /** Port the local synccalm server is listening on. Defaults to 4040. */
  port?: number;
  /** Set to false to disable capturing even in development. Defaults to true. */
  enabled?: boolean;
  /** Maximum characters kept per request/response body before truncation. Defaults to 200000. */
  maxBodyLength?: number;
  /** Also mirror captured requests to the Metro/console log. Defaults to false. */
  logToConsole?: boolean;
  /** Capture console.log/info/warn/error/debug calls for the Logs tab. Defaults to true. */
  captureConsole?: boolean;
  /**
   * Scrub credentials before anything leaves the device. Defaults to true.
   *
   * Covers common auth headers (Authorization, Cookie, Set-Cookie, X-API-Key…)
   * and sensitive JSON body keys (password, token, secret, ssn, cvv…), matched
   * case-insensitively and ignoring `-`/`_`. Set to false only when you're
   * certain the traffic carries nothing sensitive.
   */
  redact?: boolean;
  /** Extra header names to redact, added to the defaults. */
  redactHeaders?: string[];
  /** Extra JSON body keys to redact, added to the defaults. */
  redactBodyKeys?: string[];
  /**
   * Final say over each captured request, applied after the built-in
   * redaction. Return a modified entry, or a falsy value to drop it entirely.
   */
  redactor?: (entry: CapturedRequest) => CapturedRequest | null | undefined | false;
}

export interface CapturedRequest {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  startTime: number;
  endTime: number;
  duration: number;
  error: string | null;
}

export interface SyncCalmSDK {
  /**
   * Starts intercepting network calls and console logs, streaming them to
   * the local synccalm dashboard. Call once, in development only —
   * this is a no-op whenever `__DEV__` is false, so it's safe to leave in
   * production code paths guarded by `if (__DEV__)`.
   */
  init(options?: SyncCalmOptions): void;
}

declare const SyncCalm: SyncCalmSDK;
export default SyncCalm;
export { SyncCalm };
