/**
 * IPC Channel Registry - single source of truth for all IPC channel names.
 *
 * Convention: all channels use snake_case, prefixed with 'pi:'.
 */

/** Invoke channels: renderer → main (request/response via ipcRenderer.invoke / ipcMain.handle) */
export enum PiIpcInvoke {
  CreateSession = 'pi:create_session',
  ResumeSession = 'pi:resume_session',
  DestroySession = 'pi:destroy_session',
  Prompt = 'pi:prompt',
  Abort = 'pi:abort',
  GetState = 'pi:get_state',
  GetMessages = 'pi:get_messages',
  SwitchSession = 'pi:switch_session',
  ListSessions = 'pi:list_sessions',
  CycleModel = 'pi:cycle_model',
  CycleThinkingLevel = 'pi:cycle_thinking_level',
}

/** One-way send channels (ipcRenderer.send / webContents.send) */
export enum PiIpcSend {
  /** renderer → main: request a MessagePort for streaming */
  RequestStreamPort = 'pi:request_stream_port',
  /** main → renderer: deliver a MessagePort for a session */
  StreamPort = 'pi:stream_port',
  /** main → renderer: session is ready */
  SessionReady = 'pi:session_ready',
  /** main → renderer: session creation/runtime error */
  SessionError = 'pi:session_error',
  /** main → renderer: session event (agent lifecycle, messages, tools) */
  Event = 'pi:event',
  /** main → renderer: runtime error during session */
  Error = 'pi:error',
  /** main → renderer: utility process exited */
  ProcessExit = 'pi:process_exit',
}
