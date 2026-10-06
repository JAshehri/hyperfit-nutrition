"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  AppData, Client, Food, GeneratedMeal, Goal, NutritionInput, NutritionResult, Plan,
  calculateNutrition, generateMeals, initialData, regenerateMeal,
} from "./lib/domain";
import { api, AppRole, AuthUser, CreateManagedUser, ManagedUser } from "./lib/api";

type NavName = "لوحة التحكم" | "العملاء" | "الخطط الغذائية" | "قاعدة الأطعمة" | "التقارير" | "إدارة المستخدمين" | "الإعدادات";
type ModalName = "client" | "food" | null;

const navigation: { label: NavName; icon: string }[] = [
  { label: "لوحة التحكم", icon: "▦" }, { label: "العملاء", icon: "♙" },
  { label: "الخطط الغذائية", icon: "▤" }, { label: "قاعدة الأطعمة", icon: "♨" },
  { label: "التقارير", icon: "⌁" }, { label: "إدارة المستخدمين", icon: "♟" }, { label: "الإعدادات", icon: "⚙" },
];

const emptyMealSlots = [
  { name: "الفطور", pct: 25 }, { name: "الغداء", pct: 40 },
  { name: "العشاء", pct: 25 }, { name: "سناك", pct: 10 },
];

const emptyClient: Client = {
  id: "", name: "", phone: "", email: "", age: 30, height: 170, sex: "MALE",
  weight: 75, bodyFat: 20, activity: "MODERATE", goal: "MAINTAIN", status: "ACTIVE",
  joinedAt: "", notes: "",
};

function makeInput(client: Client, adjustment: number): NutritionInput {
  return {
    age: client.age, height: client.height, weight: client.weight, bodyFat: client.bodyFat, sex: client.sex, activity: client.activity,
    goal: client.goal, adjustment, mealSlots: emptyMealSlots.map(slot => ({ ...slot })),
    formula: "MIFFLIN_ST_JEOR",
  };
}

function migrateStoredData(value: AppData): AppData {
  const clients = value.clients.map(client => ({ ...client, height: client.height ?? 170 }));
  const clientById = new Map(clients.map(client => [client.id, client]));
  return {
    ...value,
    clients,
    foods: value.foods.map(food => ({ ...food, mealTypes: food.mealTypes?.length ? food.mealTypes : ["LUNCH", "DINNER"] })),
    plans: value.plans.flatMap(plan => {
      const client = clientById.get(plan.clientId) ?? clients[0] ?? emptyClient;
      const rawStatus = plan.status as string;
      const status = rawStatus === "READY" ? "DRAFT" : rawStatus;
      if (status !== "DRAFT" && status !== "ACTIVE") return [];
      return [{ ...plan, status, input: { ...plan.input, age: plan.input.age ?? client.age, height: plan.input.height ?? client.height, formula: plan.input.formula ?? "MIFFLIN_ST_JEOR" } } as Plan];
    }),
  };
}

function format(value: number | string, digits = 0) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: digits }).format(Number(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function Brand() { return <div className="brand"><span>hyper</span><b>ϟ</b><span>fit</span></div>; }

function StatusBadge({ status }: { status: Plan["status"] | Client["status"] }) {
  const labels: Record<string, string> = { DRAFT: "مسودة", ACTIVE: "فعالة", PAUSED: "متوقف" };
  return <span className={`status-badge status-${status.toLowerCase()}`}>{labels[status] ?? "نشط"}</span>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span>ϟ</span><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export default function HyperFitApp() {
  const [data, setData] = useState<AppData>(initialData);
  const [hydrated, setHydrated] = useState(false);
  const [activeNav, setActiveNav] = useState<NavName>("لوحة التحكم");
  const [selectedClientId, setSelectedClientId] = useState(initialData.clients[0]?.id ?? "");
  const [builder, setBuilder] = useState<NutritionInput>(() => makeInput(initialData.clients[0] ?? emptyClient, 500));
  const [result, setResult] = useState<NutritionResult | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [macroEditor, setMacroEditor] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const sessionRole = sessionUser?.role ?? null;

  useEffect(() => {
    async function restoreSession() {
      if (!api.hasToken()) { setHydrated(true); return; }
      try {
        const [{ user }, state] = await Promise.all([api.me(), api.loadState()]);
        setSessionUser(user);
        if (state.data) setData(migrateStoredData(state.data));
        else if (user.role !== "CLIENT") setData(initialData);
        else setData({ ...initialData, clients: [], plans: [], foods: [] });
        setDataReady(true);
      } catch {
        api.clearToken();
      } finally { setHydrated(true); }
    }
    restoreSession();
  }, []);

  useEffect(() => {
    if (!dataReady || !sessionRole || sessionRole === "CLIENT") return;
    const timer = window.setTimeout(() => {
      api.saveState(data).catch(caught => setError(caught instanceof Error ? caught.message : "تعذر حفظ البيانات في الخادم"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, dataReady, sessionRole]);

  useEffect(() => {
    if (!sessionUser || (sessionRole !== "CLIENT" && activeNav !== "التقارير")) return;
    const refresh = async () => {
      try {
        const state = await api.loadState();
        if (state.data) {
          const next = migrateStoredData(state.data);
          setData(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        }
      } catch { /* the next authenticated action will surface session errors */ }
    };
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [sessionUser, sessionRole, activeNav]);

  useEffect(() => {
    if (data.clients.length && !data.clients.some(client => client.id === selectedClientId)) {
      setSelectedClientId(data.clients[0].id);
      setBuilder(makeInput(data.clients[0], data.settings.defaultAdjustment));
    }
  }, [data.clients, data.settings.defaultAdjustment, selectedClientId]);

  useEffect(() => {
    if (!dataReady || !selectedClientId || currentPlanId) return;
    const draft = data.plans.find(plan => plan.clientId === selectedClientId && plan.status === "DRAFT");
    if (!draft) return;
    setCurrentPlanId(draft.id);
    setBuilder(draft.input);
    setResult(draft.result);
  }, [data.plans, dataReady, selectedClientId, currentPlanId]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const selectedClient = data.clients.find(client => client.id === selectedClientId) ?? data.clients[0];
  const currentPlan = data.plans.find(plan => plan.id === currentPlanId) ?? null;
  const activePlans = data.plans.filter(plan => plan.status === "ACTIVE");
  const pendingPlans = data.plans.filter(plan => plan.status === "DRAFT");
  const completedMeals = data.plans.flatMap(plan => plan.generatedMeals).filter(meal => meal.completed).length;
  const allMeals = data.plans.flatMap(plan => plan.generatedMeals).length;
  const adherence = allMeals ? Math.round(completedMeals / allMeals * 100) : 0;

  function updateData(updater: (current: AppData) => AppData) { setData(current => updater(current)); }

  function chooseClient(id: string, openBuilder = false) {
    const client = data.clients.find(item => item.id === id);
    if (!client) return;
    const draft = data.plans.find(plan => plan.clientId === id && plan.status === "DRAFT");
    setSelectedClientId(id);
    setBuilder(draft?.input ?? makeInput(client, data.settings.defaultAdjustment));
    setResult(draft?.result ?? null); setCurrentPlanId(draft?.id ?? null); setError("");
    if (openBuilder) setActiveNav("الخطط الغذائية");
  }

  function runCalculation() {
    setError("");
    try {
      const calculated = calculateNutrition(builder);
      setResult(calculated);
      setToast("تم حساب المسودة والتحقق من النسب");
      return calculated;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حساب الخطة");
      return null;
    }
  }

  function saveDraft(calculated = result, persist = true) {
    if (!calculated || !selectedClient) { setError("احسب المسودة أولًا قبل الحفظ"); return null; }
    const now = new Date().toISOString();
    const selectedPlan = currentPlanId ? data.plans.find(plan => plan.id === currentPlanId) : undefined;
    const existing = selectedPlan?.clientId === selectedClient.id && selectedPlan.status === "DRAFT"
      ? selectedPlan
      : data.plans.find(plan => plan.clientId === selectedClient.id && plan.status === "DRAFT");
    const nextVersion = Math.max(0, ...data.plans.filter(plan => plan.clientId === selectedClient.id).map(plan => plan.version)) + 1;
    const plan: Plan = existing ? {
      ...existing, input: builder, result: calculated, updatedAt: now, status: "DRAFT", generatedMeals: [],
    } : {
      id: crypto.randomUUID(), clientId: selectedClient.id, clientName: selectedClient.name, createdAt: now, updatedAt: now,
      status: "DRAFT", version: nextVersion, input: builder, result: calculated, generatedMeals: [],
    };
    const nextData = { ...data, plans: existing ? data.plans.map(item => item.id === plan.id ? plan : item) : [plan, ...data.plans] };
    setData(nextData);
    if (persist) api.saveState(nextData).catch(caught => setError(caught instanceof Error ? caught.message : "تعذر حفظ المسودة"));
    setCurrentPlanId(plan.id); setToast(existing ? "تم تحديث نسخة العمل الوحيدة" : "حُفظت نسخة عمل جديدة");
    return plan;
  }

  function generatePlanMeals() {
    const calculated = result ?? runCalculation();
    if (!calculated || !selectedClient) return;
    const plan = saveDraft(calculated, false);
    if (!plan) return;
    try {
      const meals = generateMeals(calculated, data.foods, Date.now());
      const generatedPlan = { ...plan, result: calculated, input: builder, generatedMeals: meals, status: "DRAFT" as const, updatedAt: new Date().toISOString() };
      const nextPlans = data.plans.some(item => item.id === plan.id)
        ? data.plans.map(item => item.id === plan.id ? generatedPlan : item)
        : [generatedPlan, ...data.plans];
      const nextData = { ...data, plans: nextPlans };
      setData(nextData);
      api.saveState(nextData).catch(caught => setError(caught instanceof Error ? caught.message : "تعذر حفظ الوجبات المولدة"));
      setCurrentPlanId(plan.id); setToast("تم توليد أربع وجبات وربطها بأهداف الخطة");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر توليد الوجبات"); }
  }

  async function approvePlan() {
    if (!currentPlan || currentPlan.status !== "DRAFT" || !currentPlan.generatedMeals.length) { setError("يجب حفظ المسودة وتوليد وجباتها قبل اعتمادها"); return; }
    setError("");
    try {
      const response = await api.approvePlan(currentPlan.id);
      setData(migrateStoredData(response.data));
      setToast("تم تفعيل الإصدار الجديد واستبدال الإصدار السابق");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر اعتماد الخطة"); }
  }

  function replaceMeal(meal: GeneratedMeal) {
    if (!currentPlan) return;
    const target = currentPlan.result.meals.find(item => item.display_name === meal.slot);
    if (!target) return;
    const replacement = regenerateMeal(target, data.foods, meal.variant + 1);
    updateData(current => ({ ...current, plans: current.plans.map(plan => plan.id === currentPlan.id ? {
      ...plan, status: "DRAFT", generatedMeals: plan.generatedMeals.map(item => item.id === meal.id ? replacement : item), updatedAt: new Date().toISOString(),
    } : plan) }));
    setToast(`تم إنشاء بديل جديد لوجبة ${meal.slot}`);
  }

  function toggleMeal(planId: string, mealId: string) {
    const plan = data.plans.find(item => item.id === planId);
    const meal = plan?.generatedMeals.find(item => item.id === mealId);
    const completed = !meal?.completed;
    updateData(current => ({ ...current, plans: current.plans.map(plan => plan.id === planId ? {
      ...plan, generatedMeals: plan.generatedMeals.map(meal => meal.id === mealId ? { ...meal, completed } : meal),
    } : plan) }));
    if (sessionRole === "CLIENT") api.setMealCompleted(planId, mealId, completed).catch(caught => setError(caught instanceof Error ? caught.message : "تعذر حفظ إكمال الوجبة"));
  }

  function openPlan(plan: Plan) {
    setCurrentPlanId(plan.id); setSelectedClientId(plan.clientId); setBuilder(plan.input); setResult(plan.result); setActiveNav("الخطط الغذائية"); setError("");
  }

  function exportReport() {
    const rows = [["العميل", "الحالة", "الإصدار", "السعرات", "وجبات مكتملة"], ...data.plans.map(plan => [
      plan.clientName, plan.status, String(plan.version), String(Math.round(Number(plan.result.daily_target_kcal))),
      `${plan.generatedMeals.filter(meal => meal.completed).length}/${plan.generatedMeals.length}`,
    ])];
    const csv = "\uFEFF" + rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "hyperfit-report.csv"; anchor.click(); URL.revokeObjectURL(url);
    setToast("تم تصدير التقرير بصيغة CSV");
  }

  function resetData() {
    if (!window.confirm("سيتم استبدال بيانات النظام الحالية بالبيانات الأولية. هل أنت متأكد؟")) return;
    setData(initialData); setSelectedClientId(initialData.clients[0]?.id ?? ""); setBuilder(makeInput(initialData.clients[0] ?? emptyClient, 500));
    setResult(null); setCurrentPlanId(null); setToast("تمت إعادة بيانات النظام الأولية");
  }

  async function login(email: string, password: string) {
    const user = await api.login(email, password);
    const state = await api.loadState();
    setSessionUser(user);
    if (state.data) setData(migrateStoredData(state.data));
    else if (user.role !== "CLIENT") setData(initialData);
    else setData({ ...initialData, clients: [], plans: [], foods: [] });
    setDataReady(true);
  }

  async function logout() {
    if (dataReady && sessionRole && sessionRole !== "CLIENT") {
      try { await api.saveState(data); } catch { /* logout must remain available if the session expired */ }
    }
    await api.logout();
    setSessionUser(null);
    setDataReady(false);
    setActiveNav("لوحة التحكم");
  }

  async function updateCurrentUser(fullName: string, email: string) {
    const updated = await api.updateProfile(fullName, email);
    setSessionUser(updated);
  }

  async function replaceClientMeal(planId: string, meal: GeneratedMeal) {
    const response = await api.replaceClientMeal(planId, meal.id);
    setData(current => ({ ...current, plans: current.plans.map(plan => plan.id === planId ? {
      ...plan, generatedMeals: plan.generatedMeals.map(item => item.id === meal.id ? response.meal : item),
    } : plan) }));
  }

  if (!hydrated) return <div className="boot-screen">HyperFit</div>;
  if (!sessionUser) return <LoginView onLogin={login} />;
  if (sessionUser.must_change_password) return <ForcePasswordChange onComplete={logout} />;
  if (sessionRole === "CLIENT") return data.clients[0]
    ? <ClientPortal user={sessionUser} client={data.clients[0]} plans={data.plans.filter(plan => plan.clientId === data.clients[0].id)} onToggleMeal={toggleMeal} onReplaceMeal={replaceClientMeal} onUserUpdated={updateCurrentUser} onLogout={logout} />
    : <main className="boot-screen">لا يوجد ملف مستخدم مرتبط بهذا البريد. تواصل مع الأدمن.</main>;

  return <main className="shell">
    <aside className="sidebar">
      <Brand />
      <nav aria-label="التنقل الرئيسي">
        {navigation.filter(item => item.label !== "إدارة المستخدمين" || sessionRole === "ADMIN").map(item => <button key={item.label} className={`nav-item ${activeNav === item.label ? "active" : ""}`} onClick={() => setActiveNav(item.label)}>
          <i>{item.icon}</i><span>{item.label}</span>{item.label === "الخطط الغذائية" && pendingPlans.length > 0 && <b>{pendingPlans.length}</b>}
        </button>)}
      </nav>
      <div className="storage-note"><span className="status-dot" />متصل بقاعدة البيانات</div>
      <div className="profile-card"><div className="avatar">{sessionUser.full_name.slice(0, 1)}</div><div><strong>{sessionUser.full_name}</strong><small>{sessionUser.email}</small></div></div>
    </aside>

    <section className="content">
      <header className="topbar">
        <div><p>{new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h1>{activeNav}</h1></div>
        <div className="top-actions"><span className="role-badge">{sessionRole === "ADMIN" ? "ADMIN" : "DOCTOR"}</span><button className="circle-btn" aria-label="الإشعارات" onClick={() => setNotificationsOpen(value => !value)}><i>{pendingPlans.length}</i>♢</button><button className="primary-btn" onClick={() => setModal("client")}>＋ إضافة عميل</button><button className="logout-btn" onClick={logout}>خروج</button></div>
        {notificationsOpen && <div className="notifications-panel"><strong>التنبيهات</strong>{pendingPlans.length ? pendingPlans.slice(0, 4).map(plan => <button key={plan.id} onClick={() => openPlan(plan)}>خطة {plan.clientName} تنتظر المراجعة</button>) : <p>لا توجد تنبيهات جديدة</p>}</div>}
      </header>

      {activeNav === "لوحة التحكم" && <DashboardView data={data} adherence={adherence} pendingPlans={pendingPlans} activePlans={activePlans} canManageUsers onAddClient={() => setModal("client")} onOpenPlan={openPlan} onNavigate={setActiveNav} />}
      {activeNav === "العملاء" && <ClientsView clients={data.clients} plans={data.plans} search={search} setSearch={setSearch} canAdd onAdd={() => setModal("client")} onBuild={id => chooseClient(id, true)} />}
      {activeNav === "الخطط الغذائية" && <PlansView data={data} selectedClientId={selectedClientId} onSelectClient={chooseClient} builder={builder} setBuilder={setBuilder} result={result} currentPlan={currentPlan} plans={data.plans} error={error} macroEditor={macroEditor} setMacroEditor={setMacroEditor} onCalculate={runCalculation} onSave={() => saveDraft()} onGenerate={generatePlanMeals} onApprove={approvePlan} onRegenerate={replaceMeal} onOpenPlan={openPlan} />}
      {activeNav === "قاعدة الأطعمة" && <FoodsView foods={data.foods} search={search} setSearch={setSearch} onAdd={() => setModal("food")} />}
      {activeNav === "التقارير" && <ReportsView data={data} adherence={adherence} onExport={exportReport} onOpenPlan={openPlan} />}
      {activeNav === "إدارة المستخدمين" && sessionRole === "ADMIN" && <AdminUsersView currentUser={sessionUser} onClientCreated={client => updateData(current => ({ ...current, clients: [client, ...current.clients] }))} onClientDeleted={email => updateData(current => { const ids = new Set(current.clients.filter(client => client.email.toLowerCase() === email.toLowerCase()).map(client => client.id)); return { ...current, clients: current.clients.filter(client => !ids.has(client.id)), plans: current.plans.filter(plan => !ids.has(plan.clientId)) }; })} />}
      {activeNav === "الإعدادات" && <SettingsView user={sessionUser} data={data} setData={setData} onUserUpdated={updateCurrentUser} onLogout={logout} onReset={resetData} showSystemSettings={sessionRole === "ADMIN"} />}
    </section>

    {modal === "client" && <ClientModal onClose={() => setModal(null)} onSave={async (payload, client) => { const created = await api.createUser(payload); const savedClient = { ...client, id: created.id }; updateData(current => ({ ...current, clients: [savedClient, ...current.clients.filter(item => item.id !== created.id)] })); setSelectedClientId(savedClient.id); setBuilder(makeInput(savedClient, data.settings.defaultAdjustment)); setModal(null); setToast("تم إنشاء حساب العميل وأصبح ظاهرًا للطبيب والأدمن"); }} />}
    {modal === "food" && <FoodModal onClose={() => setModal(null)} onSave={food => { updateData(current => ({ ...current, foods: [food, ...current.foods] })); setModal(null); setToast("تمت إضافة الطعام إلى القاعدة"); }} />}
    {toast && <div className="toast">✓ {toast}</div>}
  </main>;
}

function DashboardView({ data, adherence, pendingPlans, activePlans, canManageUsers, onAddClient, onOpenPlan, onNavigate }: { data: AppData; adherence: number; pendingPlans: Plan[]; activePlans: Plan[]; canManageUsers: boolean; onAddClient: () => void; onOpenPlan: (plan: Plan) => void; onNavigate: (nav: NavName) => void }) {
  return <><section className="overview-grid"><article className="hero-card"><div className="eyebrow"><span className="status-dot" />نظرة عامة مباشرة</div><h2>كل قرار غذائي<br /><em>محسوب وقابل للتنفيذ.</em></h2><p>البيانات أدناه مرتبطة بما تحفظه وتنجزه فعليًا داخل النظام.</p><div className="hero-metrics"><div><strong>{data.clients.length}</strong><span>عميل</span></div><div><strong>{adherence}%</strong><span>التزام الوجبات</span></div><div><strong>{pendingPlans.length}</strong><span>مسودات قيد الإعداد</span></div></div></article><article className="activity-card"><div className="card-title"><div><span>حالة التشغيل</span><small>تُحدّث مباشرة مع كل إجراء</small></div><button className="text-btn" onClick={() => onNavigate("التقارير")}>كل التقارير ←</button></div><div className="live-stats"><div><i>01</i><strong>{activePlans.length}</strong><span>خطط فعالة</span></div><div><i>02</i><strong>{data.plans.length}</strong><span>إجمالي الإصدارات</span></div><div><i>03</i><strong>{data.foods.length}</strong><span>عنصرًا غذائيًا</span></div><div><i>04</i><strong>{data.plans.flatMap(plan => plan.generatedMeals).length}</strong><span>وجبات مولدة</span></div></div></article></section><section className="dashboard-grid"><article className="card"><div className="section-heading"><div><div><h3>مهام تحتاج تدخلك</h3><p>المسودات الجاري إعدادها للإصدار التالي</p></div></div></div>{pendingPlans.length ? <div className="task-list">{pendingPlans.slice(0, 5).map(plan => <button key={plan.id} onClick={() => onOpenPlan(plan)}><span><strong>{plan.clientName}</strong><small>الإصدار {plan.version} · {dateLabel(plan.updatedAt)}</small></span><StatusBadge status={plan.status} /></button>)}</div> : <EmptyState title="لا توجد مهام معلقة" text="أنشئ خطة جديدة وسيظهر مسار المراجعة هنا." />}</article><article className="card quick-card"><div className="section-heading"><div><div><h3>إجراء سريع</h3><p>ابدأ من مكان واضح</p></div></div></div>{canManageUsers && <button onClick={onAddClient}>＋ <span><strong>إضافة عميل</strong><small>إنشاء حساب مستخدم جديد</small></span></button>}<button onClick={() => onNavigate("الخطط الغذائية")}>ϟ <span><strong>إنشاء خطة</strong><small>حساب ثم توليد واعتماد</small></span></button><button onClick={() => onNavigate("قاعدة الأطعمة")}>♨ <span><strong>إدارة الأطعمة</strong><small>بحث وإضافة عناصر</small></span></button></article></section></>;
}

function ClientsView({ clients, plans, search, setSearch, canAdd, onAdd, onBuild }: { clients: Client[]; plans: Plan[]; search: string; setSearch: (value: string) => void; canAdd: boolean; onAdd: () => void; onBuild: (id: string) => void }) {
  const shown = clients.filter(client => `${client.name} ${client.phone} ${client.email}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="page-stack"><div className="page-toolbar"><div className="search-box">⌕<input placeholder="ابحث بالاسم أو الهاتف أو البريد" value={search} onChange={event => setSearch(event.target.value)} /></div>{canAdd && <button className="primary-btn" onClick={onAdd}>＋ إضافة حساب مستخدم</button>}</div><article className="card data-card"><div className="data-row data-head"><span>العميل</span><span>الهدف</span><span>القياسات</span><span>آخر خطة</span><span>إجراء</span></div>{shown.map(client => { const last = plans.find(plan => plan.clientId === client.id); return <div className="data-row" key={client.id}><span className="person-cell"><i>{client.name.slice(0, 2)}</i><b>{client.name}<small>{client.email}</small></b></span><span>{goalLabel(client.goal)}</span><span>{client.weight} كجم · {client.bodyFat}% دهون</span><span>{last ? <StatusBadge status={last.status} /> : "لا توجد"}</span><span><button className="mini-btn" onClick={() => onBuild(client.id)}>إنشاء خطة</button></span></div>; })}{!shown.length && <EmptyState title="لا يوجد عملاء" text="يمكن للطبيب أو الأدمن إضافة حساب مستخدم جديد من هذه الصفحة." action={canAdd ? <button className="primary-btn" onClick={onAdd}>إضافة مستخدم</button> : undefined} />}</article></section>;
}

function PlansView({ data, selectedClientId, onSelectClient, builder, setBuilder, result, currentPlan, plans, error, macroEditor, setMacroEditor, onCalculate, onSave, onGenerate, onApprove, onRegenerate, onOpenPlan }: { data: AppData; selectedClientId: string; onSelectClient: (id: string) => void; builder: NutritionInput; setBuilder: React.Dispatch<React.SetStateAction<NutritionInput>>; result: NutritionResult | null; currentPlan: Plan | null; plans: Plan[]; error: string; macroEditor: boolean; setMacroEditor: (value: boolean) => void; onCalculate: () => NutritionResult | null; onSave: () => Plan | null; onGenerate: () => void; onApprove: () => void; onRegenerate: (meal: GeneratedMeal) => void; onOpenPlan: (plan: Plan) => void }) {
  if (!data.clients.length) return <EmptyState title="لا يوجد عملاء" text="أضف حساب مستخدم من زر «إضافة عميل» ثم ابدأ إنشاء الخطة." />;
  const mealTotal = builder.mealSlots.reduce((sum, slot) => sum + slot.pct, 0);
  return <section className="page-stack"><article className="card plan-strip"><div><h3>إصدارات الخطط</h3><p>خطة فعالة حالية ومسودة واحدة للإصدار القادم</p></div><div>{plans.slice(0, 5).map(plan => <button key={plan.id} className={currentPlan?.id === plan.id ? "selected" : ""} onClick={() => onOpenPlan(plan)}><b>{plan.clientName}</b><small>v{plan.version}</small><StatusBadge status={plan.status} /></button>)}{!plans.length && <span>لا توجد خطط محفوظة بعد</span>}</div></article><article className="card builder-card"><div className="section-heading"><div><span className="section-icon">ϟ</span><div><h3>منشئ الخطة الغذائية</h3><p>المسودة مستقلة عن الخطة الفعالة، واعتمادها يستبدل الإصدار السابق</p></div></div><span className="engine-badge">FORMULA V1</span></div><div className="builder-client"><label>العميل<select value={selectedClientId} onChange={event => onSelectClient(event.target.value)}>{data.clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label><div className="flow-steps"><span className={result ? "done" : "active"}>1 الحساب</span><span className={currentPlan ? "done" : ""}>2 حفظ المسودة</span><span className={currentPlan?.generatedMeals.length ? "done" : ""}>3 التوليد</span><span className={currentPlan?.status === "ACTIVE" ? "done" : ""}>4 الاعتماد</span></div></div>{currentPlan?.status === "ACTIVE" && <p className="plan-readonly-note">هذه الخطة فعالة للعميل ولا تُعدّل مباشرة. أي حفظ جديد سينشئ مسودة للإصدار التالي.</p>}<div className="calc-form"><Field label="الوزن كجم" value={builder.weight} onChange={value => setBuilder(current => ({ ...current, weight: value }))} /><Field label="نسبة الدهون %" value={builder.bodyFat} onChange={value => setBuilder(current => ({ ...current, bodyFat: value }))} /><label>الجنس<select value={builder.sex} onChange={event => setBuilder(current => ({ ...current, sex: event.target.value as NutritionInput["sex"] }))}><option value="MALE">ذكر</option><option value="FEMALE">أنثى</option></select></label><label>النشاط<select value={builder.activity} onChange={event => setBuilder(current => ({ ...current, activity: event.target.value as NutritionInput["activity"] }))}><option value="SEDENTARY">خامل</option><option value="LIGHT">خفيف</option><option value="MODERATE">متوسط</option><option value="HIGH">مرتفع</option><option value="VERY_HIGH">مرتفع جدًا</option></select></label><label>الهدف<select value={builder.goal} onChange={event => setBuilder(current => ({ ...current, goal: event.target.value as Goal }))}><option value="LOSS">خسارة وزن</option><option value="GAIN">زيادة وزن</option><option value="MAINTAIN">ثبات</option></select></label><Field label="فرق السعرات" value={builder.goal === "MAINTAIN" ? 0 : builder.adjustment} disabled={builder.goal === "MAINTAIN"} onChange={value => setBuilder(current => ({ ...current, adjustment: value }))} /></div><div className="slot-editor"><div><b>توزيع الوجبات</b><small className={mealTotal === 100 ? "valid" : "invalid"}>المجموع {mealTotal}%</small></div>{builder.mealSlots.map((slot, index) => <label key={slot.name}>{slot.name}<input type="number" min="1" max="100" value={slot.pct} onChange={event => setBuilder(current => ({ ...current, mealSlots: current.mealSlots.map((item, idx) => idx === index ? { ...item, pct: Number(event.target.value) } : item) }))} /></label>)}</div><div className="builder-actions"><button className="primary-btn" onClick={onCalculate}>احسب المسودة</button><button className="secondary-btn" disabled={!result} onClick={onSave}>حفظ المسودة</button><button className="secondary-btn" disabled={!result} onClick={onGenerate}>توليد الوجبات</button><button className="approve-btn" disabled={currentPlan?.status !== "DRAFT" || !currentPlan.generatedMeals.length} onClick={onApprove}>{currentPlan?.status === "ACTIVE" ? "الخطة الفعالة الحالية" : "اعتماد الإصدار الجديد"}</button></div>{error && <p className="error-message">{error}</p>}</article>
    {result ? <><section className="result-grid"><article className="card metrics-card"><Metric label="LBM" value={`${format(result.lbm_kg, 1)} كجم`} /><Metric label="BMR" value={`${format(result.bmr_kcal)} سعرة`} /><Metric label="TDEE" value={`${format(result.tdee_kcal)} سعرة`} /><Metric label="الهدف اليومي" value={`${format(result.daily_target_kcal)} سعرة`} accent /></article><article className="card macro-card"><div className="section-heading"><div><div><h3>الماكروز</h3><p>جرامات ونسب محسوبة</p></div></div><button className="text-btn" onClick={() => setMacroEditor(!macroEditor)}>{macroEditor ? "إغلاق" : "تعديل النسب"}</button></div>{macroEditor && <div className="macro-editor"><Field label="بروتين %" value={builder.macroPercentages?.protein ?? Math.round(Number(result.macros.protein_pct))} onChange={value => setBuilder(current => ({ ...current, macroPercentages: { protein: value, carbs: current.macroPercentages?.carbs ?? Math.round(Number(result.macros.carb_pct)), fat: current.macroPercentages?.fat ?? Math.round(Number(result.macros.fat_pct)) } }))} /><Field label="كارب %" value={builder.macroPercentages?.carbs ?? Math.round(Number(result.macros.carb_pct))} onChange={value => setBuilder(current => ({ ...current, macroPercentages: { protein: current.macroPercentages?.protein ?? Math.round(Number(result.macros.protein_pct)), carbs: value, fat: current.macroPercentages?.fat ?? Math.round(Number(result.macros.fat_pct)) } }))} /><Field label="دهون %" value={builder.macroPercentages?.fat ?? Math.round(Number(result.macros.fat_pct))} onChange={value => setBuilder(current => ({ ...current, macroPercentages: { protein: current.macroPercentages?.protein ?? Math.round(Number(result.macros.protein_pct)), carbs: current.macroPercentages?.carbs ?? Math.round(Number(result.macros.carb_pct)), fat: value } }))} /><button className="mini-btn" onClick={onCalculate}>تطبيق</button></div>}<div className="macro-bars"><Macro label="بروتين" grams={result.macros.protein_g} pct={result.macros.protein_pct} color="green" /><Macro label="كربوهيدرات" grams={result.macros.carb_g} pct={result.macros.carb_pct} color="blue" /><Macro label="دهون" grams={result.macros.fat_g} pct={result.macros.fat_pct} color="gray" /></div></article></section><article className="card targets-card"><div className="section-heading"><div><div><h3>أهداف الوجبات</h3><p>يجب أن تساوي نسبها 100%</p></div></div></div><div className="meal-table"><div className="table-row table-head"><span>الوجبة</span><span>النسبة</span><span>السعرات</span><span>البروتين</span><span>الكربوهيدرات</span><span>الدهون</span></div>{result.meals.map(meal => <div className="table-row" key={meal.display_name}><span><i className="meal-icon">◇</i><strong>{meal.display_name}</strong></span><span>{format(meal.calorie_pct)}%</span><span>{format(meal.target_kcal)} سعرة</span><span>{format(meal.target_protein_g, 1)} جم</span><span>{format(meal.target_carb_g, 1)} جم</span><span>{format(meal.target_fat_g, 1)} جم</span></div>)}</div></article></> : <EmptyState title="ابدأ بحساب المسودة" text="اختر العميل وراجع قياساته ثم اضغط «احسب المسودة». لن نعرض أرقامًا تجريبية قبل نجاح الحساب." />}
    {currentPlan?.generatedMeals.length ? <GeneratedMeals plan={currentPlan} onRegenerate={currentPlan.status === "DRAFT" ? onRegenerate : undefined} /> : result && <EmptyState title="الأهداف جاهزة للتوليد" text="اضغط «توليد الوجبات» لبناء منيو حقيقي من قاعدة الأطعمة، ثم راجعه واعتمده." />}</section>;
}

function FoodsView({ foods, search, setSearch, onAdd }: { foods: Food[]; search: string; setSearch: (value: string) => void; onAdd: () => void }) {
  const shown = foods.filter(food => `${food.nameAr} ${food.category}`.includes(search));
  return <section className="page-stack"><div className="page-toolbar"><div className="search-box">⌕<input placeholder="ابحث في الأطعمة أو التصنيف" value={search} onChange={event => setSearch(event.target.value)} /></div><button className="primary-btn" onClick={onAdd}>＋ إضافة طعام</button></div><article className="card data-card food-data"><div className="data-row data-head"><span>الطعام</span><span>التصنيف</span><span>السعرات/100جم</span><span>البروتين</span><span>الكارب</span><span>الدهون</span></div>{shown.map(food => <div className="data-row" key={food.id}><span><b>{food.nameAr}</b><small>{food.state}</small></span><span>{food.category}</span><span>{food.kcal}</span><span>{food.protein} جم</span><span>{food.carbs} جم</span><span>{food.fat} جم</span></div>)}</article></section>;
}

function ReportsView({ data, adherence, onExport, onOpenPlan }: { data: AppData; adherence: number; onExport: () => void; onOpenPlan: (plan: Plan) => void }) {
  const statusCount = (status: Plan["status"]) => data.plans.filter(plan => plan.status === status).length;
  const clientRows = data.clients.map(client => {
    const plans = data.plans.filter(plan => plan.clientId === client.id);
    const active = plans.find(plan => plan.status === "ACTIVE") ?? plans[0];
    const completed = active?.generatedMeals.filter(meal => meal.completed).length ?? 0;
    const total = active?.generatedMeals.length ?? 0;
    return { client, active, completed, total, percentage: total ? Math.round(completed / total * 100) : 0 };
  });
  return <section className="page-stack"><div className="page-toolbar"><div><h2>ملخص الأداء</h2><p>تُحدّث البيانات من تسجيل المستخدم لإكمال وجباته</p></div><button className="primary-btn" onClick={onExport}>⇩ تصدير CSV</button></div><section className="report-cards"><Metric label="العملاء" value={String(data.clients.length)} /><Metric label="الخطط الفعالة" value={String(statusCount("ACTIVE"))} accent /><Metric label="مسودات قيد الإعداد" value={String(statusCount("DRAFT"))} /><Metric label="التزام الوجبات" value={`${adherence}%`} /></section><article className="card adherence-card"><div className="section-heading"><div><div><h3>التزام العملاء</h3><p>الإكمال لا يستطيع تسجيله إلا المستخدم صاحب الخطة</p></div></div></div>{clientRows.length ? <div className="adherence-list">{clientRows.map(row => <div key={row.client.id} className="adherence-row"><span className="person-cell"><i>{row.client.name.slice(0, 2)}</i><b>{row.client.name}<small>{row.client.email}</small></b></span><div><span><b>{row.completed}/{row.total}</b> وجبة مكتملة</span><div className="adherence-track"><i style={{ width: `${row.percentage}%` }} /></div></div><strong>{row.percentage}%</strong>{row.active ? <button className="mini-btn" onClick={() => onOpenPlan(row.active!)}>عرض الخطة</button> : <span>لا توجد خطة</span>}</div>)}</div> : <EmptyState title="لا يوجد مستخدمون" text="أضف حساب مستخدم ليظهر تقرير التزامه هنا." />}</article><article className="card"><div className="section-heading"><div><div><h3>سجل الخطط</h3><p>كل إصدار وحالته الحالية</p></div></div></div>{data.plans.length ? <div className="task-list report-list">{data.plans.map(plan => <button key={plan.id} onClick={() => onOpenPlan(plan)}><span><strong>{plan.clientName}</strong><small>v{plan.version} · {format(plan.result.daily_target_kcal)} سعرة · {dateLabel(plan.updatedAt)}</small></span><span>{plan.generatedMeals.filter(meal => meal.completed).length}/{plan.generatedMeals.length} وجبة</span><StatusBadge status={plan.status} /></button>)}</div> : <EmptyState title="لا توجد بيانات للتقرير" text="عند حفظ أول خطة ستظهر هنا تلقائيًا." />}</article></section>;
}

function AdminUsersView({ currentUser, onClientCreated, onClientDeleted }: { currentUser: AuthUser; onClientCreated: (client: Client) => void; onClientDeleted: (email: string) => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    full_name: "", email: "", password: "", role: "CLIENT" as AppRole,
    license_number: "", specialty: "تغذية علاجية", age: 30, sex: "MALE" as "MALE" | "FEMALE",
    height_cm: 170, weight_kg: 75, body_fat_pct: 20, activity_level: "MODERATE", default_goal: "LOSS", medical_notes: "",
  });

  async function refresh() {
    try {
      setUsers(await api.listUsers());
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر تحميل الحسابات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    const payload: CreateManagedUser = form.role === "DOCTOR"
      ? { email: form.email, password: form.password, full_name: form.full_name, role: form.role, license_number: form.license_number, specialty: form.specialty }
      : form.role === "CLIENT"
        ? { email: form.email, password: form.password, full_name: form.full_name, role: form.role, age: form.age, sex: form.sex, height_cm: form.height_cm, weight_kg: form.weight_kg, body_fat_pct: form.body_fat_pct, activity_level: form.activity_level, default_goal: form.default_goal, medical_notes: form.medical_notes }
        : { email: form.email, password: form.password, full_name: form.full_name, role: form.role };
    try {
      const created = await api.createUser(payload);
      if (form.role === "CLIENT") onClientCreated({
        id: created.id, name: form.full_name, phone: "", email: form.email.toLowerCase(), age: form.age,
        height: form.height_cm, sex: form.sex, weight: form.weight_kg, bodyFat: form.body_fat_pct,
        activity: form.activity_level as Client["activity"], goal: form.default_goal as Client["goal"],
        status: "ACTIVE", joinedAt: new Date().toISOString().slice(0, 10), notes: form.medical_notes,
      });
      setMessage("تم إنشاء الحساب. سيُطلب من صاحبه تغيير كلمة المرور الأولية.");
      setForm(current => ({ ...current, full_name: "", email: "", password: "", license_number: "" }));
      await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر إنشاء الحساب"); }
    finally { setSaving(false); }
  }

  async function remove(user: ManagedUser) {
    if (!window.confirm(`حذف حساب ${user.full_name} نهائيًا؟`)) return;
    try { await api.deleteUser(user.id); if (user.role === "CLIENT") onClientDeleted(user.email); setMessage("تم حذف الحساب"); await refresh(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر حذف الحساب"); }
  }

  async function toggleStatus(user: ManagedUser) {
    try { await api.setUserEnabled(user.id, user.status !== "ACTIVE"); await refresh(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر تغيير حالة الحساب"); }
  }

  const roleLabel = (role: AppRole) => role === "ADMIN" ? "أدمن" : role === "DOCTOR" ? "طبيب" : "مستخدم";
  return <section className="page-stack admin-users-page">
    <div className="page-toolbar"><div><h2>إدارة المستخدمين</h2><p>إنشاء وإيقاف وحذف حسابات النظام من قاعدة البيانات</p></div><span className="role-badge">{users.length} حساب</span></div>
    <article className="card admin-create-card"><div className="section-heading"><div><div><h3>إضافة حساب</h3><p>الدور يُحفظ في الخادم ويُحدد تلقائيًا عند تسجيل الدخول</p></div></div></div>
      <form className="admin-user-form" onSubmit={create}>
        <label>الاسم الكامل<input required value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} /></label>
        <label>البريد الإلكتروني<input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <label>كلمة المرور الأولية<input required type="password" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="12 خانة، كبير وصغير ورقم ورمز" /></label>
        <label>نوع الحساب<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as AppRole })}><option value="CLIENT">مستخدم</option><option value="DOCTOR">طبيب</option><option value="ADMIN">أدمن</option></select></label>
        {form.role === "DOCTOR" && <><label>رقم الترخيص<input required value={form.license_number} onChange={event => setForm({ ...form, license_number: event.target.value })} /></label><label>التخصص<input required value={form.specialty} onChange={event => setForm({ ...form, specialty: event.target.value })} /></label></>}
        {form.role === "CLIENT" && <><label>العمر<input required type="number" step="1" min="18" max="100" value={form.age} onChange={event => setForm({ ...form, age: Number.parseInt(event.target.value, 10) })} /></label><label>الجنس<select value={form.sex} onChange={event => setForm({ ...form, sex: event.target.value as "MALE" | "FEMALE" })}><option value="MALE">ذكر</option><option value="FEMALE">أنثى</option></select></label><label>الطول سم<input required type="number" min="100" max="250" value={form.height_cm} onChange={event => setForm({ ...form, height_cm: Number(event.target.value) })} /></label><label>الوزن كجم<input required type="number" step="0.1" min="25" max="500" value={form.weight_kg} onChange={event => setForm({ ...form, weight_kg: Number(event.target.value) })} /></label><label>نسبة الدهون<input type="number" step="0.1" min="1" max="79" value={form.body_fat_pct} onChange={event => setForm({ ...form, body_fat_pct: Number(event.target.value) })} /></label><label>النشاط<select value={form.activity_level} onChange={event => setForm({ ...form, activity_level: event.target.value })}><option value="SEDENTARY">خامل</option><option value="LIGHT">خفيف</option><option value="MODERATE">متوسط</option><option value="HIGH">مرتفع</option><option value="VERY_HIGH">مرتفع جدًا</option></select></label><label>الهدف<select value={form.default_goal} onChange={event => setForm({ ...form, default_goal: event.target.value })}><option value="LOSS">خسارة وزن</option><option value="GAIN">زيادة وزن</option><option value="MAINTAIN">ثبات</option></select></label><label>ملاحظات طبية<input value={form.medical_notes} onChange={event => setForm({ ...form, medical_notes: event.target.value })} /></label></>}
        <button className="primary-btn" disabled={saving}>{saving ? "جارٍ الإنشاء..." : "إنشاء الحساب"}</button>
      </form>{message && <p className="admin-message">{message}</p>}
    </article>
    <article className="card data-card users-table"><div className="data-row data-head"><span>الحساب</span><span>الدور</span><span>الحالة</span><span>آخر دخول</span><span>الإجراءات</span></div>{loading ? <p className="loading-line">جارٍ تحميل الحسابات...</p> : users.map(user => <div className="data-row" key={user.id}><span className="person-cell"><i>{user.full_name.slice(0, 2)}</i><b>{user.full_name}<small>{user.email}</small></b></span><span>{roleLabel(user.role)}</span><span className={user.status === "ACTIVE" ? "user-active" : "user-suspended"}>{user.status === "ACTIVE" ? "فعال" : "موقوف"}</span><span>{user.last_login_at ? dateLabel(user.last_login_at) : "لم يسجل"}</span><span className="user-actions"><button className="mini-btn" disabled={user.id === currentUser.id} onClick={() => toggleStatus(user)}>{user.status === "ACTIVE" ? "إيقاف" : "تفعيل"}</button><button className="danger-btn" disabled={user.id === currentUser.id} onClick={() => remove(user)}>حذف</button></span></div>)}</article>
  </section>;
}

function AccountSettings({ user, onUserUpdated, onLogout }: { user: AuthUser; onUserUpdated: (fullName: string, email: string) => Promise<void>; onLogout: () => Promise<void> }) {
  const [profile, setProfile] = useState({ fullName: user.full_name, email: user.email });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirmation: "" });
  const [message, setMessage] = useState("");
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setMessage("");
    try { await onUserUpdated(profile.fullName, profile.email); setMessage("تم تحديث بيانات الحساب"); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر تحديث الحساب"); }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault(); setMessage("");
    if (passwords.next !== passwords.confirmation) { setMessage("تأكيد كلمة المرور غير مطابق"); return; }
    try { await api.changePassword(passwords.current, passwords.next); await onLogout(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر تغيير كلمة المرور"); }
  }
  return <article className="card account-settings"><div className="section-heading"><div><div><h3>إدارة الحساب</h3><p>الاسم والبريد وكلمة المرور الخاصة بحسابك</p></div></div><span className="role-badge">{user.role}</span></div><div className="account-settings-grid"><form className="settings-form" onSubmit={saveProfile}><label>الاسم الكامل<input required value={profile.fullName} onChange={event => setProfile({ ...profile, fullName: event.target.value })} /></label><label>البريد الإلكتروني<input required value={profile.email} onChange={event => setProfile({ ...profile, email: event.target.value })} /></label><button className="primary-btn">حفظ بيانات الحساب</button></form><form className="settings-form" onSubmit={savePassword}><label>كلمة المرور الحالية<input required type="password" value={passwords.current} onChange={event => setPasswords({ ...passwords, current: event.target.value })} /></label><label>كلمة المرور الجديدة<input required type="password" minLength={12} value={passwords.next} onChange={event => setPasswords({ ...passwords, next: event.target.value })} placeholder="12 خانة، كبير وصغير ورقم ورمز" /></label><label>تأكيد كلمة المرور<input required type="password" value={passwords.confirmation} onChange={event => setPasswords({ ...passwords, confirmation: event.target.value })} /></label><button className="secondary-btn">تغيير كلمة المرور</button></form></div>{message && <p className="admin-message">{message}</p>}</article>;
}

function SettingsView({ user, data, setData, onUserUpdated, onLogout, onReset, showSystemSettings }: { user: AuthUser; data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; onUserUpdated: (fullName: string, email: string) => Promise<void>; onLogout: () => Promise<void>; onReset: () => void; showSystemSettings: boolean }) {
  const [draft, setDraft] = useState(data.settings);
  return <section className="page-stack"><AccountSettings user={user} onUserUpdated={onUserUpdated} onLogout={onLogout} />{showSystemSettings && <section className="settings-grid"><article className="card"><div className="section-heading"><div><div><h3>إعدادات النظام</h3><p>هذه إعدادات عامة لا تظهر إلا للأدمن</p></div></div></div><div className="settings-form"><label>اسم العيادة<input value={draft.clinicName} onChange={event => setDraft({ ...draft, clinicName: event.target.value })} /></label><label>اسم المختص<input value={draft.doctorName} onChange={event => setDraft({ ...draft, doctorName: event.target.value })} /></label><label>فرق السعرات الافتراضي<input type="number" min="0" max="1000" value={draft.defaultAdjustment} onChange={event => setDraft({ ...draft, defaultAdjustment: Number(event.target.value) })} /></label><label className="toggle-line"><input type="checkbox" checked={draft.notifications} onChange={event => setDraft({ ...draft, notifications: event.target.checked })} /> تفعيل التنبيهات داخل التطبيق</label><button className="primary-btn" onClick={() => setData(current => ({ ...current, settings: draft }))}>حفظ إعدادات النظام</button></div></article><article className="card danger-card"><h3>إعادة تهيئة بيانات النظام</h3><p>يحذف ملفات العملاء والخطط ويعيد قاعدة الأطعمة الأولية. الحسابات لا تُحذف.</p><button className="danger-btn" onClick={onReset}>إعادة تهيئة البيانات</button></article></section>}</section>;
}

function GeneratedMeals({ plan, onRegenerate, onToggle, allowCompletion = false }: { plan: Plan; onRegenerate?: (meal: GeneratedMeal) => void | Promise<void>; onToggle?: (planId: string, mealId: string) => void; allowCompletion?: boolean }) {
  return <article className="card generated-section"><div className="section-heading"><div><div><h3>المنيو المولّد</h3><p>مكونات من قاعدة الأطعمة وأرقام مرتبطة بهدف كل وجبة</p></div></div><StatusBadge status={plan.status} /></div><div className="generated-grid">{plan.generatedMeals.map(meal => <article key={meal.id} className={meal.completed ? "generated-meal completed" : "generated-meal"}><div><span>{meal.slot}</span><b>{meal.kcal} سعرة</b></div><h4>{meal.name}</h4><ul>{meal.ingredients.map(item => <li key={item}>{item}</li>)}</ul><div className="meal-macros"><span>P {format(meal.protein, 1)}g</span><span>C {format(meal.carbs, 1)}g</span><span>F {format(meal.fat, 1)}g</span></div><div className="meal-actions">{onRegenerate && <button onClick={() => onRegenerate(meal)}>↻ بديل جديد</button>}{allowCompletion && onToggle && <button className={meal.completed ? "complete" : ""} onClick={() => onToggle(plan.id, meal.id)}>{meal.completed ? "✓ مكتملة" : "تسجيل الإكمال"}</button>}</div></article>)}</div></article>;
}

function LoginView({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("joudali1910@gmailcom");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email || !password) return;
    setLoading(true); setError("");
    try { await onLogin(email, password); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر تسجيل الدخول"); }
    finally { setLoading(false); }
  }
  return <main className="login-page"><section className="login-panel"><Brand /><span className="login-kicker">نظام التغذية الذكية</span><h1>تسجيل الدخول</h1><p>أدخل بيانات حسابك. سيحدد النظام صلاحياتك تلقائيًا.</p><form onSubmit={submit}><label>البريد الإلكتروني<input autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label><label>كلمة المرور<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="كلمة المرور" /></label>{error && <p className="error-message">{error}</p>}<button className="primary-btn" disabled={loading}>{loading ? "جارٍ التحقق..." : "تسجيل الدخول"}</button></form><small>الدور والصلاحيات والجلسة يتم التحقق منها في الخادم، وليس من المتصفح.</small></section></main>;
}

function ForcePasswordChange({ onComplete }: { onComplete: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (newPassword !== confirmation) { setError("تأكيد كلمة المرور غير مطابق"); return; }
    setLoading(true);
    try { await api.changePassword(currentPassword, newPassword); await onComplete(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر تغيير كلمة المرور"); }
    finally { setLoading(false); }
  }
  return <main className="login-page"><section className="login-panel"><Brand /><span className="login-kicker">حماية الحساب</span><h1>غيّر كلمة المرور الأولية</h1><p>يجب تعيين كلمة مرور خاصة بك قبل استخدام النظام.</p><form onSubmit={submit}><label>كلمة المرور الحالية<input required type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label>كلمة المرور الجديدة<input required type="password" minLength={12} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="12 خانة، كبير وصغير ورقم ورمز" /></label><label>تأكيد كلمة المرور<input required type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>{error && <p className="error-message">{error}</p>}<button className="primary-btn" disabled={loading}>{loading ? "جارٍ الحفظ..." : "تغيير كلمة المرور"}</button></form></section></main>;
}

function ClientPortal({ user, client, plans, onToggleMeal, onReplaceMeal, onUserUpdated, onLogout }: { user: AuthUser; client: Client; plans: Plan[]; onToggleMeal: (planId: string, mealId: string) => void; onReplaceMeal: (planId: string, meal: GeneratedMeal) => Promise<void>; onUserUpdated: (fullName: string, email: string) => Promise<void>; onLogout: () => Promise<void> }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [mealMessage, setMealMessage] = useState("");
  const plan = plans.find(item => item.status === "ACTIVE");
  const completed = plan?.generatedMeals.filter(meal => meal.completed).length ?? 0;
  const total = plan?.generatedMeals.length ?? 0;
  const adherence = total ? Math.round(completed / total * 100) : 0;
  async function replace(meal: GeneratedMeal) {
    setMealMessage("");
    try { await onReplaceMeal(plan!.id, meal); setMealMessage(`تم تغيير وجبة ${meal.slot} وحفظ البديل`); }
    catch (caught) { setMealMessage(caught instanceof Error ? caught.message : "تعذر تغيير الوجبة"); }
  }
  return <main className="client-shell"><header><Brand /><div><span className="role-badge">CLIENT</span><button className="logout-btn" onClick={() => setAccountOpen(value => !value)}>{accountOpen ? "خطتي" : "إدارة الحساب"}</button><button className="logout-btn" onClick={onLogout}>تسجيل الخروج</button></div></header>{accountOpen ? <section className="client-account-page"><AccountSettings user={user} onUserUpdated={onUserUpdated} onLogout={onLogout} /></section> : <><section className="client-hero"><div><p>مرحبًا، {client.name}</p><h1>خطتك الغذائية اليوم</h1><span>الطول {client.height} سم · الوزن {client.weight} كجم · العمر {client.age}</span></div>{plan && <div><small>الهدف اليومي</small><strong>{format(plan.result.daily_target_kcal)} سعرة</strong><small>{completed}/{total} وجبة · التزام {adherence}%</small></div>}</section>{plan ? <><section className="client-macros"><Metric label="البروتين" value={`${format(plan.result.macros.protein_g, 1)} جم`} /><Metric label="الكربوهيدرات" value={`${format(plan.result.macros.carb_g, 1)} جم`} /><Metric label="الدهون" value={`${format(plan.result.macros.fat_g, 1)} جم`} /><Metric label="الالتزام" value={`${adherence}%`} accent /></section>{mealMessage && <p className="client-meal-message">{mealMessage}</p>}<GeneratedMeals plan={plan} onRegenerate={replace} onToggle={onToggleMeal} allowCompletion /></> : <EmptyState title="لا توجد خطة فعالة بعد" text="ستظهر خطتك هنا بعد أن ينشئها الطبيب ويعتمدها." />}</>}</main>;
}

function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (payload: CreateManagedUser, client: Client) => Promise<void> }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", age: 30, height: 170, sex: "MALE", weight: 75, bodyFat: 20, activity: "MODERATE", goal: "LOSS", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const client: Client = { name: form.name, phone: form.phone, email: form.email.toLowerCase(), age: form.age, height: form.height, weight: form.weight, bodyFat: form.bodyFat, notes: form.notes, id: "", sex: form.sex as Client["sex"], activity: form.activity as Client["activity"], goal: form.goal as Client["goal"], status: "ACTIVE", joinedAt: new Date().toISOString().slice(0, 10) };
    const payload: CreateManagedUser = { email: client.email, password: form.password, full_name: client.name, role: "CLIENT", age: client.age, sex: client.sex, height_cm: client.height, weight_kg: client.weight, body_fat_pct: client.bodyFat, activity_level: client.activity, default_goal: client.goal, medical_notes: client.notes };
    try { await onSave(payload, client); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر إنشاء حساب العميل"); }
    finally { setSaving(false); }
  }
  return <Modal title="إضافة عميل جديد" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>الاسم الكامل<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label>الجوال<input required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      <label>البريد<input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      <label>كلمة المرور الأولية<input required type="password" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="12 خانة، كبير وصغير ورقم ورمز" /></label>
      <label>العمر<input required type="number" step="1" min="18" max="100" value={form.age} onChange={event => setForm({ ...form, age: Number.parseInt(event.target.value, 10) })} /></label>
      <Field label="الطول سم" value={form.height} onChange={height => setForm({ ...form, height })} />
      <label>الجنس<select value={form.sex} onChange={event => setForm({ ...form, sex: event.target.value })}><option value="MALE">ذكر</option><option value="FEMALE">أنثى</option></select></label>
      <Field label="الوزن كجم" value={form.weight} onChange={weight => setForm({ ...form, weight })} />
      <Field label="نسبة الدهون %" value={form.bodyFat} onChange={bodyFat => setForm({ ...form, bodyFat })} />
      <label>النشاط<select value={form.activity} onChange={event => setForm({ ...form, activity: event.target.value })}><option value="SEDENTARY">خامل</option><option value="LIGHT">خفيف</option><option value="MODERATE">متوسط</option><option value="HIGH">مرتفع</option></select></label>
      <label>الهدف<select value={form.goal} onChange={event => setForm({ ...form, goal: event.target.value })}><option value="LOSS">خسارة وزن</option><option value="GAIN">زيادة وزن</option><option value="MAINTAIN">ثبات</option></select></label>
      <label className="wide">ملاحظات<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      {error && <p className="error-message wide">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>إلغاء</button><button className="primary-btn" disabled={saving}>{saving ? "جارٍ إنشاء الحساب..." : "حفظ العميل"}</button></div>
    </form>
  </Modal>;
}

function FoodModal({ onClose, onSave }: { onClose: () => void; onSave: (food: Food) => void }) {
  const [form, setForm] = useState({ nameAr: "", category: "", kcal: 0, protein: 0, carbs: 0, fat: 0, state: "كما يؤكل", mealTypes: ["LUNCH", "DINNER"] });
  function submit(event: FormEvent) { event.preventDefault(); onSave({ ...form, id: crypto.randomUUID() }); }
  function toggleMealType(type: string) {
    setForm(current => ({ ...current, mealTypes: current.mealTypes.includes(type) ? current.mealTypes.filter(item => item !== type) : [...current.mealTypes, type] }));
  }
  return <Modal title="إضافة عنصر غذائي" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>اسم الطعام<input required value={form.nameAr} onChange={event => setForm({ ...form, nameAr: event.target.value })} /></label>
      <label>التصنيف<input required value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} /></label>
      <Field label="السعرات / 100جم" value={form.kcal} onChange={kcal => setForm({ ...form, kcal })} />
      <Field label="البروتين" value={form.protein} onChange={protein => setForm({ ...form, protein })} />
      <Field label="الكربوهيدرات" value={form.carbs} onChange={carbs => setForm({ ...form, carbs })} />
      <Field label="الدهون" value={form.fat} onChange={fat => setForm({ ...form, fat })} />
      <label>حالة القياس<select value={form.state} onChange={event => setForm({ ...form, state: event.target.value })}><option>كما يؤكل</option><option>مطبوخ</option><option>نيء</option></select></label>
      <fieldset className="meal-type-picker"><legend>مسموح في</legend>{[["BREAKFAST", "الفطور"], ["LUNCH", "الغداء"], ["DINNER", "العشاء"], ["SNACK", "السناك"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={form.mealTypes.includes(value)} onChange={() => toggleMealType(value)} />{label}</label>)}</fieldset>
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>إلغاء</button><button className="primary-btn" disabled={!form.mealTypes.length}>إضافة إلى القاعدة</button></div>
    </form>
  </Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={event => event.stopPropagation()}><header><h2>{title}</h2><button onClick={onClose} aria-label="إغلاق">×</button></header>{children}</section></div>; }
function Field({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) { return <label>{label}<input type="number" step="0.1" disabled={disabled} value={value} onChange={event => onChange(Number(event.target.value))} /></label>; }
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`metric ${accent ? "accent" : ""}`}><small>{label}</small><strong>{value}</strong></div>; }
function Macro({ label, grams, pct, color }: { label: string; grams: string; pct: string; color: string }) { return <div className="macro-line"><div><span className={`dot ${color}`} /><b>{label}</b><small>{format(grams, 1)} جم</small></div><strong>{format(pct)}%</strong><i><span className={color} style={{ width: `${Math.min(100, Number(pct))}%` }} /></i></div>; }
function goalLabel(goal: Goal) { return goal === "LOSS" ? "خسارة وزن" : goal === "GAIN" ? "زيادة وزن" : "ثبات"; }
