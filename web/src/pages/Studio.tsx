import '../studio/studio.css';

import { useCallback, useEffect, useState } from 'react';

import { go, useRoute } from '../App';
import { api } from '../api';
import { Editor } from '../studio/Editor';
import { ProjectView } from '../studio/ProjectView';
import { Projects } from '../studio/Projects';
import { Project } from '../studio/types';
import { Empty, toastError } from '../ui';

/** #/studio → project list, #/studio/<project> → project, #/studio/<project>/<clip> → editor. */
export default function Studio() {
  const [, pid, cid] = useRoute();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!pid) return;
    try {
      setProject(await api.get<Project>(`/api/projects/${pid}`));
      setMissing(false);
    } catch (e) {
      setMissing(true);
      toastError(e);
    }
  }, [pid]);

  // Refetch on every move between project and clip (including the browser's Back button), so the editor never
  // opens on a copy of the clip that is older than what was last saved.
  useEffect(() => {
    setProject(null);
    reload();
  }, [reload, cid]);

  if (!pid) return <Projects />;
  if (missing) return <Empty title="Project not found"><a href="#/studio">Back to projects</a></Empty>;
  if (!project || project.id !== pid) return <Empty title="Loading…" />;
  const clip = cid ? project.clips.find((c) => c.id === cid) : undefined;
  if (cid && clip) return <Editor key={clip.id} project={project} clip={clip} onBack={() => go(`studio/${pid}`)} />;
  return <ProjectView project={project} reload={reload} />;
}
