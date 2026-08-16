import { useState, useEffect } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ToolLayout from "./ToolLayout";

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

interface Props {
  onBack: () => void;
}

const STORAGE_KEY = "standaid-projects";

const ProjectManager = ({ onBack }: Props) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);

  // Load projects from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert date strings back to Date objects
        const withDates = parsed.map((p: any) => ({
          ...p,
          created: new Date(p.created),
          calculations: p.calculations.map((c: any) => ({
            ...c,
            timestamp: new Date(c.timestamp),
          })),
        }));
        setProjects(withDates);
      }
    } catch (e) {
      console.error("[ProjectManager] Failed to load projects:", e);
    }
  }, []);

  // Save projects to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (e) {
      console.error("[ProjectManager] Failed to save projects:", e);
    }
  }, [projects]);

  const createProject = () => {
    if (!newProjectName.trim()) return;
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      name: newProjectName,
      created: new Date(),
      calculations: [],
    };
    setProjects([...projects, newProject]);
    setNewProjectName("");
    setShowNewProjectForm(false);
    setSelectedProjectId(newProject.id);
  };

  const deleteProject = (id: string) => {
    setProjects(projects.filter((p) => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  };

  const deleteCalculation = (projectId: string, calcId: string) => {
    setProjects(
      projects.map((p) =>
        p.id === projectId
          ? { ...p, calculations: p.calculations.filter((c) => c.id !== calcId) }
          : p
      )
    );
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // List view
  if (!selectedProjectId) {
    return (
      <ToolLayout onBack={onBack}>
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-bold text-lg text-foreground">Your Projects</h2>
              <p className="text-xs text-muted-foreground">Manage your calculation jobs</p>
            </div>
            {projects.length > 0 && (
              <Button
                size="sm"
                onClick={() => setShowNewProjectForm(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            )}
          </div>

          {/* New project form */}
          {showNewProjectForm && (
            <Card className="p-4 border-primary/40 bg-primary/5">
              <div className="space-y-3">
                <Input
                  placeholder="Project name (e.g. 'Residential Rewire')"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && createProject()}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={createProject}
                    disabled={!newProjectName.trim()}
                  >
                    Create
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowNewProjectForm(false);
                      setNewProjectName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Projects list */}
          {projects.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">No projects yet</p>
              <Button onClick={() => setShowNewProjectForm(true)}>
                Create Your First Project
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((proj) => (
                <Card
                  key={proj.id}
                  className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => setSelectedProjectId(proj.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-bold text-foreground">{proj.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {proj.calculations.length} calculation{proj.calculations.length !== 1 ? "s" : ""}
                        {" "} • Created {proj.created.toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(proj.id);
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ToolLayout>
    );
  }

  // Project detail view
  return (
    <ToolLayout onBack={() => setSelectedProjectId(null)}>
      <div className="space-y-4">
        {/* Project header */}
        <div className="mb-6">
          <h2 className="font-bold text-lg text-foreground">{selectedProject?.name}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedProject?.calculations.length || 0} calculation
            {(selectedProject?.calculations.length || 0) !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Calculations list */}
        {!selectedProject?.calculations.length ? (
          <Card className="p-8 text-center border-dashed">
            <p className="text-muted-foreground mb-4">
              No calculations added yet
            </p>
            <p className="text-xs text-muted-foreground">
              Use the "Add to Project" button in any calculator to add calculations here
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {selectedProject?.calculations.map((calc) => (
              <Card key={calc.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-foreground text-sm mb-1">
                      {calc.label}
                    </h3>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">
                        {calc.toolName}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{calc.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(calc.timestamp).toLocaleDateString()}
                      {" "}
                      {new Date(calc.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      deleteCalculation(selectedProject.id, calc.id)
                    }
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ToolLayout>
  );
};

export default ProjectManager;
