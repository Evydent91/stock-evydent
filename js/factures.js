// Lecture des factures PDF des fournisseurs (dans le navigateur, sans envoi à l'extérieur).
// 1. extraireLignes(fichier) : texte du PDF reconstitué ligne par ligne (cellules séparées par « | »).
// 2. lireFacture(lignes) : reconnaît le fournisseur et renvoie les lignes d'articles.
// Pour ajouter un fournisseur : écrire un nouveau modèle dans MODELES (voir GACD et MEGADENTAL).
(function () {
  var PDFJS = 'js/vendor/pdf.min.mjs', WORKER = 'js/vendor/pdf.worker.min.mjs';

  function extraireLignes(buf) {
    var base = new URL('.', location.href).href;
    return import(base + PDFJS).then(function (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc = base + WORKER;
      return pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    }).then(lignesDuDoc);
  }
  function lignesDuDoc(doc) {
    var out = [], p = 1;
    function page() {
      if (p > doc.numPages) return Promise.resolve(out);
      return doc.getPage(p++).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
        var rows = [];
        tc.items.forEach(function (it) {
          if (!it.str || !it.str.trim()) return;
          var y = it.transform[5], x = it.transform[4], r = null;
          for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) < 2.5) { r = rows[i]; break; }
          if (!r) rows.push(r = { y: y, it: [] });
          r.it.push({ x: x, s: it.str, w: it.width });
        });
        rows.sort(function (a, b) { return b.y - a.y; }).forEach(function (r) {
          r.it.sort(function (a, b) { return a.x - b.x; });
          var s = '', e = null;
          r.it.forEach(function (i) { if (e != null) s += (i.x - e > 4 ? ' | ' : (i.x - e > 0.5 ? ' ' : '')); s += i.s; e = i.x + i.w; });
          out.push(s.replace(/\s+/g, ' ').trim());
        });
        return page();
      });
    }
    return page();
  }

  // nombre « 1.114,13 » (GACD) ou « 143.95 » (Megadental)
  function num(s) {
    s = String(s).replace(/\s|€|EUR/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s); return isNaN(n) ? null : n;
  }
  var NB = /^-?[\d.\s]*\d(,\d+)?$|^-?\d+\.\d+$/;
  function estNb(c) { return NB.test(c.trim()); }
  function estTva(c) { return /^(20|10|5[,.]5|2[,.]1)([,.]0+)?$/.test(c.trim()); }

  var MODELES = [
    {
      nom: 'GACD', reconnait: /GACD/,
      ref: /^[A-Z0-9]{1,4}-[A-Z0-9]{2,6}$/,
      entete: function (t, F) {
        var m = t.match(/Facture n° (\d+) du (\d\d)\.(\d\d)\.(\d{4})/);
        if (m) { F.facture = m[1]; F.date = m[4] + '-' + m[3] + '-' + m[2]; }
      },
      commande: function (l) { var m = l.match(/^Commande (\d+) du/); return m && m[1]; },
      ligne: function (c) {
        // ref | désignation | qté | prix réf | remise | prix net TTC | total TTC | total HT | TVA
        if (c.length < 7 || !estTva(c[c.length - 1])) return null;
        var n = c.length;
        return { nom: c[1], qte: num(c[2]), prix: num(c[n - 4]), total: num(c[n - 3]) };
      },
      suite: true
    },
    {
      nom: 'MEGADENTAL', reconnait: /MEGA ?DENTAL|Mega Dental/i,
      ref: /^\d{3}[–-]\d{4}$/,
      entete: function (t, F) {
        var m = t.match(/#\d+#(\d+)#(\d+)#(\d\d) \/ (\d\d) \/ (\d{4})#(\d+)#/);
        if (m) { F.facture = m[2]; F.date = m[5] + '-' + m[4] + '-' + m[3]; F.commandes.push(m[6]); }
        else { var c = t.match(/N° COMMANDE\n(\d{6,})/); if (c) F.commandes.push(c[1]); }
      },
      commande: function () { return null; },
      ligne: function (c) {
        // ref | désignation | [index] | qté commandée | qté livrée | prix réf | [remise] | prix net TTC | total TTC | TVA
        if (c.length < 6 || !estTva(c[c.length - 1])) return null;
        var n = c.length, q = c.slice(2).filter(estNb);
        if (q.length < 4) return null;
        return { nom: c[1], qte: num(q[1]), prix: num(c[n - 3]), total: num(c[n - 2]) };
      },
      suite: false
    }
  ];

  function lireFacture(lignes) {
    var t = lignes.join('\n'), mod = null;
    for (var i = 0; i < MODELES.length; i++) if (MODELES[i].reconnait.test(t)) { mod = MODELES[i]; break; }
    var F = { fournisseur: mod ? mod.nom : null, facture: null, date: null, commandes: [], lignes: [] };
    if (!mod) return F;
    mod.entete(t, F);
    var cmd = F.commandes[0] || null, der = null;
    lignes.forEach(function (l) {
      var k = mod.commande(l);
      if (k) { cmd = k; if (F.commandes.indexOf(k) < 0) F.commandes.push(k); der = null; return; }
      var c = l.split(' | ');
      if (mod.ref.test(c[0])) {
        var x = mod.ligne(c);
        if (x && x.qte != null && x.prix != null) {
          x.ref = c[0].replace('–', '-'); x.commande = cmd; F.lignes.push(x); der = x; return;
        }
      }
      // désignation sur deux lignes (GACD) : « (50) », « ADAPTATEURS) »
      if (mod.suite && der && c.length === 1 && l.length < 45 && !/Page|Facture|Total|Commande/i.test(l)) { der.nom += ' ' + l; der = null; return; }
      der = null;
    });
    // un même article facturé deux fois : on additionne
    var vus = {};
    F.lignes = F.lignes.filter(function (x) {
      var k = x.commande + '|' + x.ref + '|' + x.prix;
      if (vus[k]) { vus[k].qte += x.qte; vus[k].total = (vus[k].total || 0) + (x.total || 0); return false; }
      vus[k] = x; return true;
    });
    return F;
  }

  window.FACTURES = { extraireLignes: extraireLignes, lireFacture: lireFacture, modeles: MODELES.map(function (m) { return m.nom; }), _lignesDuDoc: lignesDuDoc };
})();
