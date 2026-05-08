/**
 * Start the pi-agent utility process.
 */
import { utilityProcess } from 'electron';
import { join } from 'path';

export function createPiAgentProcess(): Electron.UtilityProcess {
  const modulePath = join(__dirname, 'processes/utility/piAgent.js');
  return utilityProcess.fork(modulePath, [], {
    env: { ...process.env },
  });
}

export function createSessionIndexProcess(): Electron.UtilityProcess {
  const modulePath = join(__dirname, 'processes/utility/sessionIndex.js');
  return utilityProcess.fork(modulePath, [], {
    env: { ...process.env },
  });
}
