import { basename } from 'node:path';
import ElectronStore from 'electron-store';
import type { ProjectDirectory } from '../../shared/ipcContract';

interface ProjectStoreSchema {
  recentProjects: ProjectDirectory[];
  activeProjectPath: string | null;
}

const STORE_NAME = 'projects';
const RECENT_PROJECTS_KEY = 'recentProjects';
const ACTIVE_PROJECT_PATH_KEY = 'activeProjectPath';
const MAX_RECENT_PROJECTS = 12;

const store = new ElectronStore<ProjectStoreSchema>({
  name: STORE_NAME,
  defaults: {
    recentProjects: [],
    activeProjectPath: null,
  },
});

function toProjectDirectory(path: string): ProjectDirectory {
  return {
    path,
    name: basename(path) || path,
  };
}

export function getRecentProjects(): ProjectDirectory[] {
  return store.get(RECENT_PROJECTS_KEY, []);
}

export function getActiveProjectPath(): string | null {
  return store.get(ACTIVE_PROJECT_PATH_KEY, null);
}

export function getActiveProject(): ProjectDirectory | null {
  const activeProjectPath = getActiveProjectPath();
  if (!activeProjectPath) {
    return null;
  }

  const existing = getRecentProjects().find((project) => project.path === activeProjectPath);
  return existing ?? toProjectDirectory(activeProjectPath);
}

export function setActiveProject(path: string): ProjectDirectory {
  const project = toProjectDirectory(path);
  store.set(ACTIVE_PROJECT_PATH_KEY, project.path);

  return project;
}

export function addRecentProject(path: string): ProjectDirectory {
  const project = toProjectDirectory(path);
  const recentProjects = getRecentProjects().filter((item) => item.path !== project.path);
  const nextProjects = [project, ...recentProjects].slice(0, MAX_RECENT_PROJECTS);

  store.set(RECENT_PROJECTS_KEY, nextProjects);
  store.set(ACTIVE_PROJECT_PATH_KEY, project.path);

  return project;
}

export function removeRecentProject(path: string): void {
  const recentProjects = getRecentProjects().filter((item) => item.path !== path);
  store.set(RECENT_PROJECTS_KEY, recentProjects);

  const activeProjectPath = getActiveProjectPath();
  if (activeProjectPath === path) {
    const nextActive = recentProjects.length > 0 ? recentProjects[0].path : null;
    store.set(ACTIVE_PROJECT_PATH_KEY, nextActive);
  }
}

export function reorderRecentProjects(paths: string[]): void {
  const existing = getRecentProjects();
  const byPath = new Map(existing.map((p) => [p.path, p]));
  const reordered: ProjectDirectory[] = [];
  for (const path of paths) {
    const project = byPath.get(path);
    if (project) {
      reordered.push(project);
    }
  }
  // Append any projects not in the new order (shouldn't happen, but safety)
  for (const project of existing) {
    if (!reordered.some((p) => p.path === project.path)) {
      reordered.push(project);
    }
  }
  store.set(RECENT_PROJECTS_KEY, reordered);
}

export function getProjectState(): {
  recentProjects: ProjectDirectory[];
  activeProject: ProjectDirectory | null;
} {
  return {
    recentProjects: getRecentProjects(),
    activeProject: getActiveProject(),
  };
}
