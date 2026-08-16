interface CalcResult {
  id: string;
  toolId: string;
  toolName: string;
  label: string;
  timestamp: Date;
  inputs: Record<string, any>;
  result: Record<string, any>;
  summary: string;
}

interface Project {
  id: string;
  name: string;
  created: Date;
  calculations: CalcResult[];
}

const STORAGE_KEY = "standaid-projects";

export const saveCalculationToProject = (
  projectId: string,
  projectName: string,
  toolId: string,
  toolName: string,
  inputs: Record<string, any>,
  result: Record<string, any>,
  summary: string,
  label: string = ""
): void => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let projects: Project[] = [];

    if (stored) {
      const parsed = JSON.parse(stored);
      projects = parsed.map((p: any) => ({
        ...p,
        created: new Date(p.created),
        calculations: p.calculations.map((c: any) => ({
          ...c,
          timestamp: new Date(c.timestamp),
        })),
      }));
    }

    // Find or create project
    let project = projects.find((p) => p.id === projectId);

    if (!project) {
      // Create new project
      project = {
        id: `proj-${Date.now()}`,
        name: projectName,
        created: new Date(),
        calculations: [],
      };
      projects.push(project);
    }

    // Add calculation to project
    const calc: CalcResult = {
      id: `calc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      toolId,
      toolName,
      label: label || summary,
      timestamp: new Date(),
      inputs,
      result,
      summary,
    };

    project.calculations.push(calc);

    // Save back to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error("[projectUtils] Failed to save calculation:", e);
  }
};
