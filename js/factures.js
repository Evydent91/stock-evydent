// Lecture des factures PDF des fournisseurs (dans le navigateur, sans envoi à l'extérieur).
// 1. extraireLignes(fichier) : texte du PDF reconstitué ligne par ligne (cellules séparées par « | »).
// 2. lireFacture(lignes) : reconnaît le fournisseur et renvoie les lignes d'articles.
// Pour ajouter un fournisseur : écrire un nouveau modèle dans MODELES (voir GACD, MEGADENTAL, Embout.fr et Dentalclick).
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
    out.pos = [];   // pour chaque ligne : ses cellules avec leur position horizontale (colonnes des factures sans séparateurs)
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
          var s = '', e = null, cel = [], cc = null;
          r.it.forEach(function (i) {
            if (e != null) s += (i.x - e > 4 ? ' | ' : (i.x - e > 0.5 ? ' ' : ''));
            if (e == null || i.x - e > 4) cel.push(cc = { x: i.x, s: '' }); else if (i.x - e > 0.5) cc.s += ' ';
            s += i.s; cc.s += i.s; e = i.x + i.w;
          });
          out.push(s.replace(/\s+/g, ' ').trim());
          out.pos.push(cel.map(function (c) { return { x: c.x, s: c.s.replace(/\s+/g, ' ').trim() }; }));
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
        var n = c.length, q = c.slice(2).filter(estNb), k = 2;
        if (q.length < 4) return null;
        while (k < n && !estNb(c[k])) k++;   // désignation coupée en plusieurs cellules (marque, réf. fabricant) : on la recolle
        return { nom: c.slice(1, k).join(' '), qte: num(q[1]), prix: num(c[n - 3]), total: num(c[n - 2]) };
      },
      suite: false
    },
    {
      // Embout.fr : prix HT, colonnes sans séparateurs (référence et désignation sur plusieurs lignes),
      // remises globales en bas (« -20% sur la gamme Embout.fr », « 5% de remise dès 500€ ») réparties sur les articles concernés.
      nom: 'Embout.fr', reconnait: /Embout\.fr/i, cleNom: true,
      entete: function (t, F) {
        var m = t.match(/#FA(\d+) \| (\d\d)\/(\d\d)\/(\d{4}) \| ([A-Z0-9]+) \|/);
        if (m) { F.facture = 'FA' + m[1]; F.date = m[4] + '-' + m[3] + '-' + m[2]; F.commandes.push(m[5]); }
      },
      lire: function (lignes, F) {
        var pos = lignes.pos || [], col = null, zone = false, red = false, items = [], cur = null, reds = [];
        var eur = function (c) { return /^-?\s*[\d\s.]*\d,\d\d €$/.test(c.trim()); };
        for (var i = 0; i < lignes.length; i++) {
          var l = lignes[i], cel = pos[i] || l.split(' | ').map(function (x) { return { x: 0, s: x }; });
          if (/^Référence \| Produit \| Taux de/.test(l)) { col = { prod: cel[0].x + 45, taxe: cel[2].x }; zone = true; continue; }   // « Produit » est centré : la désignation commence juste après la colonne des références
          if (!zone) continue;
          if (/^Réductions$/.test(l)) { red = true; cur = null; continue; }
          if (/^Détail des/.test(l)) break;
          if (red) { var mr = l.match(/^(.*) \| - ([\d\s.]*\d,\d\d) €$/); if (mr && !/^Total/.test(mr[1])) reds.push({ lib: mr[1], v: num(mr[2]) }); continue; }
          if (/^(FACTURE|\d\d\/\d\d\/\d{4}|#FA\d+|\d+ \/ \d+|taxe \|.*|\(HT\).*)$/.test(l)) continue;
          var refP = cel.filter(function (c) { return c.x < col.prod; }).map(function (c) { return c.s; }).join('');
          var desP = cel.filter(function (c) { return c.x >= col.prod && c.x < col.taxe - 6; }).map(function (c) { return c.s; }).join(' ');
          var reste = cel.filter(function (c) { return c.x >= col.taxe - 6; }).map(function (c) { return c.s; });
          var n = reste.length;
          if (n >= 5 && eur(reste[n - 1]) && /^\d+$/.test(reste[n - 2]) && eur(reste[n - 3])) {
            cur = { ref: '', nom: '', qte: +reste[n - 2], ht: num(reste[n - 1]), tva: num(reste[0]) || 20 }; items.push(cur);
          }
          if (!cur) continue;
          if (refP) cur.ref += refP;
          if (desP) cur.nom += (cur.nom ? ' ' : '') + desP;
        }
        // remises : d'abord celles d'une gamme, puis les remises sur tout, au prorata des montants
        reds.forEach(function (r) {
          var g = /gamme (.+)$/i.exec(r.lib), cible = items.filter(function (x) { return !g || norm(x.nom).indexOf(norm(g[1])) >= 0; });
          var base = cible.reduce(function (t, x) { return t + x.ht; }, 0); if (!base) return;
          cible.forEach(function (x) { x.ht -= r.v * x.ht / base; });
        });
        var t = lignes.join('\n'), tot = t.match(/(?:^|\| )Total \| ([\d\s.]*\d,\d\d) €$/m), fr = t.match(/Frais de livraison \| ([\d\s.]*\d,\d\d) €/);
        enTTC(items, F, tot ? num(tot[1]) - (fr ? num(fr[1]) * 1.2 : 0) : null);
      }
    },
    {
      // Dentalclick (Centrale de Facturation Dentaire) : prix HT après remise, une ligne par article (marque parfois en dessous, puis « Lot: »),
      // titres de famille entre les articles, gratuités en bas (« RÉDUCTIONS ET GRATUITÉS PROMOTIONNELLES ») déduites de l'article concerné.
      nom: 'Dentalclick', reconnait: /dentalclick/i,
      entete: function (t, F) {
        var f = t.match(/FACTURE \| (\d+)/), d = t.match(/Date facture: (\d\d)\.(\d\d)\.(\d{4})/), c = t.match(/Notre référence (\d+)/);
        if (f) F.facture = f[1]; if (d) F.date = d[3] + '-' + d[2] + '-' + d[1]; if (c) F.commandes.push(c[1]);
      },
      lire: function (lignes, F) {
        var items = [], cur = null, grat = false, frais = 0, grats = [];
        lignes.forEach(function (l, i) {
          var c = l.split(' | '), n = c.length, suiv = lignes[i + 1] || '';
          if (/^RÉDUCTIONS ET GRATUITÉS/i.test(l)) { grat = true; cur = null; return; }
          if (/^BASE IMPOSABLE/.test(l)) { grat = false; cur = null; return; }
          if (/^Frais de port \|/.test(l) && n >= 3) { frais += num(c[n - 2]) || 0; return; }
          if (/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(c[0]) && n >= 4 && /%$/.test(c[n - 1])) {
            if (grat) { var v = num(c[n - 2]); if (v < 0) grats.push({ ref: c[0], v: v }); return; }   // gratuité : déduite plus bas de l'article de même référence
            if (n >= 7 && /^\d+$/.test(c[2])) { cur = { ref: c[0], nom: c[1], qte: +c[2], ht: num(c[n - 2]), tva: num(c[n - 1]) || 20 }; if (cur.ht > 0) items.push(cur); return; }
          }
          // marque écrite sous la désignation (suivie du lot) ; les titres de famille, eux, sont suivis d'un article
          if (cur && n === 1 && !/^Lot:/.test(l) && /^Lot:/.test(suiv) && l.length < 40) { cur.nom += ' ' + l; return; }
          if (!/^Lot:/.test(l)) cur = null;
        });
        // deux lignes du même article au même prix : une seule ligne
        var vus = {}; items = items.filter(function (x) { var k = x.ref + '|' + (x.ht / x.qte).toFixed(4); if (vus[k]) { vus[k].qte += x.qte; vus[k].ht += x.ht; return false; } vus[k] = x; return true; });
        grats.forEach(function (g) { var x = items.filter(function (y) { return y.ref === g.ref && y.ht > 0; })[0]; if (x) x.ht = Math.max(0, x.ht + g.v); });
        var tot = lignes.join('\n').match(/TOTAL FACTURE \| ([\d\s.]*\d,\d\d) €/);
        enTTC(items, F, tot ? num(tot[1]) - frais * 1.2 : null);
      }
    }
  ];
  // Prix HT → TTC ; la somme est calée sur le total payé de la facture (arrondis de TVA), hors frais de port
  function enTTC(items, F, cible) {
    var somme = items.reduce(function (s0, x) { return s0 + x.ht * (1 + x.tva / 100); }, 0);
    var k = cible && somme && Math.abs(cible - somme) < 1 ? cible / somme : 1;
    var L = items.map(function (x) { return { ref: x.ref, nom: x.nom, qte: x.qte, total: Math.round(x.ht * (1 + x.tva / 100) * k * 100) / 100, commande: F.commandes[0] || null }; });
    // les centimes d'arrondi restants vont sur la plus grosse ligne
    var r = cible && k !== 1 ? Math.round((cible - L.reduce(function (s0, x) { return s0 + x.total; }, 0)) * 100) / 100 : 0;
    if (r && Math.abs(r) <= 0.1 && L.length) { var g = L.reduce(function (a, b) { return b.total > a.total ? b : a; }); g.total = Math.round((g.total + r) * 100) / 100; }
    L.forEach(function (x) { x.prix = x.qte ? Math.round(x.total / x.qte * 10000) / 10000 : 0; F.lignes.push(x); });
  }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function lireFacture(lignes) {
    var t = lignes.join('\n'), mod = null;
    for (var i = 0; i < MODELES.length; i++) if (MODELES[i].reconnait.test(t)) { mod = MODELES[i]; break; }
    var F = { fournisseur: mod ? mod.nom : null, facture: null, date: null, commandes: [], lignes: [] };
    if (!mod) return F;
    mod.entete(t, F);
    if (mod.lire) mod.lire(lignes, F); else {
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
    }
    // un même article facturé deux fois : on additionne
    var vus = {};
    F.lignes = F.lignes.filter(function (x) {
      var k = x.commande + '|' + x.ref + '|' + x.prix + (mod.cleNom ? '|' + x.nom : '');
      if (vus[k]) { vus[k].qte += x.qte; vus[k].total = (vus[k].total || 0) + (x.total || 0); return false; }
      vus[k] = x; return true;
    });
    return F;
  }

  window.FACTURES = { extraireLignes: extraireLignes, lireFacture: lireFacture, modeles: MODELES.map(function (m) { return m.nom; }), _lignesDuDoc: lignesDuDoc };
})();
