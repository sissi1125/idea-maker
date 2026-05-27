/**
 * ProjectsStore — feat-200.5 Week 5
 *
 * 职责：
 *   - 维护项目列表 + 当前选中项目
 *   - CRUD 操作后自动刷新列表
 *   - currentProjectId 持久化到 localStorage（刷新页面恢复选中）
 *
 * 设计选择：
 *   - 不用 React Query / SWR：MVP 阶段数据量小，手动管理足够清晰
 *   - 后续 Week 7+ 如需缓存策略 / 乐观更新，再考虑引入
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { projectsApi, type Project } from "@/lib/api";

interface ProjectsState {
  projects: Project[];
  currentProjectId: string | null;
  loading: boolean;

  /** 从 API 拉取项目列表 */
  fetchProjects: () => Promise<void>;
  /** 创建项目并自动切换为当前 */
  createProject: (input: { name: string; emoji?: string; description?: string }) => Promise<Project>;
  /** 删除项目（如果删的是当前选中，自动切到列表第一个） */
  deleteProject: (id: string) => Promise<void>;
  /** 切换当前项目 */
  setCurrentProject: (id: string) => void;

  // computed helper
  currentProject: () => Project | null;
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProjectId: null,
      loading: false,

      fetchProjects: async () => {
        set({ loading: true });
        try {
          const { projects } = await projectsApi.listProjects();
          set({ projects, loading: false });
          // 如果 currentProjectId 不在列表里，重置到第一个
          const { currentProjectId } = get();
          if (currentProjectId && !projects.find((p) => p.id === currentProjectId)) {
            set({ currentProjectId: projects[0]?.id ?? null });
          }
          // 如果还没选过项目，默认选第一个
          if (!get().currentProjectId && projects.length > 0) {
            set({ currentProjectId: projects[0].id });
          }
        } catch (err) {
          set({ loading: false });
          throw err;
        }
      },

      createProject: async (input) => {
        const { project } = await projectsApi.createProject(input);
        // 插入列表头部 + 自动切换
        set((state) => ({
          projects: [project, ...state.projects],
          currentProjectId: project.id,
        }));
        return project;
      },

      deleteProject: async (id) => {
        await projectsApi.deleteProject(id);
        set((state) => {
          const projects = state.projects.filter((p) => p.id !== id);
          const currentProjectId =
            state.currentProjectId === id
              ? projects[0]?.id ?? null
              : state.currentProjectId;
          return { projects, currentProjectId };
        });
      },

      setCurrentProject: (id) => {
        set({ currentProjectId: id });
      },

      currentProject: () => {
        const { projects, currentProjectId } = get();
        return projects.find((p) => p.id === currentProjectId) ?? null;
      },
    }),
    {
      name: "harness-projects",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
      ),
      // 只持久化 currentProjectId（项目列表每次从 API 拉新）
      partialize: (state) => ({ currentProjectId: state.currentProjectId }) as unknown as ProjectsState,
    },
  ),
);
