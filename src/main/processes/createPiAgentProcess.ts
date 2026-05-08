/**
 * Start the pi-agent utility process.
 */
import { utilityProcess } from 'electron';
import { join } from 'path';
import { getResolvedShellEnv } from './shellEnvResolver';

export function createPiAgentProcess(): Electron.UtilityProcess {
  const modulePath = join(__dirname, 'processes/utility/piAgent.js');
  return utilityProcess.fork(modulePath, [], {
    env: getResolvedShellEnv(),
  });
}

export function createSessionIndexProcess(): Electron.UtilityProcess {
  const modulePath = join(__dirname, 'processes/utility/sessionIndex.js');
  return utilityProcess.fork(modulePath, [], {
    env: getResolvedShellEnv(),
  });
}
