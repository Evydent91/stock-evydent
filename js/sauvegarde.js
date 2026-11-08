// Sauvegarde : fabrique un fichier Excel (.xlsx) dans le navigateur, une feuille par tableau.
// XLSX.creer([{ nom, colonnes: [...], lignes: [[...], ...] }]) -> Promise<Blob>
// JSZip est chargé seulement au moment de la sauvegarde.
(function () {
  var JSZIP = 'js/vendor/jszip.min.js';
  function chargerZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = JSZIP;
      s.onload = function () { ok(window.JSZip); }; s.onerror = function () { ko(new Error('Module de sauvegarde introuvable')); };
      document.head.appendChild(s);
    });
  }
  function xml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function col(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function cellule(v, ref, style) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'boolean') v = v ? 'oui' : 'non';
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><v>' + v + '</v></c>';
    if (typeof v === 'object') v = JSON.stringify(v);
    return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
  }
  function feuille(f) {
    var rows = ['<row r="1">' + f.colonnes.map(function (c, i) { return cellule(c, col(i) + '1', 1); }).join('') + '</row>'];
    f.lignes.forEach(function (l, n) { rows.push('<row r="' + (n + 2) + '">' + l.map(function (v, i) { return cellule(v, col(i) + (n + 2)); }).join('') + '</row>'); });
    var largeurs = f.colonnes.map(function (c, i) { var m = String(c).length; f.lignes.slice(0, 200).forEach(function (l) { var v = l[i]; if (v != null) m = Math.max(m, Math.min(60, String(typeof v === 'object' ? JSON.stringify(v) : v).length)); }); return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (m + 2) + '" customWidth="1"/>'; }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + '<cols>' + largeurs + '</cols><sheetData>' + rows.join('') + '</sheetData></worksheet>';
  }
  function creer(feuilles) {
    return chargerZip().then(function (JSZip) {
      var z = new JSZip(), noms = feuilles.map(function (f, i) { return xml(String(f.nom).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Feuille' + (i + 1)); });
      z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + feuilles.map(function (f, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>');
      z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + noms.map(function (n, i) { return '<sheet name="' + n + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>');
      z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + feuilles.map(function (f, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('')
        + '<Relationship Id="rId' + (feuilles.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
      z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
      feuilles.forEach(function (f, i) { z.file('xl/worksheets/sheet' + (i + 1) + '.xml', feuille(f)); });
      return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
    });
  }
  window.XLSX_EVY = { creer: creer };
})();
