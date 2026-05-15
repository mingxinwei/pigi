import type { Platform } from '../../../shared/platform';

export function detectPlatform(): Platform {
  const platform = navigator.userAgentData?.platform?.toLowerCase();
  if (platform?.includes('mac')) return 'mac';
  if (platform?.includes('win')) return 'windows';
  if (platform?.includes('linux')) return 'linux';
  return 'unknown';
}
