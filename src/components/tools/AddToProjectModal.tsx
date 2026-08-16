import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Project {
  id: string;
  name: string;
  created: Date;
  calculations: any[];
}

interface AddToProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (projectId: string, projectName: string, calcLabel: string) => void;
  calculationSummary: string;
}

const STORAGE_KEY = "standaid-projects";

const AddToProjectModal = ({
  isOpen,
  onClose,
  onSave,
  calculationSummary,
}: AddToProjectModalProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [calcLabel, setCalcLabel] = useState("");

  // Load projects from localStorage
  useEffect(() => {
    if (!isOpen) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
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
      console.error("[AddToProjectModal] Failed to load projects:", e);
    }
  }, [isOpen]);

  const handleSave = () => {
    if (showNewProjectForm) {
      if (!newProjectName.trim()) return;
      onSave("new", newProjectName, calcLabel.trim());
    } else if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId);
      onSave(selectedProjectId, project?.name || "", calcLabel.trim());
    }
    setSelectedProjectId(null);
    setNewProjectName("");
    setCalcLabel("");
    setShowNewProjectForm(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
        <h2 className="font-bold text-lg text-foreground mb-2">Add to Project</h2>
        <p className="text-xs text-muted-foreground mb-4">{calculationSummary}</p>

        {/* Label input */}
        <div className="mb-4">
          <label className="text-xs font-medium text-foreground mb-1 block">
            Label (optional)
          </label>
          <Input
            placeholder="e.g. 'Main Feed Cable', 'Subboard 1'"
            value={calcLabel}
            onChange={(e) => setCalcLabel(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          {/* New project form */}
          {showNewProjectForm ? (
            <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Input
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!newProjectName.trim()}
                >
                  Create & Save
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
          ) : (
            <>
              {/* Projects list */}
              {projects.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    No projects yet
                  </p>
                  <Button
                    size="sm"
                    onClick={() => setShowNewProjectForm(true)}
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Create New Project
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => setSelectedProjectId(project.id)}
                        className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                          selectedProjectId === project.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm text-foreground">
                              {project.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {project.calculations.length} calculation
                              {project.calculations.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                          {selectedProjectId === project.id && (
                            <Badge className="bg-primary">Selected</Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowNewProjectForm(true)}
                    className="w-full gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    New Project
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-6">
          <Button
            onClick={handleSave}
            disabled={!selectedProjectId && !showNewProjectForm}
            className="flex-1"
          >
            Save to Project
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AddToProjectModal;
