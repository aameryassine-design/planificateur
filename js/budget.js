// منطق صفحة الميزانية: الحركات الشهرية، توزيع المصاريف، الديون
const Budget = (function () {
  let current = new Date();
  current.setDate(1);

  let els = {};

  async function getBudget(key) {
    return (await Storage.get("budget:" + key, null)) || { entries: [] };
  }
  async function saveBudget(key, data) {
    await Storage.set("budget:" + key, data);
  }
  async function getDebts() {
    return (await Storage.get("debts", [])) || [];
  }
  async function saveDebts(list) {
    await Storage.set("debts", list);
  }

  function cacheEls() {
    els = {
      label: document.getElementById("budget-month-label"),
      sumIncome: document.getElementById("sum-income"),
      sumExpense: document.getElementById("sum-expense"),
      sumBalance: document.getElementById("sum-balance"),

      form: document.getElementById("budget-form"),
      error: document.getElementById("budget-error"),
      type: document.getElementById("budget-type"),
      amount: document.getElementById("budget-amount"),
      category: document.getElementById("budget-category"),
      catSuggestions: document.getElementById("budget-cat-suggestions"),
      note: document.getElementById("budget-note"),
      date: document.getElementById("budget-date"),

      entriesList: document.getElementById("budget-entries-list"),
      breakdown: document.getElementById("budget-breakdown"),

      owedToMe: document.getElementById("debt-owed-to-me"),
      iOwe: document.getElementById("debt-i-owe"),
      debtForm: document.getElementById("debt-form"),
      debtError: document.getElementById("debt-error"),
      debtType: document.getElementById("debt-type"),
      debtPerson: document.getElementById("debt-person"),
      debtAmount: document.getElementById("debt-amount"),
      debtNote: document.getElementById("debt-note"),
      debtDate: document.getElementById("debt-date"),
      debtsList: document.getElementById("debts-list")
    };
  }

  function bindEvents() {
    document.getElementById("budget-month-prev").addEventListener("click", () => shiftMonth(-1));
    document.getElementById("budget-month-next").addEventListener("click", () => shiftMonth(1));
    document.getElementById("budget-month-today").addEventListener("click", () => {
      current = new Date();
      current.setDate(1);
      renderAll();
    });
    els.form.addEventListener("submit", onSubmitEntry);
    els.debtForm.addEventListener("submit", onSubmitDebt);
  }

  function shiftMonth(dir) {
    current = Utils.addMonths(current, dir);
    current.setDate(1);
    renderAll();
  }

  function currentMonthKey() {
    return Utils.monthKey(current.getFullYear(), current.getMonth());
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.classList.add("show");
  }
  function hideError(el) {
    el.classList.remove("show");
    el.textContent = "";
  }

  async function renderAll() {
    els.label.textContent = Utils.formatMonthLabel(current.getFullYear(), current.getMonth());
    if (!els.date.value) els.date.value = Utils.dateKey(new Date());
    if (!els.debtDate.value) els.debtDate.value = Utils.dateKey(new Date());
    await renderSummaryAndEntries();
    await renderBreakdown();
    await renderCategorySuggestions();
    await renderDebts();
  }

  // ----- الحركات (دخل/مصروف) -----
  async function onSubmitEntry(e) {
    e.preventDefault();
    const type = els.type.value;
    const amount = parseFloat(els.amount.value);
    const category = els.category.value.trim();
    const note = els.note.value.trim();
    const date = els.date.value;

    if (!category) return showError(els.error, T.errorCategoryRequired);
    if (!amount || amount <= 0) return showError(els.error, T.errorAmountInvalid);
    hideError(els.error);

    const key = Utils.monthKey(new Date(date).getFullYear(), new Date(date).getMonth());
    const data = await getBudget(key);
    data.entries = data.entries || [];
    data.entries.push({ id: Utils.uid(), type, amount, category, note, date });
    await saveBudget(key, data);

    els.amount.value = "";
    els.category.value = "";
    els.note.value = "";
    await renderAll();
  }

  async function renderSummaryAndEntries() {
    const data = await getBudget(currentMonthKey());
    const entries = (data.entries || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    let income = 0, expense = 0;
    entries.forEach((e) => {
      if (e.type === "income") income += e.amount;
      else expense += e.amount;
    });
    const balance = income - expense;

    els.sumIncome.innerHTML = `<bdi>${Utils.formatAmount(income)}</bdi>`;
    els.sumExpense.innerHTML = `<bdi>${Utils.formatAmount(expense)}</bdi>`;
    els.sumBalance.innerHTML = `<bdi>${Utils.formatAmount(balance)}</bdi>`;
    els.sumBalance.classList.toggle("positive", balance >= 0);
    els.sumBalance.classList.toggle("negative", balance < 0);

    els.entriesList.innerHTML = "";
    if (entries.length === 0) {
      els.entriesList.innerHTML = `<li class="empty-msg">${T.noEntries}</li>`;
      return;
    }
    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "item-row";
      const typeLabel = entry.type === "income" ? T.income : T.expense;
      const sign = entry.type === "income" ? "+" : "-";
      const color = entry.type === "income" ? "var(--c-habit)" : "var(--c-task)";
      li.innerHTML = `
        <span class="item-cat-tag" style="background:${color}">${typeLabel}</span>
        <span class="item-title"><bdi>${Utils.formatShortDate(Utils.parseDateKey(entry.date))}</bdi> — ${Utils.escapeHtml(entry.category)}${entry.note ? " · " + Utils.escapeHtml(entry.note) : ""}</span>
        <span style="color:${color}; font-weight:600"><bdi>${sign}${Utils.formatAmount(entry.amount)}</bdi></span>
      `;
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger";
      delBtn.textContent = T.delete;
      delBtn.addEventListener("click", () => deleteEntry(entry.id));
      li.appendChild(delBtn);
      els.entriesList.appendChild(li);
    });
  }

  async function deleteEntry(id) {
    const key = currentMonthKey();
    const data = await getBudget(key);
    data.entries = (data.entries || []).filter((e) => e.id !== id);
    await saveBudget(key, data);
    await renderAll();
  }

  async function renderBreakdown() {
    const data = await getBudget(currentMonthKey());
    const expenses = (data.entries || []).filter((e) => e.type === "expense");
    const total = expenses.reduce((s, e) => s + e.amount, 0);

    els.breakdown.innerHTML = "";
    if (expenses.length === 0) {
      els.breakdown.innerHTML = `<p class="empty-msg">${T.noBreakdown}</p>`;
      return;
    }

    const byCategory = {};
    expenses.forEach((e) => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    });
    const rows = Object.keys(byCategory)
      .map((cat) => ({ cat, amount: byCategory[cat] }))
      .sort((a, b) => b.amount - a.amount);

    rows.forEach((row) => {
      const pct = total > 0 ? Math.round((row.amount / total) * 100) : 0;
      const div = document.createElement("div");
      div.className = "breakdown-row";
      div.innerHTML = `
        <div class="breakdown-top">
          <span>${Utils.escapeHtml(row.cat)}</span>
          <span><bdi>${Utils.formatAmount(row.amount)}</bdi> (${pct}%)</span>
        </div>
        <div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${pct}%"></div></div>
      `;
      els.breakdown.appendChild(div);
    });
  }

  async function renderCategorySuggestions() {
    const cats = new Set();
    const keys = await Storage.list("budget:");
    for (const key of keys) {
      const data = await Storage.get(key, null);
      if (data && data.entries) data.entries.forEach((e) => cats.add(e.category));
    }
    els.catSuggestions.innerHTML = "";
    Array.from(cats).sort().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      els.catSuggestions.appendChild(opt);
    });
  }

  // ----- الديون -----
  async function onSubmitDebt(e) {
    e.preventDefault();
    const type = els.debtType.value;
    const person = els.debtPerson.value.trim();
    const amount = parseFloat(els.debtAmount.value);
    const note = els.debtNote.value.trim();
    const date = els.debtDate.value;

    if (!person) return showError(els.debtError, T.errorPersonRequired);
    if (!amount || amount <= 0) return showError(els.debtError, T.errorAmountInvalid);
    hideError(els.debtError);

    const list = await getDebts();
    list.push({ id: Utils.uid(), type, person, amount, note, date });
    await saveDebts(list);

    els.debtPerson.value = "";
    els.debtAmount.value = "";
    els.debtNote.value = "";
    await renderDebts();
  }

  async function renderDebts() {
    const debts = await getDebts();

    let owedToMe = 0, iOwe = 0;
    const byPerson = {};
    debts.forEach((d) => {
      byPerson[d.person] = byPerson[d.person] || { lent: 0, borrowed: 0, entries: [] };
      if (d.type === "prete") byPerson[d.person].lent += d.amount;
      else byPerson[d.person].borrowed += d.amount;
      byPerson[d.person].entries.push(d);
    });
    Object.keys(byPerson).forEach((p) => {
      const net = byPerson[p].lent - byPerson[p].borrowed;
      if (net > 0) owedToMe += net;
      else iOwe += -net;
    });

    els.owedToMe.innerHTML = `<bdi>${Utils.formatAmount(owedToMe)}</bdi>`;
    els.iOwe.innerHTML = `<bdi>${Utils.formatAmount(iOwe)}</bdi>`;

    els.debtsList.innerHTML = "";
    const people = Object.keys(byPerson);
    if (people.length === 0) {
      els.debtsList.innerHTML = `<p class="empty-msg">${T.noDebts}</p>`;
      return;
    }

    people.sort().forEach((person) => {
      const info = byPerson[person];
      const net = info.lent - info.borrowed;
      const group = document.createElement("div");
      group.className = "person-group";

      const head = document.createElement("div");
      head.className = "person-group-head";
      const netLabel = net === 0 ? Utils.formatAmount(0) : Utils.formatAmount(Math.abs(net));
      const netClass = net > 0 ? "net-positive" : net < 0 ? "net-negative" : "";
      const netText = net > 0 ? `${T.totalOwedToMe}: ` : net < 0 ? `${T.totalIOwe}: ` : "";
      head.innerHTML = `<span>${Utils.escapeHtml(person)}</span><span class="${netClass}"><bdi>${netText}${netLabel}</bdi></span>`;
      group.appendChild(head);

      const list = document.createElement("ul");
      list.className = "list";
      info.entries
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach((d) => {
          const li = document.createElement("li");
          li.className = "item-row";
          const typeLabel = d.type === "prete" ? T.debtLent : T.debtBorrowed;
          li.innerHTML = `
            <span class="item-cat-tag" style="background:${d.type === "prete" ? "var(--c-habit)" : "var(--c-task)"}">${typeLabel}</span>
            <span class="item-title"><bdi>${Utils.formatShortDate(Utils.parseDateKey(d.date))}</bdi>${d.note ? " · " + Utils.escapeHtml(d.note) : ""}</span>
            <span><bdi>${Utils.formatAmount(d.amount)}</bdi></span>
          `;
          const delBtn = document.createElement("button");
          delBtn.className = "btn-danger";
          delBtn.textContent = T.delete;
          delBtn.addEventListener("click", () => confirmDeleteDebt(d.id));
          li.appendChild(delBtn);
          list.appendChild(li);
        });
      group.appendChild(list);
      els.debtsList.appendChild(group);
    });
  }

  function confirmDeleteDebt(id) {
    Modal.confirm(T.confirmDeleteDebt, async () => {
      const list = await getDebts();
      await saveDebts(list.filter((d) => d.id !== id));
      await renderDebts();
    });
  }

  async function init() {
    cacheEls();
    bindEvents();
    await renderAll();
  }

  return { init, refresh: renderAll };
})();
