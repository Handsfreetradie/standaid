import { useState, useEffect } from "react";
import { GraduationCap, BookOpen, ClipboardList, FileText, ChevronRight, Loader2, CheckCircle2, XCircle, ArrowLeft, Trophy, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

type Mode = "menu" | "quiz" | "exam" | "exam-active" | "exam-result" | "study-guide" | "study-view";

interface Question {
  id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  clause_reference: string;
  topic?: string;
}

const Learn = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("menu");
  const [standards, setStandards] = useState<any[]>([]);
  const [selectedStandard, setSelectedStandard] = useState("");
  const [loading, setLoading] = useState(false);

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  // Exam state
  const [examId, setExamId] = useState<string | null>(null);
  const [examStartTime, setExamStartTime] = useState<number>(0);
  const [examResult, setExamResult] = useState<any>(null);

  // Study guide state
  const [guides, setGuides] = useState<any[]>([]);
  const [activeGuide, setActiveGuide] = useState<any>(null);

  useEffect(() => {
    if (user) loadStandards();
  }, [user]);

  const loadStandards = async () => {
    const { data } = await supabase
      .from("standards")
      .select("id, title, standard_code, extraction_status")
      .eq("extraction_status", "complete");
    if (data) setStandards(data);
  };

  const loadGuides = async () => {
    const { data } = await supabase
      .from("capstone_study_guides")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setGuides(data);
  };

  const generateQuestions = async () => {
    if (!selectedStandard) { toast.error("Select a standard first"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: { action: "generate_questions", standardId: selectedStandard, questionCount: 5 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setQuestions(data.questions);
      setCurrentQ(0);
      setScore({ correct: 0, total: 0 });
      setSelectedAnswer(null);
      setAnswered(false);
      setMode("quiz");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate questions");
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = (answer: string) => {
    if (answered) return;
    setSelectedAnswer(answer);
    setAnswered(true);
    const isCorrect = answer === questions[currentQ].correct_answer;
    setScore((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));

    if (examId) {
      supabase.functions.invoke("capstone", {
        body: { action: "submit_answer", examId, questionId: questions[currentQ].id, userAnswer: answer },
      });
    }
  };

  const nextQuestion = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((c) => c + 1);
      setSelectedAnswer(null);
      setAnswered(false);
    } else if (examId) {
      completeExam();
    } else {
      setMode("menu");
    }
  };

  const startExam = async () => {
    if (!selectedStandard) { toast.error("Select a standard first"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: { action: "start_exam", standardId: selectedStandard, questionCount: 10 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setExamId(data.exam.id);
      setQuestions(data.questions);
      setCurrentQ(0);
      setScore({ correct: 0, total: 0 });
      setSelectedAnswer(null);
      setAnswered(false);
      setExamStartTime(Date.now());
      setMode("exam-active");
    } catch (e: any) {
      toast.error(e.message || "Failed to start exam");
    } finally {
      setLoading(false);
    }
  };

  const completeExam = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("capstone", {
        body: { action: "complete_exam", examId },
      });
      setExamResult({ ...data, timeTaken: Math.round((Date.now() - examStartTime) / 1000) });
      setMode("exam-result");
      setExamId(null);
    } catch {
      toast.error("Failed to complete exam");
    } finally {
      setLoading(false);
    }
  };

  const generateStudyGuide = async () => {
    if (!selectedStandard) { toast.error("Select a standard first"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: { action: "generate_study_guide", standardId: selectedStandard },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setActiveGuide(data.guide);
      setMode("study-view");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate study guide");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setMode("menu");
    setExamId(null);
    setExamResult(null);
    setActiveGuide(null);
  };

  // ── MENU ──
  if (mode === "menu") {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-extrabold text-foreground">Capstone Helper</h1>
            <p className="text-sm text-muted-foreground">Study, practice, and ace your exams</p>
          </div>
        </div>

        <div className="mb-6">
          <label className="text-sm font-medium text-foreground mb-2 block">Select a standard</label>
          <Select value={selectedStandard} onValueChange={setSelectedStandard}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Choose a standard to study..." />
            </SelectTrigger>
            <SelectContent>
              {standards.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.standard_code || s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!standards.length && (
            <p className="text-xs text-muted-foreground mt-2">Upload a standard first from the Standards tab</p>
          )}
        </div>

        <div className="space-y-3">
          <Card
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={generateQuestions}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Practice Quiz</p>
                <p className="text-xs text-muted-foreground">5 questions from your standard</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={startExam}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Mock Exam</p>
                <p className="text-xs text-muted-foreground">10 questions, timed, with scoring</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={generateStudyGuide}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Study Guide</p>
                <p className="text-xs text-muted-foreground">AI-generated revision notes</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => { loadGuides(); setMode("study-guide"); }}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">My Study Guides</p>
                <p className="text-xs text-muted-foreground">View saved guides</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>
        </div>

        {loading && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">Generating with AI...</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── QUIZ / EXAM ACTIVE ──
  if (mode === "quiz" || mode === "exam-active") {
    const q = questions[currentQ];
    if (!q) return null;

    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Badge variant="secondary" className="text-xs">
            {currentQ + 1} / {questions.length}
          </Badge>
        </div>

        {mode === "exam-active" && (
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground font-medium">Mock Exam</p>
          </div>
        )}

        <div className="mb-2">
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        <Card className="p-5 mb-4">
          <p className="font-bold text-foreground leading-relaxed">{q.question}</p>
          {q.clause_reference && (
            <Badge className="bg-primary/10 text-primary border-0 text-xs mt-2">{q.clause_reference}</Badge>
          )}
        </Card>

        <div className="space-y-2.5 mb-6">
          {(q.options as string[]).map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selectedAnswer === opt;
            const isCorrect = opt === q.correct_answer;
            let optClass = "border-border bg-card hover:border-primary/30";
            if (answered) {
              if (isCorrect) optClass = "border-primary bg-primary/5";
              else if (isSelected && !isCorrect) optClass = "border-destructive bg-destructive/5";
            } else if (isSelected) {
              optClass = "border-primary bg-primary/5";
            }

            return (
              <button
                key={i}
                onClick={() => handleAnswer(opt)}
                disabled={answered}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${optClass}`}
              >
                <div className="flex items-start gap-3">
                  <span className="font-bold text-sm text-muted-foreground">{letter}</span>
                  <span className="text-sm text-foreground">{opt}</span>
                  {answered && isCorrect && <CheckCircle2 className="h-5 w-5 text-primary ml-auto flex-shrink-0" />}
                  {answered && isSelected && !isCorrect && <XCircle className="h-5 w-5 text-destructive ml-auto flex-shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>

        {answered && (
          <Card className="p-4 mb-4 bg-secondary/50">
            <p className="text-xs font-bold text-foreground mb-1">Explanation</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{q.explanation}</p>
          </Card>
        )}

        {answered && (
          <Button onClick={nextQuestion} className="w-full h-12 font-bold rounded-xl">
            {currentQ < questions.length - 1 ? "Next Question" : mode === "exam-active" ? "Finish Exam" : "Done"}
          </Button>
        )}

        <div className="text-center mt-4">
          <p className="text-xs text-muted-foreground">
            Score: {score.correct}/{score.total}
          </p>
        </div>
      </div>
    );
  }

  // ── EXAM RESULT ──
  if (mode === "exam-result" && examResult) {
    const passed = examResult.passed;
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto text-center">
        <div className={`h-20 w-20 rounded-full mx-auto mb-4 flex items-center justify-center ${passed ? "bg-accent" : "bg-destructive/10"}`}>
          <Trophy className={`h-10 w-10 ${passed ? "text-primary" : "text-destructive"}`} />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-foreground mb-1">
          {passed ? "Exam Passed! 🎉" : "Keep Practicing"}
        </h2>
        <p className="text-muted-foreground text-sm mb-6">
          {passed ? "Great work — you're on track!" : "You need 70% to pass. Review and try again."}
        </p>

        <div className="grid grid-cols-3 gap-3 mb-8">
          <Card className="p-3">
            <p className="text-2xl font-extrabold text-foreground">{examResult.percentage}%</p>
            <p className="text-xs text-muted-foreground">Score</p>
          </Card>
          <Card className="p-3">
            <p className="text-2xl font-extrabold text-foreground">{examResult.correct}/{examResult.total}</p>
            <p className="text-xs text-muted-foreground">Correct</p>
          </Card>
          <Card className="p-3">
            <p className="text-2xl font-extrabold text-foreground">{Math.floor(examResult.timeTaken / 60)}m</p>
            <p className="text-xs text-muted-foreground">Time</p>
          </Card>
        </div>

        <Button onClick={goBack} className="w-full h-12 font-bold rounded-xl">Back to Learn</Button>
      </div>
    );
  }

  // ── STUDY GUIDE LIST ──
  if (mode === "study-guide") {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="font-display text-lg font-extrabold text-foreground">My Study Guides</h2>
        </div>

        {!guides.length ? (
          <div className="text-center py-12">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No study guides yet. Generate one from the menu.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {guides.map((g) => (
              <Card
                key={g.id}
                className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => { setActiveGuide(g); setMode("study-view"); }}
              >
                <p className="font-bold text-sm text-foreground">{g.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(g.created_at).toLocaleDateString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── STUDY GUIDE VIEW ──
  if (mode === "study-view" && activeGuide) {
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
        <h2 className="font-display text-lg font-extrabold text-foreground mb-4">{activeGuide.title}</h2>
        <Card className="p-5">
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
            <ReactMarkdown>{activeGuide.content}</ReactMarkdown>
          </div>
        </Card>
      </div>
    );
  }

  return null;
};

export default Learn;
