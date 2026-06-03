import type { PiSessionInfo, ProjectDirectory } from '../../../../shared/ipcContract';
import type { ShortcutBinding } from '../../../../shared/ipcContract';
import type { SessionEntry } from '../../state/appStore';

export interface SidebarProps {
  sessions: Map<string, SessionEntry>;
  selectedSessionPath: string | null;
  recentProjects: ProjectDirectory[];
  projectSessions: Record<string, PiSessionInfo[]>;
  shortcutBindings: Map<string, ShortcutBinding> | null;
  onNewSession: () => void;
  onNewSessionForProject: (path: string) => void;
  onResumeSession: (session: PiSessionInfo) => void;
  onOpenProject: () => void;
  onSelectProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
  onReorderProjects: (paths: string[]) => void;
  onRenameSession: (sessionPath: string, name: string) => void;
  onLogin: () => void;
}
