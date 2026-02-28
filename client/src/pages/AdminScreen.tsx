import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import type { Question } from "@shared/schema";
import { Plus, Trash2, Upload, Download, ArrowRight, Edit2, Save, X } from "lucide-react";
import { Link } from "wouter";

interface EditState {
  context: string;
  text: string;
  optA: string;
  optB: string;
  optC: string;
  optD: string;
  correct: "A" | "B" | "C" | "D";
  category: string;
  timeLimit: number | "";
}

function QuestionForm({
  state,
  onChange,
  onSubmit,
  onCancel,
  isPending,
  isEdit,
}: {
  state: EditState;
  onChange: (s: EditState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  isEdit: boolean;
}) {
  const set = <K extends keyof EditState>(key: K, val: EditState[K]) =>
    onChange({ ...state, [key]: val });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">مقدمة السؤال (اختياري)</label>
        <textarea
          placeholder="مقدمة تظهر على الشاشة الكبيرة قبل السؤال..."
          value={state.context}
          onChange={(e) => set("context", e.target.value)}
          className="w-full bg-muted rounded-md border border-border/50 px-3 py-2 text-sm resize-none min-h-[60px]"
          dir="auto"
          rows={2}
          data-testid="input-question-context"
        />
      </div>
      <Input placeholder="نص السؤال" value={state.text} onChange={(e) => set("text", e.target.value)} className="bg-muted" dir="auto" data-testid="input-question-text" />
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="الخيار أ" value={state.optA} onChange={(e) => set("optA", e.target.value)} className="bg-muted" dir="auto" data-testid="input-option-a" />
        <Input placeholder="الخيار ب" value={state.optB} onChange={(e) => set("optB", e.target.value)} className="bg-muted" dir="auto" data-testid="input-option-b" />
        <Input placeholder="الخيار ج" value={state.optC} onChange={(e) => set("optC", e.target.value)} className="bg-muted" dir="auto" data-testid="input-option-c" />
        <Input placeholder="الخيار د" value={state.optD} onChange={(e) => set("optD", e.target.value)} className="bg-muted" dir="auto" data-testid="input-option-d" />
      </div>
      <div className="flex gap-3 flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">الإجابة الصحيحة</label>
          <div className="flex gap-2" dir="ltr">
            {(["A", "B", "C", "D"] as const).map((opt) => (
              <button key={opt} onClick={() => set("correct", opt)} className={`w-10 h-10 rounded-md font-bold text-sm transition-colors ${state.correct === opt ? "bg-[#CDB58B] text-primary-foreground" : "bg-muted text-muted-foreground"}`} data-testid={`button-correct-${opt}`}>{opt}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="text-xs text-muted-foreground block mb-1">التصنيف</label>
          <Input placeholder="اختياري" value={state.category} onChange={(e) => set("category", e.target.value)} className="bg-muted" dir="auto" data-testid="input-category" />
        </div>
        <div className="w-24">
          <label className="text-xs text-muted-foreground block mb-1">الوقت (ث)</label>
          <Input type="number" placeholder="30" value={state.timeLimit} onChange={(e) => set("timeLimit", e.target.value ? Number(e.target.value) : "")} className="bg-muted" dir="ltr" data-testid="input-time" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={onSubmit} disabled={isPending} data-testid="button-save-question">
          <Save className="w-4 h-4 ml-1" /> {isEdit ? "تحديث" : "حفظ"}
        </Button>
        <Button variant="ghost" onClick={onCancel} data-testid="button-cancel">
          <X className="w-4 h-4 ml-1" /> إلغاء
        </Button>
      </div>
    </div>
  );
}

const emptyState: EditState = { context: "", text: "", optA: "", optB: "", optC: "", optD: "", correct: "A", category: "", timeLimit: "" };

function stateFromQuestion(q: Question): EditState {
  return {
    context: q.context || "",
    text: q.text,
    optA: q.options[0],
    optB: q.options[1],
    optC: q.options[2],
    optD: q.options[3],
    correct: q.correct,
    category: q.category || "",
    timeLimit: q.timeLimit || "",
  };
}

function buildPayload(s: EditState) {
  return {
    context: s.context.trim() || null,
    text: s.text.trim(),
    options: [s.optA.trim(), s.optB.trim(), s.optC.trim(), s.optD.trim()],
    correct: s.correct,
    category: s.category.trim() || null,
    timeLimit: s.timeLimit ? Number(s.timeLimit) : null,
  };
}

function isFormValid(s: EditState) {
  return s.text.trim() && s.optA.trim() && s.optB.trim() && s.optC.trim() && s.optD.trim();
}

export default function AdminScreen() {
  const queryClient = useQueryClient();
  const { data: questions = [], isLoading } = useQuery<Question[]>({ queryKey: ["/api/questions"] });
  const [showNewForm, setShowNewForm] = useState(false);
  const [newState, setNewState] = useState<EditState>({ ...emptyState });
  const [editId, setEditId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ ...emptyState });
  const fileRef = useRef<HTMLInputElement>(null);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/questions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      setShowNewForm(false);
      setNewState({ ...emptyState });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PUT", `/api/questions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/questions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/questions"] }),
  });

  const importMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/questions/import", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/questions"] }),
  });

  const startEdit = (q: Question) => {
    setEditId(q.id);
    setEditState(stateFromQuestion(q));
    setShowNewForm(false);
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const csv = evt.target?.result as string;
      const lines = csv.split("\n").filter((l) => l.trim());
      if (lines.length < 2) return;

      const header = lines[0].toLowerCase().split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const hasContext = header.includes("context") || header.includes("مقدمة");
      const qs: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        if (hasContext) {
          if (cols.length >= 7) {
            qs.push({
              context: cols[0] || undefined,
              text: cols[1],
              options: [cols[2], cols[3], cols[4], cols[5]],
              correct: cols[6].toUpperCase(),
              category: cols[7] || undefined,
            });
          }
        } else {
          if (cols.length >= 6) {
            qs.push({
              text: cols[0],
              options: [cols[1], cols[2], cols[3], cols[4]],
              correct: cols[5].toUpperCase(),
              category: cols[6] || undefined,
            });
          }
        }
      }
      if (qs.length > 0) {
        importMutation.mutate({ questions: qs });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fawazeer-questions.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6" dir="rtl" data-testid="admin-screen">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/host">
            <Button variant="ghost" size="icon" data-testid="button-back-host"><ArrowRight className="w-5 h-5" /></Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[#CDB58B]">إدارة الأسئلة</h1>
            <p className="text-sm text-muted-foreground">{questions.length} سؤال</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input type="file" accept=".csv" ref={fileRef} className="hidden" onChange={handleCSVImport} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} data-testid="button-import-csv">
              <Upload className="w-4 h-4 ml-1" /> استيراد
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport} data-testid="button-export-json">
              <Download className="w-4 h-4 ml-1" /> تصدير
            </Button>
            <Button size="sm" onClick={() => { setEditId(null); setNewState({ ...emptyState }); setShowNewForm(true); }} data-testid="button-add-question">
              <Plus className="w-4 h-4 ml-1" /> إضافة
            </Button>
          </div>
        </div>

        <div className="mb-4 p-4 bg-card/50 rounded-xl border border-border/30 text-sm text-muted-foreground">
          <p className="font-medium text-foreground/80 mb-1">صيغة ملف CSV</p>
          <code className="text-xs block mb-1" dir="ltr">text, optionA, optionB, optionC, optionD, correct(A/B/C/D), category</code>
          <code className="text-xs block" dir="ltr">context, text, optionA, optionB, optionC, optionD, correct, category</code>
          <p className="text-xs mt-1">عمود context اختياري - إذا وُجد في العنوان يكون العمود الأول</p>
        </div>

        <AnimatePresence>
          {showNewForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="bg-card rounded-xl p-6 border border-[#CDB58B]/30 mb-6 overflow-hidden">
              <h3 className="font-semibold mb-4">سؤال جديد</h3>
              <QuestionForm
                state={newState}
                onChange={setNewState}
                onSubmit={() => { if (isFormValid(newState)) createMutation.mutate(buildPayload(newState)); }}
                onCancel={() => { setShowNewForm(false); setNewState({ ...emptyState }); }}
                isPending={createMutation.isPending}
                isEdit={false}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#CDB58B]/30 border-t-[#CDB58B] rounded-full animate-spin" />
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">لا توجد أسئلة بعد</p>
            <p className="text-sm text-muted-foreground mt-1">أضف أسئلة أو استوردها من ملف CSV</p>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q, i) => (
              <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={`bg-card rounded-xl p-4 border ${editId === q.id ? "border-[#CDB58B]/50" : "border-border/30"}`}>
                <AnimatePresence mode="wait">
                  {editId === q.id ? (
                    <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                      <h3 className="font-semibold mb-3 text-[#CDB58B] text-sm">تعديل السؤال س{i + 1}</h3>
                      <QuestionForm
                        state={editState}
                        onChange={setEditState}
                        onSubmit={() => { if (isFormValid(editState)) updateMutation.mutate({ id: q.id, data: buildPayload(editState) }); }}
                        onCancel={() => setEditId(null)}
                        isPending={updateMutation.isPending}
                        isEdit={true}
                      />
                    </motion.div>
                  ) : (
                    <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1">
                          <span className="text-xs text-muted-foreground ml-2">س{i + 1}</span>
                          {q.category && <span className="text-xs px-2 py-0.5 bg-[#CDB58B]/10 text-[#CDB58B] rounded-full">{q.category}</span>}
                          {q.context && <p className="text-xs text-muted-foreground mt-1 italic" dir="auto">📋 {q.context}</p>}
                          <p className="font-medium mt-1" dir="auto" data-testid={`text-question-${q.id}`}>{q.text}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="icon" variant="ghost" onClick={() => startEdit(q)} data-testid={`button-edit-${q.id}`}><Edit2 className="w-4 h-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(q.id)} data-testid={`button-delete-${q.id}`}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {(["A", "B", "C", "D"] as const).map((label, idx) => (
                          <div key={label} className={`px-3 py-1.5 rounded-md ${q.correct === label ? "bg-green-500/15 text-green-400 border border-green-500/30" : "bg-muted/50 text-muted-foreground"}`} dir="auto">
                            <span className="font-semibold ml-1">{label}.</span> {q.options[idx]}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
