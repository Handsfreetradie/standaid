import { useState, useEffect } from "react";
import { GraduationCap, BookOpen, ClipboardList, FileText, ChevronRight, Loader2, CheckCircle2, XCircle, ArrowLeft, Trophy, Clock, Camera, Target, Upload, Calculator, ExternalLink } from "lucide-react";
import { PDFViewerModal } from "@/components/PDFViewerModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

type Mode = "menu" | "quiz" | "exam" | "exam-active" | "exam-result" | "study-guide" | "study-view" | "photo-analysis" | "exam-prep" | "exam-prep-result" | "short-answer" | "short-answer-result" | "calculation";

interface CalculationQuestion {
  calculation_type: "voltage_drop" | "maximum_demand" | "cable_sizing" | "fault_current";
  scenario: string;
  given_data: string[];
  question_parts: string[];
  model_solution: string;
  total_marks: number;
  key_answers: string[];
}

interface ShortAnswerQuestion {
  question: string;
  model_answer: string;
  clause_reference: string;
  marks: number;
}

interface ShortAnswerResult {
  marks_awarded: number;
  answer_correct: boolean;
  clause_correct: boolean;
  feedback: string;
  model_answer: string;
  clause_reference: string;
}

interface Question {
  id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  clause_reference: string;
  topic?: string;
}

async function extractFnError(error: any): Promise<Error> {
  let msg = "Request failed";
  try {
    const body = await error?.context?.json();
    msg = body?.error || error.message || msg;
  } catch { msg = error.message || msg; }
  return new Error(msg);
}

const Learn = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("menu");
  const [standards, setStandards] = useState<any[]>([]);
  const [selectedStandard, setSelectedStandard] = useState("");
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<{ prefix: string; title: string }[]>([]);
  const [selectedSection, setSelectedSection] = useState("");
  const [pdfViewer, setPdfViewer] = useState<{ clauseNumber: string; standardId: string } | null>(null);

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
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoAnalysis, setPhotoAnalysis] = useState<string | null>(null);

  // Calculation state
  const [calcQuestion, setCalcQuestion] = useState<CalculationQuestion | null>(null);
  const [calcWorking, setCalcWorking] = useState("");
  const [calcGrading, setCalcGrading] = useState(false);
  const [calcResult, setCalcResult] = useState<{ marks_awarded: number; correct_method: boolean; correct_answer: boolean; feedback: string } | null>(null);

  // Short answer state
  const [shortAnswerQuestions, setShortAnswerQuestions] = useState<ShortAnswerQuestion[]>([]);
  const [shortAnswerCurrentQ, setShortAnswerCurrentQ] = useState(0);
  const [shortAnswerText, setShortAnswerText] = useState("");
  const [shortAnswerClause, setShortAnswerClause] = useState("");
  const [shortAnswerResults, setShortAnswerResults] = useState<ShortAnswerResult[]>([]);
  const [shortAnswerGrading, setShortAnswerGrading] = useState(false);
  const [shortAnswerCurrentResult, setShortAnswerCurrentResult] = useState<ShortAnswerResult | null>(null);

  // Exam prep state
  const [examPrepTopics, setExamPrepTopics] = useState("");
  const [examPrepPdfText, setExamPrepPdfText] = useState<string | null>(null);
  const [examPrepPdfName, setExamPrepPdfName] = useState<string | null>(null);
  const [examPrepResult, setExamPrepResult] = useState<any>(null);

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

  const loadSections = async (standardId: string) => {
    setSections([]);
    setSelectedSection("");

    // Primary: query explicit section/appendix heading chunks stored by process-standard
    // These have clause_number = null and clause_title like "SECTION 1 SCOPE..."
    // Fetch content too — some PDFs put the title on the next line, so clause_title is just
    // "APPENDIX A" or "SECTION 1" with no title text; we extract it from content instead.
    const { data: headingData } = await supabase
      .from("standard_chunks")
      .select("clause_title, chunk_index, content")
      .eq("standard_id", standardId)
      .is("clause_number", null)
      .or("clause_title.ilike.SECTION %,clause_title.ilike.PART %,clause_title.ilike.APPENDIX %")
      .order("chunk_index", { ascending: true });

    const SECTION_RE = /^(?:SECTION|PART)\s+(\d+)\s*(.*)/i;
    const APPENDIX_RE = /^APPENDIX\s+([A-Z])\s*(.*)/i;
    // Strip "(NORMATIVE)" / "(INFORMATIVE)" labels that some standards prepend to appendix titles
    const NORMATIVE_RE = /^\((?:NORMATIVE|INFORMATIVE|MANDATORY)\)\s*/i;

    const parsed: { prefix: string; title: string }[] = [];
    // Tracks prefixes we've accepted (not just seen) so we keep scanning for a real heading
    const accepted = new Set<string>();

    // Strip trailing dots and page number e.g. "EARTHING ............... 416" → "EARTHING"
    const cleanTitle = (raw: string) =>
      raw.replace(/[\s.…]+\d+\s*$/, "").replace(/^[\s,\-—:]+|[\s,\-—:]+$/g, "").trim();

    const toTitleCase = (s: string) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    // Real section headings in AS/NZ standards are ALL CAPS.
    // Narrative foreword refs ("Section 5 requires...") are sentence/mixed case.
    // Require >50% uppercase letters to accept a title as a real heading.
    const isRealHeading = (raw: string): boolean => {
      if (raw.length < 3) return false;
      const letters = raw.match(/[a-zA-Z]/g) || [];
      if (letters.length < 3) return false;
      const upper = raw.match(/[A-Z]/g) || [];
      return upper.length / letters.length >= 0.5;
    };

    // When clause_title has no title text (just "APPENDIX A" or "SECTION 1"),
    // scan the chunk's content body for the first all-caps heading line.
    const titleFromContent = (content: string): string => {
      const lines = (content || "").split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("[")) continue; // skip breadcrumb e.g. "[AS/NZS 3000 2018] APPENDIX A"
        if (/^(?:SECTION|PART|APPENDIX)\s+[\dA-Z]$/i.test(line)) continue; // skip bare "APPENDIX A"
        if (line.length < 4) continue;
        const letters = line.match(/[a-zA-Z]/g) || [];
        if (letters.length < 3) continue;
        const upper = line.match(/[A-Z]/g) || [];
        if (upper.length / letters.length >= 0.5) return cleanTitle(line);
      }
      return "";
    };

    for (const chunk of headingData || []) {
      const t = ((chunk.clause_title as string) || "").trim();
      const content = (chunk.content as string) || "";
      const sm = t.match(SECTION_RE);
      const am = t.match(APPENDIX_RE);

      if (sm) {
        const prefix = sm[1];
        if (accepted.has(prefix)) continue;
        let raw = cleanTitle(sm[2].trim());
        // If title is missing from clause_title, try to find it in the content body
        if (!raw || raw.length < 3 || !isRealHeading(raw)) raw = titleFromContent(content);
        if (!raw || raw.length < 3 || !isRealHeading(raw)) continue;
        accepted.add(prefix);
        parsed.push({ prefix, title: toTitleCase(raw.replace(NORMATIVE_RE, "").trim()) });
      } else if (am) {
        const prefix = am[1];
        if (accepted.has(prefix)) continue;
        let raw = cleanTitle(am[2].trim());
        // If title is missing from clause_title, try to find it in the content body
        if (!raw || raw.length < 3 || !isRealHeading(raw)) raw = titleFromContent(content);
        // Accept even with no title — show "Appendix A" rather than silently drop the appendix
        accepted.add(prefix);
        if (raw && raw.length >= 3 && isRealHeading(raw)) {
          parsed.push({ prefix, title: toTitleCase(raw.replace(NORMATIVE_RE, "").trim()) });
        } else {
          parsed.push({ prefix, title: "" });
        }
      }
    }

    if (parsed.length > 0) {
      parsed.sort((a, b) => {
        const aNum = Number(a.prefix), bNum = Number(b.prefix);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        if (!isNaN(aNum)) return -1;
        if (!isNaN(bNum)) return 1;
        return a.prefix.localeCompare(b.prefix);
      });
      setSections(parsed.slice(0, 30));
      return;
    }

    // Fallback for standards without explicit SECTION headings — infer from clause numbers
    const { data } = await supabase
      .from("standard_chunks")
      .select("clause_number, clause_title")
      .eq("standard_id", standardId)
      .not("clause_number", "is", null)
      .order("chunk_index", { ascending: true });

    if (!data) return;

    const counts = new Map<string, number>();
    const allTitles = new Map<string, string[]>();

    for (const chunk of data) {
      const cn = chunk.clause_number as string;
      if (!cn || !/^[\dA-Za-z]/.test(cn)) continue;
      const prefix = cn.split(".")[0];
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
      if (chunk.clause_title) {
        const list = allTitles.get(prefix) || [];
        list.push(chunk.clause_title as string);
        allTitles.set(prefix, list);
      }
    }

    const SENTENCE_PATTERN = /\b(has been|have been|are indicated|will be|should be|must be|was added|were added|is now|are now|replaced|removed|clarified|revised)\b/i;
    const pickBestTitle = (titles: string[]): string | undefined => {
      const candidates = titles.filter((t) => t.length >= 4 && t.length <= 70 && !SENTENCE_PATTERN.test(t));
      if (!candidates.length) return undefined;
      return candidates.sort((a, b) => a.length - b.length)[0];
    };

    const sorted = [...counts.entries()]
      .filter(([, count]) => count >= 5)
      .sort(([a], [b]) => {
        const aNum = Number(a), bNum = Number(b);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        if (!isNaN(aNum)) return -1;
        if (!isNaN(bNum)) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 30)
      .map(([prefix]) => ({
        prefix,
        title: pickBestTitle(allTitles.get(prefix) || []) ?? (isNaN(Number(prefix)) ? `Appendix ${prefix}` : `Section ${prefix}`),
      }));

    setSections(sorted);
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
        body: { action: "generate_questions", standardId: selectedStandard, questionCount: 5, sectionFilter: (selectedSection && selectedSection !== "__all__") ? selectedSection : undefined },
      });
      if (error) throw await extractFnError(error);
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
        body: { action: "start_exam", standardId: selectedStandard, questionCount: 10, sectionFilter: (selectedSection && selectedSection !== "__all__") ? selectedSection : undefined },
      });
      if (error) throw await extractFnError(error);
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
        body: { action: "generate_study_guide", standardId: selectedStandard, sectionFilter: (selectedSection && selectedSection !== "__all__") ? selectedSection : undefined },
      });
      if (error) throw await extractFnError(error);
      if (data?.error) throw new Error(data.error);
      setActiveGuide(data.guide);
      setMode("study-view");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate study guide");
    } finally {
      setLoading(false);
    }
  };

  const CALC_TYPE_LABELS: Record<string, string> = {
    voltage_drop: "Voltage Drop",
    maximum_demand: "Maximum Demand",
    cable_sizing: "Cable Sizing",
    fault_current: "Fault Current",
  };

  const generateCalculation = async () => {
    if (!selectedStandard) { toast.error("Select a standard first"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: { action: "generate_calculation", standardId: selectedStandard, sectionFilter: (selectedSection && selectedSection !== "__all__") ? selectedSection : undefined },
      });
      if (error) throw await extractFnError(error);
      if (data?.error) throw new Error(data.error);
      setCalcQuestion(data.question);
      setCalcWorking("");
      setCalcResult(null);
      setMode("calculation");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate question");
    } finally {
      setLoading(false);
    }
  };

  const gradeCalculation = async () => {
    if (!calcQuestion) return;
    setCalcGrading(true);
    try {
      const fullQuestion = `${calcQuestion.scenario}\n\nGiven:\n${calcQuestion.given_data.join("\n")}\n\nQuestions:\n${calcQuestion.question_parts.join("\n")}`;
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: {
          action: "grade_calculation",
          questionText: fullQuestion,
          modelAnswer: calcQuestion.model_solution,
          correctClause: String(calcQuestion.total_marks),
          userAnswer: calcWorking,
        },
      });
      if (error) throw await extractFnError(error);
      setCalcResult(data);
    } catch (e: any) {
      toast.error(e.message || "Grading failed");
    } finally {
      setCalcGrading(false);
    }
  };

  const generateShortAnswer = async () => {
    if (!selectedStandard) { toast.error("Select a standard first"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: { action: "generate_short_answer", standardId: selectedStandard, questionCount: 5, sectionFilter: (selectedSection && selectedSection !== "__all__") ? selectedSection : undefined },
      });
      if (error) throw await extractFnError(error);
      if (data?.error) throw new Error(data.error);
      setShortAnswerQuestions(data.questions);
      setShortAnswerCurrentQ(0);
      setShortAnswerResults([]);
      setShortAnswerText("");
      setShortAnswerClause("");
      setShortAnswerCurrentResult(null);
      setMode("short-answer");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate questions");
    } finally {
      setLoading(false);
    }
  };

  const gradeShortAnswer = async () => {
    const q = shortAnswerQuestions[shortAnswerCurrentQ];
    if (!q) return;
    setShortAnswerGrading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: {
          action: "grade_short_answer",
          questionText: q.question,
          modelAnswer: q.model_answer,
          correctClause: q.clause_reference,
          userAnswer: shortAnswerText,
          userClauseRef: shortAnswerClause,
        },
      });
      if (error) throw await extractFnError(error);
      const result: ShortAnswerResult = { ...data, model_answer: q.model_answer, clause_reference: q.clause_reference };
      setShortAnswerCurrentResult(result);
      setShortAnswerResults((prev) => [...prev, result]);
    } catch (e: any) {
      toast.error(e.message || "Grading failed");
    } finally {
      setShortAnswerGrading(false);
    }
  };

  const nextShortAnswer = () => {
    if (shortAnswerCurrentQ < shortAnswerQuestions.length - 1) {
      setShortAnswerCurrentQ((c) => c + 1);
      setShortAnswerText("");
      setShortAnswerClause("");
      setShortAnswerCurrentResult(null);
    } else {
      setMode("short-answer-result");
    }
  };

  const handlePhotoUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { toast.error("Image must be under 10MB"); return; }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setPhotoPreview(reader.result as string);
        analyzePhoto(base64);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const analyzePhoto = async (base64: string) => {
    if (!selectedStandard) { toast.error("Select a standard first"); return; }
    setLoading(true);
    setPhotoAnalysis(null);
    setMode("photo-analysis");
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: { action: "analyze_photo", standardId: selectedStandard, imageBase64: base64 },
      });
      if (error) throw await extractFnError(error);
      if (data?.error) throw new Error(data.error);
      setPhotoAnalysis(data.analysis);
    } catch (e: any) {
      toast.error(e.message || "Failed to analyze photo");
      setMode("menu");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setMode("menu");
    setExamId(null);
    setExamResult(null);
    setActiveGuide(null);
    setPhotoPreview(null);
    setPhotoAnalysis(null);
    setExamPrepResult(null);
    setExamPrepPdfText(null);
    setExamPrepPdfName(null);
    setExamPrepTopics("");
    setShortAnswerQuestions([]);
    setShortAnswerResults([]);
    setShortAnswerCurrentResult(null);
    setShortAnswerText("");
    setShortAnswerClause("");
    setCalcQuestion(null);
    setCalcWorking("");
    setCalcResult(null);
  };

  const handleExamPdfUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { toast.error("PDF must be under 20MB"); return; }
      setExamPrepPdfName(file.name);
      
      // Extract text client-side using simple approach
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let text = "";
      // Simple text extraction from PDF
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const raw = decoder.decode(bytes);
      // Extract text between BT/ET blocks
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let match;
      while ((match = btEtRegex.exec(raw)) !== null) {
        const block = match[1];
        const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g);
        if (tjMatches) {
          for (const tj of tjMatches) {
            const content = tj.match(/\(([^)]*)\)/);
            if (content) text += content[1] + " ";
          }
        }
        const tjArrayMatches = block.match(/\[(.*?)\]\s*TJ/gi);
        if (tjArrayMatches) {
          for (const tja of tjArrayMatches) {
            const parts = tja.match(/\(([^)]*)\)/g);
            if (parts) {
              for (const p of parts) {
                const c = p.match(/\(([^)]*)\)/);
                if (c) text += c[1];
              }
              text += " ";
            }
          }
        }
      }

      if (text.trim().length < 50) {
        // If extraction failed, send it to process-standard for better extraction
        toast.info("Extracting text from PDF...");
        try {
          const base64 = btoa(String.fromCharCode(...bytes.slice(0, 3 * 1024 * 1024)));
          const { data, error } = await supabase.functions.invoke("capstone", {
            body: { action: "exam_prep", examPdfText: `[PDF uploaded: ${file.name} — client extraction yielded minimal text. The student uploaded a previous exam paper.]`, examTopics: examPrepTopics || "", standardId: selectedStandard || undefined },
          });
          if (error) throw await extractFnError(error);
          if (data?.error) throw new Error(data.error);
          setExamPrepResult(data);
          setMode("exam-prep-result");
          return;
        } catch (err: any) {
          toast.error(err.message || "Failed to process exam PDF");
          return;
        }
      }

      setExamPrepPdfText(text.trim());
      toast.success(`Extracted text from ${file.name}`);
    };
    input.click();
  };

  const submitExamPrep = async () => {
    if (!examPrepTopics.trim() && !examPrepPdfText) {
      toast.error("Please upload an exam or list some topics");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capstone", {
        body: {
          action: "exam_prep",
          examPdfText: examPrepPdfText || "",
          examTopics: examPrepTopics || "",
          standardId: selectedStandard || undefined,
        },
      });
      if (error) throw await extractFnError(error);
      if (data?.error) throw new Error(data.error);
      setExamPrepResult(data);
      setMode("exam-prep-result");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate exam prep");
    } finally {
      setLoading(false);
    }
  };

  // ── MENU ──
  if (mode === "menu") {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-sans text-xl font-extrabold text-foreground">Exam Helper</h1>
            <p className="text-sm text-muted-foreground">Study, practice, and ace your exams</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-2 block">Select a standard</label>
          <Select value={selectedStandard} onValueChange={(v) => { setSelectedStandard(v); loadSections(v); }}>
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

        {selectedStandard && sections.length > 0 && (
          <div className="mb-6">
            <label className="text-sm font-medium text-foreground mb-2 block">Focus on a section <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Select value={selectedSection || "__all__"} onValueChange={(v) => setSelectedSection(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.prefix} value={s.prefix}>
                    {isNaN(Number(s.prefix)) ? `Appendix ${s.prefix}` : `Section ${s.prefix}`}{s.title ? ` — ${s.title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
            onClick={generateShortAnswer}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Short Answer Practice</p>
                <p className="text-xs text-muted-foreground">Section B style — write your answer + clause ref</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={generateCalculation}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Calculator className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Calculation Practice</p>
                <p className="text-xs text-muted-foreground">Section C style — voltage drop, cable sizing, max demand</p>
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
            onClick={handlePhotoUpload}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Photo Analysis</p>
                <p className="text-xs text-muted-foreground">Upload handwritten work for AI hints</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>

          <Card
            className="p-4 cursor-pointer hover:border-primary/50 transition-colors border-primary/20 bg-primary/[0.02]"
            onClick={() => setMode("exam-prep")}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Exam Prep</p>
                <p className="text-xs text-muted-foreground">Upload a past exam or list topics to study</p>
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
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
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
          {answered && q.clause_reference && (
            <button
              onClick={() => setPdfViewer({ clauseNumber: q.clause_reference })}
              className="inline-flex items-center gap-1.5 mt-2 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all"
            >
              Clause {q.clause_reference}
              <ExternalLink className="h-3 w-3" />
            </button>
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

        <PDFViewerModal
          isOpen={!!pdfViewer}
          onClose={() => setPdfViewer(null)}
          clauseNumber={pdfViewer?.clauseNumber ?? ""}
          standardId={selectedStandard}
        />
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
        <h2 className="font-sans text-2xl font-extrabold text-foreground mb-1">
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
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="font-sans text-lg font-extrabold text-foreground">My Study Guides</h2>
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
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-4">{activeGuide.title}</h2>
        <Card className="p-5">
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
            <ReactMarkdown>{activeGuide.content}</ReactMarkdown>
          </div>
        </Card>
      </div>
    );
  }

  // ── PHOTO ANALYSIS ──
  if (mode === "photo-analysis") {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="font-sans text-lg font-extrabold text-foreground mb-4">Photo Analysis</h2>

        {photoPreview && (
          <Card className="p-2 mb-4 overflow-hidden">
            <img src={photoPreview} alt="Uploaded work" className="w-full rounded-lg max-h-64 object-contain" />
          </Card>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyzing against standard...</p>
            </div>
          </div>
        )}

        {photoAnalysis && (
          <Card className="p-5">
            <Badge className="bg-accent text-primary border-0 text-xs mb-3">AI Hints</Badge>
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
              <ReactMarkdown>{photoAnalysis}</ReactMarkdown>
            </div>
          </Card>
        )}

        {!loading && photoAnalysis && (
          <Button onClick={handlePhotoUpload} variant="outline" className="w-full mt-4 h-11">
            Upload Another Photo
          </Button>
        )}
      </div>
    );
  }

  // ── EXAM PREP INPUT ──
  if (mode === "exam-prep") {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-sans text-lg font-extrabold text-foreground">Exam Prep</h2>
            <p className="text-xs text-muted-foreground">Upload a past exam or list what you'll be tested on</p>
          </div>
        </div>

        {/* Standard selector (optional) */}
        <div className="mb-5">
          <label className="text-sm font-medium text-foreground mb-2 block">Link to a standard (optional)</label>
          <Select value={selectedStandard} onValueChange={setSelectedStandard}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Choose a standard..." />
            </SelectTrigger>
            <SelectContent>
              {standards.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.standard_code || s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Upload past exam */}
        <Card className="p-4 mb-4">
          <p className="text-sm font-bold text-foreground mb-2">Upload a Previous Exam</p>
          <p className="text-xs text-muted-foreground mb-3">Upload a PDF of a past exam paper and the AI will generate study materials matching its style</p>
          <Button variant="outline" className="w-full h-11" onClick={handleExamPdfUpload}>
            <Upload className="h-4 w-4 mr-2" />
            {examPrepPdfName ? examPrepPdfName : "Choose PDF..."}
          </Button>
          {examPrepPdfText && (
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <p className="text-xs text-primary font-medium">Text extracted successfully</p>
            </div>
          )}
        </Card>

        {/* List topics */}
        <Card className="p-4 mb-6">
          <p className="text-sm font-bold text-foreground mb-2">List Exam Topics</p>
          <p className="text-xs text-muted-foreground mb-3">Write down the areas you know the exam will cover</p>
          <Textarea
            placeholder="e.g.&#10;- Cable sizing for domestic installations&#10;- Earthing and bonding requirements&#10;- Circuit protection and fuse ratings&#10;- Maximum demand calculations"
            value={examPrepTopics}
            onChange={(e) => setExamPrepTopics(e.target.value)}
            className="min-h-[120px] text-sm"
          />
        </Card>

        <Button
          onClick={submitExamPrep}
          className="w-full h-12 font-bold rounded-xl"
          disabled={loading || (!examPrepTopics.trim() && !examPrepPdfText)}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating Exam Prep...</>
          ) : (
            "Generate Study Materials & Mock Questions"
          )}
        </Button>
      </div>
    );
  }

  // ── EXAM PREP RESULT ──
  if (mode === "exam-prep-result" && examPrepResult) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-sans text-lg font-extrabold text-foreground">Exam Prep Ready!</h2>
            <p className="text-xs text-muted-foreground">Your study materials have been generated</p>
          </div>
        </div>

        {/* Identified topics */}
        {examPrepResult.topics?.length > 0 && (
          <Card className="p-4 mb-4">
            <p className="text-sm font-bold text-foreground mb-2">Key Topics Identified</p>
            <div className="flex flex-wrap gap-2">
              {examPrepResult.topics.map((t: string, i: number) => (
                <Badge key={i} className="bg-primary/10 text-primary border-0 text-xs">{t}</Badge>
              ))}
            </div>
          </Card>
        )}

        {/* Study guide */}
        {examPrepResult.guide && (
          <Card className="p-4 mb-4">
            <p className="text-sm font-bold text-foreground mb-3">📖 Study Guide</p>
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
              <ReactMarkdown>{examPrepResult.guide.content}</ReactMarkdown>
            </div>
          </Card>
        )}

        {/* Practice with generated questions */}
        {examPrepResult.questions?.length > 0 && (
          <Button
            className="w-full h-12 font-bold rounded-xl mb-3"
            onClick={() => {
              setQuestions(examPrepResult.questions);
              setCurrentQ(0);
              setScore({ correct: 0, total: 0 });
              setSelectedAnswer(null);
              setAnswered(false);
              setMode("quiz");
            }}
          >
            Practice {examPrepResult.questions.length} Mock Questions
          </Button>
        )}

        <Button variant="outline" onClick={() => setMode("exam-prep")} className="w-full h-11">
          Prepare for Another Exam
        </Button>
      </div>
    );
  }

  // ── CALCULATION ──
  if (mode === "calculation" && calcQuestion) {
    const typeLabel = CALC_TYPE_LABELS[calcQuestion.calculation_type] || "Calculation";

    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Badge className="bg-primary/10 text-primary border-0 text-xs">{typeLabel}</Badge>
        </div>

        {/* Scenario */}
        <Card className="p-4 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Scenario</p>
          <p className="text-sm text-foreground leading-relaxed">{calcQuestion.scenario}</p>
        </Card>

        {/* Given data */}
        <Card className="p-4 mb-4 bg-secondary/50">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Given</p>
          <ul className="space-y-1">
            {calcQuestion.given_data.map((item, i) => (
              <li key={i} className="text-sm text-foreground font-mono">{item}</li>
            ))}
          </ul>
        </Card>

        {/* Questions */}
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Questions</p>
            <span className="text-xs font-semibold text-muted-foreground">{calcQuestion.total_marks} marks</span>
          </div>
          <ul className="space-y-2">
            {calcQuestion.question_parts.map((part, i) => (
              <li key={i} className="text-sm text-foreground leading-relaxed">{part}</li>
            ))}
          </ul>
        </Card>

        {!calcResult ? (
          <>
            <div className="mb-4">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Your Working</label>
              <Textarea
                placeholder={"Show all working…\ne.g. VD = I × mV/A.m × L / 1000\n    = 32 × 9.22 × 45 / 1000\n    = 13.3V"}
                value={calcWorking}
                onChange={(e) => setCalcWorking(e.target.value)}
                className="min-h-[140px] text-sm font-mono"
                disabled={calcGrading}
              />
            </div>

            <Button
              className="w-full h-12 font-bold rounded-xl"
              onClick={gradeCalculation}
              disabled={calcGrading || !calcWorking.trim()}
            >
              {calcGrading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Marking…</> : "Submit Working"}
            </Button>
          </>
        ) : (
          <>
            {/* Grade result */}
            <Card className={`p-4 mb-4 ${calcResult.correct_answer ? "border-primary bg-primary/5" : calcResult.correct_method ? "border-yellow-400 bg-yellow-50" : "border-destructive bg-destructive/5"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-foreground">
                  {calcResult.correct_answer ? "✓ Correct" : calcResult.correct_method ? "Method correct, check answer" : "✗ Review needed"}
                </span>
                <Badge className={`text-xs border-0 ${calcResult.correct_answer ? "bg-primary/10 text-primary" : calcResult.correct_method ? "bg-yellow-100 text-yellow-700" : "bg-destructive/10 text-destructive"}`}>
                  {calcResult.marks_awarded} / {calcQuestion.total_marks}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{calcResult.feedback}</p>
            </Card>

            {/* Worked solution */}
            <Card className="p-4 mb-4">
              <p className="text-xs font-semibold text-foreground mb-2">Worked Solution</p>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">{calcQuestion.model_solution}</pre>
              {calcQuestion.key_answers.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-semibold text-foreground mb-1">Key answers:</p>
                  {calcQuestion.key_answers.map((a, i) => (
                    <p key={i} className="text-xs text-primary font-mono font-semibold">{a}</p>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-3">
              <Button className="w-full h-12 font-bold rounded-xl" onClick={generateCalculation}>Try Another Question</Button>
              <Button variant="outline" className="w-full h-11" onClick={goBack}>Back to Learn</Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── SHORT ANSWER ──
  if (mode === "short-answer") {
    const q = shortAnswerQuestions[shortAnswerCurrentQ];
    if (!q) return null;
    const totalMarks = shortAnswerQuestions.length * 2;
    const earnedSoFar = shortAnswerResults.reduce((s, r) => s + r.marks_awarded, 0);

    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Badge variant="secondary" className="text-xs">
            {shortAnswerCurrentQ + 1} / {shortAnswerQuestions.length}
          </Badge>
        </div>

        <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${((shortAnswerCurrentQ + 1) / shortAnswerQuestions.length) * 100}%` }}
          />
        </div>

        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <Badge className="bg-primary/10 text-primary border-0 text-xs">Section B Style</Badge>
            <span className="text-xs text-muted-foreground font-semibold">2 marks</span>
          </div>
          <p className="font-bold text-foreground leading-relaxed">{q.question}</p>
        </Card>

        {!shortAnswerCurrentResult ? (
          <>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Your Answer</label>
                <Textarea
                  placeholder="Write your answer here…"
                  value={shortAnswerText}
                  onChange={(e) => setShortAnswerText(e.target.value)}
                  className="min-h-[100px] text-sm"
                  disabled={shortAnswerGrading}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Clause Reference</label>
                <Input
                  placeholder="e.g. 1.5.1"
                  value={shortAnswerClause}
                  onChange={(e) => setShortAnswerClause(e.target.value)}
                  className="h-11 font-mono"
                  disabled={shortAnswerGrading}
                />
              </div>
            </div>

            <Button
              className="w-full h-12 font-bold rounded-xl"
              onClick={gradeShortAnswer}
              disabled={shortAnswerGrading || !shortAnswerText.trim()}
            >
              {shortAnswerGrading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Marking…</>
              ) : "Submit Answer"}
            </Button>
          </>
        ) : (
          <>
            <Card className={`p-4 mb-4 ${shortAnswerCurrentResult.marks_awarded === 2 ? "border-primary bg-primary/5" : shortAnswerCurrentResult.marks_awarded === 1 ? "border-yellow-400 bg-yellow-50" : "border-destructive bg-destructive/5"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-foreground">
                  {shortAnswerCurrentResult.marks_awarded === 2 ? "✓ Full marks" : shortAnswerCurrentResult.marks_awarded === 1 ? "½ Partial" : "✗ No marks"}
                </span>
                <Badge className={`text-xs border-0 ${shortAnswerCurrentResult.marks_awarded === 2 ? "bg-primary/10 text-primary" : shortAnswerCurrentResult.marks_awarded === 1 ? "bg-yellow-100 text-yellow-700" : "bg-destructive/10 text-destructive"}`}>
                  {shortAnswerCurrentResult.marks_awarded} / 2
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{shortAnswerCurrentResult.feedback}</p>
              <div className="pt-3 border-t border-border space-y-1">
                <p className="text-xs font-semibold text-foreground">Model answer:</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{shortAnswerCurrentResult.model_answer}</p>
                <div className="flex items-center gap-2 mt-2">
                  <p className="text-xs font-semibold text-foreground">Correct clause:</p>
                  <button
                    onClick={() => setPdfViewer({ clauseNumber: shortAnswerCurrentResult.clause_reference })}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono font-semibold bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all"
                  >
                    {shortAnswerCurrentResult.clause_reference}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </Card>

            <Button className="w-full h-12 font-bold rounded-xl" onClick={nextShortAnswer}>
              {shortAnswerCurrentQ < shortAnswerQuestions.length - 1 ? "Next Question" : "See Results"}
            </Button>
          </>
        )}

        <p className="text-center text-xs text-muted-foreground mt-4">
          Score so far: {earnedSoFar} / {shortAnswerResults.length * 2}
        </p>

        <PDFViewerModal
          isOpen={!!pdfViewer}
          onClose={() => setPdfViewer(null)}
          clauseNumber={pdfViewer?.clauseNumber ?? ""}
          standardId={selectedStandard}
        />
      </div>
    );
  }

  // ── SHORT ANSWER RESULT ──
  if (mode === "short-answer-result") {
    const totalMarks = shortAnswerQuestions.length * 2;
    const earnedMarks = shortAnswerResults.reduce((s, r) => s + r.marks_awarded, 0);
    const pct = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const passed = pct >= 70;

    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto">
        <div className="text-center mb-6 mt-4">
          <div className={`h-20 w-20 rounded-full mx-auto mb-4 flex items-center justify-center ${passed ? "bg-primary/10" : "bg-destructive/10"}`}>
            <Trophy className={`h-10 w-10 ${passed ? "text-primary" : "text-destructive"}`} />
          </div>
          <h2 className="font-sans text-2xl font-extrabold text-foreground mb-1">
            {passed ? "Well done!" : "Keep practising"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {passed ? "You're on track for the real exam." : "Review the model answers and try again."}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="p-3 text-center">
            <p className="text-2xl font-extrabold text-foreground">{pct}%</p>
            <p className="text-xs text-muted-foreground">Score</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-2xl font-extrabold text-primary">{earnedMarks}</p>
            <p className="text-xs text-muted-foreground">Marks</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-2xl font-extrabold text-foreground">{totalMarks}</p>
            <p className="text-xs text-muted-foreground">Available</p>
          </Card>
        </div>

        <div className="space-y-2 mb-6">
          {shortAnswerQuestions.map((q, i) => {
            const r = shortAnswerResults[i];
            return (
              <Card key={i} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-foreground font-medium flex-1 leading-relaxed">{q.question}</p>
                  <Badge className={`text-xs border-0 flex-shrink-0 ${!r ? "bg-secondary text-muted-foreground" : r.marks_awarded === 2 ? "bg-primary/10 text-primary" : r.marks_awarded === 1 ? "bg-yellow-100 text-yellow-700" : "bg-destructive/10 text-destructive"}`}>
                    {r ? `${r.marks_awarded}/2` : "-"}
                  </Badge>
                </div>
                {r && r.marks_awarded < 2 && (
                  <p className="text-[10px] text-muted-foreground mt-1">Clause: <span className="font-mono">{q.clause_reference}</span></p>
                )}
              </Card>
            );
          })}
        </div>

        <div className="space-y-3">
          <Button className="w-full h-12 font-bold rounded-xl" onClick={generateShortAnswer}>Try Again</Button>
          <Button variant="outline" className="w-full h-11" onClick={goBack}>Back to Learn</Button>
        </div>
      </div>
    );
  }

  return null;
};

export default Learn;
