/* Stock · Espace dentaire Val d'Yerres — application branchée sur Supabase
   Livraison 1 : connexion, sorties, demandes, stock, historique, équipe. */
(function () {
  'use strict';
  var C = window.CONFIG;
  var sb = window.supabase.createClient(C.url, C.key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'stock-evydent-' + C.env }
  });

  // ---------- État ----------
  var S = {
    session: null, me: null, err: '', tab: 'sortie', loading: false,
    articles: [], byId: {}, stocks: {}, fournisseurs: {}, profils: [], attente: [], histo: [],
    sortie: { cab: null, q: '', panier: {}, msg: null, busy: false },
    stockQ: '', stockF: '', histTous: false, eqEdit: null, pwAbc: false, dernierInv: {}, recents: [], j0: null, invJ0: {}, fiche: null, artQ: '', artF: 'tous', artMax: 100, archives: [], fournListe: [], foArch: false,
    inv: { emp: null, d: {}, q: '', tous: false, recap: false, motifs: {}, busy: false, msg: null, max: 80 }
  };
  var LABEL = { assistante: 'Assistante', referente: 'Référente', responsable: 'Responsable' };

  // ---------- Outils ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nb(x) { return Math.round((+x || 0) * 100) / 100; }
  function fr(x) { var v = nb(x); return String(v).replace('.', ','); }
  function eur(x) { return (+x || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function gestion() { return S.me && (S.me.role === 'referente' || S.me.role === 'responsable'); }
  function facteur(a) { return a && a.conditionnement === 'BOITE' && a.consommation === 'Unité' && +a.qte_par_boite > 1 ? +a.qte_par_boite : 1; }
  function stockDe(id, emp) { return (S.stocks[id] && S.stocks[id][emp]) || 0; }
  function dispoUnites(a) { return nb(stockDe(a.id, 0) * facteur(a)); }
  function uRes(a) { return a.conditionnement === 'BOITE' ? 'boîte(s)' : 'u.'; }
  function quand(d) { var x = new Date(d); return x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function cabTxt(e) { return e === 0 ? 'Réserve' : 'Cab. ' + e; }
  var tt;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 3200); }
  function msgErr(e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Identifiant ou mot de passe incorrect.';
    if (/row-level security|permission denied/i.test(m)) return 'Action non autorisée pour votre compte.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion internet. Réessayez.';
    return m;
  }

  // ---------- Connexion ----------
  function emailDe(id) { id = String(id || '').trim(); return id.indexOf('@') >= 0 ? id.toLowerCase() : norm(id).replace(/\s+/g, '') + '@' + C.domaine; }
  function connexion(ev) {
    ev.preventDefault();
    var id = $('lid').value, pw = $('lpw').value;
    if (!id.trim() || !pw) { S.err = 'Saisissez l’identifiant et le mot de passe.'; render(); return; }
    $('lbtn').disabled = true;
    sb.auth.signInWithPassword({ email: emailDe(id), password: pw }).then(function (r) {
      if (r.error) { S.err = msgErr(r.error); render(); var p = $('lpw'); if (p) { p.value = ''; p.focus(); } return; }
      S.err = ''; demarrer(r.data.session);
    });
  }
  function deconnexion() { sb.auth.signOut().then(function () { S.session = null; S.me = null; S.tab = 'sortie'; render(); }); }

  function vLogin() {
    var id = ($('lid') && $('lid').value) || '';
    var numerique = !S.pwAbc && id.indexOf('@') < 0;
    return '<div class="lg"><div class="lg-top"></div><div class="lg-in">'
      + '<div class="lg-hd"><img class="lg-logo" src="assets/logo-evydent.jpg" alt="Logo Evydent Val d’Yerres"><div class="lg-name">Espace dentaire Val d’Yerres</div><div class="lg-sub">Gestion du stock · Espace équipe' + (C.env === 'dev' ? ' · <span class="env">TEST</span>' : '') + '</div></div>'
      + '<form class="lg-card" id="lform" autocomplete="on"><h1>Bonjour</h1>'
      + '<label>Identifiant<input id="lid" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Votre identifiant" value="' + esc(id) + '"></label>'
      + '<label>Mot de passe ou code<span class="lg-pw"><input id="lpw" name="password" type="password" autocomplete="current-password" placeholder="••••••" ' + (numerique ? 'inputmode="numeric"' : '') + '>'
      + '<button type="button" class="btn l sm" id="labc" aria-label="Changer de clavier">' + (numerique ? 'ABC' : '123') + '</button></span></label>'
      + (S.err ? '<p class="lg-err" role="alert">' + esc(S.err) + '</p>' : '')
      + '<button class="btn gold" id="lbtn" type="submit">Se connecter</button>'
      + '<p class="lg-help">Identifiant ou code oublié ? Demandez à la responsable des achats ou à la référente.</p></form>'
      + '<div class="lg-foot">Accès réservé au personnel du centre · 01 85 12 00 85</div></div></div>';
  }
  function bindLogin() {
    $('lform').addEventListener('submit', connexion);
    $('labc').addEventListener('click', function () { S.pwAbc = !S.pwAbc; var v = $('lpw').value; render(); $('lpw').value = v; $('lpw').focus(); });
    $('lid').addEventListener('input', function () {
      var num = !S.pwAbc && this.value.indexOf('@') < 0;
      if (num) $('lpw').setAttribute('inputmode', 'numeric'); else $('lpw').removeAttribute('inputmode');
      $('labc').textContent = num ? 'ABC' : '123';
    });
    if (!$('lid').value) $('lid').focus(); else $('lpw').focus();
  }

  // ---------- Chargement des données ----------
  function demarrer(session) {
    S.session = session;
    S.loading = true; render();
    sb.from('profils').select('*').eq('id', session.user.id).maybeSingle().then(function (r) {
      S.me = r.data || null;
      if (!S.me || !S.me.actif) { S.loading = false; render(); return; }
      if (S.sortie.cab == null) S.sortie.cab = S.me.cabinet || 1;
      if (!gestion() && ['sortie', 'inventaire', 'histo'].indexOf(S.tab) < 0) S.tab = 'sortie';
      if (S.inv.emp == null && S.me.cabinet) choisirEmp(S.me.cabinet);
      if (gestion() && !S.tabChoisi) S.tab = 'accueil';
      return charger();
    });
  }
  function toutLire(table, cols, modif) {
    // lit une table par pages de 1000 lignes
    var out = [], pas = 1000;
    function page(from) {
      var q = sb.from(table).select(cols).range(from, from + pas - 1);
      if (modif) q = modif(q);
      return q.then(function (r) { if (r.error) throw r.error; out = out.concat(r.data); return r.data.length === pas ? page(from + pas) : out; });
    }
    return page(0);
  }
  function charger() {
    var ps = [
      toutLire('articles', 'id,code,nom,reference,fournisseur_id,conditionnement,qte_par_boite,consommation,conso_verifiee,seuil,sans_seuil,cout_moyen,prix,archive', function (q) { return q.order('nom'); }),
      toutLire('stocks', 'article_id,emplacement,quantite'),
      toutLire('fournisseurs', '*', function (q) { return q.order('nom'); }),
      sb.from('profils').select('*').order('nom').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('mouvements').select('*').eq('statut', 'attente').order('cree_le').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('parametres').select('cle,valeur').eq('cle', 'j0').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('inventaires').select('emplacement,date_inv,j0').order('date_inv', { ascending: false }).limit(500).then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('mouvements').select('*').order('cree_le', { ascending: false }).limit(30).then(function (r) { if (r.error) throw r.error; return r.data; })
    ];
    return Promise.all(ps).then(function (x) {
      S.articles = x[0].filter(function (a) { return !a.archive; }); S.archives = x[0].filter(function (a) { return a.archive; }); S.byId = {}; x[0].forEach(function (a) { S.byId[a.id] = a; });
      S.stocks = {}; x[1].forEach(function (s) { (S.stocks[s.article_id] = S.stocks[s.article_id] || {})[s.emplacement] = +s.quantite; });
      S.fournisseurs = {}; x[2].forEach(function (f) { S.fournisseurs[f.id] = f.nom; }); S.fournListe = x[2];
      S.profils = x[3]; S.attente = x[4];
      S.j0 = x[5][0] ? x[5][0].valeur : null;
      S.dernierInv = {}; S.invJ0 = {}; x[6].forEach(function (i) { if (!S.dernierInv[i.emplacement]) S.dernierInv[i.emplacement] = i.date_inv; if (i.j0 && S.j0 && S.j0.debut && i.date_inv.slice(0, 10) >= S.j0.debut) S.invJ0[i.emplacement] = true; });
      S.recents = x[7];
      S.loading = false; render();
      if (S.tab === 'histo') chargerHisto();
    }).catch(function (e) { S.loading = false; toast(msgErr(e)); render(); });
  }
  function chargerHisto() {
    var q = sb.from('mouvements').select('*').order('cree_le', { ascending: false }).limit(150);
    if (!gestion() || !S.histTous) q = q.eq('auteur', S.me.id);
    q.then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } S.histo = r.data; if (S.tab === 'histo') render(); });
  }

  // ---------- Rendu général ----------
  function render() {
    var app = $('app');
    if (!S.session) { app.innerHTML = vLogin(); bindLogin(); return; }
    if (S.loading && !S.me) { app.innerHTML = '<p class="chargement">Chargement…</p>'; return; }
    if (!S.me || !S.me.actif) {
      app.innerHTML = '<div class="lg"><div class="lg-top"></div><div class="lg-in"><div class="lg-card"><h1>Compte non activé</h1><p>Votre connexion fonctionne, mais votre compte n’a pas encore de profil actif dans l’application. Demandez à la responsable des achats ou à la référente de l’activer.</p><button class="btn l" id="bout">Se déconnecter</button></div></div></div>';
      $('bout').onclick = deconnexion; return;
    }
    var tabs = gestion() ? [['accueil', 'Accueil'], ['sortie', 'Sortie'], ['inventaire', 'Inventaire']] : [['sortie', 'Sortie'], ['inventaire', 'Inventaire']];
    if (gestion()) tabs.push(['demandes', 'Demandes' + (S.attente.length ? '<span class="badge">' + S.attente.length + '</span>' : '')], ['stock', 'Stock'], ['articles', 'Articles'], ['fournisseurs', 'Fournisseurs']);
    tabs.push(['histo', 'Historique']);
    if (gestion()) tabs.push(['equipe', 'Équipe']);
    var h = '<header class="top"><div class="top-in"><img src="assets/logo-evydent.jpg" alt="">'
      + '<div class="top-who"><b>' + esc(S.me.nom) + (C.env === 'dev' ? ' <span class="env">TEST</span>' : '') + '</b><span>' + LABEL[S.me.role] + (S.me.cabinet ? ' · cabinet ' + S.me.cabinet : '') + '</span></div>'
      + '<button class="btn l sm" data-act="out">Changer de personne</button></div>'
      + '<nav class="tabs" aria-label="Menu">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav></header>';
    h += '<main>' + (S.loading ? '<p class="mu">Mise à jour…</p>' : '') + ({ accueil: vAccueil, sortie: vSortie, inventaire: vInventaire, demandes: vDemandes, stock: vStock, histo: vHisto, equipe: vEquipe, articles: vArticles, fournisseurs: vFournisseurs }[S.tab] || vSortie)() + '</main>';
    h += (S.tab === 'sortie' ? vBarSortie() : S.tab === 'inventaire' && S.inv.emp != null && !S.inv.recap ? vBarInv() : '');
    var fq = document.activeElement && document.activeElement.id, pos = fq && document.activeElement.selectionStart;
    app.innerHTML = h;
    if (fq && $(fq)) { $(fq).focus(); try { $(fq).setSelectionRange(pos, pos); } catch (e) {} }
  }

  // ---------- Sortie ----------
  function vSortie() {
    var s = S.sortie, hors = S.me.cabinet && +s.cab !== +S.me.cabinet;
    var h = '<h2>Nouvelle sortie</h2>';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    h += '<div class="card"><div class="g2"><label class="mu">Cabinet<select class="in" id="scab">'
      + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (+s.cab === c ? ' selected' : '') + '>Cabinet ' + c + (S.me.cabinet === c ? ' (le mien)' : '') + '</option>'; }).join('')
      + '</select></label><label class="mu">Rechercher un article<input class="in" id="sq" type="search" placeholder="Nom ou référence" value="' + esc(s.q) + '"></label></div>'
      + (hors ? '<p class="ban warn" style="margin:10px 0 0">Ce n’est pas votre cabinet : la sortie sera enregistrée « hors cabinet » (remplacement).</p>' : '') + '</div>';
    var q = norm(s.q), ids = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; });
    var liste = q ? S.articles.filter(function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }).slice(0, 40)
                  : ids.map(function (k) { return S.byId[k]; }).filter(Boolean);
    if (!q && !ids.length) h += '<p class="mu">Tapez le nom d’un article pour l’ajouter à la sortie.</p>';
    if (q && !liste.length) h += '<p class="mu">Aucun article trouvé.</p>';
    if (liste.length) h += '<div class="card">' + liste.map(function (a) {
      var v = s.panier[a.id] || 0, d = dispoUnites(a), trop = v > d;
      return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + (a.reference && a.reference !== 'SR' ? '<span class="ref">' + esc(a.reference) + '</span>' : '') + '</b>'
        + '<span class="' + (trop ? 'pill warn' : '') + '">Réserve : ' + fr(d) + ' u.' + (facteur(a) > 1 ? ' (' + fr(stockDe(a.id, 0)) + ' boîte(s) de ' + fr(a.qte_par_boite) + ')' : '') + (trop ? ' · au-delà : demande à confirmer' : '') + '</span></div>'
        + '<div class="stp"><button type="button" data-moins="' + a.id + '" aria-label="Moins un">−</button><input inputmode="decimal" data-qte="' + a.id + '" value="' + (v || '') + '" placeholder="0" aria-label="Quantité"><button type="button" data-plus="' + a.id + '" aria-label="Plus un">+</button></div></div>';
    }).join('') + '</div>';
    return h;
  }
  function vBarSortie() {
    var n = Object.keys(S.sortie.panier).filter(function (k) { return S.sortie.panier[k] > 0; }).length;
    return '<div class="bar"><div class="bar-in"><span class="grow mu">' + (n ? n + ' article(s) · cabinet ' + S.sortie.cab : 'Panier vide') + '</span>'
      + (n ? '<button class="btn l" data-act="vider">Vider</button>' : '') + '<button class="btn" data-act="valider"' + (n && !S.sortie.busy ? '' : ' disabled') + '>Valider la sortie</button></div></div>';
  }
  function setQte(id, v) { v = Math.max(0, nb(String(v).replace(',', '.'))); if (v) S.sortie.panier[id] = v; else delete S.sortie.panier[id]; }
  function validerSortie() {
    var s = S.sortie, lignes = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; }).map(function (k) { return { article_id: +k, quantite: s.panier[k] }; });
    if (!lignes.length || s.busy) return;
    s.busy = true; render();
    sb.rpc('faire_sortie', { p_cabinet: +s.cab, p_lignes: lignes }).then(function (r) {
      s.busy = false;
      if (r.error) { s.msg = ['ko', esc(msgErr(r.error))]; render(); return; }
      var d = r.data || {}, m = [];
      if (d.sorties) m.push('✔ ' + d.sorties + ' article(s) sorti(s) pour le cabinet ' + s.cab + '.');
      if (d.en_attente) m.push('⏳ ' + d.en_attente + ' article(s) dépassent la réserve : demande envoyée à la responsable, voyez-la pour confirmer.');
      if (d.hors_cabinet) m.push('Enregistré « hors cabinet ».');
      s.msg = [d.en_attente ? 'warn' : 'ok', m.join(' ')]; s.panier = {}; s.q = '';
      charger();
    });
  }

  // ---------- Demandes (gestion) ----------
  function vDemandes() {
    var h = '<h2>Demandes à confirmer</h2>';
    if (!S.attente.length) return h + '<p class="mu">Aucune demande en attente.</p>';
    return h + S.attente.map(function (m) {
      var a = S.byId[m.article_id] || { nom: '?' }, d = dispoUnites(a);
      return '<div class="card"><div class="row wrap"><div class="grow"><b>' + esc(a.nom) + ' × ' + fr(m.quantite) + '</b><br><span class="mu">' + esc(m.auteur_nom || '?') + ' · ' + cabTxt(m.emplacement_vers) + ' · ' + quand(m.cree_le) + (m.hors_cabinet ? ' · <span class="pill warn">hors cabinet</span>' : '') + '</span><br><span class="mu">Réserve actuelle : ' + fr(d) + ' u. — écart si confirmé : ' + fr(Math.max(0, m.quantite - d)) + ' u.</span></div>'
        + '<button class="btn l sm" data-refuser="' + m.id + '">Refuser</button><button class="btn sm" data-confirmer="' + m.id + '">Confirmer</button></div></div>';
    }).join('');
  }
  function traiter(id, ok) {
    if (!ok && !confirm('Refuser cette demande ? Le stock ne sera pas modifié.')) return;
    sb.rpc('traiter_demande', { p_mouvement: id, p_accepter: ok }).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      toast(ok ? '✔ Sortie confirmée' + (r.data && +r.data.ecart ? ' (écart de réserve enregistré)' : '') : 'Demande refusée');
      charger();
    });
  }

  // ---------- Inventaire ----------
  var MOTIFS = ['Casse', 'Périmé', 'Perte', 'Erreur de saisie', 'Utilisé sans sortie', 'Autre'];
  function aujourdhui() { return new Date().toISOString().slice(0, 10); }
  function peutReserve() { return gestion() || (S.me.reserve_jusquau && S.me.reserve_jusquau >= aujourdhui()); }
  function j0Actif() { return !!(S.j0 && S.j0.actif && aujourdhui() <= S.j0.fin); }
  function j0Premier(emp) { return j0Actif() && !S.invJ0[emp]; }
  function cleBrouillon(emp) { return 'inv-' + C.env + '-' + S.me.id + '-' + emp; }
  function lireBrouillon(emp) { try { return JSON.parse(localStorage.getItem(cleBrouillon(emp)) || '{}'); } catch (e) { return {}; } }
  function ecrireBrouillon() { try { localStorage.setItem(cleBrouillon(S.inv.emp), JSON.stringify(S.inv.d)); } catch (e) {} }
  function effacerBrouillon(emp) { try { localStorage.removeItem(cleBrouillon(emp)); } catch (e) {} }
  // Unité de saisie : unités d'usage, sauf réserve d'un article compté à la boîte entière
  function fInv(a, emp) { return emp === 0 ? facteur(a) : 1; }
  function uInv(a, emp) { return emp === 0 && facteur(a) === 1 && a.conditionnement === 'BOITE' ? 'boîte(s)' : 'u.'; }
  function theo(a, emp) { return nb(stockDe(a.id, emp) * fInv(a, emp)); }
  function choisirEmp(emp) { S.inv.emp = emp; S.inv.d = lireBrouillon(emp); S.inv.recap = false; S.inv.motifs = {}; S.inv.q = ''; S.inv.msg = null; }
  function listeInv() {
    var emp = S.inv.emp, q = norm(S.inv.q), d = S.inv.d;
    var tous = emp === 0 || S.inv.tous || !S.dernierInv[emp];
    return S.articles.filter(function (a) {
      if (!tous && !(stockDe(a.id, emp) > 0) && d[a.id] == null) return false;
      return !q || norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0;
    });
  }
  function nbComptes() { return Object.keys(S.inv.d).filter(function (k) { return S.inv.d[k] !== '' && S.inv.d[k] != null && S.byId[k]; }).length; }
  function vInventaire() {
    var I = S.inv, emp = I.emp, h = '<h2>Inventaire</h2>';
    if (I.msg) h += '<div class="ban ' + I.msg[0] + '" role="status">' + I.msg[1] + '</div>';
    if (j0Actif()) h += '<div class="ban j0">🚩 <b>Inventaire de départ (J0)</b> jusqu’au ' + S.j0.fin.split('-').reverse().slice(0, 2).join('/') + ' : les quantités comptées <b>remplacent</b> le stock, sans perte ni gain.' + (emp != null && j0Premier(emp) ? ' <b>Les articles non comptés de cet emplacement passeront à 0.</b>' : '') + (gestion() ? ' <button class="lnk" data-act="j0off">Terminer le J0</button>' : '') + '</div>';
    else if (gestion()) h += (I.j0ask ? '<div class="ban j0"><b>Lancer l’inventaire de départ (J0) ?</b><br>Pendant 7 jours, chaque inventaire remplacera directement le stock : aucune perte, aucun gain, aucun motif. Au premier comptage de chaque emplacement, les articles non comptés passeront à 0.<div class="row" style="margin-top:10px"><button class="btn l sm" data-act="j0non">Non</button><button class="btn sm" data-act="j0oui">Oui, lancer le J0</button></div></div>' : '<button class="btn l sm" style="margin-bottom:12px" data-act="j0ask">🚩 Lancer l’inventaire de départ (J0)</button>');
    var opts = (peutReserve() ? '<option value="0"' + (emp === 0 ? ' selected' : '') + '>Réserve</option>' : '') + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (emp === c ? ' selected' : '') + '>Cabinet ' + c + (S.me.cabinet === c ? ' (le mien)' : '') + '</option>'; }).join('');
    h += '<div class="card"><div class="g2"><label class="mu">Emplacement à compter<select class="in" id="iemp"><option value="">— Choisir —</option>' + opts + '</select></label>'
      + (emp != null ? '<label class="mu">Rechercher<input class="in" id="iq" type="search" placeholder="Nom ou référence" value="' + esc(I.q) + '"></label>' : '') + '</div>'
      + (emp != null && emp > 0 && S.me.cabinet && emp !== S.me.cabinet ? '<p class="ban warn" style="margin:10px 0 0">Ce n’est pas votre cabinet : l’inventaire sera enregistré « hors cabinet » (remplacement).</p>' : '')
      + (!peutReserve() ? '<p class="mu" style="margin:8px 0 0">L’inventaire de la réserve est fait par la responsable ou la référente (ou sur autorisation).</p>' : '') + '</div>';
    if (emp == null) return h;
    if (I.recap) return h + vRecap();
    var der = S.dernierInv[emp];
    h += '<p class="mu">' + (der ? 'Dernier inventaire : ' + new Date(der).toLocaleDateString('fr-FR') : 'Premier inventaire de cet emplacement : tous les articles sont listés, saisissez ceux qui sont présents.') + ' Votre saisie est gardée sur cet appareil jusqu’à la validation.</p>';
    if (emp > 0 && der) h += '<label class="row" style="margin:0 0 10px"><input type="checkbox" id="itous"' + (I.tous ? ' checked' : '') + ' style="width:20px;height:20px"> Afficher tous les articles (produit trouvé qui n’était pas prévu)</label>';
    var l = listeInv(), max = I.max || 80;
    if (!l.length) h += '<p class="mu">Aucun article.</p>';
    else h += '<div class="card">' + l.slice(0, max).map(function (a) {
      var v = I.d[a.id];
      return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + (a.reference && !estSR(a) ? '<span class="ref">' + esc(a.reference) + '</span>' : '') + '</b><span>en ' + uInv(a, emp) + (gestion() ? ' · théorique : ' + fr(theo(a, emp)) : '') + '</span></div>'
        + '<div class="stp"><button type="button" data-izero="' + a.id + '" class="zero" aria-label="Aucun">0</button><input inputmode="decimal" data-iq="' + a.id + '" value="' + esc(v == null ? '' : v) + '" placeholder="—" aria-label="Quantité comptée"></div></div>';
    }).join('') + '</div>';
    if (l.length > max) h += '<button class="btn l" style="width:100%" data-act="iplus">Afficher plus d’articles (' + (l.length - max) + ' restants)</button>';
    return h;
  }
  function ecartsInv() {
    var emp = S.inv.emp, out = [];
    Object.keys(S.inv.d).forEach(function (k) {
      var a = S.byId[k], s = S.inv.d[k]; if (!a || s === '' || s == null) return;
      var v = nb(String(s).replace(',', '.')), t = theo(a, emp);
      if (Math.abs(v - t) > 1e-9) out.push({ a: a, avant: t, apres: v });
    });
    return out;
  }
  function aZero() {
    var emp = S.inv.emp; if (!j0Premier(emp)) return [];
    return S.articles.filter(function (a) { return stockDe(a.id, emp) !== 0 && (S.inv.d[a.id] === '' || S.inv.d[a.id] == null); });
  }
  function vRecap() {
    var emp = S.inv.emp, E = ecartsInv(), Z = aZero(), motif = emp === 0 && !j0Actif();
    var h = '<div class="card"><b>Récapitulatif · ' + cabTxt(emp) + '</b><p class="mu" style="margin:4px 0 8px">' + nbComptes() + ' article(s) comptés · ' + E.length + ' écart(s)' + (Z.length ? ' · ' + Z.length + ' non comptés passeront à 0' : '') + '</p>';
    if (!E.length) h += '<p>Aucun écart : le stock correspond à votre comptage.</p>';
    else h += E.map(function (e) {
      return '<div class="it"><div class="it-n"><b>' + esc(e.a.nom) + '</b><span>' + fr(e.avant) + ' → <strong>' + fr(e.apres) + '</strong> ' + uInv(e.a, emp) + ' (' + (e.apres > e.avant ? '+' : '') + fr(e.apres - e.avant) + ')</span></div>'
        + (motif ? '<select class="in" style="max-width:200px" data-imotif="' + e.a.id + '"><option value="">Motif…</option>' + MOTIFS.map(function (m) { return '<option' + (S.inv.motifs[e.a.id] === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' : '') + '</div>';
    }).join('');
    if (Z.length) h += '<p class="ban warn" style="margin:10px 0 0">Inventaire de départ : ' + Z.length + ' article(s) présents dans le stock mais non comptés passeront à 0' + ' (' + Z.slice(0, 4).map(function (a) { return esc(a.nom); }).join(', ') + (Z.length > 4 ? '…' : '') + ').</p>';
    if (!motif && emp > 0 && E.length && !j0Actif()) h += '<p class="mu" style="margin:10px 0 0">Les écarts d’un cabinet sont enregistrés comme « utilisé au cabinet ».</p>';
    return h + '<div class="row" style="margin-top:12px"><button class="btn l" data-act="irevenir">Revenir au comptage</button><button class="btn" data-act="ivalider"' + (S.inv.busy ? ' disabled' : '') + '>Valider l’inventaire</button></div></div>';
  }
  function validerInv() {
    var I = S.inv, emp = I.emp, E = ecartsInv();
    if (emp === 0 && !j0Actif() && E.some(function (e) { return !I.motifs[e.a.id]; })) { toast('Choisissez un motif pour chaque écart de la réserve'); return; }
    var lignes = Object.keys(I.d).filter(function (k) { return S.byId[k] && I.d[k] !== '' && I.d[k] != null; }).map(function (k) {
      var a = S.byId[k], v = nb(String(I.d[k]).replace(',', '.'));
      return { article_id: +k, quantite: Math.round(v / fInv(a, emp) * 10000) / 10000, motif: I.motifs[k] || null };
    });
    if (!lignes.length && !aZero().length) { toast('Aucun article compté'); return; }
    I.busy = true; render();
    sb.rpc('compter_inventaire', { p_emplacement: emp, p_lignes: lignes }).then(function (r) {
      I.busy = false;
      if (r.error) { toast(msgErr(r.error)); render(); return; }
      var d = r.data || {};
      effacerBrouillon(emp); I.d = {}; I.recap = false; I.motifs = {};
      I.msg = ['ok', '✔ Inventaire ' + cabTxt(emp) + ' enregistré : ' + d.comptes + ' article(s) comptés, ' + d.modifies + ' modifié(s)' + (d.mis_a_zero ? ', ' + d.mis_a_zero + ' mis à 0' : '') + (d.j0 ? ' (inventaire de départ, sans impact financier)' : d.valeur ? ' · écart ' + eur(d.valeur) : '') + (d.hors_cabinet ? ' · hors cabinet' : '') + '.'];
      charger();
    });
  }
  function reglerJ0(on) {
    if (!on && !confirm('Terminer l’inventaire de départ ? Les inventaires suivants reprendront le fonctionnement normal (écarts et motifs).')) return;
    sb.rpc('regler_j0', { p_actif: on, p_jours: 7 }).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } S.j0 = r.data; S.inv.j0ask = false; toast(on ? '✔ Inventaire de départ lancé pour 7 jours' : '✔ Inventaire de départ terminé'); charger(); });
  }

  function vBarInv() { var n = nbComptes(); return '<div class="bar"><div class="bar-in"><span class="grow mu">' + n + ' article(s) comptés · ' + cabTxt(S.inv.emp) + '</span><button class="btn" data-act="iterminer"' + (n || aZero().length ? '' : ' disabled') + '>Terminer</button></div></div>'; }

  // ---------- Tableau de bord (gestion) ----------
  var STF = { commander: 'À commander', rupture: 'En rupture', sr: 'Sans référence', sf: 'Sans fournisseur', seuil: 'Sans seuil' };
  function estSR(a) { return !a.reference || /^\s*SR\s*$/i.test(a.reference); }
  function filtreStock(a, f) {
    var r = stockDe(a.id, 0), s = +a.seuil || 0;
    if (f === 'rupture') return !a.sans_seuil && s > 0 && r <= 0;
    if (f === 'commander') return !a.sans_seuil && s > 0 && r <= s; // inclut les ruptures
    if (f === 'sr') return estSR(a);
    if (f === 'sf') return !a.fournisseur_id;
    if (f === 'seuil') return !a.sans_seuil && !(s > 0);
    return true;
  }
  function ajouterMois(d) { var x = new Date(d); x.setMonth(x.getMonth() + 1); return x; }
  function etatInventaire(emp) {
    var der = S.dernierInv[emp];
    if (!der) return { cls: 'warn', txt: 'jamais compté', ordre: 1 };
    var ech = ajouterMois(der), j = Math.floor((ech - new Date()) / 864e5);
    if (j < 0) return { cls: 'ko', txt: 'en retard de ' + (-j) + ' j', ordre: 0, der: der };
    if (j <= 7) return { cls: 'warn', txt: 'à faire avant le ' + ech.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), ordre: 2, der: der };
    return { cls: 'ok', txt: 'à jour', ordre: 3, der: der };
  }
  function tuile(n, label, cls, go, sous) {
    return '<button class="tile ' + (cls || '') + '" data-go="' + go + '"><b>' + n + '</b><span>' + label + '</span>' + (sous ? '<small>' + sous + '</small>' : '') + '</button>';
  }
  function vAccueil() {
    var A = S.articles, cnt = {};
    Object.keys(STF).forEach(function (f) { cnt[f] = A.filter(function (a) { return filtreStock(a, f); }).length; });
    var valR = 0, valC = 0;
    A.forEach(function (a) { var cm = +a.cout_moyen || 0, f = facteur(a); valR += stockDe(a.id, 0) * cm; for (var c = 1; c <= 8; c++) valC += stockDe(a.id, c) / f * cm; });
    var heure = new Date().getHours(), bj = heure < 18 ? 'Bonjour' : 'Bonsoir';
    var h = '<h2>' + bj + ' ' + esc(S.me.nom) + '</h2>';
    // à traiter
    var att = S.attente.length, cmd = cnt.commander;
    h += '<div class="tiles">'
      + tuile(att, 'demande' + (att > 1 ? 's' : '') + ' à confirmer', att ? 'warn' : 'ok', 'demandes', att ? 'Sorties au-delà de la réserve' : 'Rien en attente')
      + tuile(cnt.rupture, 'en rupture', cnt.rupture ? 'ko' : 'ok', 'stock:rupture', 'Réserve à zéro')
      + tuile(cnt.commander, 'à commander', cnt.commander ? 'warn' : 'ok', 'stock:commander', cnt.rupture ? 'dont ' + cnt.rupture + ' en rupture' : 'Au seuil d’alerte ou en dessous')
      + tuile(eur(valR), 'valeur de la réserve', '', 'stock:', 'Cabinets : ' + eur(valC))
      + '</div>';
    // inventaires
    var emps = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (e) { var s = etatInventaire(e); s.emp = e; return s; });
    var aFaire = emps.filter(function (s) { return s.cls !== 'ok'; }).sort(function (a, b) { return a.ordre - b.ordre || a.emp - b.emp; });
    h += '<div class="card"><div class="row wrap" style="margin-bottom:6px"><b class="grow">🗓️ Inventaires mensuels</b><span class="mu">' + (aFaire.length ? aFaire.length + ' à faire' : 'tout est à jour') + '</span></div><div class="invs">'
      + emps.map(function (s) { return '<button class="inv ' + s.cls + '" data-go="inventaire:' + s.emp + '" title="' + (s.der ? 'Dernier : ' + new Date(s.der).toLocaleDateString('fr-FR') : 'Jamais compté') + '"><b>' + cabTxt(s.emp) + '</b>' + s.txt + '</button>'; }).join('') + '</div></div>';
    // commandes par fournisseur
    if (cmd) {
      var parF = {};
      A.filter(function (a) { return filtreStock(a, 'rupture') || filtreStock(a, 'commander'); }).forEach(function (a) { var f = S.fournisseurs[a.fournisseur_id] || 'Fournisseur à renseigner'; (parF[f] = parF[f] || []).push(a); });
      h += '<div class="card"><b>🛒 À commander par fournisseur</b>' + Object.keys(parF).sort().map(function (f) {
        return '<div class="it"><div class="it-n"><b>' + esc(f) + ' · ' + parF[f].length + ' article' + (parF[f].length > 1 ? 's' : '') + '</b><span>' + parF[f].slice(0, 6).map(function (a) { return esc(a.nom) + (stockDe(a.id, 0) <= 0 ? ' (rupture)' : ''); }).join(', ') + (parF[f].length > 6 ? '…' : '') + '</span></div></div>';
      }).join('') + '</div>';
    }
    // à compléter
    h += '<div class="card"><div class="row wrap"><b class="grow">🧩 Fiches à compléter</b></div><div class="chips">'
      + ['sr', 'sf', 'seuil'].map(function (f) { return '<button class="chip' + (cnt[f] ? ' warn' : '') + '" data-go="stock:' + f + '">' + STF[f] + ' · ' + cnt[f] + '</button>'; }).join('') + '</div></div>';
    // derniers mouvements
    var hors = S.recents.filter(function (m) { return m.hors_cabinet && new Date(m.cree_le) > new Date(Date.now() - 7 * 864e5); }).length;
    h += '<div class="card"><div class="row wrap" style="margin-bottom:4px"><b class="grow">🕘 Derniers mouvements de l’équipe</b>' + (hors ? '<span class="pill warn">' + hors + ' hors cabinet (7 j)</span>' : '') + '</div>';
    if (!S.recents.length) h += '<p class="mu" style="margin:6px 0 0">Aucun mouvement pour l’instant.</p>';
    else h += S.recents.slice(0, 12).map(function (m) {
      var a = S.byId[m.article_id] || { nom: '(article)' }, st = STAT[m.statut] || ['', m.statut];
      var lieu = m.type === 'sortie' || m.type === 'demande' ? ' → ' + cabTxt(m.emplacement_vers) : m.emplacement_de != null ? ' · ' + cabTxt(m.emplacement_de) : '';
      return '<div class="it"><div class="it-n"><b>' + (TYP[m.type] || m.type) + lieu + ' · ' + esc(a.nom) + ' × ' + fr(m.quantite) + '</b><span>' + quand(m.cree_le) + ' · ' + esc(m.auteur_nom || '') + '</span></div>'
        + (m.statut !== 'ok' ? '<span class="pill ' + st[0] + '">' + st[1] + '</span>' : '') + (m.hors_cabinet ? '<span class="pill warn">hors cabinet</span>' : '') + '</div>';
    }).join('') + '<div style="margin-top:8px"><button class="lnk" data-go="histo">Tout l’historique</button></div>';
    return h + '</div>';
  }

  // ---------- Stock (gestion) ----------
  function vStock() {
    var q = norm(S.stockQ), l = S.articles.filter(function (a) { return filtreStock(a, S.stockF) && (!q || norm(a.nom + ' ' + (a.reference || '') + ' ' + (S.fournisseurs[a.fournisseur_id] || '')).indexOf(q) >= 0); });
    var val = S.articles.reduce(function (t, a) { return t + stockDe(a.id, 0) * (+a.cout_moyen || 0); }, 0);
    var h = '<h2>Stock</h2><div class="card row wrap"><span class="grow"><b>' + S.articles.length + '</b> articles · valeur de la réserve <b>' + eur(val) + '</b></span>'
      + '<input class="in" style="max-width:320px" id="stq" type="search" placeholder="Rechercher" value="' + esc(S.stockQ) + '"></div>'
      + '<div class="chips" style="margin:0 0 10px"><button class="chip' + (!S.stockF ? ' on' : '') + '" data-go="stock:">Tous</button>' + Object.keys(STF).map(function (f) { return '<button class="chip' + (S.stockF === f ? ' on' : '') + '" data-go="stock:' + f + '">' + STF[f] + '</button>'; }).join('') + '</div>'
      + (S.stockF ? '<p class="mu">' + l.length + ' article(s) · ' + STF[S.stockF] + '</p>' : '');
    h += '<div class="scroll"><table class="tbl"><thead><tr><th>Article</th><th class="n">Réserve</th><th class="n">Cabinets</th><th>État</th></tr></thead><tbody>';
    h += l.slice(0, 300).map(function (a) {
      var r = stockDe(a.id, 0), cabs = 0, det = [];
      for (var c = 1; c <= 8; c++) { var v = stockDe(a.id, c); if (v) { cabs += v; det.push(c + ':' + fr(v)); } }
      var etat = a.sans_seuil ? '<span class="pill">sans seuil</span>' : !(+a.seuil > 0) ? '<span class="pill">seuil ?</span>' : r <= 0 ? '<span class="pill ko">rupture</span>' : r <= +a.seuil ? '<span class="pill warn">à commander</span>' : '<span class="pill ok">ok</span>';
      return '<tr><td>' + esc(a.nom) + '<span class="ref">' + esc(a.reference || '') + '</span><br><span class="mu" style="font-size:13px">' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + '</span></td><td class="n">' + fr(r) + ' ' + uRes(a) + '</td><td class="n" title="' + esc(det.join(' · ')) + '">' + (cabs ? fr(cabs) + ' u.' : '—') + '</td><td>' + etat + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    if (l.length > 300) h += '<p class="mu">300 premiers articles affichés : affinez la recherche.</p>';
    return h;
  }

  // ---------- Historique ----------
  var TYP = { sortie: 'Sortie', demande: 'Demande', transfert: 'Transfert', retour: 'Retour', reception: 'Réception', inventaire: 'Inventaire', regul: 'Régularisation', correction: 'Correction', annulation: 'Annulation' };
  var STAT = { ok: ['ok', 'ok'], attente: ['warn', 'en attente'], refuse: ['ko', 'refusée'], annule: ['', 'annulée'], corrige: ['', 'corrigée'] };
  function vHisto() {
    var h = '<h2>Historique</h2>';
    if (gestion()) h += '<div class="row" style="margin-bottom:10px"><label class="row"><input type="checkbox" id="htous"' + (S.histTous ? ' checked' : '') + ' style="width:20px;height:20px"> Toute l’équipe</label></div>';
    if (!S.histo.length) return h + '<p class="mu">Aucun mouvement pour l’instant.</p>';
    return h + '<div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th>Mouvement</th><th class="n">Qté</th><th>Par</th></tr></thead><tbody>' + S.histo.map(function (m) {
      var a = S.byId[m.article_id] || { nom: '(article)' }, st = STAT[m.statut] || ['', m.statut];
      var lieu = m.type === 'sortie' || m.type === 'demande' ? ' → ' + cabTxt(m.emplacement_vers) : m.emplacement_de != null ? ' · ' + cabTxt(m.emplacement_de) : '';
      return '<tr><td>' + quand(m.cree_le) + '</td><td>' + (TYP[m.type] || m.type) + lieu + ' · <b>' + esc(a.nom) + '</b> ' + (m.statut !== 'ok' ? '<span class="pill ' + st[0] + '">' + st[1] + '</span> ' : '') + (m.hors_cabinet ? '<span class="pill warn">hors cabinet</span>' : '') + (m.ecart ? '<br><span class="mu">écart ' + fr(m.ecart) + (m.valeur ? ' · ' + eur(m.valeur) : '') + '</span>' : '') + '</td><td class="n">' + fr(m.quantite) + '</td><td>' + esc(m.auteur_nom || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ---------- Articles (gestion) ----------
  var AF = { tous: 'Tous', sr: 'Sans référence', sf: 'Sans fournisseur', seuil: 'Sans seuil', archive: 'Archivés' };
  function vArticles() {
    if (S.fiche && S.fiche.type === 'article') return vFicheArticle();
    var q = norm(S.artQ), f = S.artF || 'tous';
    var base = f === 'archive' ? S.archives : S.articles;
    var l = base.filter(function (a) { return (f === 'tous' || f === 'archive' || filtreStock(a, f)) && (!q || norm(a.nom + ' ' + (a.reference || '') + ' ' + (S.fournisseurs[a.fournisseur_id] || '')).indexOf(q) >= 0); });
    var h = '<h2>Articles</h2><div class="card row wrap"><input class="in grow" id="aq" type="search" placeholder="Rechercher un article, une référence, un fournisseur" value="' + esc(S.artQ) + '"><button class="btn" data-act="anew">+ Nouvel article</button></div>'
      + '<div class="chips" style="margin:0 0 10px">' + Object.keys(AF).map(function (k) { return '<button class="chip' + (f === k ? ' on' : '') + '" data-af="' + k + '">' + AF[k] + '</button>'; }).join('') + '</div>'
      + '<p class="mu">' + l.length + ' article(s)</p>';
    h += '<div class="card">' + l.slice(0, S.artMax || 100).map(function (a) {
      return '<button class="it lrow" data-aopen="' + a.id + '"><span class="it-n"><b>' + esc(a.nom) + (a.reference && !estSR(a) ? '<span class="ref">' + esc(a.reference) + '</span>' : ' <span class="pill warn">SR</span>') + '</b><span>' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + ' · ' + condTxt(a) + ' · réserve ' + fr(stockDe(a.id, 0)) + ' ' + uRes(a) + '</span></span><span aria-hidden="true">›</span></button>';
    }).join('') + '</div>';
    if (l.length > (S.artMax || 100)) h += '<button class="btn l" style="width:100%" data-act="amore">Afficher plus</button>';
    return h;
  }
  function condTxt(a) { return a.conditionnement === 'BOITE' ? 'boîte de ' + fr(a.qte_par_boite) + (a.consommation === 'Unité' && +a.qte_par_boite > 1 ? ', sortie à l’unité' : ', sortie à la boîte') : 'à l’unité'; }
  function ouvrirArticle(id) {
    S.fiche = { type: 'article', id: id, edit: id === 'new', d: null, fo: [], hist: [], cor: null };
    if (id === 'new') { S.fiche.d = { nom: '', reference: 'SR', conditionnement: 'Unité', qte_par_boite: 1, consommation: 'Unité', conso_verifiee: false, seuil: 0, sans_seuil: false, cout_moyen: 0, prix: 0 }; render(); return; }
    render();
    Promise.all([
      sb.from('articles').select('*').eq('id', id).maybeSingle(),
      sb.from('article_fournisseurs').select('*').eq('article_id', id).order('rang'),
      sb.from('prix_historique').select('*').eq('article_id', id).order('date_prix', { ascending: false }).limit(20)
    ]).then(function (r) {
      if (!S.fiche || S.fiche.id !== id) return;
      if (r[0].error) { toast(msgErr(r[0].error)); return; }
      S.fiche.d = r[0].data; S.fiche.fo = r[1].data || []; S.fiche.hist = r[2].data || []; render();
    });
  }
  function optFo(sel, vide) { return (vide ? '<option value="">' + vide + '</option>' : '') + S.fournListe.filter(function (f) { return !f.archive || String(f.id) === String(sel); }).map(function (f) { return '<option value="' + f.id + '"' + (String(f.id) === String(sel) ? ' selected' : '') + '>' + esc(f.nom) + '</option>'; }).join(''); }
  function vFicheArticle() {
    var F = S.fiche, a = F.d;
    var h = '<button class="lnk" data-act="fclose">← Tous les articles</button>';
    if (!a) return h + '<p class="mu">Chargement…</p>';
    if (F.edit) return h + vEditArticle();
    var f = facteur(a), cabs = [1, 2, 3, 4, 5, 6, 7, 8].filter(function (c) { return stockDe(a.id, c); });
    h += '<div class="card"><div class="row wrap"><div class="grow"><h2 style="margin:0">' + esc(a.nom) + '</h2><span class="mu">Réf. ' + (a.reference && !estSR(a) ? esc(a.reference) : '<span class="pill warn">SR</span>') + ' · ' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + (a.archive ? ' · <span class="pill ko">archivé</span>' : '') + '</span></div><button class="btn" data-act="aedit">✏️ Modifier</button></div></div>';
    h += '<div class="card"><b>📦 Conditionnement et stock</b><dl class="dl">'
      + '<dt>Conditionnement</dt><dd>' + condTxt(a) + (a.conditionnement === 'BOITE' && +a.qte_par_boite > 1 && !a.conso_verifiee ? ' <span class="pill warn">consommation à vérifier</span>' : '') + '</dd>'
      + '<dt>Réserve</dt><dd>' + fr(stockDe(a.id, 0)) + ' ' + uRes(a) + (f > 1 ? ' (' + fr(stockDe(a.id, 0) * f) + ' u.)' : '') + '</dd>'
      + '<dt>Cabinets</dt><dd>' + (cabs.length ? cabs.map(function (c) { return 'cab. ' + c + ' : ' + fr(stockDe(a.id, c)) + ' u.'; }).join(' · ') : 'aucun') + '</dd>'
      + '<dt>Seuil d’alerte</dt><dd>' + (a.sans_seuil ? 'aucun (voulu)' : +a.seuil > 0 ? fr(a.seuil) + ' ' + uRes(a) : '<span class="pill warn">à renseigner</span>') + '</dd>'
      + '<dt>Coût moyen</dt><dd>' + eur(a.cout_moyen) + ' / ' + (a.conditionnement === 'BOITE' ? 'boîte' : 'unité') + '</dd></dl>'
      + (F.cor ? vCorrection() : '<button class="btn l sm" data-act="cor">🛠 Corriger les quantités sans impact financier</button>') + '</div>';
    h += '<div class="card"><b>🚚 Fournisseurs et prix</b>' + (F.fo.length ? F.fo.map(function (x) { return '<div class="it"><div class="it-n"><b>' + (x.rang === 0 ? '★ ' : '') + esc(S.fournisseurs[x.fournisseur_id] || '?') + '</b><span>' + (x.reference ? 'réf. ' + esc(x.reference) + ' · ' : '') + eur(x.prix) + '</span></div></div>'; }).join('') : '<p class="mu">Aucun fournisseur (SF).</p>') + '</div>';
    h += '<div class="card"><b>📈 Historique des prix</b>' + (F.hist.length ? '<div class="scroll"><table class="tbl"><tbody>' + F.hist.map(function (p) { return '<tr><td>' + p.date_prix.split('-').reverse().join('/') + '</td><td>' + esc(S.fournisseurs[p.fournisseur_id] || '') + '</td><td class="n">' + eur(p.prix) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="mu">Aucun prix enregistré.</p>') + '</div>';
    return h;
  }
  function vEditArticle() {
    var F = S.fiche, a = F.d, nouv = F.id === 'new';
    if (!F.foEdit) F.foEdit = F.fo.map(function (x) { return { fournisseur_id: x.fournisseur_id, prix: x.prix, reference: x.reference || '' }; });
    var h = '<div class="ban j0">✏️ <b>' + (nouv ? 'Nouvel article' : 'Modification') + '</b> : rien n’est enregistré tant que vous ne touchez pas « Enregistrer ».</div>';
    h += '<div class="card"><div class="g2">'
      + '<label class="mu">Nom<input class="in" data-af-f="nom" value="' + esc(a.nom) + '"></label>'
      + '<label class="mu">Référence (SR si aucune)<input class="in" data-af-f="reference" value="' + esc(a.reference || '') + '"></label>'
      + '<label class="mu">Livré<select class="in" data-af-f="conditionnement"><option value="Unité"' + (a.conditionnement === 'Unité' ? ' selected' : '') + '>À l’unité</option><option value="BOITE"' + (a.conditionnement === 'BOITE' ? ' selected' : '') + '>En boîte</option></select></label>'
      + '<label class="mu">Unités par boîte<input class="in" inputmode="decimal" data-af-f="qte_par_boite" value="' + esc(a.qte_par_boite) + '"></label>'
      + '<label class="mu">Sortie au cabinet<select class="in" data-af-f="consommation"><option value="Unité"' + (a.consommation === 'Unité' ? ' selected' : '') + '>À l’unité</option><option value="BOITE"' + (a.consommation === 'BOITE' ? ' selected' : '') + '>À la boîte entière</option></select></label>'
      + '<label class="mu">Seuil d’alerte de la réserve<input class="in" inputmode="decimal" data-af-f="seuil" value="' + esc(a.seuil) + '"' + (a.sans_seuil ? ' disabled' : '') + '></label>'
      + '</div><label class="row" style="margin-top:10px"><input type="checkbox" data-af-f="sans_seuil"' + (a.sans_seuil ? ' checked' : '') + ' style="width:20px;height:20px"> Article sans seuil (pas d’alerte même à zéro)</label>'
      + '<label class="row" style="margin-top:6px"><input type="checkbox" data-af-f="conso_verifiee"' + (a.conso_verifiee ? ' checked' : '') + ' style="width:20px;height:20px"> Consommation vérifiée</label></div>';
    h += '<div class="card"><b>🚚 Fournisseurs</b> <span class="mu">(★ le premier = principal)</span>' + F.foEdit.map(function (x, i) {
      return '<div class="row wrap" style="margin-top:8px"><span style="width:18px">' + (i === 0 ? '★' : '') + '</span><select class="in grow" data-fo-i="' + i + '" data-fo-k="fournisseur_id">' + optFo(x.fournisseur_id, 'Choisir…') + '</select>'
        + '<input class="in" style="width:110px" inputmode="decimal" placeholder="Prix €" data-fo-i="' + i + '" data-fo-k="prix" value="' + esc(x.prix || '') + '"><input class="in" style="width:130px" placeholder="Réf." data-fo-i="' + i + '" data-fo-k="reference" value="' + esc(x.reference || '') + '">'
        + (i > 0 ? '<button class="btn l sm" data-fotop="' + i + '" title="Mettre en principal">★</button>' : '') + '<button class="btn l sm" data-fodel="' + i + '" aria-label="Retirer">✕</button></div>';
    }).join('') + '<button class="btn l sm" style="margin-top:10px" data-act="foadd">+ Ajouter un fournisseur</button></div>';
    return h + '<div class="row"><button class="btn l" data-act="aannule">Annuler</button><button class="btn" data-act="asave"' + (F.busy ? ' disabled' : '') + '>Enregistrer</button>' + (!nouv ? '<span class="grow"></span><button class="btn l sm" data-act="aarch">' + (a.archive ? 'Réactiver' : 'Archiver') + '</button>' : '') + '</div>';
  }
  function sauverArticle() {
    var F = S.fiche, a = F.d, nouv = F.id === 'new';
    var o = { nom: String(a.nom || '').trim(), reference: String(a.reference || '').trim() || 'SR', conditionnement: a.conditionnement, qte_par_boite: Math.max(1, nb(a.qte_par_boite) || 1),
      consommation: a.consommation, seuil: a.sans_seuil ? 0 : Math.max(0, nb(a.seuil)), sans_seuil: !!a.sans_seuil, conso_verifiee: !!a.conso_verifiee };
    if (!o.nom) { toast('Le nom est obligatoire'); return; }
    var fo = F.foEdit.filter(function (x) { return x.fournisseur_id; });
    var vus = {}; fo = fo.filter(function (x) { if (vus[x.fournisseur_id]) return false; vus[x.fournisseur_id] = 1; return true; });
    o.fournisseur_id = fo.length ? +fo[0].fournisseur_id : null;
    if (o.reference.toUpperCase() !== 'SR' && S.articles.concat(S.archives).some(function (x) { return x.id !== F.id && String(x.reference || '').toUpperCase() === o.reference.toUpperCase(); })) { toast('Cette référence est déjà utilisée par un autre article'); return; }
    F.busy = true; render();
    var p = nouv ? sb.from('articles').insert(o).select().single() : sb.from('articles').update(o).eq('id', F.id).select().single();
    p.then(function (r) {
      if (r.error) throw r.error;
      var id = r.data.id, anciens = {}; F.fo.forEach(function (x) { anciens[x.fournisseur_id] = x; });
      var ops = [sb.from('article_fournisseurs').delete().eq('article_id', id)];
      return ops[0].then(function (d) {
        if (d.error) throw d.error;
        if (!fo.length) return id;
        var lignes = fo.map(function (x, i) { return { article_id: id, fournisseur_id: +x.fournisseur_id, prix: Math.max(0, nb(x.prix)), reference: x.reference || null, rang: i }; });
        var hist = lignes.filter(function (l) { var o2 = anciens[l.fournisseur_id]; return l.prix > 0 && (!o2 || nb(o2.prix) !== l.prix); }).map(function (l) { return { article_id: id, fournisseur_id: l.fournisseur_id, date_prix: aujourdhui(), prix: l.prix, source: 'Saisie dans la fiche' }; });
        return sb.from('article_fournisseurs').insert(lignes).then(function (r2) {
          if (r2.error) throw r2.error;
          var maj = { prix: lignes[0].prix }; if (nouv && lignes[0].prix) maj.cout_moyen = lignes[0].prix;
          return Promise.all([sb.from('articles').update(maj).eq('id', id), hist.length ? sb.from('prix_historique').upsert(hist, { onConflict: 'article_id,fournisseur_id,date_prix,prix', ignoreDuplicates: true }) : Promise.resolve({})]).then(function () { return id; });
        });
      });
    }).then(function (id) {
      toast(nouv ? '✔ Article créé' : '✔ Article enregistré'); S.fiche.busy = false; charger().then(function () { ouvrirArticle(id); });
    }).catch(function (e) { F.busy = false; toast(msgErr(e)); render(); });
  }
  function archiverArticle() {
    var a = S.fiche.d, v = !a.archive;
    if (v && !confirm('Archiver « ' + a.nom + ' » ? Il disparaîtra des sorties, de l’inventaire et des listes. Vous pourrez le réactiver depuis le filtre « Archivés ».')) return;
    sb.from('articles').update({ archive: v }).eq('id', a.id).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } toast(v ? 'Article archivé' : 'Article réactivé'); S.fiche = null; charger(); });
  }
  // Correction sans impact financier (double confirmation)
  function vCorrection() {
    var F = S.fiche, a = F.d, c = F.cor, f = facteur(a);
    if (c.etape === 2) {
      var ch = corChanges();
      return '<div class="ban ko" role="alert"><b>⚠️ Confirmez la correction</b><ul style="margin:6px 0 6px 18px;padding:0">' + ch.map(function (x) { return '<li>' + cabTxt(x.emp) + ' : ' + fr(x.avant) + ' → <strong>' + fr(x.apres) + '</strong></li>'; }).join('') + '</ul>Les quantités seront remplacées <b>sans perte ni gain</b> ; le coût moyen ne change pas. La correction reste tracée dans l’historique.'
        + '<div class="row" style="margin-top:10px"><button class="btn l sm" data-act="cor1">Non, revenir</button><button class="btn ko sm" data-act="corgo">Oui, corriger</button></div></div>';
    }
    return '<div class="card" style="border:2px dashed #b45309;margin-top:10px"><b>🛠 Correction sans impact financier</b><p class="mu" style="margin:4px 0 8px">Pour rectifier une erreur de saisie. Réserve en ' + (f > 1 ? 'boîtes' : uRes(a)) + ', cabinets en unités.</p><div class="g4">'
      + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (e) { return '<label class="mu">' + cabTxt(e) + '<input class="in" inputmode="decimal" data-cor="' + e + '" value="' + esc(c.v[e]) + '"></label>'; }).join('')
      + '</div><div class="row" style="margin-top:10px"><button class="btn l sm" data-act="corx">Annuler</button><button class="btn sm" data-act="cor2">Enregistrer la correction</button></div></div>';
  }
  function corChanges() { var a = S.fiche.d, c = S.fiche.cor, out = []; for (var e = 0; e <= 8; e++) { var v = Math.max(0, nb(String(c.v[e]).replace(',', '.'))), s = stockDe(a.id, e); if (Math.abs(v - s) > 1e-9) out.push({ emp: e, avant: s, apres: v }); } return out; }
  function corGo() {
    var a = S.fiche.d, ch = corChanges();
    Promise.all(ch.map(function (x) { return sb.rpc('fixer_stock', { p_article: a.id, p_emplacement: x.emp, p_quantite: x.apres, p_type: 'correction', p_motif: 'Correction sans impact financier' }); })).then(function (rs) {
      var e = rs.filter(function (r) { return r.error; })[0];
      if (e) { toast(msgErr(e.error)); return; }
      S.fiche.cor = null; toast('✔ Quantités corrigées, sans impact financier'); charger();
    });
  }

  // ---------- Fournisseurs (gestion) ----------
  var FOC = [['Compte client', [['n_client', 'N° de client']]], ['Contact', [['telephone', 'Téléphone', 'tel'], ['email', 'Email (commandes)', 'mail'], ['site_web', 'Site / lien de commande', 'web'], ['mode_commande', 'Mode de commande habituel']]],
    ['Commercial', [['commercial_nom', 'Nom'], ['commercial_tel', 'Portable', 'tel'], ['commercial_email', 'Email', 'mail']]],
    ['Conditions commerciales', [['franco', 'Franco de port'], ['minimum_commande', 'Minimum de commande'], ['remises', 'Remises négociées'], ['paiement', 'Délai / mode de paiement']]], ['Notes', [['notes', 'Notes', 'area']]]];
  function vFournisseurs() {
    if (S.fiche && S.fiche.type === 'fournisseur') return vFicheFo();
    var l = S.fournListe.filter(function (f) { return !!f.archive === !!S.foArch; });
    var h = '<h2>Fournisseurs</h2><div class="card row wrap"><span class="grow mu">Une fiche par fournisseur : compte client, contacts, commercial, conditions.</span><button class="btn" data-act="fonew">+ Nouveau fournisseur</button></div>'
      + '<label class="row" style="margin:0 0 10px"><input type="checkbox" id="foarch"' + (S.foArch ? ' checked' : '') + ' style="width:20px;height:20px"> Voir les fiches archivées</label>';
    return h + '<div class="card">' + (l.length ? l.map(function (f) {
      var na = S.articles.filter(function (a) { return a.fournisseur_id === f.id; }).length, manque = !f.n_client || !f.telephone || !f.email;
      return '<button class="it lrow" data-foopen="' + f.id + '"><span class="it-n"><b>' + esc(f.nom) + '</b><span>' + na + ' article(s) en principal' + (f.n_client ? ' · client n° ' + esc(f.n_client) : '') + (f.telephone ? ' · ' + esc(f.telephone) : '') + '</span></span>' + (manque ? '<span class="pill warn">à compléter</span>' : '<span class="pill ok">complète</span>') + '</button>';
    }).join('') : '<p class="mu">Aucune fiche.</p>') + '</div>';
  }
  function ouvrirFo(id) {
    var f = id === 'new' ? { nom: '' } : JSON.parse(JSON.stringify(S.fournListe.filter(function (x) { return x.id === id; })[0] || {}));
    S.fiche = { type: 'fournisseur', id: id, edit: id === 'new', d: f, cpt: null };
    render();
    if (id !== 'new') sb.from('fournisseur_comptes').select('*').eq('fournisseur_id', id).maybeSingle().then(function (r) { if (S.fiche && S.fiche.id === id) { S.fiche.cpt = r.data || {}; render(); } });
    else S.fiche.cpt = {};
  }
  function lienFo(t, v) {
    if (!v) return '<span class="mu">—</span>';
    if (t === 'tel') return '<a href="tel:' + esc(v.replace(/[^\d+]/g, '')) + '">📞 ' + esc(v) + '</a>';
    if (t === 'mail') return '<a href="mailto:' + esc(v) + '">✉️ ' + esc(v) + '</a>';
    if (t === 'web') return '<a target="_blank" rel="noopener" href="' + esc(/^https?:/.test(v) ? v : 'https://' + v) + '">🌐 ' + esc(v) + '</a>';
    return esc(v).replace(/\n/g, '<br>');
  }
  function vFicheFo() {
    var F = S.fiche, f = F.d, h = '<button class="lnk" data-act="fclose">← Tous les fournisseurs</button>';
    if (F.edit) {
      h += '<div class="ban j0">✏️ <b>' + (F.id === 'new' ? 'Nouveau fournisseur' : 'Modification') + '</b> : rien n’est enregistré tant que vous ne touchez pas « Enregistrer ».</div>';
      h += '<div class="card"><label class="mu">Nom du fournisseur<input class="in" data-fo-f="nom" value="' + esc(f.nom) + '"></label></div>';
      FOC.forEach(function (g) { h += '<div class="card"><b>' + g[0] + '</b><div class="g2" style="margin-top:6px">' + g[1].map(function (x) { return '<label class="mu">' + x[1] + (x[2] === 'area' ? '<textarea class="in" style="height:90px;padding:10px" data-fo-f="' + x[0] + '">' + esc(f[x[0]] || '') + '</textarea>' : '<input class="in" data-fo-f="' + x[0] + '" value="' + esc(f[x[0]] || '') + '">') + '</label>'; }).join('') + '</div></div>'; });
      h += '<div class="card"><b>🔐 Compte sur le site du fournisseur</b> <span class="mu">(visible seulement par la responsable et la référente)</span><div class="g2" style="margin-top:6px"><label class="mu">Identifiant<input class="in" data-cpt-f="identifiant" value="' + esc((F.cpt || {}).identifiant || '') + '"></label><label class="mu">Mot de passe<input class="in" data-cpt-f="mot_de_passe" value="' + esc((F.cpt || {}).mot_de_passe || '') + '"></label></div></div>';
      return h + '<div class="row"><button class="btn l" data-act="foannule">Annuler</button><button class="btn" data-act="fosave">Enregistrer</button>' + (F.id !== 'new' ? '<span class="grow"></span><button class="btn l sm" data-act="foarchive">' + (f.archive ? 'Réactiver' : 'Archiver') + '</button>' : '') + '</div>';
    }
    h += '<div class="card row wrap"><div class="grow"><h2 style="margin:0">' + esc(f.nom) + '</h2>' + (f.archive ? '<span class="pill ko">archivée</span>' : '') + '</div><button class="btn" data-act="foedit">✏️ Modifier</button></div>';
    FOC.forEach(function (g) { h += '<div class="card"><b>' + g[0] + '</b><dl class="dl">' + g[1].map(function (x) { return '<dt>' + x[1] + '</dt><dd>' + lienFo(x[2], f[x[0]]) + '</dd>'; }).join('') + '</dl></div>'; });
    var c = F.cpt;
    h += '<div class="card"><b>🔐 Compte sur le site du fournisseur</b>' + (c == null ? '<p class="mu">Chargement…</p>' : '<dl class="dl"><dt>Identifiant</dt><dd>' + (c.identifiant ? esc(c.identifiant) + ' <button class="btn l sm" data-copie="' + esc(c.identifiant) + '">📋</button>' : '<span class="mu">—</span>') + '</dd><dt>Mot de passe</dt><dd>' + (c.mot_de_passe ? esc(c.mot_de_passe) + ' <button class="btn l sm" data-copie="' + esc(c.mot_de_passe) + '">📋</button>' : '<span class="mu">—</span>') + '</dd></dl>') + '</div>';
    return h;
  }
  function sauverFo() {
    var F = S.fiche, f = F.d, o = { nom: String(f.nom || '').trim() };
    if (!o.nom) { toast('Le nom est obligatoire'); return; }
    FOC.forEach(function (g) { g[1].forEach(function (x) { o[x[0]] = String(f[x[0]] || '').trim() || null; }); });
    var p = F.id === 'new' ? sb.from('fournisseurs').insert(o).select().single() : sb.from('fournisseurs').update(o).eq('id', F.id).select().single();
    p.then(function (r) {
      if (r.error) { if (/duplicate|unique/i.test(r.error.message)) throw new Error('Un autre fournisseur porte déjà ce nom'); throw r.error; }
      var id = r.data.id, c = F.cpt || {};
      return sb.from('fournisseur_comptes').upsert({ fournisseur_id: id, identifiant: c.identifiant || null, mot_de_passe: c.mot_de_passe || null, modifie_le: new Date().toISOString() }).then(function (r2) { if (r2.error) throw r2.error; return id; });
    }).then(function (id) { toast('✔ Fiche fournisseur enregistrée'); charger().then(function () { ouvrirFo(id); }); })
      .catch(function (e) { toast(msgErr(e)); });
  }
  function archiverFo() {
    var f = S.fiche.d, v = !f.archive;
    sb.from('fournisseurs').update({ archive: v }).eq('id', f.id).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } toast(v ? 'Fiche archivée' : 'Fiche réactivée'); S.fiche = null; charger(); });
  }

  // ---------- Équipe (gestion) ----------
  function vEquipe() {
    var h = '<h2>Équipe</h2><p class="mu">Rôle, cabinet par défaut, activation, et autorisation temporaire d’inventaire de la réserve. La création des comptes depuis l’application arrive dans la prochaine livraison.</p>';
    return h + S.profils.map(function (p) {
      if (S.eqEdit === p.id) {
        return '<div class="card"><div class="g2">'
          + '<label class="mu">Prénom affiché<input class="in" id="enom" value="' + esc(p.nom) + '"></label>'
          + '<label class="mu">Rôle<select class="in" id="erole">' + ['assistante', 'referente', 'responsable'].map(function (r) { return '<option value="' + r + '"' + (p.role === r ? ' selected' : '') + '>' + LABEL[r] + '</option>'; }).join('') + '</select></label>'
          + '<label class="mu">Cabinet par défaut<select class="in" id="ecab"><option value="">Aucun</option>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (p.cabinet === c ? ' selected' : '') + '>Cabinet ' + c + '</option>'; }).join('') + '</select></label>'
          + '<label class="mu">Inventaire de la réserve autorisé jusqu’au<input class="in" type="date" id="eres" value="' + esc(p.reserve_jusquau || '') + '"></label>'
          + '</div><label class="row" style="margin:12px 0"><input type="checkbox" id="eact"' + (p.actif ? ' checked' : '') + ' style="width:20px;height:20px"> Compte actif</label>'
          + '<div class="row"><button class="btn l" data-act="eannule">Annuler</button><button class="btn" data-esave="' + p.id + '">Enregistrer</button></div></div>';
      }
      var res = p.reserve_jusquau && p.reserve_jusquau >= new Date().toISOString().slice(0, 10);
      return '<div class="card row wrap"><div class="grow"><b>' + esc(p.nom) + '</b> <span class="mu">(' + esc(p.identifiant) + ')</span><br><span class="mu">' + LABEL[p.role] + (p.cabinet ? ' · cabinet ' + p.cabinet : '') + (res ? ' · réserve autorisée jusqu’au ' + p.reserve_jusquau.split('-').reverse().join('/') : '') + '</span> ' + (p.actif ? '' : '<span class="pill ko">inactif</span>') + '</div>'
        + '<button class="btn l sm" data-eedit="' + p.id + '">Modifier</button></div>';
    }).join('');
  }
  function sauverProfil(id) {
    var o = { nom: $('enom').value.trim(), role: $('erole').value, cabinet: $('ecab').value ? +$('ecab').value : null, actif: $('eact').checked, reserve_jusquau: $('eres').value || null };
    if (!o.nom) { toast('Le prénom ne peut pas être vide'); return; }
    if (id === S.me.id && (!o.actif || o.role === 'assistante') && !confirm('Vous allez retirer vos propres droits de gestion. Continuer ?')) return;
    sb.from('profils').update(o).eq('id', id).select().then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      if (!r.data || !r.data.length) { toast('Modification refusée'); return; }
      S.eqEdit = null; toast('✔ Profil enregistré');
      if (id === S.me.id) S.me = r.data[0];
      charger();
    });
  }

  // ---------- Événements (délégation) ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || !S.me) return;
    var d = t.dataset;
    if (d.go) { var g = d.go.split(':'); S.tab = g[0]; S.tabChoisi = true; if (g[0] === 'stock') S.stockF = g[1] || ''; if (g[0] === 'inventaire' && g[1] !== undefined) choisirEmp(+g[1]); if (g[0] === 'histo') { S.histTous = true; chargerHisto(); } render(); window.scrollTo(0, 0); return; }
    if (d.tab) { S.fiche = null; S.tab = d.tab; S.tabChoisi = true; if (d.tab === 'histo') chargerHisto(); render(); window.scrollTo(0, 0); return; }
    if (d.act === 'out') { if (confirm('Changer de personne ? La personne suivante devra se connecter avec son identifiant et son code.')) deconnexion(); return; }
    if (d.act === 'valider') return validerSortie();
    if (d.act === 'vider') { S.sortie.panier = {}; render(); return; }
    if (d.plus) { setQte(d.plus, (S.sortie.panier[d.plus] || 0) + 1); S.sortie.msg = null; render(); return; }
    if (d.moins) { setQte(d.moins, (S.sortie.panier[d.moins] || 0) - 1); render(); return; }
    if (d.izero) { S.inv.d[d.izero] = '0'; ecrireBrouillon(); render(); return; }
    if (d.act === 'iterminer') { S.inv.recap = true; render(); window.scrollTo(0, 0); return; }
    if (d.act === 'irevenir') { S.inv.recap = false; render(); return; }
    if (d.act === 'ivalider') return validerInv();
    if (d.act === 'iplus') { S.inv.max = (S.inv.max || 80) + 100; render(); return; }
    if (d.act === 'j0ask') { S.inv.j0ask = true; render(); return; }
    if (d.act === 'j0non') { S.inv.j0ask = false; render(); return; }
    if (d.act === 'j0oui') return reglerJ0(true);
    if (d.act === 'j0off') return reglerJ0(false);
    if (d.confirmer) return traiter(+d.confirmer, true);
    if (d.refuser) return traiter(+d.refuser, false);
    if (d.eedit) { S.eqEdit = d.eedit; render(); return; }
    if (d.af) { S.artF = d.af; S.artMax = 100; render(); return; }
    if (d.aopen) { ouvrirArticle(+d.aopen); window.scrollTo(0, 0); return; }
    if (d.act === 'anew') { ouvrirArticle('new'); return; }
    if (d.act === 'amore') { S.artMax += 100; render(); return; }
    if (d.act === 'fclose') { S.fiche = null; render(); return; }
    if (d.act === 'aedit') { S.fiche.edit = true; S.fiche.d = JSON.parse(JSON.stringify(S.fiche.d)); S.fiche.foEdit = null; render(); return; }
    if (d.act === 'aannule') { if (S.fiche.id === 'new') S.fiche = null; else { var id0 = S.fiche.id; ouvrirArticle(id0); } render(); return; }
    if (d.act === 'asave') return sauverArticle();
    if (d.act === 'aarch') return archiverArticle();
    if (d.act === 'foadd') { S.fiche.foEdit.push({ fournisseur_id: '', prix: '', reference: '' }); render(); return; }
    if (d.fodel) { S.fiche.foEdit.splice(+d.fodel, 1); render(); return; }
    if (d.fotop) { var x0 = S.fiche.foEdit.splice(+d.fotop, 1)[0]; S.fiche.foEdit.unshift(x0); render(); return; }
    if (d.act === 'cor') { var a0 = S.fiche.d, v0 = {}; for (var e0 = 0; e0 <= 8; e0++) v0[e0] = fr(stockDe(a0.id, e0)); S.fiche.cor = { etape: 1, v: v0 }; render(); return; }
    if (d.act === 'corx') { S.fiche.cor = null; render(); return; }
    if (d.act === 'cor2') { if (!corChanges().length) { toast('Aucune quantité modifiée'); return; } S.fiche.cor.etape = 2; render(); return; }
    if (d.act === 'cor1') { S.fiche.cor.etape = 1; render(); return; }
    if (d.act === 'corgo') return corGo();
    if (d.foopen) { ouvrirFo(+d.foopen); window.scrollTo(0, 0); return; }
    if (d.act === 'fonew') { ouvrirFo('new'); return; }
    if (d.act === 'foedit') { S.fiche.edit = true; S.fiche.d = JSON.parse(JSON.stringify(S.fiche.d)); S.fiche.cpt = JSON.parse(JSON.stringify(S.fiche.cpt || {})); render(); return; }
    if (d.act === 'foannule') { if (S.fiche.id === 'new') S.fiche = null; else ouvrirFo(S.fiche.id); render(); return; }
    if (d.act === 'fosave') return sauverFo();
    if (d.act === 'foarchive') return archiverFo();
    if (d.copie != null) { try { navigator.clipboard.writeText(d.copie).then(function () { toast('✔ Copié'); }); } catch (er) { toast('Copie impossible'); } return; }
    if (d.act === 'eannule') { S.eqEdit = null; render(); return; }
    if (d.esave) return sauverProfil(d.esave);
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.id === 'sq') { S.sortie.q = t.value; S.sortie.msg = null; render(); }
    else if (t.id === 'stq') { S.stockQ = t.value; render(); }
    else if (t.id === 'aq') { S.artQ = t.value; S.artMax = 100; render(); }
    else if (t.dataset && t.dataset.afF && S.fiche) { S.fiche.d[t.dataset.afF] = t.type === 'checkbox' ? t.checked : t.value; if (t.type === 'checkbox') render(); }
    else if (t.dataset && t.dataset.foI != null && S.fiche) { S.fiche.foEdit[+t.dataset.foI][t.dataset.foK] = t.value; }
    else if (t.dataset && t.dataset.foF && S.fiche) { S.fiche.d[t.dataset.foF] = t.value; }
    else if (t.dataset && t.dataset.cptF && S.fiche) { (S.fiche.cpt = S.fiche.cpt || {})[t.dataset.cptF] = t.value; }
    else if (t.dataset && t.dataset.cor != null && S.fiche && S.fiche.cor) { S.fiche.cor.v[t.dataset.cor] = t.value; }
    else if (t.id === 'iq') { S.inv.q = t.value; S.inv.max = 80; render(); }
    else if (t.dataset && t.dataset.iq) { S.inv.d[t.dataset.iq] = t.value.trim(); ecrireBrouillon(); var b2 = document.querySelector('.bar'); if (b2) b2.outerHTML = vBarInv(); }
    else if (t.dataset && t.dataset.qte) { setQte(t.dataset.qte, t.value); var b = document.querySelector('.bar'); if (b) b.outerHTML = vBarSortie(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.id === 'scab') { S.sortie.cab = +t.value; render(); }
    else if (t.id === 'foarch') { S.foArch = t.checked; render(); }
    else if (t.dataset && (t.dataset.afF || t.dataset.foK) && S.fiche) { if (t.dataset.afF) S.fiche.d[t.dataset.afF] = t.type === 'checkbox' ? t.checked : t.value; else S.fiche.foEdit[+t.dataset.foI][t.dataset.foK] = t.value; if (t.tagName === 'SELECT' || t.type === 'checkbox') render(); }
    else if (t.id === 'iemp') { if (t.value === '') { S.inv.emp = null; } else choisirEmp(+t.value); render(); }
    else if (t.id === 'itous') { S.inv.tous = t.checked; render(); }
    else if (t.dataset && t.dataset.imotif) { S.inv.motifs[t.dataset.imotif] = t.value; }
    else if (t.id === 'htous') { S.histTous = t.checked; chargerHisto(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.me) charger(); });

  // ---------- Démarrage ----------
  sb.auth.getSession().then(function (r) { if (r.data.session) demarrer(r.data.session); else render(); });
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === 'SIGNED_OUT') { S.session = null; S.me = null; render(); } else if (session) S.session = session; });
})();
