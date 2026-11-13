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

  // Lecture d'un .xlsx (fichier modifié dans Excel) -> { "Nom de feuille": [[ligne1...], ...] }
  function lire(buf) {
    return chargerZip().then(function (JSZip) { return JSZip.loadAsync(buf); }).then(function (z) {
      var fx = function (n) { var f = z.file(n); return f ? f.async('string') : Promise.resolve(''); };
      return Promise.all([fx('xl/workbook.xml'), fx('xl/_rels/workbook.xml.rels'), fx('xl/sharedStrings.xml')]).then(function (r) {
        var P = new DOMParser(), wb = P.parseFromString(r[0], 'application/xml'), rels = P.parseFromString(r[1], 'application/xml');
        var ss = r[2] ? Array.prototype.map.call(P.parseFromString(r[2], 'application/xml').getElementsByTagName('si'), function (si) {
          return Array.prototype.map.call(si.getElementsByTagName('t'), function (t) { return t.textContent; }).join('');
        }) : [];
        var cible = {}; Array.prototype.forEach.call(rels.getElementsByTagName('Relationship'), function (x) { cible[x.getAttribute('Id')] = x.getAttribute('Target'); });
        var feuilles = Array.prototype.map.call(wb.getElementsByTagName('sheet'), function (sh) {
          var id = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
          var t = (cible[id] || '').replace(/^\/?(xl\/)?/, ''); return { nom: sh.getAttribute('name'), chemin: 'xl/' + t };
        });
        return Promise.all(feuilles.map(function (f) { return fx(f.chemin); })).then(function (xs) {
          var out = {};
          xs.forEach(function (x, i) {
            var d = P.parseFromString(x, 'application/xml'), rows = [];
            Array.prototype.forEach.call(d.getElementsByTagName('row'), function (row) {
              var n = +row.getAttribute('r') - 1, ligne = [];
              Array.prototype.forEach.call(row.getElementsByTagName('c'), function (c) {
                var ref = c.getAttribute('r') || '', lettres = ref.replace(/\d+/g, ''), k = 0;
                for (var j = 0; j < lettres.length; j++) k = k * 26 + (lettres.charCodeAt(j) - 64);
                var t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = null;
                if (t === 's') val = v ? ss[+v.textContent] : null;
                else if (t === 'inlineStr') val = Array.prototype.map.call(c.getElementsByTagName('t'), function (e) { return e.textContent; }).join('');
                else if (t === 'b') val = v ? (v.textContent === '1' ? 'oui' : 'non') : null;
                else if (t === 'str') val = v ? v.textContent : null;
                else if (v) val = +v.textContent;
                ligne[k ? k - 1 : ligne.length] = val;
              });
              rows[n] = ligne;
            });
            out[feuilles[i].nom] = rows;
          });
          return out;
        });
      });
    });
  }
  // Classeur mis en forme (couleurs, bordures, cellules fusionnées, heures) : utilisé pour l'export du planning.
  // feuilles : [{ nom, cases: [{ r, c, v, st }], fusions: ['A1:B2'], larg: [..], haut: { r: h }, figer: 'B1', paysage: true }]
  // st : { fond: 'RRGGBB', coul: 'RRGGBB', gras: true, taille: 11, fmt: 'h:mm', bord: 'fin'|'moyen', ali: 'center'|'left', retour: true }
  // v : texte, nombre, ou { h: heures } (durée affichée en heures:minutes).
  function creerMiseEnForme(feuilles) {
    var fonts = ['<font><sz val="11"/><name val="Aptos Narrow"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'],
      borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], fmts = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], cache = {};
    function idx(tab, x, base) { var i = tab.indexOf(x); if (i < 0) { tab.push(x); i = tab.length - 1; } return i + (base || 0); }
    function style(st) {
      if (!st) return 0; var k = JSON.stringify(st); if (cache[k] != null) return cache[k];
      var f = idx(fonts, '<font>' + (st.gras ? '<b/>' : '') + '<sz val="' + (st.taille || 11) + '"/>' + (st.coul ? '<color rgb="FF' + st.coul + '"/>' : '') + '<name val="Aptos Narrow"/></font>');
      var fi = st.fond ? idx(fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + st.fond + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
      var b = 0; if (st.bord) { var w = st.bord === 'moyen' ? 'medium' : 'thin', e = '<color rgb="FF000000"/>'; b = idx(borders, '<border><left style="' + w + '">' + e + '</left><right style="' + w + '">' + e + '</right><top style="' + w + '">' + e + '</top><bottom style="' + w + '">' + e + '</bottom><diagonal/></border>'); }
      var n = 0; if (st.fmt) n = idx(fmts, st.fmt, 164);
      var al = '<alignment horizontal="' + (st.ali || 'center') + '" vertical="center"' + (st.retour ? ' wrapText="1"' : '') + '/>';
      var x = '<xf numFmtId="' + n + '" fontId="' + f + '" fillId="' + fi + '" borderId="' + b + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"' + (n ? ' applyNumberFormat="1"' : '') + '>' + al + '</xf>';
      return (cache[k] = idx(xfs, x));
    }
    function cel(cs) {
      var ref = col(cs.c) + (cs.r + 1), s = style(cs.st), v = cs.v, sa = s ? ' s="' + s + '"' : '';
      if (v == null || v === '') return '<c r="' + ref + '"' + sa + '/>';
      if (typeof v === 'object' && v.h != null) return '<c r="' + ref + '"' + sa + '><v>' + (+v.h / 24) + '</v></c>';
      if (typeof v === 'number') return '<c r="' + ref + '"' + sa + '><v>' + v + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr"' + sa + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
    }
    function feuilleMef(f) {
      var lignes = {}; f.cases.forEach(function (cs) { (lignes[cs.r] = lignes[cs.r] || []).push(cs); });
      var data = Object.keys(lignes).map(Number).sort(function (a, b) { return a - b; }).map(function (r) {
        var h = f.haut && f.haut[r]; return '<row r="' + (r + 1) + '"' + (h ? ' ht="' + h + '" customHeight="1"' : '') + '>' + lignes[r].sort(function (a, b) { return a.c - b.c; }).map(cel).join('') + '</row>';
      }).join('');
      var cols = (f.larg || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('');
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
        + '<sheetViews><sheetView workbookViewId="0" zoomScale="90">' + (f.figer ? '<pane xSplit="1" topLeftCell="B1" activePane="topRight" state="frozen"/>' : '') + '</sheetView></sheetViews>'
        + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + data + '</sheetData>'
        + (f.fusions && f.fusions.length ? '<mergeCells count="' + f.fusions.length + '">' + f.fusions.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '')
        + '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>'
        + '<pageSetup paperSize="9" orientation="' + (f.paysage ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/></worksheet>';
    }
    return chargerZip().then(function (JSZip) {
      var z = new JSZip(), noms = feuilles.map(function (f, i) { return xml(String(f.nom).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Feuille' + (i + 1)); });
      var xmlF = feuilles.map(feuilleMef);   // d'abord les feuilles : elles remplissent la table des styles
      z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + feuilles.map(function (f, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>');
      z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + noms.map(function (n, i) { return '<sheet name="' + n + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>');
      z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + feuilles.map(function (f, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('')
        + '<Relationship Id="rId' + (feuilles.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
      z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + (fmts.length ? '<numFmts count="' + fmts.length + '">' + fmts.map(function (f, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xml(f) + '"/>'; }).join('') + '</numFmts>' : '')
        + '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') + '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
      xmlF.forEach(function (x, i) { z.file('xl/worksheets/sheet' + (i + 1) + '.xml', x); });
      return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
    });
  }
  window.XLSX_EVY = { creer: creer, lire: lire, creerMiseEnForme: creerMiseEnForme };
})();
