(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BulkConsignments = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const MAX_BYTES = 10 * 1024 * 1024; // Parsed locally; only mapped rows are submitted.
  const MAX_ROWS = 2000;
  const aliases = {
    "customer reference number": "reference", "customer reference": "reference",
    "invoice number": "reference", "customer": "customer",
    "collection date": "collectionDate", "collection time": "collectionTime",
    "delivery date": "deliveryDate", "delivery time": "deliveryTime",
    "delivery time specified": "deliveryTime", "unit cost": "price",
    "load weight": "weight", "pallets": "pallets", "sdj": "sdj", "po": "po",
    "order date": "orderDate"
  };
  const text = value => value == null ? "" : String(value).trim();
  const header = value => text(value).replace(/^\uFEFF/, "").toLowerCase().replace(/[_\s]+/g, " ").replace(/\s*[:*]\s*$/, "");
  const pad = value => String(value).padStart(2, "0");
  const blank = value => value == null || text(value) === "";

  function customerFromFilename(filename) {
    return text(filename).split(/[\\/]/).pop().replace(/\.(xlsx|xls|csv|ods|tsv)$/i, "").trim();
  }

  function dateValue(cell, XLSX, date1904) {
    if (!cell || blank(cell.v)) return "";
    let y, m, d;
    const displayed = text(cell.w);
    // DJL explicitly supplies dates as displayed in UK day/month order, including
    // numeric Excel dates whose existing US number format shows swapped parts.
    const shownUk = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(displayed);
    if (shownUk) {
      [, d, m, y] = shownUk.map(Number);
      if (y < 100) y += 2000;
    } else if (cell.t === "n") {
      const parsed = XLSX.SSF.parse_date_code(cell.v, { date1904 });
      if (!parsed) throw new Error("date could not be read");
      ({ y, m, d } = parsed);
    } else if (cell.v instanceof Date) {
      y = cell.v.getUTCFullYear(); m = cell.v.getUTCMonth() + 1; d = cell.v.getUTCDate();
    } else {
      const value = text(cell.v);
      const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(value);
      const uk = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(value);
      if (iso) [, y, m, d] = iso.map(Number);
      else if (uk) [, d, m, y] = uk.map(Number);
      else throw new Error("use DD/MM/YYYY or YYYY-MM-DD");
      if (y < 100) y += 2000;
    }
    const check = new Date(Date.UTC(y, m - 1, d));
    if (y < 1901 || y > 9999 || check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      throw new Error("date is not valid");
    }
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function timeValue(cell) {
    if (!cell || blank(cell.v)) return "";
    if (cell.t === "n") {
      if (!Number.isFinite(cell.v) || cell.v < 0 || cell.v >= 1) throw new Error("use a time such as 08:30");
      const seconds = Math.round(cell.v * 86400) % 86400;
      return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}`;
    }
    if (cell.v instanceof Date) return `${pad(cell.v.getUTCHours())}:${pad(cell.v.getUTCMinutes())}`;
    const match = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i.exec(text(cell.v));
    if (!match) throw new Error("use a time such as 08:30");
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (match[4]) {
      if (hour < 1 || hour > 12) throw new Error("time is not valid");
      hour = hour % 12 + (match[4].toLowerCase() === "pm" ? 12 : 0);
    }
    if (hour > 23 || minute > 59 || Number(match[3] || 0) > 59) throw new Error("time is not valid");
    return `${pad(hour)}:${pad(minute)}`;
  }

  function numericValue(cell, price = false) {
    if (!cell || blank(cell.v)) return null;
    let value = text(cell.v);
    if (price) value = value.replace(/^(?:GBP\s*|[£\uFFFD]\s*|Â£\s*)/i, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) throw new Error("number is not valid");
    const number = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(number)) throw new Error("number is not valid");
    return price ? number.toFixed(2) : String(number);
  }

  function parseWorkbook(workbook, filename, XLSX) {
    const customerName = customerFromFilename(filename);
    if (!customerName) throw new Error("The file needs a customer name before its extension.");
    const rows = [], ignoredSheets = [];
    const date1904 = !!(workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904);
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      if (range.e.r > MAX_ROWS + 100 || range.e.c > 255) throw new Error(`Sheet "${sheetName}" is too large. Upload up to ${MAX_ROWS} consignments at a time.`);
      let headerRow = -1, columns = {}, bestScore = 0;
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 49); r++) {
        const candidate = {};
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })];
          const field = aliases[header(cell && cell.v)];
          if (field && candidate[field] == null) candidate[field] = c;
        }
        const score = Object.keys(candidate).length;
        if (score > bestScore) {
          headerRow = r; columns = candidate; bestScore = score;
        }
      }
      if (headerRow < 0) { ignoredSheets.push(sheetName); continue; }
      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const cells = {};
        for (const [field, c] of Object.entries(columns)) cells[field] = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!Object.values(cells).some(cell => cell && !blank(cell.v))) continue;
        if (header(cells.reference && cells.reference.v) === "customer reference number") continue;
        if (/^(?:grand\s+)?totals?$/i.test(text(cells.reference && cells.reference.v))) continue;
        const warnings = [], notes = [];
        const raw = cell => !cell ? "" : cell.t === "n" && cell.w ? cell.w : text(cell.v);
        const read = (field, label, parse) => {
          const cell = cells[field];
          if (cell && (cell.t === "e" || (cell.f && blank(cell.v)))) {
            warnings.push(`${label} contains a spreadsheet error or a formula without a saved result; left blank.`);
            return null;
          }
          try { return parse(cell); }
          catch (error) {
            warnings.push(`${label}: ${error.message}; left blank.`);
            notes.push(`Original ${label.toLowerCase()}: ${raw(cell)}`);
            return null;
          }
        };
        const collectionDate = read("collectionDate", "Collection date", cell => dateValue(cell, XLSX, date1904));
        const collectionTime = read("collectionTime", "Collection time", timeValue);
        const deliveryDate = read("deliveryDate", "Delivery date", cell => dateValue(cell, XLSX, date1904));
        const deliveryTime = read("deliveryTime", "Delivery time", timeValue);
        const combine = (date, time, label) => {
          if (!date) {
            if (time) { notes.push(`${label} time: ${time} (date not supplied)`); warnings.push(`${label} time saved in notes because the date is missing.`); }
            return null;
          }
          if (!time) { warnings.push(`${label} time not supplied; date saved at 00:00.`); notes.push(`${label} time not specified.`); }
          return `${date}T${time || "00:00"}`;
        };
        for (const [field, label] of [["sdj", "SDJ"], ["po", "PO"], ["orderDate", "Order date"]]) {
          if (cells[field] && !blank(cells[field].v)) notes.push(`${label}: ${raw(cells[field])}`);
        }
        const sourceCustomer = raw(cells.customer);
        if (sourceCustomer && sourceCustomer.toUpperCase() !== "IPN") notes.push(`File delivery customer: ${sourceCustomer}; fixed IPN delivery address used.`);
        const row = {
          row_number: rows.length + 1, sheet_name: sheetName, sheet_row: r + 1,
          customers_own_invoice_number: raw(cells.reference),
          coll_datetime: combine(collectionDate, collectionTime, "Collection"),
          del_datetime: combine(deliveryDate, deliveryTime, "Delivery"),
          total_price: read("price", "Unit cost", cell => numericValue(cell, true)),
          total_pallets: read("pallets", "Pallets", numericValue),
          total_weight: read("weight", "Load weight", numericValue),
          job_notes: notes.join("\n"), warnings
        };
        rows.push(row);
        if (rows.length > MAX_ROWS) throw new Error(`Upload up to ${MAX_ROWS} consignments at a time.`);
      }
    }
    if (!rows.length) throw new Error("No consignments found. Include the column headers above the job rows, for example Customer reference number, Collection date or Unit cost.");
    return { customerName, filename, rows, ignoredSheets };
  }

  async function readFile(file, XLSX) {
    if (!/\.(xlsx|xls|csv|ods|tsv)$/i.test(file.name)) throw new Error("Choose an Excel, CSV or ODS file. For Google Sheets, use File → Download → Microsoft Excel or CSV.");
    if (!file.size) throw new Error("The selected file is empty.");
    if (file.size > MAX_BYTES) throw new Error("Choose a file smaller than 10 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const options = { type: "array", raw: true, cellDates: false, cellNF: true, cellHTML: false, sheetRows: MAX_ROWS + 102 };
    let data = bytes;
    if (/\.(csv|tsv)$/i.test(file.name)) {
      const utf16 = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : null;
      try { data = new TextDecoder(utf16 || "utf-8", { fatal: true }).decode(bytes); }
      catch (_) { data = new TextDecoder("windows-1252").decode(bytes); }
      options.type = "string";
      if (/\.tsv$/i.test(file.name)) options.FS = "\t";
    }
    const workbook = XLSX.read(data, options);
    for (const name of workbook.SheetNames) {
      if (workbook.Sheets[name]["!fullref"]) throw new Error(`The workbook exceeds the ${MAX_ROWS}-consignment limit.`);
    }
    return parseWorkbook(workbook, file.name, XLSX);
  }

  async function batchKey(parsed, cryptoApi) {
    const canonical = JSON.stringify([parsed.customerName, parsed.rows]);
    const hash = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  return Object.freeze({ readFile, parseWorkbook, customerFromFilename, dateValue, timeValue, numericValue, batchKey, MAX_ROWS });
});
