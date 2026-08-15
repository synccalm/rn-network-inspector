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
