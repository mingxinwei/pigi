/**
 * Start the pi-agent utility process.
 */
import { utilityProcess } from 'electron';
import { join } from 'path';
import { getResolvedShellEnv } from './shellEnvResolver';

export async function createPiAgentProcess(): Promise<Electron.UtilityProcess> {
  const modulePath = join(__dirname, 'processes/utility/piAgent.js');
  return utilityProcess.fork(modulePath, [], {
    env: await getResolvedShellEnv(),
  });
}

export async function createSessionIndexProcess(): Promise<Electron.UtilityProcess> {
  const modulePath = join(__dirname, 'processes/utility/sessionIndex.js');
  return utilityProcess.fork(modulePath, [], {
    env: await getResolvedShellEnv(),
  });
}
