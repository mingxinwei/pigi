/**
 * Start the pi-agent utility process.
 */
import { utilityProcess } from 'electron'
import { join } from 'path'

export function createPiAgentProcess(): Electron.UtilityProcess {
  const modulePath = join(__dirname, 'processes/utility/pi-agent.js')
  return utilityProcess.fork(modulePath)
}
