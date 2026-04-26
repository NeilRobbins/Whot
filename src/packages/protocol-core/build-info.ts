/**
 * Build identifiers injected by Vite at build time. These help diagnose
 * "the host and guest are seeing different things" by exposing the exact
 * bundle each browser is running.
 */
declare const __WHOT_BUILD_ID__: string;
declare const __WHOT_BUILD_TIME__: string;

export const BUILD_ID: string =
  typeof __WHOT_BUILD_ID__ !== "undefined" ? __WHOT_BUILD_ID__ : "dev";

export const BUILD_TIME: string =
  typeof __WHOT_BUILD_TIME__ !== "undefined" ? __WHOT_BUILD_TIME__ : "dev";

export const SHORT_BUILD_ID: string = BUILD_ID.slice(0, 8);
