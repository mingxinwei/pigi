/// <reference types="vite/client" />

// Navigator.userAgentData is not yet in TypeScript's DOM lib.
// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgentData
interface Navigator {
  readonly userAgentData?: {
    readonly platform: string;
  };
}
