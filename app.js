const API_BASE = "http://localhost:3001/api";
const TOKEN_KEY = "finflow_token";
const USER_KEY = "finflow_user";

const defaultData = {
  contas: [],
  categorias: {
    despesa: ["Alimentacao", "Moradia", "Saude", "Transporte", "Lazer"],
    receita: ["Salario", "Freelance", "Investimentos", "Outros"]
  },
  transacoes: [],
  orcamentos: [],
  metas: [],
  regrasAporte: [],
  investimentos: [],
  assinaturas: []
};

let state = structuredClone(defaultData);
let deferredInstallPrompt = null;
let transactionFilters = {
  tipo: "",
  categoria: "",
  conta: "",
  dataInicio: "",
  dataFim: ""
};
let auth = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  user: JSON.parse(localStorage.getItem(USER_KEY) || "null")
};
let saveTimer = null;

const formatBRL = (n) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(n || 0)
  );

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Falha na requisicao.");
  return payload;
}

function scheduleSaveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!auth.token) return;
    try {
      await api("/state", {
        method: "PUT",
        body: JSON.stringify({ data: state })
      });
    } catch {}
  }, 300);
}

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function nextMonths(count) {
  const base = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth() + 1}`,
      label: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    };
  });
}

function addItem(key, values) {
  state[key].unshift({ id: crypto.randomUUID(), ...values });
  scheduleSaveState();
  renderAll();
}

function updateItem(key, id, values) {
  const index = state[key].findIndex((item) => item.id === id);
  if (index < 0) return false;
  state[key][index] = { ...state[key][index], ...values };
  scheduleSaveState();
  renderAll();
  return true;
}

function removeItem(key, id) {
  state[key] = state[key].filter((item) => item.id !== id);
  scheduleSaveState();
  renderAll();
}

function balanceFromTransactions() {
  return state.transacoes.reduce(
    (acc, t) => acc + (t.tipo === "receita" ? Number(t.valor) : -Number(t.valor)),
    0
  );
}

function bindAuthForms() {
  const msg = document.querySelector("#auth-message");
  document.querySelector("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fd.entries()))
      });
      auth.token = result.token;
      auth.user = result.user;
      localStorage.setItem(TOKEN_KEY, auth.token);
      localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
      await loadRemoteState();
      showApp();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  document.querySelector("#form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fd.entries()))
      });
      msg.textContent = "Conta criada. Agora faca login.";
      e.target.reset();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  document.querySelector("#logout-btn").addEventListener("click", () => {
    auth = { token: "", user: null };
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    document.querySelector("#app-shell").classList.add("hidden");
    document.querySelector("#auth-screen").classList.remove("hidden");
  });
}

async function loadRemoteState() {
  const result = await api("/state");
  state = { ...structuredClone(defaultData), ...(result.data || {}) };
}

function showApp() {
  document.querySelector("#auth-screen").classList.add("hidden");
  document.querySelector("#app-shell").classList.remove("hidden");
  renderAll();
}

function bindTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const screens = document.querySelectorAll(".screen");
  const title = document.querySelector("#screen-title");
  buttons.forEach((btn) =>
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      screens.forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`#${btn.dataset.tab}`).classList.add("active");
      title.textContent = btn.textContent;
    })
  );
}

function activateTab(tabId) {
  const buttons = document.querySelectorAll(".tab-btn");
  const screens = document.querySelectorAll(".screen");
  const title = document.querySelector("#screen-title");
  buttons.forEach((b) => b.classList.remove("active"));
  screens.forEach((s) => s.classList.remove("active"));
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  const targetScreen = document.querySelector(`#${tabId}`);
  if (!targetBtn || !targetScreen) return;
  targetBtn.classList.add("active");
  targetScreen.classList.add("active");
  title.textContent = targetBtn.textContent;
}

function bindForms() {
  document.querySelector("#form-conta").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = Object.fromEntries(fd.entries());
    const editId = values.editId;
    delete values.editId;
    if (editId) {
      const existing = state.contas.find((c) => c.id === editId);
      const oldName = existing?.nome;
      const ok = updateItem("contas", editId, values);
      if (ok && oldName && oldName !== values.nome) {
        state.transacoes = state.transacoes.map((t) =>
          t.conta === oldName ? { ...t, conta: values.nome } : t
        );
        scheduleSaveState();
        renderAll();
      }
      e.target.reset();
      document.querySelector("#submit-conta").textContent = "Salvar";
      return;
    }
    addItem("contas", values);
    e.target.reset();
  });

  document.querySelector("#form-transacao").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    addItem("transacoes", Object.fromEntries(fd.entries()));
    e.target.reset();
  });

  document
    .querySelector("#form-editar-transacao")
    .addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const values = Object.fromEntries(fd.entries());
      const id = values.id;
      delete values.id;
      const ok = updateItem("transacoes", id, values);
      alert(ok ? "Transacao atualizada." : "ID nao encontrado.");
      if (ok) e.target.reset();
    });

  document.querySelector("#form-orcamento").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    addItem("orcamentos", Object.fromEntries(fd.entries()));
    e.target.reset();
  });

  document.querySelector("#form-meta").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = Object.fromEntries(fd.entries());
    values.aporteMensal = values.aporteMensal || 0;
    addItem("metas", values);
    e.target.reset();
  });

  document.querySelector("#form-regra-aporte").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = Object.fromEntries(fd.entries());
    values.percentualReceita = Number(values.percentualReceita);
    const targetMeta = state.metas.find(
      (m) => m.nome.toLowerCase() === String(values.metaNome).toLowerCase()
    );
    if (!targetMeta) {
      alert("Meta nao encontrada. Use o mesmo nome cadastrado.");
      return;
    }
    addItem("regrasAporte", values);
    e.target.reset();
  });

  document
    .querySelector("#form-investimento")
    .addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      addItem("investimentos", Object.fromEntries(fd.entries()));
      e.target.reset();
    });

  document.querySelector("#form-assinatura").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    addItem("assinaturas", Object.fromEntries(fd.entries()));
    e.target.reset();
  });

  document.querySelector("#form-categoria").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = Object.fromEntries(fd.entries());
    const tipo = values.tipo;
    const oldNome = String(values.oldNome || "").trim();
    const nome = String(values.nome || "").trim();
    if (!nome) return;
    if (!state.categorias[tipo]) state.categorias[tipo] = [];
    if (oldNome) {
      const oldIdx = (state.categorias[tipo] || []).findIndex(
        (c) => c.toLowerCase() === oldNome.toLowerCase()
      );
      if (oldIdx >= 0) {
        state.categorias[tipo][oldIdx] = nome;
        state.transacoes = state.transacoes.map((t) =>
          t.tipo === tipo && t.categoria === oldNome ? { ...t, categoria: nome } : t
        );
        scheduleSaveState();
        renderAll();
        e.target.reset();
        document.querySelector("#submit-categoria").textContent = "Adicionar categoria";
        return;
      }
    }
    const exists = state.categorias[tipo].some(
      (c) => c.toLowerCase() === nome.toLowerCase()
    );
    if (exists) {
      alert("Essa categoria ja existe.");
      return;
    }
    state.categorias[tipo].push(nome);
    scheduleSaveState();
    renderAll();
    e.target.reset();
  });

  document.querySelector("#cancelar-edicao-conta").addEventListener("click", () => {
    const form = document.querySelector("#form-conta");
    form.reset();
    form.elements.editId.value = "";
    document.querySelector("#submit-conta").textContent = "Salvar";
  });

  document
    .querySelector("#cancelar-edicao-categoria")
    .addEventListener("click", () => {
      const form = document.querySelector("#form-categoria");
      form.reset();
      form.elements.oldNome.value = "";
      document.querySelector("#submit-categoria").textContent = "Adicionar categoria";
    });
}

function bindTransactionFilters() {
  document
    .querySelector("#filtros-transacoes")
    .addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      transactionFilters = { ...transactionFilters, ...Object.fromEntries(fd.entries()) };
      renderTransacoes();
    });

  document.querySelector("#limpar-filtros").addEventListener("click", () => {
    transactionFilters = {
      tipo: "",
      categoria: "",
      conta: "",
      dataInicio: "",
      dataFim: ""
    };
    document.querySelector("#filtros-transacoes").reset();
    renderTransacoes();
  });
}

function bindGlobalActions() {
  document.querySelector("#reset-all").addEventListener("click", () => {
    if (!confirm("Tem certeza que deseja remover todos os dados?")) return;
    state = structuredClone(defaultData);
    scheduleSaveState();
    renderAll();
  });

  document.querySelector("#seed-data").addEventListener("click", () => {
    state = {
      contas: [
        { id: crypto.randomUUID(), nome: "Nubank", tipo: "conta", saldo: 4200, limite: 0 },
        { id: crypto.randomUUID(), nome: "Visa Platinum", tipo: "cartao", saldo: -1300, limite: 8000 }
      ],
      categorias: {
        despesa: ["Alimentacao", "Saude", "Casa", "Lazer", "Transporte"],
        receita: ["Salario", "Bonus", "Freelance"]
      },
      transacoes: [
        { id: crypto.randomUUID(), tipo: "receita", descricao: "Salario", categoria: "Salario", conta: "Nubank", valor: 8500, data: new Date().toISOString().slice(0, 10) },
        { id: crypto.randomUUID(), tipo: "despesa", descricao: "Supermercado", categoria: "Alimentacao", conta: "Nubank", valor: 650, data: new Date().toISOString().slice(0, 10) },
        { id: crypto.randomUUID(), tipo: "despesa", descricao: "Academia", categoria: "Saude", conta: "Visa Platinum", valor: 180, data: new Date().toISOString().slice(0, 10) }
      ],
      orcamentos: [{ id: crypto.randomUUID(), categoria: "Alimentacao", limite: 1200 }],
      metas: [{ id: crypto.randomUUID(), nome: "Reserva de emergencia", alvo: 30000, atual: 9500, aporteMensal: 1200 }],
      regrasAporte: [{ id: crypto.randomUUID(), metaNome: "Reserva de emergencia", percentualReceita: 10 }],
      investimentos: [{ id: crypto.randomUUID(), ativo: "Tesouro Selic", tipo: "Renda Fixa", valorAplicado: 8000, valorAtual: 8750 }],
      assinaturas: [{ id: crypto.randomUUID(), nome: "Netflix", valor: 55.9, dia: 10 }]
    };
    scheduleSaveState();
    renderAll();
  });

  document.querySelector("#export-data").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finflow-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector("#import-data").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const incoming = JSON.parse(text);
      state = { ...structuredClone(defaultData), ...incoming };
      scheduleSaveState();
      renderAll();
      alert("Dados importados com sucesso.");
    } catch {
      alert("Arquivo invalido.");
    }
    e.target.value = "";
  });
}

function bindPwaInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.querySelector("#install-pwa").classList.remove("hidden");
  });
  document.querySelector("#install-pwa").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.querySelector("#install-pwa").classList.add("hidden");
  });
}

function renderKPIs() {
  const month = currentMonthKey();
  const transMonth = state.transacoes.filter((t) => monthKey(t.data) === month);
  const receitas = transMonth
    .filter((t) => t.tipo === "receita")
    .reduce((acc, t) => acc + Number(t.valor), 0);
  const despesas = transMonth
    .filter((t) => t.tipo === "despesa")
    .reduce((acc, t) => acc + Number(t.valor), 0);
  const saldo = balanceFromTransactions();
  const poupanca = receitas > 0 ? ((receitas - despesas) / receitas) * 100 : 0;
  document.querySelector("#kpi-saldo").textContent = formatBRL(saldo);
  document.querySelector("#kpi-receitas").textContent = formatBRL(receitas);
  document.querySelector("#kpi-despesas").textContent = formatBRL(despesas);
  document.querySelector("#kpi-poupanca").textContent = `${poupanca.toFixed(1)}%`;
  document.querySelector("#kpi-score").textContent = String(
    Math.max(0, Math.min(100, Math.round(65 + poupanca * 0.7)))
  );
}

function renderInsights() {
  const list = document.querySelector("#insights");
  list.innerHTML = "";
  const totalAss = state.assinaturas.reduce((a, s) => a + Number(s.valor), 0);
  const li = document.createElement("li");
  li.textContent = totalAss
    ? `Compromisso fixo mensal com assinaturas: ${formatBRL(totalAss)}.`
    : "Adicione assinaturas para analise recorrente.";
  list.appendChild(li);
}

function renderAlertas() {
  const ul = document.querySelector("#alertas-inteligentes");
  ul.innerHTML = "";
  const li = document.createElement("li");
  li.innerHTML = "<span>Nenhum alerta critico no momento.</span><span class='ok'>OK</span>";
  ul.appendChild(li);
}

function renderProjecao() {
  let saldo = balanceFromTransactions();
  const ul = document.querySelector("#projecao-saldo");
  ul.innerHTML = "";
  nextMonths(6).forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${m.label}</span><span class="${saldo >= 0 ? "ok" : "alert"}">${formatBRL(saldo)}</span>`;
    ul.appendChild(li);
  });
}

function renderContas() {
  const ul = document.querySelector("#lista-contas");
  ul.innerHTML = "";
  let limiteTotalCartoes = 0;
  let gastoTotalCartoes = 0;
  const mesAtual = currentMonthKey();
  state.contas.forEach((c) => {
    const saldo = Number(c.saldo || 0);
    const limite = Number(c.limite || 0);
    const isCartao = c.tipo === "cartao";
    const gasto = isCartao
      ? state.transacoes
          .filter((t) => t.tipo === "despesa" && t.conta === c.nome && monthKey(t.data) === mesAtual)
          .reduce((acc, t) => acc + Number(t.valor), 0)
      : 0;
    const disponivel = isCartao ? Math.max(0, limite - gasto) : 0;
    if (isCartao) {
      limiteTotalCartoes += limite;
      gastoTotalCartoes += gasto;
    }
    const li = document.createElement("li");
    li.innerHTML = isCartao
      ? `<span>${c.nome} <span class="muted">(cartao)</span></span><span class="muted">Limite: ${formatBRL(limite)} | Gasto: ${formatBRL(gasto)} | Disponivel: ${formatBRL(disponivel)}</span><button data-edit-conta="${c.id}">Editar</button><button data-remove="${c.id}" data-key="contas">Excluir</button>`
      : `<span>${c.nome} <span class="muted">(conta)</span></span><span class="${saldo >= 0 ? "ok" : "alert"}">${formatBRL(saldo)}</span><button data-edit-conta="${c.id}">Editar</button><button data-remove="${c.id}" data-key="contas">Excluir</button>`;
    ul.appendChild(li);
  });
  document.querySelector("#cartoes-limite-total").textContent = formatBRL(limiteTotalCartoes);
  document.querySelector("#cartoes-gasto-total").textContent = formatBRL(gastoTotalCartoes);
  document.querySelector("#cartoes-disponivel-total").textContent = formatBRL(
    Math.max(0, limiteTotalCartoes - gastoTotalCartoes)
  );
}

function fillSelectOptions(select, options, placeholder) {
  if (!select) return;
  select.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    return;
  }
  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
}

function syncTransactionSelects() {
  fillSelectOptions(document.querySelector("#transacao-conta"), state.contas.map((c) => c.nome), "Cadastre conta/cartao");
  fillSelectOptions(document.querySelector("#editar-transacao-conta"), state.contas.map((c) => c.nome), "Cadastre conta/cartao");
  fillSelectOptions(
    document.querySelector("#transacao-categoria"),
    state.categorias?.[document.querySelector("#transacao-tipo")?.value || "despesa"] || [],
    "Cadastre categoria"
  );
  fillSelectOptions(
    document.querySelector("#editar-transacao-categoria"),
    state.categorias?.[document.querySelector("#editar-transacao-tipo")?.value || "despesa"] || [],
    "Cadastre categoria"
  );
}

function bindDynamicTransactionSelects() {
  document.querySelector("#transacao-tipo").addEventListener("change", syncTransactionSelects);
  document.querySelector("#editar-transacao-tipo").addEventListener("change", syncTransactionSelects);
}

function renderCategorias() {
  const despesaUl = document.querySelector("#lista-categorias-despesa");
  const receitaUl = document.querySelector("#lista-categorias-receita");
  despesaUl.innerHTML = "";
  receitaUl.innerHTML = "";
  (state.categorias?.despesa || []).forEach((nome) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${nome}</span><button data-edit-categoria="${nome}" data-tipo-categoria="despesa">Editar</button><button data-remove-categoria="${nome}" data-tipo-categoria="despesa">Excluir</button>`;
    despesaUl.appendChild(li);
  });
  (state.categorias?.receita || []).forEach((nome) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${nome}</span><button data-edit-categoria="${nome}" data-tipo-categoria="receita">Editar</button><button data-remove-categoria="${nome}" data-tipo-categoria="receita">Excluir</button>`;
    receitaUl.appendChild(li);
  });
}

function renderTransacoes() {
  const ul = document.querySelector("#lista-transacoes");
  ul.innerHTML = "";
  state.transacoes
    .filter((t) => {
      if (transactionFilters.tipo && t.tipo !== transactionFilters.tipo) return false;
      if (transactionFilters.categoria && !String(t.categoria).toLowerCase().includes(transactionFilters.categoria.toLowerCase())) return false;
      if (transactionFilters.conta && !String(t.conta).toLowerCase().includes(transactionFilters.conta.toLowerCase())) return false;
      if (transactionFilters.dataInicio && t.data < transactionFilters.dataInicio) return false;
      if (transactionFilters.dataFim && t.data > transactionFilters.dataFim) return false;
      return true;
    })
    .forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<span><span class="badge ${t.tipo}">${t.tipo}</span> ${t.descricao} <span class="muted">(${t.categoria} - ${t.conta})</span><br /><span class="muted">ID: ${t.id}</span></span><span>${formatBRL(t.valor)} - ${t.data}</span><button data-edit-transacao="${t.id}">Editar</button><button data-remove="${t.id}" data-key="transacoes">Excluir</button>`;
      ul.appendChild(li);
    });
}

function renderOrcamentos() {
  const ul = document.querySelector("#lista-orcamentos");
  ul.innerHTML = "";
  state.orcamentos.forEach((o) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${o.categoria}</span><span>${formatBRL(o.limite)}</span><button data-remove="${o.id}" data-key="orcamentos">Excluir</button>`;
    ul.appendChild(li);
  });
}

function renderMetas() {
  const ul = document.querySelector("#lista-metas");
  ul.innerHTML = "";
  state.metas.forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${m.nome}</span><span>${formatBRL(m.atual)} / ${formatBRL(m.alvo)}</span><button data-remove="${m.id}" data-key="metas">Excluir</button>`;
    ul.appendChild(li);
  });
}

function renderRegrasAporte() {
  const ul = document.querySelector("#lista-regras-aporte");
  ul.innerHTML = "";
  state.regrasAporte.forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.metaNome}</span><span>${r.percentualReceita}%</span><button data-remove="${r.id}" data-key="regrasAporte">Excluir</button>`;
    ul.appendChild(li);
  });
}

function renderInvestimentos() {
  const ul = document.querySelector("#lista-investimentos");
  ul.innerHTML = "";
  state.investimentos.forEach((i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i.ativo}</span><span>${formatBRL(i.valorAtual)}</span><button data-remove="${i.id}" data-key="investimentos">Excluir</button>`;
    ul.appendChild(li);
  });
}

function renderAssinaturas() {
  const ul = document.querySelector("#lista-assinaturas");
  ul.innerHTML = "";
  state.assinaturas.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${s.nome}</span><span>${formatBRL(s.valor)} / dia ${s.dia}</span><button data-remove="${s.id}" data-key="assinaturas">Excluir</button>`;
    ul.appendChild(li);
  });
}

function renderRelatorios() {
  const relCat = document.querySelector("#relatorio-categorias");
  relCat.innerHTML = "";
  const byCat = {};
  state.transacoes
    .filter((t) => t.tipo === "despesa")
    .forEach((t) => (byCat[t.categoria] = (byCat[t.categoria] || 0) + Number(t.valor)));
  Object.entries(byCat).forEach(([cat, value]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${cat}</span><span>${formatBRL(value)}</span>`;
    relCat.appendChild(li);
  });

  const relInv = document.querySelector("#relatorio-investimentos");
  const totalInv = state.investimentos.reduce((a, i) => a + Number(i.valorAplicado || 0), 0);
  const atualInv = state.investimentos.reduce((a, i) => a + Number(i.valorAtual || 0), 0);
  relInv.innerHTML = `<li><span>Total aplicado</span><span>${formatBRL(totalInv)}</span></li><li><span>Valor atual</span><span>${formatBRL(atualInv)}</span></li>`;

  const relFluxo = document.querySelector("#relatorio-fluxo");
  relFluxo.innerHTML = "";
  const fluxos = {};
  state.transacoes.forEach((t) => {
    const key = monthKey(t.data);
    if (!fluxos[key]) fluxos[key] = { receita: 0, despesa: 0 };
    fluxos[key][t.tipo] += Number(t.valor);
  });
  Object.entries(fluxos).forEach(([mes, f]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${mes}</span><span>${formatBRL(f.receita - f.despesa)}</span>`;
    relFluxo.appendChild(li);
  });
  drawSaldoChart(fluxos);
}

function drawSaldoChart(fluxos) {
  const canvas = document.querySelector("#grafico-saldo");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const entries = Object.entries(fluxos).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  const values = entries.map(([, f]) => f.receita - f.despesa);
  const width = canvas.clientWidth || 600;
  const height = Number(canvas.getAttribute("height")) || 180;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f0f5ff";
  ctx.fillRect(0, 0, width, height);
  if (!values.length) return;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(1, max - min);
  const pad = 24;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const yPos = (v) => height - pad - ((v - min) / range) * (height - pad * 2);
  const xPos = (i) => pad + i * step;
  ctx.strokeStyle = "#2f6bff";
  ctx.beginPath();
  values.forEach((v, i) => (i === 0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v))));
  ctx.stroke();
}

function bindDeleteActions() {
  document.body.addEventListener("click", (e) => {
    const editContaBtn = e.target.closest("button[data-edit-conta]");
    if (editContaBtn) {
      const conta = state.contas.find((c) => c.id === editContaBtn.dataset.editConta);
      if (!conta) return;
      const form = document.querySelector("#form-conta");
      form.elements.editId.value = conta.id;
      form.elements.nome.value = conta.nome;
      form.elements.tipo.value = conta.tipo;
      form.elements.limite.value = conta.limite || "";
      form.elements.saldo.value = conta.saldo || "";
      document.querySelector("#submit-conta").textContent = "Atualizar";
      activateTab("contas");
      form.elements.nome.focus();
      return;
    }

    const editCategoriaBtn = e.target.closest("button[data-edit-categoria]");
    if (editCategoriaBtn) {
      const form = document.querySelector("#form-categoria");
      form.elements.tipo.value = editCategoriaBtn.dataset.tipoCategoria;
      form.elements.nome.value = editCategoriaBtn.dataset.editCategoria;
      form.elements.oldNome.value = editCategoriaBtn.dataset.editCategoria;
      document.querySelector("#submit-categoria").textContent = "Atualizar categoria";
      activateTab("configuracoes");
      form.elements.nome.focus();
      return;
    }

    const editTransacaoBtn = e.target.closest("button[data-edit-transacao]");
    if (editTransacaoBtn) {
      const transacao = state.transacoes.find((t) => t.id === editTransacaoBtn.dataset.editTransacao);
      if (!transacao) return;
      const form = document.querySelector("#form-editar-transacao");
      form.elements.id.value = transacao.id;
      form.elements.tipo.value = transacao.tipo;
      syncTransactionSelects();
      form.elements.descricao.value = transacao.descricao;
      form.elements.categoria.value = transacao.categoria;
      form.elements.conta.value = transacao.conta;
      form.elements.valor.value = transacao.valor;
      form.elements.data.value = transacao.data;
      activateTab("transacoes");
      form.elements.descricao.focus();
      return;
    }

    const catBtn = e.target.closest("button[data-remove-categoria]");
    if (catBtn) {
      const tipo = catBtn.dataset.tipoCategoria;
      const nome = catBtn.dataset.removeCategoria;
      state.categorias[tipo] = (state.categorias[tipo] || []).filter((c) => c !== nome);
      scheduleSaveState();
      renderAll();
      return;
    }

    const btn = e.target.closest("button[data-remove]");
    if (!btn) return;
    removeItem(btn.dataset.key, btn.dataset.remove);
  });
}

function renderAll() {
  renderKPIs();
  renderInsights();
  renderAlertas();
  renderProjecao();
  renderContas();
  renderCategorias();
  syncTransactionSelects();
  renderTransacoes();
  renderOrcamentos();
  renderMetas();
  renderRegrasAporte();
  renderInvestimentos();
  renderAssinaturas();
  renderRelatorios();
}

async function init() {
  bindAuthForms();
  bindTabs();
  bindForms();
  bindDynamicTransactionSelects();
  bindTransactionFilters();
  bindGlobalActions();
  bindDeleteActions();
  bindPwaInstall();

  if (auth.token) {
    try {
      await loadRemoteState();
      showApp();
    } catch {
      auth = { token: "", user: null };
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }
}

init();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
