import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../tools/supabase';
import { autoPurgeStaleDrafts } from '../../tools/schedule';
import type { Profile, Project, BoqItem, PurchaseOrder, Envelope, Milestone, Defect, ActivityLog } from '../../tools/types';

interface ProjectContextType {
  // Identity
  profile: Profile | null;

  // Multi-project
  projects: Project[];
  project: Project | null;
  setActiveProject: (projectId: string) => void;

  // Project data (scoped to active project)
  boqItems: BoqItem[];
  purchaseOrders: PurchaseOrder[];
  envelopes: Envelope[];
  milestones: Milestone[];
  milestoneDrafts: Milestone[];
  defects: Defect[];
  activityLog: ActivityLog[];

  loading: boolean;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType>({
  profile: null,
  projects: [],
  project: null,
  setActiveProject: () => {},
  boqItems: [],
  purchaseOrders: [],
  envelopes: [],
  milestones: [],
  milestoneDrafts: [],
  defects: [],
  activityLog: [],
  loading: true,
  refresh: async () => {},
});

export function useProject() {
  return useContext(ProjectContext);
}

export function ProjectProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestoneDrafts, setMilestoneDrafts] = useState<Milestone[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const project = projects.find(p => p.id === activeProjectId) ?? null;

  // Load profile and all assigned projects
  const loadProjects = useCallback(async () => {
    try {
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (profErr) console.warn('Profile fetch error:', profErr.message);
      setProfile(prof);

      // Load all assigned project IDs
      const { data: assignments, error: assignErr } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', userId);

      if (assignErr || !assignments || assignments.length === 0) {
        setLoading(false);
        return;
      }

      const projectIds = assignments.map(a => a.project_id);

      const { data: projectList, error: projErr } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds)
        .order('code', { ascending: true });

      if (projErr) console.warn('Projects fetch error:', projErr.message);

      const loadedProjects = projectList ?? [];
      setProjects(loadedProjects);

      // Auto-select first project if none active
      if (loadedProjects.length > 0 && !activeProjectId) {
        setActiveProjectId(loadedProjects[0].id);
      }
    } catch (err) {
      console.warn('Project load failed:', err);
    }
  }, [userId, activeProjectId]);

  // Load project-scoped data when active project changes
  const loadProjectData = useCallback(async (pid: string) => {
    try {
      const results = await Promise.all([
        supabase.from('boq_items').select('*').eq('project_id', pid).order('code'),
        supabase.from('purchase_orders').select('*').eq('project_id', pid),
        supabase.from('envelopes').select('*').eq('project_id', pid),
        supabase.from('milestones')
          .select('*')
          .eq('project_id', pid)
          .eq('author_status', 'confirmed')
          .is('deleted_at', null)
          .order('planned_date'),
        supabase.from('defects').select('*').eq('project_id', pid).order('reported_at', { ascending: false }),
        supabase.from('activity_log').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(20),
        supabase.from('milestones')
          .select('*')
          .eq('project_id', pid)
          .eq('author_status', 'draft')
          .is('deleted_at', null)
          .order('planned_date'),
      ]);

      for (const r of results) {
        if (r.error) console.warn('Query error:', r.error.message);
      }

      setBoqItems(results[0].data ?? []);
      setPurchaseOrders(results[1].data ?? []);
      setEnvelopes(results[2].data ?? []);
      setMilestones(results[3].data ?? []);
      setDefects(results[4].data ?? []);
      setActivityLog(results[5].data ?? []);
      setMilestoneDrafts(results[6].data ?? []);

      const purged = await autoPurgeStaleDrafts(pid);
      if (purged > 0) {
        console.log(`[auto-purge] removed ${purged} stale drafts`);
      }
    } catch (err) {
      console.warn('Project data load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await loadProjects();
    if (activeProjectId) {
      await loadProjectData(activeProjectId);
    } else {
      setLoading(false);
    }
  }, [loadProjects, loadProjectData, activeProjectId]);

  const setActiveProject = useCallback((projectId: string) => {
    // Only allow switching to assigned projects
    if (projects.some(p => p.id === projectId) || projects.length === 0) {
      setActiveProjectId(projectId);
    }
  }, [projects]);

  // Initial load
  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Reload data when active project changes
  useEffect(() => {
    if (activeProjectId) {
      setLoading(true);
      loadProjectData(activeProjectId);
    }
  }, [activeProjectId, loadProjectData]);

  return (
    <ProjectContext.Provider
      value={{
        profile,
        projects,
        project,
        setActiveProject,
        boqItems,
        purchaseOrders,
        envelopes,
        milestones,
        milestoneDrafts,
        defects,
        activityLog,
        loading,
        refresh,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
