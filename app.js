(() => {
  "use strict";

  const required = [
    "OT", "Tipo_mantenimiento", "Equipo", "Tipo_equipo", "Criticidad",
    "Modo_falla", "Estado", "Downtime_h", "Horas_mano_obra",
    "Costo_total_CLP", "Fecha_inicio", "Fecha_fin"
  ];
  const palette = ["#2877a9", "#23a49a", "#d68e35", "#8367b7"];
  const state = { rows: [], assets: [], modes: [], toastTimer: null };
  const $ = (selector) => document.querySelector(selector);
  const integer = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
  const number = (value, digits = 1) => value == null || !Number.isFinite(value)
    ? "—" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  const clp = (value) => `$${integer.format(Number.isFinite(value) ? value : 0)}`;

  function clean(value) {
    return String(value ?? "").replace(/^\uFEFF/, "").trim().replace(/^'/, "").trim();
  }

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function category(value) {
    const text = clean(value);
    const key = text.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (key === "correctivo") return "Correctivo";
    if (key === "preventivo" || key === "preventiva") return "Preventivo";
    if (key === "predictivo") return "Predictivo";
    return text ? text[0].toLocaleUpperCase("es") + text.slice(1) : "Sin especificar";
  }

  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, "");
    const headerLine = source.split(/\r?\n/, 1)[0] || "";
    const delimiter = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ";" : ",";
    const matrix = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (char === '"') {
        if (quoted && source[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        row.push(field); field = "";
      } else if (!quoted && (char === "\n" || char === "\r")) {
        if (char === "\r" && source[i + 1] === "\n") i += 1;
        row.push(field);
        if (row.some((cell) => cell.trim())) matrix.push(row);
        row = []; field = "";
      } else field += char;
    }
    if (quoted) throw new Error("El CSV contiene un campo entre comillas sin cerrar.");
    row.push(field);
    if (row.some((cell) => cell.trim())) matrix.push(row);
    if (matrix.length < 2) throw new Error("El archivo no contiene filas de datos.");
    const headers = matrix[0].map(clean);
    if (headers.some((header) => !header)) throw new Error("El CSV contiene encabezados vacíos.");
    if (new Set(headers).size !== headers.length) throw new Error("El CSV contiene encabezados duplicados.");
    return matrix.slice(1).map((values, index) => {
      if (values.length !== headers.length) {
        throw new Error(`La fila ${index + 2} tiene ${values.length} campos; se esperaban ${headers.length}.`);
      }
      return Object.fromEntries(headers.map((header, col) => [header, clean(values[col])]));
    });
  }

  function numeric(value) {
    let text = clean(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
    if (!text) return 0;
    if (text.includes(",") && text.includes(".")) {
      const decimal = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
      text = text.split(decimal === "," ? "." : ",").join("");
      if (decimal === ",") text = text.replace(",", ".");
    } else text = text.replace(",", ".");
    const result = Number(text);
    return Number.isFinite(result) ? result : 0;
  }

  function date(value) {
    const text = clean(value);
    if (!text) return null;
    const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
      const result = new Date(+year, +month - 1, +day, +hour, +minute, +second);
      return Number.isNaN(result.getTime()) ? null : result;
    }
    const result = new Date(text);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function prepare(matrix) {
    if (!matrix.length) throw new Error("El archivo no contiene registros.");
    const columns = new Set(Object.keys(matrix[0]));
    const missing = required.filter((field) => !columns.has(field));
    if (missing.length) throw new Error(`Faltan columnas necesarias: ${missing.join(", ")}.`);
    const seen = new Set();
    let duplicates = 0;
    const rows = [];
    matrix.forEach((row) => {
      const signature = JSON.stringify(row);
      if (seen.has(signature)) { duplicates += 1; return; }
      seen.add(signature);
      const item = { ...row };
      item.OT = clean(item.OT);
      item.Tipo_mantenimiento = category(item.Tipo_mantenimiento);
      item.Estado = clean(item.Estado).toLocaleLowerCase("es");
      for (const key of ["Equipo", "Tipo_equipo", "Criticidad", "Modo_falla"]) item[key] = clean(item[key]) || "Sin especificar";
      for (const key of ["Downtime_h", "Horas_mano_obra", "Costo_total_CLP"]) item[key] = numeric(item[key]);
      item.inicio = date(item.Fecha_inicio);
      item.fin = date(item.Fecha_fin);
      item.periodo = date(item.Fecha_creación ?? item.Fecha_creacion ?? item.Fecha_inicio);
      item.reparacion = item.inicio && item.fin ? (item.fin - item.inicio) / 3600000 : null;
      rows.push(item);
    });
    return { rows, duplicates, columnCount: columns.size };
  }

  function notify(message, error = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
  }

  function setStatus(text, ready = false) {
    $("#statusText").textContent = text;
    $(".data-status").classList.toggle("is-ready", ready);
  }

  function periodKey(value) {
    if (!value) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function load(text, filename, uploaded) {
    const result = prepare(parseCsv(text));
    if (!result.rows.length) throw new Error("No quedaron registros después de eliminar duplicados.");
    state.rows = result.rows;
    state.filename = filename;
    const dates = state.rows.map((row) => row.periodo || row.inicio).filter(Boolean).map(periodKey).sort();
    $("#dateFrom").value = dates[0] || "";
    $("#dateTo").value = dates.at(-1) || "";
    $("#maintenanceFilter").value = "all";
    $("#maintenanceFilter").innerHTML = '<option value="all">Todos los tipos</option>' +
      [...new Set(state.rows.map((row) => row.Tipo_mantenimiento))].sort((a, b) => a.localeCompare(b, "es"))
        .map((type) => `<option value="${escape(type)}">${escape(type)}</option>`).join("");
    for (const id of ["dateFrom", "dateTo"]) {
      $(`#${id}`).min = dates[0] || "";
      $(`#${id}`).max = dates.at(-1) || "";
    }
    $("#datasetName").textContent = filename;
    $("#sourceDescription").textContent = uploaded
      ? `Archivo seleccionado por el usuario · ${filename}. Procesado únicamente en este navegador.`
      : `Dataset CMMS de ejemplo · ${filename}.`;
    $("#qualityDescription").textContent = `${integer.format(result.rows.length)} registros · ${result.duplicates} filas duplicadas exactas omitidas · ${result.columnCount} columnas detectadas.`;
    $("#periodLabel").textContent = dates.length ? `${dates[0]} — ${dates.at(-1)}` : "PERÍODO DISPONIBLE";
    $("#reportDate").textContent = `Fecha de emisión: ${new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date())}`;
    setStatus(`${integer.format(result.rows.length)} registros`, true);
    renderDashboard();
    if (result.duplicates) notify(`Se omitieron ${result.duplicates} filas exactamente duplicadas.`);
  }

  function uniqueCount(rows) {
    return new Set(rows.map((row) => row.OT).filter(Boolean)).size;
  }

  function total(rows, field) { return rows.reduce((sum, row) => sum + row[field], 0); }
  function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
  function median(values) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }
  function percent(value, base) { return base ? value / base * 100 : 0; }

  function groupBy(rows, keyFn, aggregate) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = keyFn(row) || "Sin especificar";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return [...groups].map(([key, items]) => ({ key, ...aggregate(items) }));
  }

  function filteredRows() {
    const type = $("#maintenanceFilter").value;
    const from = $("#dateFrom").value, to = $("#dateTo").value;
    return state.rows.filter((row) => {
      if (type !== "all" && row.Tipo_mantenimiento !== type) return false;
      const key = periodKey(row.periodo || row.inicio);
      return (!key || !from || key >= from) && (!key || !to || key <= to);
    });
  }

  function summarize(rows) {
    const orders = uniqueCount(rows), labor = total(rows, "Horas_mano_obra");
    const downtime = total(rows, "Downtime_h"), cost = total(rows, "Costo_total_CLP");
    const types = groupBy(rows, (row) => row.Tipo_mantenimiento, (items) => {
      const count = uniqueCount(items), hours = total(items, "Horas_mano_obra");
      const down = total(items, "Downtime_h"), expense = total(items, "Costo_total_CLP");
      return { count, pctOrders: percent(count, orders), hours, pctHours: percent(hours, labor),
        downtime: down, pctDowntime: percent(down, downtime), cost: expense, pctCost: percent(expense, cost) };
    }).sort((a, b) => b.count - a.count);
    const validRepairs = rows.filter((row) =>
      row.Tipo_mantenimiento === "Correctivo" && ["cerrada", "cerrado"].includes(row.Estado)
      && row.reparacion != null && row.reparacion > 0);
    const repairHours = validRepairs.map((row) => row.reparacion);
    return { orders, labor, downtime, cost, types, validRepairs, mttr: mean(repairHours), repairMedian: median(repairHours) };
  }

  function renderDashboard() {
    if (!state.rows.length) return;
    const rows = filteredRows();
    if (!rows.length) {
      showEmptyDashboard();
      return;
    }
    const summary = summarize(rows);
    $("#kpiOrders").textContent = integer.format(summary.orders);
    $("#kpiLabor").textContent = `${number(summary.labor)} h`;
    $("#kpiDowntime").textContent = `${number(summary.downtime)} h`;
    $("#kpiCost").textContent = clp(summary.cost);
    $("#kpiMttr").textContent = summary.mttr == null ? "—" : `${number(summary.mttr)} h`;
    $("#kpiMedian").textContent = summary.repairMedian == null ? "—" : `${number(summary.repairMedian)} h`;
    const corrective = summary.types.find((item) => item.key === "Correctivo");
    $("#insightText").innerHTML = corrective
      ? `El mantenimiento correctivo representa <strong>${number(corrective.pctOrders)}% de las órdenes</strong>, consume <strong>${number(corrective.pctHours)}% de las horas-hombre</strong>, concentra <strong>${number(corrective.pctDowntime)}% del downtime</strong> y genera <strong>${number(corrective.pctCost)}% del costo directo</strong> del período seleccionado.`
      : "El filtro actual no contiene órdenes correctivas. Ajusta el tipo de mantenimiento para consultar el diagnóstico completo.";

    renderMixChart(summary.types);
    renderVertical("#ordersChart", summary.types.map((item) => ({ label: item.key, value: item.count })), "Órdenes de trabajo por tipo", "#2877a9", false);
    const failures = groupBy(rows, (row) => row.Modo_falla, (items) => ({
      count: uniqueCount(items), downtime: total(items, "Downtime_h"), cost: total(items, "Costo_total_CLP")
    })).filter((item) => item.key !== "Sin especificar");
    renderHorizontal("#failureCountChart", [...failures].sort((a, b) => b.count - a.count).slice(0, 10).map((x) => ({ label: x.key, value: x.count })), "Modos de falla más recurrentes", "#2877a9");
    renderHorizontal("#failureDowntimeChart", [...failures].sort((a, b) => b.downtime - a.downtime).slice(0, 10).map((x) => ({ label: x.key, value: x.downtime })), "Modos de falla con más downtime", "#d68e35");
    renderHorizontal("#failureCostChart", [...failures].sort((a, b) => b.cost - a.cost).slice(0, 10).map((x) => ({ label: x.key, value: x.cost })), "Modos de falla con mayor costo", "#8367b7", true);
    const equipmentImpact = groupBy(rows, (row) => row.Equipo, (items) => ({
      downtime: total(items, "Downtime_h"), cost: total(items, "Costo_total_CLP")
    }));
    renderHorizontal("#assetDowntimeChart", [...equipmentImpact].sort((a, b) => b.downtime - a.downtime).slice(0, 10).map((x) => ({ label: x.key, value: x.downtime })), "Activos con mayor downtime acumulado", "#d68e35");
    renderHorizontal("#assetCostChart", [...equipmentImpact].sort((a, b) => b.cost - a.cost).slice(0, 10).map((x) => ({ label: x.key, value: x.cost })), "Activos con mayor costo directo", "#8367b7", true);

    const equipmentMttr = groupBy(summary.validRepairs, (row) => row.Tipo_equipo, (items) => ({
      mttr: mean(items.map((item) => item.reparacion))
    })).filter((item) => item.mttr != null).sort((a, b) => b.mttr - a.mttr).slice(0, 10);
    renderHorizontal("#mttrChart", equipmentMttr.map((x) => ({ label: x.key, value: x.mttr })), "MTTR por tipo de equipo", "#23a49a");
    const jkRows = summary.validRepairs.filter((row) => row.Downtime_h > 0);
    state.assets = jackknife(jkRows, "Equipo");
    state.modes = jackknife(jkRows.filter((row) => row.Modo_falla !== "Sin especificar"), "Modo_falla");
    renderJackknife("#jackknifeChart", state.assets, "Jack-Knife de equipos");
    renderJackknife("#modeJackknifeChart", state.modes, "Jack-Knife de modos de falla");
    renderTables(summary);
    const dates = rows.map((row) => row.periodo || row.inicio).filter(Boolean).map(periodKey).sort();
    $("#periodLabel").textContent = dates.length ? `${$("#dateFrom").value || dates[0]} — ${$("#dateTo").value || dates.at(-1)}` : "PERÍODO DISPONIBLE";
  }

  function showEmptyDashboard() {
    for (const selector of ["#mixChart", "#ordersChart", "#failureCountChart", "#failureDowntimeChart", "#failureCostChart", "#mttrChart", "#jackknifeChart", "#assetDowntimeChart", "#assetCostChart", "#modeJackknifeChart"]) {
      $(selector).innerHTML = '<div class="empty-state">No hay datos para los filtros seleccionados.</div>';
    }
    for (const selector of ["#kpiOrders", "#kpiLabor", "#kpiDowntime", "#kpiCost", "#kpiMttr", "#kpiMedian"]) $(selector).textContent = "—";
    $("#mixTable").innerHTML = tableEmpty(9);
    $("#assetTable").innerHTML = tableEmpty(8);
    $("#modeTable").innerHTML = tableEmpty(6);
    $("#insightText").textContent = "No hay registros que coincidan con los filtros seleccionados.";
    state.assets = []; state.modes = [];
  }

  function svgStart(width, height, label) {
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title>`;
  }

  function renderMixChart(types) {
    if (!types.length) return;
    const metrics = [["pctOrders", "% OT"], ["pctHours", "% HH"], ["pctDowntime", "% Downtime"], ["pctCost", "% Costo"]];
    const width = 660, height = 238, left = 48, right = 12, top = 14, bottom = 40;
    const plotW = width - left - right, plotH = height - top - bottom;
    let svg = svgStart(width, height, "Participación porcentual por tipo de mantenimiento");
    for (let tick = 0; tick <= 100; tick += 25) {
      const y = top + plotH * (1 - tick / 100);
      svg += `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-small" x="${left - 7}" y="${y + 3}" text-anchor="end">${tick}%</text>`;
    }
    const groupW = plotW / types.length, barW = Math.min(18, (groupW - 18) / 4 - 3);
    types.forEach((type, index) => {
      const start = left + index * groupW + (groupW - (4 * (barW + 3) - 3)) / 2;
      metrics.forEach(([field], metricIndex) => {
        const value = Math.min(100, type[field]), barH = plotH * value / 100;
        const x = start + metricIndex * (barW + 3), y = top + plotH - barH;
        svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${palette[metricIndex]}"><title>${escape(type.key)} · ${metrics[metricIndex][1]}: ${number(value)}%</title></rect>`;
      });
      svg += `<text class="chart-label" x="${left + (index + .5) * groupW}" y="${height - 13}" text-anchor="middle">${escape(type.key)}</text>`;
    });
    $("#mixChart").innerHTML = svg + "</svg>";
    $("#mixLegend").innerHTML = metrics.map((metric, i) => `<span><i class="legend-dot" style="background:${palette[i]}"></i>${metric[1]}</span>`).join("");
  }

  function axis(value, currency) {
    if (currency) return value >= 1e9 ? `${number(value / 1e9)} mil M` : value >= 1e6 ? `${number(value / 1e6)} M` : integer.format(value);
    return value >= 1000 ? `${number(value / 1000)}k` : integer.format(value);
  }

  function renderVertical(target, data, label, color, currency) {
    if (!data.length) { $(target).innerHTML = '<div class="empty-state">Sin datos.</div>'; return; }
    const width = 600, height = 228, left = 48, right = 14, top = 16, bottom = 39;
    const max = Math.max(...data.map((x) => x.value), 1) * 1.15, plotW = width - left - right, plotH = height - top - bottom;
    let svg = svgStart(width, height, label);
    for (let tick = 0; tick <= 4; tick += 1) {
      const ratio = tick / 4, y = top + plotH * (1 - ratio);
      svg += `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-small" x="${left - 7}" y="${y + 3}" text-anchor="end">${axis(max * ratio, currency)}</text>`;
    }
    const groupW = plotW / data.length, barW = Math.min(48, groupW * .48);
    data.forEach((item, i) => {
      const h = plotH * item.value / max, x = left + i * groupW + (groupW - barW) / 2, y = top + plotH - h;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${color}"><title>${escape(item.label)}: ${axis(item.value, currency)}</title></rect><text class="chart-label" x="${x + barW / 2}" y="${height - 13}" text-anchor="middle">${escape(item.label)}</text>`;
    });
    $(target).innerHTML = svg + "</svg>";
  }

  function renderHorizontal(target, data, label, color, currency = false) {
    if (!data.length) { $(target).innerHTML = '<div class="empty-state">No hay datos suficientes para este gráfico.</div>'; return; }
    const width = 620, rowH = 26, top = 9, height = Math.max(164, data.length * rowH + 18), left = 190, right = 59;
    const plotW = width - left - right, max = Math.max(...data.map((x) => x.value), 1);
    let svg = svgStart(width, height, label);
    data.forEach((item, i) => {
      const y = top + i * rowH, barW = plotW * item.value / max;
      const text = item.label.length > 26 ? `${item.label.slice(0, 24)}…` : item.label;
      svg += `<text class="chart-label" x="${left - 9}" y="${y + 13}" text-anchor="end">${escape(text)}</text><rect x="${left}" y="${y + 3}" width="${plotW}" height="11" rx="5.5" fill="#f0f4f6"/><rect x="${left}" y="${y + 3}" width="${barW}" height="11" rx="5.5" fill="${color}"><title>${escape(item.label)}: ${axis(item.value, currency)}</title></rect><text class="chart-small" x="${width - right + 7}" y="${y + 13}">${axis(item.value, currency)}</text>`;
    });
    $(target).innerHTML = svg + "</svg>";
  }

  function jackknife(rows, field) {
    const items = groupBy(rows, (row) => row[field], (group) => {
      const faults = uniqueCount(group), down = total(group, "Downtime_h");
      return { faults, downtime: down, mttr: faults ? down / faults : 0, type: group[0].Tipo_equipo, criticality: group[0].Criticidad };
    }).filter((item) => item.faults > 0);
    const totalFaults = items.reduce((a, x) => a + x.faults, 0);
    const frequencyLimit = items.length ? totalFaults / items.length : 0;
    const mttrLimit = items.reduce((a, x) => a + x.downtime, 0) / Math.max(totalFaults, 1);
    return items.map((item) => {
      const frequency = frequencyLimit ? item.faults / frequencyLimit : 0;
      const repair = mttrLimit ? item.mttr / mttrLimit : 0;
      const classification = frequency >= 1 ? repair >= 1 ? "Grave" : "Crónico" : repair >= 1 ? "Agudo" : "Bajo control";
      return { ...item, frequency, repair, risk: frequency * repair, classification };
    }).sort((a, b) => b.risk - a.risk);
  }

  function renderJackknife(target, assets, label) {
    if (!assets.length) { $(target).innerHTML = '<div class="empty-state">Sin correctivos válidos con downtime para el Jack-Knife.</div>'; return; }
    const width = 600, height = 250, left = 55, top = 15, right = 18, bottom = 40;
    const plotW = width - left - right, plotH = height - top - bottom;
    const values = assets.slice(0, 300), maxX = Math.max(2, ...values.map((x) => x.frequency)) * 1.08, maxY = Math.max(2, ...values.map((x) => x.repair)) * 1.08;
    const x = (v) => left + plotW * v / maxX, y = (v) => top + plotH * (1 - v / maxY);
    const colors = { Grave: "#cc5b56", Crónico: "#2877a9", Agudo: "#d68e35", "Bajo control": "#23a49a" };
    let svg = svgStart(width, height, `${label}: frecuencia normalizada frente a MTTR normalizado`);
    for (let tick = 0; tick <= 4; tick += 1) {
      const ratio = tick / 4, xx = left + plotW * ratio, yy = top + plotH * (1 - ratio);
      svg += `<line class="chart-grid" x1="${xx}" y1="${top}" x2="${xx}" y2="${top + plotH}"/><text class="chart-small" x="${xx}" y="${height - 21}" text-anchor="middle">${number(maxX * ratio)}</text><line class="chart-grid" x1="${left}" y1="${yy}" x2="${left + plotW}" y2="${yy}"/><text class="chart-small" x="${left - 8}" y="${yy + 3}" text-anchor="end">${number(maxY * ratio)}</text>`;
    }
    svg += `<line x1="${x(1)}" y1="${top}" x2="${x(1)}" y2="${top + plotH}" stroke="#91a3af" stroke-dasharray="4 4"/><line x1="${left}" y1="${y(1)}" x2="${left + plotW}" y2="${y(1)}" stroke="#91a3af" stroke-dasharray="4 4"/>`;
    values.forEach((item) => svg += `<circle cx="${x(item.frequency)}" cy="${y(item.repair)}" r="${Math.min(8, 3 + Math.sqrt(item.risk))}" fill="${colors[item.classification]}" fill-opacity=".72" stroke="#fff"><title>${escape(item.key)} · ${item.classification} · ${item.faults} fallas · R* ${number(item.risk, 2)}</title></circle>`);
    svg += `<text class="chart-small" x="${left + plotW / 2}" y="${height - 4}" text-anchor="middle">Frecuencia normalizada N*</text><text class="chart-small" transform="translate(12 ${top + plotH / 2}) rotate(-90)" text-anchor="middle">MTTR normalizado</text>`;
    $(target).innerHTML = svg + "</svg>";
  }

  function badge(label) {
    const css = label === "Grave" ? "grave" : label === "Crónico" ? "cronico" : label === "Agudo" ? "agudo" : "control";
    return `<span class="classification ${css}">${escape(label)}</span>`;
  }

  function tableEmpty(columns) { return `<tr><td colspan="${columns}">No hay registros para esta selección.</td></tr>`; }

  function renderTables(summary) {
    $("#mixTable").innerHTML = summary.types.map((x) => `<tr><td>${escape(x.key)}</td><td>${integer.format(x.count)}</td><td>${number(x.pctOrders)}%</td><td>${number(x.hours)} h</td><td>${number(x.pctHours)}%</td><td>${number(x.downtime)} h</td><td>${number(x.pctDowntime)}%</td><td>${clp(x.cost)}</td><td>${number(x.pctCost)}%</td></tr>`).join("") || tableEmpty(9);
    $("#assetTable").innerHTML = state.assets.slice(0, 10).map((x) => `<tr><td>${escape(x.key)}</td><td>${escape(x.type)}</td><td>${escape(x.criticality)}</td><td>${integer.format(x.faults)}</td><td>${number(x.mttr)} h</td><td>${number(x.downtime)} h</td><td>${number(x.risk, 2)}</td><td>${badge(x.classification)}</td></tr>`).join("") || tableEmpty(8);
    $("#modeTable").innerHTML = state.modes.slice(0, 10).map((x) => `<tr><td>${escape(x.key)}</td><td>${integer.format(x.faults)}</td><td>${number(x.mttr)} h</td><td>${number(x.downtime)} h</td><td>${number(x.risk, 2)}</td><td>${badge(x.classification)}</td></tr>`).join("") || tableEmpty(6);
  }

  function acceptFile(file) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase("es").endsWith(".csv")) { notify("Selecciona un archivo CSV CMMS.", true); return; }
    setStatus("Validando archivo");
    file.text().then((text) => {
      load(text, file.name, true);
      notify(`Dataset «${file.name}» procesado correctamente.`);
    }).catch((error) => {
      setStatus(state.rows.length ? `${integer.format(state.rows.length)} registros` : "Dataset no disponible", state.rows.length > 0);
      notify(error instanceof Error ? error.message : "No fue posible leer el archivo.", true);
    });
  }

  $("#uploadButton").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (event) => {
    acceptFile(event.target.files?.[0]);
    event.target.value = "";
  });
  ["maintenanceFilter", "dateFrom", "dateTo"].forEach((id) => $(`#${id}`).addEventListener("change", renderDashboard));
  $("#resetFilters").addEventListener("click", () => {
    if (!state.rows.length) return;
    const dates = state.rows.map((row) => row.periodo || row.inicio).filter(Boolean).map(periodKey).sort();
    $("#maintenanceFilter").value = "all";
    $("#dateFrom").value = dates[0] || "";
    $("#dateTo").value = dates.at(-1) || "";
    renderDashboard();
  });
  $("#printButton").addEventListener("click", () => {
    if (!state.rows.length) { notify("Carga un dataset válido antes de exportar el informe.", true); return; }
    window.print();
  });
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  }));
  const dropArea = $(".filter-bar");
  dropArea.addEventListener("dragover", (event) => { event.preventDefault(); dropArea.classList.add("drag-over"); });
  dropArea.addEventListener("dragleave", (event) => {
    if (!dropArea.contains(event.relatedTarget)) dropArea.classList.remove("drag-over");
  });
  dropArea.addEventListener("drop", (event) => {
    event.preventDefault(); dropArea.classList.remove("drag-over"); acceptFile(event.dataTransfer.files?.[0]);
  });

  fetch("./data/CMMS_grupo_A.csv").then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }).then((text) => load(text, "CMMS_grupo_A.csv", false)).catch((error) => {
    setStatus("Carga un dataset");
    $("#datasetName").textContent = "Sin dataset";
    $("#sourceDescription").textContent = "No se pudo cargar automáticamente el CSV de ejemplo. Selecciona un archivo CMMS con «Cargar dataset».";
    notify("No se pudo cargar el dataset de ejemplo. En GitHub Pages se carga automáticamente; como alternativa, selecciona el CSV con «Cargar dataset».", true);
    console.error("No fue posible cargar el dataset CMMS de ejemplo.", error);
  });
})();
