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
    ret: { cab: null, q: '', panier: {}, msg: null, busy: false },
    stockQ: '', stockF: '', histTous: false, eqEdit: null, pwAbc: false, dernierInv: {}, recents: [], j0: null, invJ0: {}, fiche: null, artQ: '', artF: 'tous', artMax: 100, archives: [], fournListe: [], foArch: false, commandes: [], lignes: {}, afPrix: {}, cmdSub: 'sug', sugQ: {}, sugOpen: {}, alias: {}, nc: { fid: '', num: '', q: '', l: [] },
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
    if (/banned/i.test(m)) return 'Ce compte est désactivé. Voyez la référente ou la responsable.';
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
  // À chaque changement de personne : on repart de zéro (cabinet par défaut, panier, inventaire, écrans ouverts)
  function oublierPersonne() {
    S.session = null; S.me = null; S.tab = 'sortie'; S.tabChoisi = false; S.fiche = null; S.eqEdit = null; S.eqNew = null; S.cmBusy = false; S.histTous = false; S.histo = [];
    S.sortie = { cab: null, q: '', panier: {}, msg: null, busy: false };
    S.ret = { cab: null, q: '', panier: {}, msg: null, busy: false };
    S.inv = { emp: null, d: {}, q: '', tous: false, recap: false, motifs: {}, busy: false, msg: null, max: 80 };
  }
  function deconnexion() { sb.auth.signOut().then(function () { oublierPersonne(); render(); }); }

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
      + '<div class="lg-foot">Accès réservé au personnel du centre · 01 85 12 00 85<br><small>Version ' + esc(C.version || '') + '</small></div></div></div>';
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
      if (S.ret.cab == null) S.ret.cab = S.me.cabinet || 1;
      if (!gestion() && ['sortie', 'retour', 'inventaire', 'histo', 'compte'].indexOf(S.tab) < 0) S.tab = 'sortie';
      if (S.inv.emp == null && S.me.cabinet) choisirEmp(S.me.cabinet);
      if (gestion() && !S.tabChoisi) S.tab = 'accueil';
      S.histTous = gestion();
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
      sb.from('parametres').select('cle,valeur').in('cle', ['j0', 'alias_refs', 'derniere_sauvegarde']).then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('inventaires').select('emplacement,date_inv,j0').order('date_inv', { ascending: false }).limit(500).then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('mouvements').select('*').order('cree_le', { ascending: false }).limit(30).then(function (r) { if (r.error) throw r.error; return r.data; }),
      toutLire('article_fournisseurs', 'article_id,fournisseur_id,prix,reference,rang'),
      gestion() ? chargerCommandes() : Promise.resolve()
    ];
    return Promise.all(ps).then(function (x) {
      S.articles = x[0].filter(function (a) { return !a.archive; }); S.archives = x[0].filter(function (a) { return a.archive; }); S.byId = {}; x[0].forEach(function (a) { S.byId[a.id] = a; });
      S.stocks = {}; x[1].forEach(function (s) { (S.stocks[s.article_id] = S.stocks[s.article_id] || {})[s.emplacement] = +s.quantite; });
      S.fournisseurs = {}; x[2].forEach(function (f) { S.fournisseurs[f.id] = f.nom; }); S.fournListe = x[2];
      S.profils = x[3]; S.attente = x[4];
      var pj = x[5].filter(function (p) { return p.cle === 'j0'; })[0], pa = x[5].filter(function (p) { return p.cle === 'alias_refs'; })[0];
      S.j0 = pj ? pj.valeur : null; S.alias = pa ? pa.valeur : {};
      var ps2 = x[5].filter(function (p) { return p.cle === 'derniere_sauvegarde'; })[0]; S.sauv = ps2 ? ps2.valeur : null;
      S.dernierInv = {}; S.invJ0 = {}; x[6].forEach(function (i) { if (!S.dernierInv[i.emplacement]) S.dernierInv[i.emplacement] = i.date_inv; if (i.j0 && S.j0 && S.j0.debut && i.date_inv.slice(0, 10) >= S.j0.debut) S.invJ0[i.emplacement] = true; });
      S.recents = x[7];
      S.afPrix = {}; (x[8] || []).forEach(function (p) { (S.afPrix[p.article_id] = S.afPrix[p.article_id] || []).push(p); });
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
    var tabs = gestion() ? [['accueil', 'Accueil'], ['sortie', 'Sortie'], ['retour', 'Retour'], ['inventaire', 'Inventaire']] : [['sortie', 'Sortie'], ['retour', 'Retour'], ['inventaire', 'Inventaire']];
    if (gestion()) tabs.push(['demandes', 'Demandes' + (S.attente.length ? '<span class="badge">' + S.attente.length + '</span>' : '')], ['stock', 'Stock'], ['commandes', 'Commandes'], ['articles', 'Articles'], ['fournisseurs', 'Fournisseurs']);
    tabs.push(['histo', 'Historique']);
    if (gestion()) tabs.push(['equipe', 'Équipe'], ['plus', 'Plus']);
    var h = '<header class="top"><div class="top-in"><img src="assets/logo-evydent.jpg" alt="">'
      + '<div class="top-who"><b>' + esc(S.me.nom) + (C.env === 'dev' ? ' <span class="env">TEST</span>' : '') + '</b><span>' + LABEL[S.me.role] + (S.me.cabinet ? ' · cabinet ' + S.me.cabinet : '') + '</span></div>'
      + '<button class="btn l sm" data-tab="compte" title="Changer mon code" aria-label="Changer mon code">🔑</button><button class="btn l sm" data-act="out">Changer de personne</button></div>'
      + '<nav class="tabs" aria-label="Menu">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav></header>';
    if (S.nouvelleVersion) h += '<div class="ban ok" style="max-width:1100px;margin:10px auto 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1">Une nouvelle version de l’application est disponible (' + esc(S.nouvelleVersion) + ').</span><button class="btn sm" data-act="maj">Mettre à jour</button></div>';
    h += '<main>' + (S.loading ? '<p class="mu">Mise à jour…</p>' : '') + ({ accueil: vAccueil, sortie: vSortie, inventaire: vInventaire, demandes: vDemandes, stock: vStock, histo: vHisto, equipe: vEquipe, articles: vArticles, fournisseurs: vFournisseurs, commandes: vCommandes, compte: vCompte, retour: vRetour, plus: vPlus }[S.tab] || vSortie)() + '</main>';
    h += '<p class="mu" style="text-align:center;font-size:12px;margin:0 0 90px">Version ' + esc(C.version || '') + '</p>';
    h += (S.tab === 'sortie' ? vBarSortie() : S.tab === 'retour' ? vBarRetour() : S.tab === 'inventaire' && S.inv.emp != null && !S.inv.recap ? vBarInv() : '');
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
  // ---------- Retour d'un cabinet vers la réserve (tout le monde) ----------
  // Saisie dans l'unité de la réserve, en entiers : boîtes fermées pour un article rangé en boîte.
  function vRetour() {
    var s = S.ret, hors = S.me.cabinet && +s.cab !== +S.me.cabinet;
    var h = '<h2>Retour en réserve</h2><p class="mu" style="margin-top:-6px">Articles non utilisés qui repartent du cabinet vers la réserve. Pour un article rangé en boîte, seules les <b>boîtes fermées</b> reviennent ; les unités en vrac restent au cabinet.</p>';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    h += '<div class="card"><div class="g2"><label class="mu">Depuis le cabinet<select class="in" id="rcab">'
      + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (+s.cab === c ? ' selected' : '') + '>Cabinet ' + c + (S.me.cabinet === c ? ' (le mien)' : '') + '</option>'; }).join('')
      + '</select></label><label class="mu">Rechercher un article<input class="in" id="rq" type="search" placeholder="Nom ou référence" value="' + esc(s.q) + '"></label></div>'
      + (hors ? '<p class="ban warn" style="margin:10px 0 0">Ce n’est pas votre cabinet : le retour sera enregistré « hors cabinet » (remplacement).</p>' : '') + '</div>';
    var q = norm(s.q), ids = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; });
    var liste = q ? S.articles.filter(function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }).slice(0, 40)
                  : ids.map(function (k) { return S.byId[k]; }).filter(Boolean);
    if (!liste.length) return h + '<p class="mu">' + (q ? 'Aucun article trouvé.' : 'Tapez le nom d’un article pour l’ajouter au retour.') + '</p>';
    return h + '<div class="card">' + liste.map(function (a) {
      var v = s.panier[a.id] || 0, f = facteur(a), cab = stockDe(a.id, +s.cab), boites = f > 1 ? Math.floor(cab / f + 1e-9) : null, trop = f > 1 ? v > boites : v > cab;
      return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + (a.reference && a.reference !== 'SR' ? '<span class="ref">' + esc(a.reference) + '</span>' : '') + '</b>'
        + '<span class="' + (trop ? 'pill warn' : '') + '">Au cabinet ' + s.cab + ' : ' + fr(cab) + ' u.' + (f > 1 ? ' (' + boites + ' boîte(s) entière(s) de ' + fr(a.qte_par_boite) + ')' : '') + (trop ? ' · plus que le stock enregistré' : '') + '</span>'
        + '<span style="display:block;font-weight:600;color:var(--ink2)">Retour en ' + (f > 1 || a.conditionnement === 'BOITE' ? 'boîtes' : 'unités') + '</span></div>'
        + '<div class="stp"><button type="button" data-rmoins="' + a.id + '" aria-label="Moins un">−</button><input inputmode="numeric" data-rqte="' + a.id + '" value="' + (v || '') + '" placeholder="0" aria-label="Quantité"><button type="button" data-rplus="' + a.id + '" aria-label="Plus un">+</button></div></div>';
    }).join('') + '</div>';
  }
  function vBarRetour() {
    var n = Object.keys(S.ret.panier).filter(function (k) { return S.ret.panier[k] > 0; }).length;
    return '<div class="bar"><div class="bar-in"><span class="grow mu">' + (n ? n + ' article(s) · depuis le cabinet ' + S.ret.cab : 'Aucun article') + '</span>'
      + (n ? '<button class="btn l" data-act="rvider">Vider</button>' : '') + '<button class="btn" data-act="rvalider"' + (n && !S.ret.busy ? '' : ' disabled') + '>Valider le retour</button></div></div>';
  }
  function setRet(id, v) { v = Math.max(0, Math.floor(nb(String(v).replace(',', '.')) || 0)); if (v) S.ret.panier[id] = v; else delete S.ret.panier[id]; }
  function validerRetour() {
    var s = S.ret, lignes = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; }).map(function (k) { return { article_id: +k, quantite: s.panier[k] }; });
    if (!lignes.length || s.busy) return;
    s.busy = true; render();
    sb.rpc('retour_reserve', { p_cabinet: +s.cab, p_lignes: lignes }).then(function (r) {
      s.busy = false;
      if (r.error) { s.msg = ['ko', esc(msgErr(r.error))]; render(); return; }
      var d = r.data || {}, m = ['✔ ' + d.retours + ' article(s) retourné(s) en réserve depuis le cabinet ' + s.cab + '.'];
      if (d.ecarts) m.push('Pour ' + d.ecarts + ' article(s), le stock enregistré du cabinet était plus bas : il est mis à 0 (le prochain inventaire du cabinet corrigera).');
      if (d.hors_cabinet) m.push('Enregistré « hors cabinet ».');
      s.msg = [d.ecarts ? 'warn' : 'ok', m.join(' ')]; s.panier = {}; s.q = '';
      charger();
    });
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
    if (emp === 0 && !I.recap && peutReserve()) h += '<div class="row wrap" style="margin:0 0 10px"><button class="btn l sm" data-act="iexp">⬇️ Fichier de comptage Excel</button><label class="btn l sm" style="display:inline-flex;align-items:center">⬆️ Importer le comptage<input type="file" id="iimpf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label></div>';
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
    if (f === 'commander') return !a.sans_seuil && s > 0 && r <= s && r + enCoursPour(a.id) <= s; // inclut les ruptures, sauf si une commande en cours suffit
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
    if (sauvegardeEnRetard()) h += '<div class="ban warn row wrap"><span class="grow">💾 ' + (S.sauv && S.sauv.date ? 'Dernière sauvegarde il y a ' + joursDepuis(S.sauv.date) + ' jours : pensez à la sauvegarde du mois.' : 'Aucune sauvegarde téléchargée pour l’instant.') + '</span><button class="btn sm" data-act="sauver"' + (S.sauvBusy ? ' disabled' : '') + '>' + (S.sauvBusy ? 'Préparation…' : 'Télécharger la sauvegarde') + '</button></div>';
    // à traiter
    var att = S.attente.length, cmd = cnt.commander;
    h += '<div class="tiles">'
      + tuile(att, 'demande' + (att > 1 ? 's' : '') + ' à confirmer', att ? 'warn' : 'ok', 'demandes', att ? 'Sorties au-delà de la réserve' : 'Rien en attente')
      + tuile(cnt.rupture, 'en rupture', cnt.rupture ? 'ko' : 'ok', 'stock:rupture', 'Réserve à zéro')
      + tuile(cnt.commander, 'à commander', cnt.commander ? 'warn' : 'ok', 'stock:commander', (function () { var n = A.filter(function (a) { return filtreStock(a, 'commander') && stockDe(a.id, 0) <= 0; }).length; return n ? 'dont ' + n + ' en rupture' : 'Au seuil d’alerte ou en dessous'; })())
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
      A.filter(function (a) { return filtreStock(a, 'commander'); }).forEach(function (a) { var f = S.fournisseurs[a.fournisseur_id] || 'Fournisseur à renseigner'; (parF[f] = parF[f] || []).push(a); });
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
      var a = S.byId[m.article_id] || { nom: m.article_nom ? m.article_nom + ' (supprimé)' : '(article)' }, st = STAT[m.statut] || ['', m.statut];
      var lieu = m.type === 'retour' ? ' ' + cabTxt(m.emplacement_de) + ' → réserve' : m.type === 'sortie' || m.type === 'demande' ? ' → ' + cabTxt(m.emplacement_vers) : m.emplacement_de != null ? ' · ' + cabTxt(m.emplacement_de) : '';
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
    h += gestion() ? '<div class="row" style="margin-bottom:10px"><label class="row"><input type="checkbox" id="htous"' + (S.histTous ? ' checked' : '') + ' style="width:20px;height:20px"> Toute l’équipe</label>' + (S.histTous ? '' : '<span class="mu">(seulement vos mouvements)</span>') + '</div>' : '<p class="mu" style="margin-top:-6px">Vos derniers mouvements.</p>';
    if (!S.histo.length) return h + '<p class="mu">Aucun mouvement pour l’instant.</p>';
    return h + '<div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th>Mouvement</th><th class="n">Qté</th><th>Par</th></tr></thead><tbody>' + S.histo.map(function (m) {
      var a = S.byId[m.article_id] || { nom: m.article_nom ? m.article_nom + ' (supprimé)' : '(article)' }, st = STAT[m.statut] || ['', m.statut];
      var lieu = m.type === 'retour' ? ' ' + cabTxt(m.emplacement_de) + ' → réserve' : m.type === 'sortie' || m.type === 'demande' ? ' → ' + cabTxt(m.emplacement_vers) : m.emplacement_de != null ? ' · ' + cabTxt(m.emplacement_de) : '';
      return '<tr><td>' + quand(m.cree_le) + '</td><td>' + (TYP[m.type] || m.type) + lieu + ' · <b>' + esc(a.nom) + '</b> ' + (m.statut !== 'ok' ? '<span class="pill ' + st[0] + '">' + st[1] + '</span> ' : '') + (m.hors_cabinet ? '<span class="pill warn">hors cabinet</span>' : '') + (m.ecart ? '<br><span class="mu">écart ' + fr(m.ecart) + (m.valeur ? ' · ' + eur(m.valeur) : '') + '</span>' : '') + '</td><td class="n">' + (m.type === 'retour' && m.quantite_reserve != null && +m.quantite_reserve !== +m.quantite ? fr(m.quantite_reserve) + ' boîte(s)<br><small class="mu">' + fr(m.quantite) + ' u.</small>' : fr(m.quantite)) + '</td><td>' + esc(m.auteur_nom || '') + '</td></tr>';
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
      + '<div class="row wrap" style="margin:0 0 10px"><button class="btn l sm" data-act="aexp">⬇️ Exporter Excel</button><label class="btn l sm" style="display:inline-flex;align-items:center">⬆️ Importer Excel<input type="file" id="aimpf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label><span class="mu">Modifier les fiches en masse</span></div>'
      + (S.artImp ? vImportArticles() : '')
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
  // Synthèse : y a-t-il du stock de cet article quelque part ?
  function synthStock(a) {
    var f = facteur(a), r = stockDe(a.id, 0), cabs = [1, 2, 3, 4, 5, 6, 7, 8].filter(function (c) { return Math.abs(stockDe(a.id, c)) > 1e-9; });
    if (Math.abs(r) < 1e-9 && !cabs.length) return '<div class="ban ok">📦 <b>Aucun stock</b> : réserve et cabinets à 0.</div>';
    var uc = cabs.reduce(function (t, c) { return t + stockDe(a.id, c); }, 0), cm = +a.cout_moyen || 0, val = r * cm + uc / f * cm, parts = [];
    if (Math.abs(r) > 1e-9) parts.push(fr(r) + ' ' + uRes(a) + ' en réserve');
    if (cabs.length) parts.push(fr(uc) + ' u. dans ' + cabs.length + ' cabinet' + (cabs.length > 1 ? 's' : '') + ' (' + cabs.map(function (c) { return c; }).join(', ') + ')');
    return '<div class="ban warn">📦 <b>En stock</b> : ' + parts.join(' + ') + (cm ? ' · valeur ≈ ' + eur(val) : '') + '.</div>';
  }
  function vFicheArticle() {
    var F = S.fiche, a = F.d;
    var h = '<button class="lnk" data-act="fclose">← Tous les articles</button>';
    if (!a) return h + '<p class="mu">Chargement…</p>';
    if (F.edit) return h + synthStock(a) + vEditArticle();
    var f = facteur(a), cabs = [1, 2, 3, 4, 5, 6, 7, 8].filter(function (c) { return stockDe(a.id, c); });
    h += '<div class="card"><div class="row wrap"><div class="grow"><h2 style="margin:0">' + esc(a.nom) + '</h2><span class="mu">Réf. ' + (a.reference && !estSR(a) ? esc(a.reference) : '<span class="pill warn">SR</span>') + ' · ' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + (a.archive ? ' · <span class="pill ko">archivé</span>' : '') + '</span></div><button class="btn" data-act="aedit">✏️ Modifier</button></div></div>';
    h += synthStock(a);
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
    return h + '<div class="row"><button class="btn l" data-act="aannule">Annuler</button><button class="btn" data-act="asave"' + (F.busy ? ' disabled' : '') + '>Enregistrer</button>' + (!nouv ? '<span class="grow"></span><button class="btn l sm" data-act="aarch">' + (a.archive ? 'Réactiver' : 'Archiver') + '</button><button class="btn ko sm" data-act="asuppr">🗑 Supprimer</button>' : '') + '</div>';
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
  function stockPartout(id) { var t = []; for (var e = 0; e <= 8; e++) { var q = stockDe(id, e); if (Math.abs(q) > 1e-9) t.push(cabTxt(e) + ' : ' + fr(q)); } return t; }
  function supprimerArticle() {
    var a = S.byId[S.fiche.id] || S.fiche.d, st = stockPartout(a.id);
    if (st.length) { toast('Suppression impossible : il reste du stock (' + st.join(', ') + '). Mettez-le à 0 par un inventaire ou une correction.'); return; }
    if (!confirm('Supprimer définitivement « ' + a.nom + ' » ?\n\n• La fiche, ses prix par fournisseur et son historique de prix sont effacés.\n• Les mouvements passés restent dans l’historique, sous son nom.\n\nCette suppression est définitive. Pour simplement le masquer, utilisez « Archiver ».')) return;
    var t = prompt('Pour confirmer, tapez le nom de l’article : ' + a.nom);
    if (t == null) return;
    if (norm(t.trim()) !== norm(a.nom.trim())) { toast('Nom différent : suppression annulée'); return; }
    sb.rpc('supprimer_article', { p_article: a.id }).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      toast('✔ « ' + a.nom + ' » supprimé'); S.fiche = null; charger();
    });
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
      return h + '<div class="row"><button class="btn l" data-act="foannule">Annuler</button><button class="btn" data-act="fosave">Enregistrer</button>' + (F.id !== 'new' ? '<span class="grow"></span><button class="btn l sm" data-act="foarchive">' + (f.archive ? 'Réactiver' : 'Archiver') + '</button><button class="btn ko sm" data-act="fosuppr">🗑 Supprimer</button>' : '') + '</div>';
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

  function supprimerFo() {
    var f = S.fiche.d, n = S.articles.filter(function (a) { return a.fournisseur_id === f.id; }).length;
    var n2 = S.articles.filter(function (a) { return a.fournisseur_id !== f.id && (S.afPrix[a.id] || []).some(function (p) { return p.fournisseur_id === f.id; }); }).length;
    if (!confirm('Supprimer définitivement le fournisseur « ' + f.nom + ' » ?\n\n• ' + n + ' article(s) dont c’est le fournisseur principal passeront en SF (sans fournisseur).\n• ' + (n2 ? n2 + ' article(s) le perdront comme fournisseur secondaire.\n• ' : '') + 'Son compte (identifiant, mot de passe) sera effacé.\n• Les commandes passées et l’historique des prix sont conservés, sans nom de fournisseur.\n\nCette suppression est définitive. Pour simplement le masquer, utilisez « Archiver ».')) return;
    var t = prompt('Pour confirmer, tapez le nom du fournisseur : ' + f.nom);
    if (t == null) return;
    if (norm(t.trim()) !== norm(f.nom.trim())) { toast('Nom différent : suppression annulée'); return; }
    sb.from('fournisseurs').delete().eq('id', f.id).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      toast('✔ Fournisseur supprimé · ' + n + ' article(s) en SF'); S.fiche = null; charger();
    });
  }

  // ---------- Commandes et réceptions (gestion) ----------
  var CST = { attente: ['warn', 'en attente'], partielle: ['warn', 'reliquat'], recue: ['ok', 'reçue'], close: ['', 'close'] };
  function chargerCommandes() {
    return Promise.all([
      sb.from('commandes').select('*').order('date_commande', { ascending: false }).order('id', { ascending: false }).limit(200),
      sb.from('commande_lignes').select('*')
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      S.commandes = r[0].data; S.lignes = {};
      (r[1].data || []).forEach(function (l) { (S.lignes[l.commande_id] = S.lignes[l.commande_id] || []).push(l); });
    });
  }
  function prixChez(a, fid) { var x = (S.afPrix[a.id] || []).filter(function (p) { return p.fournisseur_id === fid; })[0]; return x && +x.prix ? +x.prix : +a.prix || +a.cout_moyen || 0; }
  function refChez(a, fid) { var x = (S.afPrix[a.id] || []).filter(function (p) { return p.fournisseur_id === fid && p.reference && p.reference !== 'SR'; })[0]; return x ? x.reference : (a.reference && !estSR(a) ? a.reference : ''); }
  function qteSuggeree(a) { var s = +a.seuil || 0, r = stockDe(a.id, 0); return Math.max(1, Math.ceil(2 * s - r)); }
  function enCoursPour(aid) { var n = 0; S.commandes.forEach(function (c) { if (c.statut === 'attente' || c.statut === 'partielle') (S.lignes[c.id] || []).forEach(function (l) { if (l.article_id === aid && !l.reliquat_abandonne) n += Math.max(0, l.quantite - l.recu); }); }); return n; }
  function vCommandes() {
    if (S.fiche && S.fiche.type === 'commande') return vCommande();
    var sub = S.cmdSub || 'sug', ouvertes = S.commandes.filter(function (c) { return c.statut === 'attente' || c.statut === 'partielle'; });
    var h = '<h2>Commandes</h2><div class="chips" style="margin:0 0 12px">'
      + [['sug', 'À commander'], ['enc', 'En cours' + (ouvertes.length ? ' · ' + ouvertes.length : '')], ['new', '+ Nouvelle commande'], ['his', 'Historique']].map(function (x) { return '<button class="chip' + (sub === x[0] ? ' on' : '') + '" data-csub="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    if (sub === 'sug') return h + vSuggestions();
    if (sub === 'new') return h + vNouvelleCommande();
    var l = sub === 'enc' ? ouvertes : S.commandes.filter(function (c) { return c.statut === 'recue' || c.statut === 'close'; });
    if (!l.length) return h + '<p class="mu">' + (sub === 'enc' ? 'Aucune commande en cours.' : 'Aucune commande reçue pour l’instant.') + '</p>';
    return h + '<div class="card">' + l.map(function (c) {
      var li = S.lignes[c.id] || [], tot = li.reduce(function (t, x) { return t + x.quantite * x.prix; }, 0), st = CST[c.statut] || ['', c.statut];
      return '<button class="it lrow" data-copen="' + c.id + '"><span class="it-n"><b>' + esc(S.fournisseurs[c.fournisseur_id] || 'Fournisseur supprimé') + (c.numero ? ' · n° ' + esc(c.numero) : '') + '</b><span>' + c.date_commande.split('-').reverse().join('/') + ' · ' + li.length + ' ligne(s) · ' + eur(tot) + '</span></span><span class="pill ' + st[0] + '">' + st[1] + '</span></button>';
    }).join('') + '</div>';
  }
  function vSuggestions() {
    var parF = {};
    S.articles.filter(function (a) { return filtreStock(a, 'commander'); }).forEach(function (a) { var k = a.fournisseur_id || 0; (parF[k] = parF[k] || []).push(a); });
    var ks = Object.keys(parF).sort(function (x, y) { return (S.fournisseurs[x] || 'zz').localeCompare(S.fournisseurs[y] || 'zz'); });
    if (!ks.length) return '<p class="mu">Rien à commander : aucun article sous son seuil d’alerte.</p>';
    return '<p class="mu">Articles au seuil d’alerte ou en dessous, regroupés par fournisseur principal. Quantité proposée : de quoi remonter à deux fois le seuil (modifiable). Une quantité à 0 retire l’article. Les articles déjà couverts par une commande en cours n’apparaissent plus ici. Touchez un fournisseur pour voir ses articles.</p>' + ks.map(function (k) {
      var fid = +k, arts = parF[k], tot = 0, ouvert = !!S.sugOpen[k], nR = arts.filter(function (a) { return stockDe(a.id, 0) <= 0; }).length;
      arts.forEach(function (a) { var key = fid + ':' + a.id, q = S.sugQ[key] != null ? S.sugQ[key] : qteSuggeree(a); tot += (nb(String(q).replace(',', '.')) || 0) * prixChez(a, fid); });
      var h = '<div class="card"><button class="lrow row" style="border:none;padding:4px 0" data-sugopen="' + k + '" aria-expanded="' + ouvert + '"><span class="grow"><b>' + esc(S.fournisseurs[fid] || 'Fournisseur à renseigner (SF)') + '</b><br><span class="mu" style="font-size:14px">' + arts.length + ' article(s)' + (nR ? ' · <span class="pill ko">' + nR + ' en rupture</span>' : '') + ' · ' + eur(tot) + ' TTC</span></span><span style="font-size:20px">' + (ouvert ? '▴' : '▾') + '</span></button>';
      if (!ouvert) return h + '</div>';
      h += arts.map(function (a) {
        var key = fid + ':' + a.id, q = S.sugQ[key] != null ? S.sugQ[key] : qteSuggeree(a), p = prixChez(a, fid), enc = enCoursPour(a.id), rf = refChez(a, fid);
        return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + (rf ? '<span class="ref">' + esc(rf) + '</span>' : '') + '</b><span>Réserve ' + fr(stockDe(a.id, 0)) + ' / seuil ' + fr(a.seuil) + ' ' + uRes(a) + (stockDe(a.id, 0) <= 0 ? ' · <span class="pill ko">rupture</span>' : '') + (enc ? ' · <span class="pill warn">' + fr(enc) + ' déjà en commande</span>' : '') + ' · ' + eur(p) + '</span></div>'
          + '<div class="stp"><input inputmode="decimal" data-sugq="' + key + '" value="' + esc(q) + '" aria-label="Quantité à commander"></div></div>';
      }).join('');
      return h + '<div class="row wrap" style="margin-top:8px"><span class="grow mu">Total estimé : <b>' + eur(tot) + '</b> TTC</span>' + (fid ? '<button class="btn sm" data-cfrom="' + fid + '">Créer la commande</button>' : '<span class="mu">Renseignez le fournisseur des articles pour commander</span>') + '</div></div>';
    }).join('');
  }
  function creerCommande(fid, lignes, numero) {
    lignes = lignes.filter(function (l) { return l.quantite > 0; });
    if (!fid) { toast('Choisissez le fournisseur'); return Promise.resolve(); }
    if (!lignes.length) { toast('Aucune ligne à commander'); return Promise.resolve(); }
    return sb.from('commandes').insert({ fournisseur_id: fid, numero: numero || null, manuelle: true }).select().single().then(function (r) {
      if (r.error) throw r.error;
      var id = r.data.id;
      return sb.from('commande_lignes').insert(lignes.map(function (l) { return { commande_id: id, article_id: l.article_id, quantite: l.quantite, prix: l.prix }; })).then(function (r2) { if (r2.error) throw r2.error; return id; });
    }).then(function (id) { toast('✔ Commande créée'); return chargerCommandes().then(function () { ouvrirCommande(id); }); })
      .catch(function (e) { toast(msgErr(e)); });
  }
  function depuisSuggestion(fid) {
    var lignes = S.articles.filter(function (a) { return filtreStock(a, 'commander') && (a.fournisseur_id || 0) === fid; }).map(function (a) {
      var key = fid + ':' + a.id, q = S.sugQ[key] != null ? nb(String(S.sugQ[key]).replace(',', '.')) : qteSuggeree(a);
      return { article_id: a.id, quantite: q, prix: prixChez(a, fid) };
    });
    creerCommande(fid, lignes, null);
  }
  // Nouvelle commande manuelle
  function vNouvelleCommande() {
    var N = S.nc, h = '<div class="card"><div class="g2"><label class="mu">Fournisseur<select class="in" id="ncfo">' + optFo(N.fid, 'Choisir…') + '</select></label><label class="mu">N° de commande (facultatif)<input class="in" id="ncnum" value="' + esc(N.num) + '"></label></div></div>';
    if (!N.fid) return h + '<p class="mu">Choisissez d’abord le fournisseur.</p>';
    h += '<div class="card"><label class="mu">Ajouter un article<input class="in" id="ncq" type="search" placeholder="Nom ou référence" value="' + esc(N.q) + '"></label>';
    var q = norm(N.q);
    if (q) h += S.articles.filter(function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }).slice(0, 12).map(function (a) { return '<button class="it lrow" data-ncadd="' + a.id + '"><span class="it-n"><b>' + esc(a.nom) + '</b><span>' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + ' · ' + eur(prixChez(a, +N.fid)) + '</span></span><span>+</span></button>'; }).join('');
    h += '</div>';
    if (N.l.length) {
      var tot = 0;
      h += '<div class="card"><b>Lignes</b>' + N.l.map(function (l, i) {
        var a = S.byId[l.article_id]; tot += (+l.quantite || 0) * (+l.prix || 0);
        return '<div class="row wrap" style="margin-top:8px"><span class="grow">' + esc(a ? a.nom : '?') + ' <span class="mu">(' + (a ? uRes(a) : '') + ')</span></span><input class="in" style="width:90px" inputmode="decimal" data-ncl="' + i + '" data-nck="quantite" value="' + esc(l.quantite) + '" aria-label="Quantité"><input class="in" style="width:110px" inputmode="decimal" data-ncl="' + i + '" data-nck="prix" value="' + esc(l.prix) + '" aria-label="Prix unitaire TTC"><button class="btn l sm" data-ncdel="' + i + '" aria-label="Retirer">✕</button></div>';
      }).join('') + '<p class="mu" style="text-align:right">Total : <b>' + eur(tot) + '</b> TTC</p><button class="btn" data-act="ncgo">Créer la commande</button></div>';
    }
    return h;
  }
  // Détail d'une commande et réception
  function ouvrirCommande(id) {
    S.fiche = { type: 'commande', id: id, rx: {}, recs: [] };
    S.cmdSub = 'enc'; S.tab = 'commandes'; render();
    sb.from('mouvements').select('*').eq('commande_id', id).order('cree_le').then(function (r) { if (S.fiche && S.fiche.id === id) { S.fiche.recs = r.data || []; render(); } });
  }
  function vCommande() {
    var F = S.fiche, c = S.commandes.filter(function (x) { return x.id === F.id; })[0];
    var h = '<button class="lnk" data-act="fclose">← Toutes les commandes</button>';
    if (!c) return h + '<p class="mu">Chargement…</p>';
    var li = S.lignes[c.id] || [], st = CST[c.statut] || ['', c.statut], ouverte = c.statut === 'attente' || c.statut === 'partielle';
    h += '<div class="card row wrap"><div class="grow"><h2 style="margin:0">' + esc(S.fournisseurs[c.fournisseur_id] || 'Fournisseur supprimé') + (c.numero ? ' · n° ' + esc(c.numero) : '') + '</h2>' + (c.numero && !F.editNum ? '<div style="margin:8px 0"><button class="btn l sm" data-act="cnumedit">✏️ Modifier la référence</button></div>' : '<div class="row" style="margin:8px 0;max-width:460px"><input class="in" id="cnum" placeholder="Référence de la commande passée" value="' + esc(F.num != null ? F.num : c.numero || '') + '" aria-label="Référence de la commande"><button class="btn sm" data-act="cnumok">Enregistrer</button>' + (c.numero ? '<button class="btn l sm" data-act="cnumno">Annuler</button>' : '') + '</div>') + '<span class="mu">Commande du ' + c.date_commande.split('-').reverse().join('/') + '</span> <span class="pill ' + st[0] + '">' + st[1] + '</span></div>' + (ouverte ? '<button class="btn l sm" data-act="cclose">Clôturer</button>' : '') + '</div>';
    if (ouverte) {
      h += '<div class="row wrap" style="margin:0 0 10px"><label class="btn gold" style="display:inline-flex;align-items:center">📄 Importer la facture PDF<input type="file" accept="application/pdf,.pdf" id="impf" hidden></label><button class="btn l" data-act="caouvre">+ Ajouter un article</button></div>';
      if (F.imp) h += vImport(c);
      h += vAjoutLigne(c);
    }
    h += '<div class="card"><b>Lignes' + (ouverte ? ' · saisir ce qui est arrivé' : '') + '</b>' + li.map(function (l) {
      var a = S.byId[l.article_id] || { nom: (l.article_nom || 'article') + ' (supprimé)' }, reste = Math.max(0, l.quantite - l.recu), r = F.rx[l.id] || {}, rf = a.id ? refChez(a, c.fournisseur_id) : '';
      return '<div class="it" style="flex-wrap:wrap"><div class="it-n"><b>' + esc(a.nom) + '</b><span style="display:block;font-weight:700;color:var(--ink2)">Réf. ' + (rf ? esc(rf) : '<span class="pill warn">SR</span>') + '</span><span>Commandé ' + fr(l.quantite) + ' · reçu ' + fr(l.recu) + (l.gratuit ? ' + ' + fr(l.gratuit) + ' offert(s)' : '') + ' · ' + eur(l.prix) + (l.reliquat_abandonne ? ' · <span class="pill">reliquat abandonné</span>' : reste && c.statut !== 'attente' ? ' · <span class="pill warn">reste ' + fr(reste) + '</span>' : '') + '</span></div>'
        + (ouverte && !l.reliquat_abandonne && a.id ? '<div class="row" style="gap:6px"><label class="mu" style="font-size:13px">Reçu<input class="in" style="width:80px;height:42px" inputmode="decimal" data-rxq="' + l.id + '" value="' + esc(r.q != null ? r.q : reste) + '"></label><label class="mu" style="font-size:13px">Offert<input class="in" style="width:70px;height:42px" inputmode="decimal" data-rxg="' + l.id + '" value="' + esc(r.g || '') + '" placeholder="0"></label>' + (reste ? '<button class="btn l sm" title="Ne plus attendre le reste" data-rxab="' + l.id + '">Abandonner le reste</button>' : '') + '</div>' : '') + '</div>';
    }).join('') + (ouverte ? '<div class="row" style="margin-top:12px"><span class="grow mu">Les quantités offertes entrent en stock sans valeur.</span><button class="btn" data-act="rxgo"' + (F.busy ? ' disabled' : '') + '>Réceptionner</button></div>' : '') + '</div>';
    var lots = {}; F.recs.forEach(function (m) { if (m.type === 'reception') (lots[m.lot] = lots[m.lot] || []).push(m); });
    var ks = Object.keys(lots);
    if (ks.length) h += '<div class="card"><b>Réceptions</b>' + ks.map(function (k) {
      var ms = lots[k], annule = ms.every(function (m) { return m.statut === 'annule'; });
      return '<div class="it"><div class="it-n"><b>' + quand(ms[0].cree_le) + ' · ' + esc(ms[0].auteur_nom || '') + (annule ? ' <span class="pill">annulée</span>' : '') + '</b><span>' + ms.map(function (m) { var a = S.byId[m.article_id] || { nom: '?' }; return esc(a.nom) + ' × ' + fr(m.quantite - (m.gratuit || 0)) + (m.gratuit ? ' + ' + fr(m.gratuit) + ' offert(s)' : ''); }).join(', ') + '</span></div>' + (annule ? '' : '<button class="btn l sm" data-rxundo="' + k + '">↩️ Annuler</button>') + '</div>';
    }).join('') + '</div>';
    return h;
  }
  function receptionner() {
    var F = S.fiche, c = S.commandes.filter(function (x) { return x.id === F.id; })[0], li = S.lignes[c.id] || [];
    var lignes = li.filter(function (l) { return !l.reliquat_abandonne && l.article_id; }).map(function (l) {
      var r = F.rx[l.id] || {}, q = r.q != null ? nb(String(r.q).replace(',', '.')) : Math.max(0, l.quantite - l.recu);
      return { ligne_id: l.id, quantite: Math.max(0, q), gratuit: Math.max(0, nb(String(r.g || 0).replace(',', '.'))) };
    }).filter(function (l) { return l.quantite > 0 || l.gratuit > 0; });
    if (!lignes.length) { toast('Aucune quantité à réceptionner'); return; }
    F.busy = true; render();
    sb.rpc('recevoir_commande', { p_commande: c.id, p_lignes: lignes }).then(function (r) {
      F.busy = false;
      if (r.error) { toast(msgErr(r.error)); render(); return; }
      toast('✔ Réception enregistrée : ' + r.data.lignes + ' ligne(s), ' + eur(r.data.valeur) + (r.data.statut === 'partielle' ? ' · reliquat attendu' : ''));
      F.rx = {}; Promise.all([charger(), chargerCommandes()]).then(function () { ouvrirCommande(c.id); });
    });
  }
  function annulerReception(lot) {
    if (!confirm('Annuler cette réception ? Les quantités sortent de la réserve et le coût moyen est recalculé.')) return;
    sb.rpc('annuler_reception', { p_lot: lot }).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      toast('✔ Réception annulée' + (r.data.reserve_insuffisante ? ' · réserve insuffisante pour : ' + r.data.reserve_insuffisante + ' (mise à 0)' : ''));
      var id = S.fiche.id; Promise.all([charger(), chargerCommandes()]).then(function () { ouvrirCommande(id); });
    });
  }
  function abandonnerReste(lid) {
    if (!confirm('Ne plus attendre le reste de cette ligne ?')) return;
    sb.from('commande_lignes').update({ reliquat_abandonne: true }).eq('id', lid).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      sb.rpc('statut_commande', { p_commande: S.fiche.id }).then(function () { var id = S.fiche.id; chargerCommandes().then(function () { ouvrirCommande(id); }); });
    });
  }
  function cloturerCommande() {
    if (!confirm('Clôturer cette commande ? Plus rien n’est attendu.')) return;
    var id = S.fiche.id;
    sb.from('commandes').update({ statut: 'close' }).eq('id', id).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } toast('Commande clôturée'); chargerCommandes().then(function () { ouvrirCommande(id); }); });
  }

  // ---------- Import d'une facture PDF dans une commande en cours ----------
  function nRef(r) { return String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function trouverArticle(ref, fid) {
    var k = nRef(ref); if (!k) return null;
    var al = (S.alias[fid] || {})[k]; if (al && S.byId[al] && !S.byId[al].archive) return S.byId[al];
    var a = null;
    S.articles.some(function (x) { return (S.afPrix[x.id] || []).some(function (p) { if (p.fournisseur_id === fid && nRef(p.reference) === k) { a = x; return true; } }); });
    if (a) return a;
    S.articles.some(function (x) { if (nRef(x.reference) === k && x.reference !== 'SR') { a = x; return true; } });
    return a;
  }
  function importerFacture(file) {
    var F = S.fiche, c = S.commandes.filter(function (x) { return x.id === F.id; })[0];
    if (!file || !c) return;
    F.imp = { lecture: true }; render();
    file.arrayBuffer().then(FACTURES.extraireLignes).then(function (lignes) {
      var R = FACTURES.lireFacture(lignes), nomFo = S.fournisseurs[c.fournisseur_id] || '';
      if (!R.fournisseur) { F.imp = { inconnu: true }; render(); return; }
      if (!R.lignes.length) { F.imp = null; toast('Aucune ligne d’article trouvée dans cette facture'); render(); return; }
      if (norm(nomFo).replace(/\s/g, '').indexOf(norm(R.fournisseur).replace(/\s/g, '')) < 0 && !confirm('Cette facture est une facture ' + R.fournisseur + ', mais la commande est chez ' + nomFo + '.\n\nContinuer quand même ?')) { F.imp = null; render(); return; }
      var lignesF = R.lignes, num = (c.numero || '').trim();
      if (num) {
        if (R.commandes.length && R.commandes.indexOf(num) < 0) {
          if (!confirm('Cette facture correspond à la commande n° ' + R.commandes.join(', ') + '.\nVotre commande est enregistrée sous le n° ' + num + '.\n\nContinuer quand même ?')) { F.imp = null; render(); return; }
        } else if (R.commandes.length > 1) lignesF = R.lignes.filter(function (x) { return x.commande === num; });
      }
      // regroupement par article (plusieurs références peuvent viser la même fiche)
      var parA = {}, items = [];
      lignesF.forEach(function (x) {
        var a = trouverArticle(x.ref, c.fournisseur_id);
        if (!a) { items.push({ type: 'inconnu', ref: x.ref, nom: x.nom, qte: x.qte, prix: x.prix, total: x.total, choix: '' }); return; }
        var it = parA[a.id];
        if (!it) { it = parA[a.id] = { type: 'connu', article_id: a.id, refs: [], qte: 0, total: 0 }; items.push(it); }
        it.refs.push(x.ref); it.qte += x.qte; it.total += x.total != null ? x.total : x.qte * x.prix;
      });
      items.forEach(function (it) { if (it.type === 'connu') it.prix = it.qte ? Math.round(it.total / it.qte * 10000) / 10000 : 0; });
      F.imp = { R: R, items: items, num: num };
      render(); window.scrollTo(0, 0);
    }).catch(function (e) { F.imp = null; toast('Lecture du PDF impossible : ' + (e && e.message || e)); render(); });
  }
  function vImport(c) {
    var I = S.fiche.imp, li = S.lignes[c.id] || [];
    if (I.lecture) return '<div class="card"><b>📄 Lecture de la facture…</b></div>';
    if (I.inconnu) return '<div class="ban warn"><b>Fournisseur pas encore reconnu.</b> L’import sait lire les factures ' + FACTURES.modeles.join(' et ') + '. Ajoutez les articles à la main avec « + Ajouter un article » et envoyez une facture de ce fournisseur à Claude pour qu’il l’ajoute. <button class="lnk" data-act="impno">Fermer</button></div>';
    var R = I.R, parL = {}; li.forEach(function (l) { parL[l.article_id] = l; });
    var h = '<div class="card" style="border:2px solid var(--gold)"><b>📄 Facture ' + esc(R.fournisseur) + (R.facture ? ' n° ' + esc(R.facture) : '') + (R.date ? ' du ' + R.date.split('-').reverse().join('/') : '') + '</b>'
      + '<p class="mu" style="margin:4px 0 8px">Commande sur la facture : ' + (R.commandes.length ? esc(R.commandes.join(', ')) : 'non indiquée') + (!I.num && R.commandes.length ? ' · sera enregistrée comme référence de la commande' : '') + '. Vérifiez puis appliquez : rien n’entre en stock avant « Réceptionner ».</p>';
    var vus = {}, nb2 = { maj: 0, ajout: 0, ok: 0 };
    h += I.items.map(function (it, i) {
      if (it.type === 'inconnu') {
        return '<div class="it" style="flex-wrap:wrap"><div class="it-n"><b>' + esc(it.nom) + '<span class="ref">' + esc(it.ref) + '</span></b><span><span class="pill warn">inconnu dans l’appli</span> · ' + fr(it.qte) + ' × ' + eur(it.prix) + '</span></div>'
          + '<select class="in" style="max-width:340px" data-impc="' + i + '"><option value="">Choisir…</option><option value="creer"' + (it.choix === 'creer' ? ' selected' : '') + '>➕ Créer une fiche article</option><option value="ignorer"' + (it.choix === 'ignorer' ? ' selected' : '') + '>Ignorer cette ligne</option><optgroup label="Associer à une fiche existante">'
          + S.articles.map(function (a) { return '<option value="' + a.id + '"' + (String(it.choix) === String(a.id) ? ' selected' : '') + '>' + esc(a.nom) + (a.reference && !estSR(a) ? ' — ' + esc(a.reference) : '') + '</option>'; }).join('') + '</optgroup></select></div>';
      }
      var a = S.byId[it.article_id], l = parL[it.article_id], txt; vus[it.article_id] = 1;
      if (!l) { txt = '<span class="pill ok">ajouté à la commande</span> · ' + fr(it.qte) + ' × ' + eur(it.prix); nb2.ajout++; }
      else if (l.quantite !== it.qte || Math.abs(l.prix - it.prix) > 0.004) { txt = '<span class="pill warn">corrigé</span> · ' + (l.quantite !== it.qte ? 'quantité ' + fr(l.quantite) + ' → <b>' + fr(it.qte) + '</b>' : 'quantité ' + fr(it.qte)) + ' · prix ' + (Math.abs(l.prix - it.prix) > 0.004 ? eur(l.prix) + ' → <b>' + eur(it.prix) + '</b>' : eur(it.prix)); nb2.maj++; }
      else { txt = '<span class="pill">identique</span> · ' + fr(it.qte) + ' × ' + eur(it.prix); nb2.ok++; }
      return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + '<span class="ref">' + esc(it.refs.join(', ')) + '</span></b><span>' + txt + '</span></div></div>';
    }).join('');
    var absents = li.filter(function (l) { return !vus[l.article_id]; });
    if (absents.length) h += '<p class="mu" style="margin:10px 0 0"><b>Pas sur la facture</b> (inchangé) : ' + absents.map(function (l) { return esc((S.byId[l.article_id] || { nom: '?' }).nom); }).join(', ') + '</p>';
    var reste = I.items.filter(function (it) { return it.type === 'inconnu' && !it.choix; }).length;
    h += '<div class="row wrap" style="margin-top:12px"><span class="grow mu">' + nb2.ajout + ' ajout(s), ' + nb2.maj + ' correction(s), ' + nb2.ok + ' identique(s)' + (reste ? ' · <b>' + reste + ' ligne(s) inconnue(s) à choisir</b>' : '') + '</span><button class="btn l" data-act="impno">Annuler</button><button class="btn" data-act="impok"' + (reste || I.busy ? ' disabled' : '') + '>Appliquer à la commande</button></div></div>';
    return h;
  }
  function appliquerImport() {
    var F = S.fiche, I = F.imp, c = S.commandes.filter(function (x) { return x.id === F.id; })[0], fid = c.fournisseur_id;
    I.busy = true; render();
    var aCreer = I.items.filter(function (it) { return it.type === 'inconnu' && it.choix === 'creer'; });
    var alias = JSON.parse(JSON.stringify(S.alias || {})), aliasModif = false;
    // 1. fiches à créer
    var p = aCreer.length ? sb.from('articles').insert(aCreer.map(function (it) {
      return { nom: it.nom, reference: it.ref, fournisseur_id: fid, conditionnement: 'BOITE', consommation: 'BOITE', qte_par_boite: 1, seuil: 0, prix: it.prix || 0, cout_moyen: it.prix || 0 };
    })).select().then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (a, i) { aCreer[i].article_id = a.id; });
      return sb.from('article_fournisseurs').insert(r.data.map(function (a, i) { return { article_id: a.id, fournisseur_id: fid, prix: aCreer[i].prix || 0, reference: aCreer[i].ref, rang: 0 }; })).then(function (r2) { if (r2.error) throw r2.error; });
    }) : Promise.resolve();
    return p.then(function () {
      // 2. total par article
      var fin = {};
      I.items.forEach(function (it) {
        var id = it.type === 'connu' ? it.article_id : it.choix === 'creer' ? it.article_id : it.choix && it.choix !== 'ignorer' ? +it.choix : null;
        if (!id) return;
        if (it.type === 'inconnu' && it.choix !== 'creer') { (alias[fid] = alias[fid] || {})[nRef(it.ref)] = id; aliasModif = true; }
        var x = fin[id] = fin[id] || { qte: 0, total: 0 };
        x.qte += it.qte; x.total += it.type === 'connu' ? it.total : (it.total != null ? it.total : it.qte * it.prix);
      });
      var li = S.lignes[c.id] || [], parL = {}; li.forEach(function (l) { parL[l.article_id] = l; });
      var ops = [], ajouts = [];
      Object.keys(fin).forEach(function (id) {
        var x = fin[id], prix = x.qte ? Math.round(x.total / x.qte * 10000) / 10000 : 0, l = parL[id];
        if (!l) ajouts.push({ commande_id: c.id, article_id: +id, quantite: x.qte, prix: prix });
        else if (l.quantite !== x.qte || Math.abs(l.prix - prix) > 0.004) ops.push(sb.from('commande_lignes').update({ quantite: Math.max(x.qte, l.recu), prix: prix }).eq('id', l.id));
      });
      if (ajouts.length) ops.push(sb.from('commande_lignes').insert(ajouts));
      if (!I.num && I.R.commandes.length) ops.push(sb.from('commandes').update({ numero: I.R.commandes.join(', ') }).eq('id', c.id));
      if (aliasModif) ops.push(sb.from('parametres').upsert({ cle: 'alias_refs', valeur: alias }, { onConflict: 'cle' }));
      return Promise.all(ops).then(function (rs) {
        rs.forEach(function (r) { if (r && r.error) throw r.error; });
        S.alias = alias;
        return sb.rpc('statut_commande', { p_commande: c.id });
      }).then(function () { return { ajouts: ajouts.length, maj: ops.length - (ajouts.length ? 1 : 0) - (aliasModif ? 1 : 0) - (!I.num && I.R.commandes.length ? 1 : 0), fiches: aCreer.length }; });
    }).then(function (n) {
      toast('✔ Facture appliquée : ' + n.ajouts + ' ligne(s) ajoutée(s), ' + n.maj + ' corrigée(s)' + (n.fiches ? ', ' + n.fiches + ' fiche(s) créée(s) à compléter' : ''));
      F.imp = null; Promise.all([charger(), chargerCommandes()]).then(function () { ouvrirCommande(c.id); });
    }).catch(function (e) { I.busy = false; toast(msgErr(e)); render(); });
  }
  // Ajout manuel d'une ligne dans une commande en cours
  function vAjoutLigne(c) {
    var A = S.fiche.ajout; if (!A) return '';
    var q = norm(A.q), h = '<div class="card"><b>+ Ajouter un article à la commande</b><input class="in" id="caq" type="search" placeholder="Nom ou référence" value="' + esc(A.q) + '" style="margin-top:8px">';
    if (q) h += S.articles.filter(function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }).slice(0, 12).map(function (a) { return '<button class="it lrow" data-caadd="' + a.id + '"><span class="it-n"><b>' + esc(a.nom) + '</b><span>' + esc(refChez(a, c.fournisseur_id) || 'SR') + ' · ' + eur(prixChez(a, c.fournisseur_id)) + '</span></span><span>+</span></button>'; }).join('');
    return h + '<button class="lnk" style="margin-top:8px" data-act="cano">Fermer</button></div>';
  }
  function ajouterLigne(aid) {
    var F = S.fiche, c = S.commandes.filter(function (x) { return x.id === F.id; })[0], a = S.byId[aid];
    if ((S.lignes[c.id] || []).some(function (l) { return l.article_id === aid; })) { toast('Cet article est déjà dans la commande'); return; }
    var q = nb(String(prompt('Quantité commandée pour « ' + a.nom + ' » (' + uRes(a) + ') ?', '1') || '').replace(',', '.'));
    if (!(q > 0)) return;
    sb.from('commande_lignes').insert({ commande_id: c.id, article_id: aid, quantite: q, prix: prixChez(a, c.fournisseur_id) }).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      F.ajout = null; toast('✔ Ligne ajoutée'); return sb.rpc('statut_commande', { p_commande: c.id }).then(function () { return chargerCommandes(); }).then(render);
    });
  }

  // ---------- Plus : sauvegarde et journal des versions (gestion) ----------
  function joursDepuis(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null; }
  function sauvegardeEnRetard() { var j = joursDepuis(S.sauv && S.sauv.date); return j == null || j > 30; }
  function vPlus() {
    var j = joursDepuis(S.sauv && S.sauv.date), h = '<h2>Plus</h2>';
    h += '<div class="card"><div class="row wrap"><div class="grow"><b>💾 Sauvegarde</b><br><span class="mu">'
      + (S.sauv && S.sauv.date ? 'Dernière : ' + new Date(S.sauv.date).toLocaleDateString('fr-FR') + ' par ' + esc(S.sauv.par || '?') + (j ? ' (il y a ' + j + ' jour' + (j > 1 ? 's' : '') + ')' : ' (aujourd’hui)') : 'Aucune sauvegarde téléchargée pour l’instant')
      + '</span></div><button class="btn' + (sauvegardeEnRetard() ? ' gold' : '') + '" data-act="sauver"' + (S.sauvBusy ? ' disabled' : '') + '>' + (S.sauvBusy ? 'Préparation…' : 'Télécharger la sauvegarde') + '</button></div>'
      + '<p class="mu" style="margin:8px 0 0">Un fichier Excel avec une feuille par tableau : stock par emplacement, articles, prix par fournisseur, fournisseurs, commandes, mouvements, inventaires, équipe. À ranger dans un dossier sûr, une fois par mois. Les mots de passe des comptes fournisseurs n’y figurent pas.</p></div>';
    h += '<h2 style="margin-top:20px">Journal des versions</h2><p class="mu" style="margin-top:-6px">Version installée : <b>' + esc(C.version) + '</b>. Majeure : changement profond · Mineure : nouvelle fonction · Correctif : réparation.</p>';
    var TC = { Majeure: 'ko', Mineure: 'ok', Correctif: 'warn' };
    h += (window.JOURNAL || []).map(function (v, i) {
      return '<details class="card"' + (i === 0 ? ' open' : '') + '><summary style="cursor:pointer;list-style:none"><b>Version ' + esc(v.v) + ' — ' + esc(v.n) + '</b> <span class="pill ' + (TC[v.t] || '') + '">' + esc(v.t) + '</span><br><span class="mu">' + esc(v.d) + '</span></summary>'
        + '<p style="margin:10px 0 6px"><b>Pourquoi :</b> ' + esc(v.w) + '</p>'
        + (v.c && v.c.length ? '<b>Changements</b><ul style="margin:4px 0 8px;padding-left:20px">' + v.c.map(function (x) { return '<li style="margin:4px 0">' + esc(x) + '</li>'; }).join('') + '</ul>' : '')
        + (v.x && v.x.length ? '<b>Données</b><ul style="margin:4px 0 0;padding-left:20px">' + v.x.map(function (x) { return '<li style="margin:4px 0">' + esc(x) + '</li>'; }).join('') + '</ul>' : '')
        + '</details>';
    }).join('');
    return h;
  }
  function telechargerSauvegarde() {
    if (S.sauvBusy) return;
    S.sauvBusy = true; render();
    var T = ['articles', 'article_fournisseurs', 'fournisseurs', 'stocks', 'commandes', 'commande_lignes', 'mouvements', 'prix_historique', 'inventaires', 'profils', 'parametres'];
    var ORD = { stocks: ['article_id', 'emplacement'], article_fournisseurs: ['article_id', 'fournisseur_id'], parametres: ['cle'], profils: ['id'] };
    Promise.all(T.map(function (t) { return toutLire(t, '*', function (q) { (ORD[t] || ['id']).forEach(function (k) { q = q.order(k); }); return q; }); })).then(function (R) {
      var D = {}; T.forEach(function (t, i) { D[t] = R[i]; });
      var nomA = {}, nomF = {}; D.articles.forEach(function (a) { nomA[a.id] = a.nom; }); D.fournisseurs.forEach(function (f) { nomF[f.id] = f.nom; });
      // feuille lisible : stock par emplacement
      var st = {}; D.stocks.forEach(function (s) { (st[s.article_id] = st[s.article_id] || {})[s.emplacement] = +s.quantite; });
      var stock = { nom: 'Stock', colonnes: ['Article', 'Référence', 'Fournisseur', 'Unité réserve', 'Réserve', 'Cab. 1', 'Cab. 2', 'Cab. 3', 'Cab. 4', 'Cab. 5', 'Cab. 6', 'Cab. 7', 'Cab. 8', 'Coût moyen TTC', 'Valeur réserve TTC', 'Archivé'],
        lignes: D.articles.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom); }).map(function (a) {
          var s = st[a.id] || {}, r = s[0] || 0;
          return [a.nom, a.reference, nomF[a.fournisseur_id] || 'SF', a.conditionnement === 'BOITE' ? 'boîte de ' + a.qte_par_boite : 'unité', r].concat([1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return s[c] || 0; })).concat([+a.cout_moyen, Math.round(r * a.cout_moyen * 100) / 100, a.archive]);
        }) };
      // feuilles brutes (toutes les colonnes) + nom de l'article / du fournisseur pour la lecture
      function brut(nom, rows) {
        var cols = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
        var out = []; cols.forEach(function (k) { out.push(k); if (k === 'article_id') out.push('article'); if (k === 'fournisseur_id') out.push('fournisseur'); });
        return { nom: nom, colonnes: out, lignes: rows.map(function (r) { return out.map(function (k) { return k === 'article' ? nomA[r.article_id] : k === 'fournisseur' ? nomF[r.fournisseur_id] : r[k]; }); }) };
      }
      var feuilles = [stock, brut('Articles', D.articles), brut('Prix par fournisseur', D.article_fournisseurs), brut('Fournisseurs', D.fournisseurs), brut('Commandes', D.commandes), brut('Lignes de commande', D.commande_lignes),
        brut('Mouvements', D.mouvements), brut('Historique des prix', D.prix_historique), brut('Inventaires', D.inventaires), brut('Équipe', D.profils), brut('Paramètres', D.parametres), brut('Stock brut', D.stocks)];
      return XLSX_EVY.creer(feuilles).then(function (blob) {
        var d = new Date(), nom = 'sauvegarde-stock-evydent-' + d.toISOString().slice(0, 10) + (C.env === 'dev' ? '-TEST' : '') + '.xlsx';
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        var v = { date: d.toISOString(), par: S.me.nom, fichier: nom, lignes: D.mouvements.length };
        return sb.from('parametres').upsert({ cle: 'derniere_sauvegarde', valeur: v }, { onConflict: 'cle' }).then(function (r) { if (r.error) throw r.error; S.sauv = v; return nom; });
      });
    }).then(function (nom) { S.sauvBusy = false; toast('✔ Sauvegarde téléchargée : ' + nom); render(); })
      .catch(function (e) { S.sauvBusy = false; toast('Sauvegarde impossible : ' + msgErr(e)); render(); });
  }

  // ---------- Traitement en masse par Excel ----------
  function telecharger(blob, nom) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function nomFichier(base) { return base + '-' + aujourdhui() + (C.env === 'dev' ? '-TEST' : '') + '.xlsx'; }
  function ouiNon(v) {
    var t = norm(String(v)).trim();
    if (['oui', 'o', 'x', '1', 'vrai', 'true', 'yes'].indexOf(t) >= 0) return true;
    if (['non', 'n', '0', 'faux', 'false', 'no'].indexOf(t) >= 0) return false;
    return null;
  }
  function vide(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function nombre(v) { if (typeof v === 'number') return v; var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
  function colonnes(entete, attendues) {
    var idx = {}; (entete || []).forEach(function (c, i) { var k = norm(String(c || '')).replace(/[^a-z0-9]/g, ''); attendues.forEach(function (a) { if (k === norm(a[0]).replace(/[^a-z0-9]/g, '')) idx[a[1]] = i; }); });
    return idx;
  }
  function feuilleDe(classeur, nom) { return classeur[nom] || classeur[Object.keys(classeur)[0]] || []; }

  // --- Articles : export / import des fiches ---
  var COLS_A = [['N°', 'id'], ['Nom', 'nom'], ['Référence', 'reference'], ['Fournisseur principal', 'fournisseur'], ['Prix TTC', 'prix'], ['Réf. chez le fournisseur', 'ref_fo'],
    ['Livré', 'conditionnement'], ['Unités par boîte', 'qte_par_boite'], ['Sortie au cabinet', 'consommation'], ['Seuil', 'seuil'], ['Sans seuil', 'sans_seuil'], ['Conso. vérifiée', 'conso_verifiee'], ['Archivé', 'archive'], ['Supprimer', 'supprimer']];
  function afPrincipal(a) { return a.fournisseur_id ? (S.afPrix[a.id] || []).filter(function (p) { return p.fournisseur_id === a.fournisseur_id; })[0] || null : null; }
  function exporterArticles() {
    var tous = S.articles.concat(S.archives).sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    var lignes = tous.map(function (a) {
      var p = afPrincipal(a);
      return [a.id, a.nom, a.reference || 'SR', S.fournisseurs[a.fournisseur_id] || 'SF', p ? +p.prix : +a.prix || 0, p && p.reference || '', a.conditionnement === 'BOITE' ? 'Boîte' : 'Unité', +a.qte_par_boite,
        a.consommation === 'BOITE' ? 'Boîte' : 'Unité', +a.seuil, a.sans_seuil ? 'oui' : 'non', a.conso_verifiee ? 'oui' : 'non', a.archive ? 'oui' : 'non', null, fr(stockDe(a.id, 0)) + ' ' + uRes(a), +a.cout_moyen];
    });
    var aide = [['Modifiez les cases à changer, puis importez le fichier avec « Importer Excel » dans l’onglet Articles.'], ['Une case laissée VIDE garde la valeur actuelle de la fiche.'], ['Ne modifiez pas la colonne N° : elle relie la ligne à la fiche.'],
      ['Nouvel article : ajoutez une ligne en bas SANS N°, avec au moins le Nom.'], ['Fournisseur principal : nom exact d’un fournisseur de la feuille Fournisseurs, ou SF pour « sans fournisseur ».'], ['Référence : SR pour « sans référence ».'],
      ['Livré / Sortie au cabinet : Boîte ou Unité.  Sans seuil, Conso. vérifiée, Archivé : oui ou non.'], ['Prix TTC : prix chez le fournisseur principal (le dernier prix connu).'], ['Les colonnes « (info) » ne sont pas importées : la réserve se met à jour par l’inventaire.'], ['Supprimer une fiche : écrivez oui dans la colonne « Supprimer ». Effacer une ligne du fichier ne supprime rien. Une fiche qui a encore du stock (réserve ou cabinets) ou qui est attendue dans une commande en cours ne peut pas être supprimée.']];
    XLSX_EVY.creer([
      { nom: 'Articles', colonnes: COLS_A.map(function (c) { return c[0]; }).concat(['Réserve (info)', 'Coût moyen (info)']), lignes: lignes },
      { nom: 'Fournisseurs', colonnes: ['Fournisseurs connus'], lignes: S.fournListe.filter(function (f) { return !f.archive; }).map(function (f) { return [f.nom]; }) },
      { nom: 'Mode d’emploi', colonnes: ['Mode d’emploi'], lignes: aide }
    ]).then(function (b) { telecharger(b, nomFichier('articles-evydent')); toast('✔ Fichier des articles téléchargé'); }).catch(function (e) { toast(msgErr(e)); });
  }
  function importerArticles(file) {
    if (!file) return;
    S.artImp = { lecture: true }; render();
    file.arrayBuffer().then(XLSX_EVY.lire).then(function (cl) {
      var rows = feuilleDe(cl, 'Articles'), idx = colonnes(rows[0], COLS_A), R = { modifs: [], nouveaux: [], suppr: [], erreurs: [], nb: 0 };
      if (idx.nom == null && idx.id == null) throw new Error('Colonnes « N° » et « Nom » introuvables : utilisez le fichier exporté depuis l’onglet Articles');
      var parFo = {}; S.fournListe.forEach(function (f) { parFo[norm(f.nom).trim()] = f; });
      var CH = { nom: 'Nom', reference: 'Référence', fournisseur_id: 'Fournisseur', prix: 'Prix TTC', ref_fo: 'Réf. fournisseur', conditionnement: 'Livré', qte_par_boite: 'Unités par boîte', consommation: 'Sortie au cabinet', seuil: 'Seuil', sans_seuil: 'Sans seuil', conso_verifiee: 'Conso. vérifiée', archive: 'Archivé' };
      rows.slice(1).forEach(function (r, i) {
        if (!r || r.every(vide)) return;
        var n = i + 2, cell = function (k) { return idx[k] == null ? null : r[idx[k]]; }, v = {}, err = [];
        var id = vide(cell('id')) ? null : nombre(cell('id'));
        var a = id ? S.byId[id] || S.archives.filter(function (x) { return x.id === id; })[0] : null;
        if (id && !a) { R.erreurs.push('Ligne ' + n + ' : N° ' + id + ' inconnu'); return; }
        if (!vide(cell('supprimer')) && ouiNon(cell('supprimer'))) {
          if (!a) { R.erreurs.push('Ligne ' + n + ' : « Supprimer » sur une ligne sans N°'); return; }
          var st = stockPartout(a.id), enc = enCoursPour(a.id);
          if (st.length) R.erreurs.push('Ligne ' + n + ' (' + a.nom + ') : suppression impossible, il reste du stock (' + st.join(', ') + ')');
          else if (enc) R.erreurs.push('Ligne ' + n + ' (' + a.nom + ') : suppression impossible, attendu dans une commande en cours');
          else { R.suppr.push(a); R.nb++; }
          return;
        }
        if (!vide(cell('nom'))) v.nom = String(cell('nom')).trim();
        if (!vide(cell('reference'))) v.reference = String(cell('reference')).trim();
        if (!vide(cell('fournisseur'))) { var fn = norm(String(cell('fournisseur'))).trim(); if (fn === 'sf') v.fournisseur_id = null; else if (parFo[fn]) v.fournisseur_id = parFo[fn].id; else err.push('fournisseur « ' + cell('fournisseur') + ' » inconnu'); }
        if (!vide(cell('prix'))) { var p = nombre(cell('prix')); if (p == null || p < 0) err.push('prix invalide'); else v.prix = Math.round(p * 10000) / 10000; }
        if (!vide(cell('ref_fo'))) v.ref_fo = String(cell('ref_fo')).trim();
        ['conditionnement', 'consommation'].forEach(function (k) { if (!vide(cell(k))) { var t = norm(String(cell(k))).trim(); if (t.indexOf('boi') === 0) v[k] = 'BOITE'; else if (t.indexOf('uni') === 0) v[k] = 'Unité'; else err.push(CH[k] + ' : Boîte ou Unité'); } });
        if (!vide(cell('qte_par_boite'))) { var q = nombre(cell('qte_par_boite')); if (!(q > 0)) err.push('unités par boîte invalides'); else v.qte_par_boite = q; }
        if (!vide(cell('seuil'))) { var s = nombre(cell('seuil')); if (s == null || s < 0) err.push('seuil invalide'); else v.seuil = s; }
        ['sans_seuil', 'conso_verifiee', 'archive'].forEach(function (k) { if (!vide(cell(k))) { var b = ouiNon(cell(k)); if (b == null) err.push(CH[k] + ' : oui ou non'); else v[k] = b; } });
        if (err.length) { R.erreurs.push('Ligne ' + n + (a ? ' (' + a.nom + ')' : '') + ' : ' + err.join(', ')); return; }
        R.nb++;
        if (!a) { if (!v.nom) { R.erreurs.push('Ligne ' + n + ' : nouvel article sans nom'); return; } R.nouveaux.push({ ligne: n, v: v }); return; }
        var pr = afPrincipal(a), act = { nom: a.nom, reference: a.reference || 'SR', fournisseur_id: a.fournisseur_id || null, prix: pr ? +pr.prix : +a.prix || 0, ref_fo: pr && pr.reference || '', conditionnement: a.conditionnement, qte_par_boite: +a.qte_par_boite, consommation: a.consommation, seuil: +a.seuil, sans_seuil: !!a.sans_seuil, conso_verifiee: !!a.conso_verifiee, archive: !!a.archive };
        var diffs = Object.keys(v).filter(function (k) { return typeof v[k] === 'number' ? Math.abs(v[k] - act[k]) > 1e-9 : v[k] !== act[k]; });
        if (diffs.length) R.modifs.push({ a: a, v: v, act: act, diffs: diffs });
      });
      // références en double
      var refs = {}; S.articles.concat(S.archives).forEach(function (a) { refs[a.id] = a.reference; });
      R.modifs.forEach(function (m) { if (m.v.reference) refs[m.a.id] = m.v.reference; });
      R.nouveaux.forEach(function (x, i) { refs['n' + i] = x.v.reference || 'SR'; });
      var vu = {}; Object.keys(refs).forEach(function (k) { var r = String(refs[k] || '').toUpperCase(); if (!r || r === 'SR') return; (vu[r] = vu[r] || []).push(k); });
      Object.keys(vu).forEach(function (r) { if (vu[r].length > 1 && vu[r].some(function (k) { return k[0] === 'n' || R.modifs.some(function (m) { return String(m.a.id) === k && m.v.reference; }); })) R.erreurs.push('Référence ' + r + ' utilisée par plusieurs articles'); });
      R.CH = CH; S.artImp = R; render(); window.scrollTo(0, 0);
    }).catch(function (e) { S.artImp = null; toast('Lecture du fichier impossible : ' + (e && e.message || e)); render(); });
  }
  function valTxt(k, x) {
    if (k === 'fournisseur_id') return x ? S.fournisseurs[x] || '?' : 'SF';
    if (k === 'prix') return eur(x);
    if (typeof x === 'boolean') return x ? 'oui' : 'non';
    if (k === 'conditionnement' || k === 'consommation') return x === 'BOITE' ? 'Boîte' : 'Unité';
    return x === '' || x == null ? '—' : String(x);
  }
  function vImportArticles() {
    var R = S.artImp;
    if (R.lecture) return '<div class="card"><b>Lecture du fichier…</b></div>';
    var h = '<div class="card" style="border:2px solid var(--gold)"><b>📥 Import Excel des articles</b><p class="mu" style="margin:4px 0 8px">' + R.nb + ' ligne(s) lue(s) · <b>' + R.modifs.length + '</b> fiche(s) modifiée(s) · <b>' + R.nouveaux.length + '</b> nouvelle(s) · <b>' + R.suppr.length + '</b> à supprimer · ' + R.erreurs.length + ' erreur(s). Rien n’est enregistré avant « Appliquer ».</p>';
    if (R.erreurs.length) h += '<div class="ban ko"><b>À corriger dans le fichier' + (R.erreurs.some(function (e) { return /plusieurs articles/.test(e); }) ? ' (import bloqué)' : ' (ces lignes seront ignorées)') + ' :</b><br>' + R.erreurs.map(esc).join('<br>') + '</div>';
    h += R.modifs.slice(0, 300).map(function (m) {
      return '<div class="it"><div class="it-n"><b>' + esc(m.a.nom) + '</b><span>' + m.diffs.map(function (k) { return R.CH[k] + ' : ' + esc(valTxt(k, m.act[k])) + ' → <b>' + esc(valTxt(k, m.v[k])) + '</b>'; }).join(' · ') + '</span></div></div>';
    }).join('');
    h += R.nouveaux.map(function (x) { return '<div class="it"><div class="it-n"><b>' + esc(x.v.nom) + ' <span class="pill ok">nouvelle fiche</span></b><span>' + Object.keys(x.v).filter(function (k) { return k !== 'nom'; }).map(function (k) { return R.CH[k] + ' : ' + esc(valTxt(k, x.v[k])); }).join(' · ') + '</span></div></div>'; }).join('');
    h += R.suppr.map(function (a) { return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + ' <span class="pill ko">sera supprimée définitivement</span></b><span>Fiche, prix par fournisseur et historique des prix effacés ; les mouvements passés restent sous son nom.</span></div></div>'; }).join('');
    var bloque = R.erreurs.some(function (e) { return /plusieurs articles/.test(e); }) || !(R.modifs.length + R.nouveaux.length + R.suppr.length);
    return h + '<div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn l" data-act="aimpno">Annuler</button><button class="btn" data-act="aimpok"' + (bloque || R.busy ? ' disabled' : '') + '>' + (R.busy ? 'Enregistrement… ' + (R.fait || 0) + '/' + (R.modifs.length + R.nouveaux.length + R.suppr.length) : 'Appliquer') + '</button></div></div>';
  }
  function enregistrerFiche(a, v) {
    // a = fiche existante (ou null pour une nouvelle), v = valeurs du fichier
    var upd = {}; ['nom', 'reference', 'conditionnement', 'qte_par_boite', 'consommation', 'seuil', 'sans_seuil', 'conso_verifiee', 'archive'].forEach(function (k) { if (k in v) upd[k] = v[k]; });
    if (upd.sans_seuil) upd.seuil = 0;
    if ('fournisseur_id' in v) upd.fournisseur_id = v.fournisseur_id;
    if ('prix' in v) upd.prix = v.prix;
    var p;
    if (a) p = Object.keys(upd).length ? sb.from('articles').update(upd).eq('id', a.id).then(function (r) { if (r.error) throw r.error; return a.id; }) : Promise.resolve(a.id);
    else { upd.reference = upd.reference || 'SR'; if ('prix' in v) upd.cout_moyen = v.prix; p = sb.from('articles').insert(upd).select().single().then(function (r) { if (r.error) throw r.error; return r.data.id; }); }
    return p.then(function (id) {
      var fid = 'fournisseur_id' in v ? v.fournisseur_id : a ? a.fournisseur_id : null;
      if (!fid || !('fournisseur_id' in v || 'prix' in v || 'ref_fo' in v)) return;
      var anc = a ? (S.afPrix[a.id] || []) : [], ex = anc.filter(function (x) { return x.fournisseur_id === fid; })[0];
      var ligne = { article_id: id, fournisseur_id: fid, prix: 'prix' in v ? v.prix : ex ? +ex.prix : a ? +a.prix || 0 : 0, reference: 'ref_fo' in v ? v.ref_fo : ex ? ex.reference : null, rang: 0 };
      var ops = [sb.from('article_fournisseurs').upsert(ligne, { onConflict: 'article_id,fournisseur_id' })];
      anc.filter(function (x) { return x.fournisseur_id !== fid && x.rang === 0; }).forEach(function (x) { ops.push(sb.from('article_fournisseurs').update({ rang: 1 }).eq('article_id', id).eq('fournisseur_id', x.fournisseur_id)); });
      if ('prix' in v && v.prix > 0) ops.push(sb.from('prix_historique').upsert({ article_id: id, fournisseur_id: fid, date_prix: aujourdhui(), prix: v.prix, source: 'Import Excel' }, { onConflict: 'article_id,fournisseur_id,date_prix,prix', ignoreDuplicates: true }));
      return Promise.all(ops).then(function (rs) { rs.forEach(function (r) { if (r && r.error) throw r.error; }); });
    });
  }
  function appliquerImportArticles() {
    var R = S.artImp, taches = R.modifs.map(function (m) { var v = {}; m.diffs.forEach(function (k) { v[k] = m.v[k]; }); if (m.diffs.indexOf('fournisseur_id') >= 0) { if (!('prix' in v) && 'prix' in m.v) v.prix = m.v.prix; if (!('ref_fo' in v) && 'ref_fo' in m.v) v.ref_fo = m.v.ref_fo; } return [m.a, v]; })
      .concat(R.nouveaux.map(function (x) { return [null, x.v]; }));
    if (R.suppr.length && !confirm(R.suppr.length + ' fiche(s) vont être supprimées définitivement :\n' + R.suppr.slice(0, 15).map(function (a) { return '• ' + a.nom; }).join('\n') + (R.suppr.length > 15 ? '\n…' : '') + '\n\nContinuer ?')) return;
    R.suppr.forEach(function (a) { taches.push([a, null]); });
    R.busy = true; R.fait = 0; render();
    var i = 0, ko = [];
    function suite() {
      if (i >= taches.length) return Promise.resolve();
      var lot = taches.slice(i, i + 8); i += 8;
      return Promise.all(lot.map(function (t) {
        var p = t[1] === null ? sb.rpc('supprimer_article', { p_article: t[0].id }).then(function (r) { if (r.error) throw r.error; }) : enregistrerFiche(t[0], t[1]);
        return p.catch(function (e) { ko.push((t[0] ? t[0].nom : t[1].nom) + ' : ' + msgErr(e)); });
      }))
        .then(function () { R.fait = Math.min(i, taches.length); render(); return suite(); });
    }
    suite().then(function () {
      S.artImp = null;
      toast(ko.length ? '⚠️ ' + (taches.length - ko.length) + ' fiche(s) enregistrée(s), ' + ko.length + ' en erreur : ' + ko.slice(0, 3).join(' ; ') : '✔ Import terminé : ' + R.modifs.length + ' fiche(s) modifiée(s), ' + R.nouveaux.length + ' créée(s)' + (R.suppr.length ? ', ' + R.suppr.length + ' supprimée(s)' : ''));
      charger();
    });
  }

  // --- Inventaire de la réserve : fichier de comptage ---
  var COLS_I = [['N°', 'id'], ['Quantité comptée', 'q'], ['Motif si écart', 'motif']];
  function exporterComptage() {
    var l = S.articles.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    var lignes = l.map(function (a) { return [a.id, a.nom, a.reference || 'SR', S.fournisseurs[a.fournisseur_id] || 'SF', uInv(a, 0) === 'u.' ? (facteur(a) > 1 ? 'unités (boîte de ' + fr(a.qte_par_boite) + ')' : 'unités') : 'boîtes', theo(a, 0), null, null]; });
    var aide = [['Remplissez la colonne « Quantité comptée » pour chaque article compté dans la réserve, puis importez le fichier dans l’onglet Inventaire (emplacement Réserve).'],
      ['Comptez dans l’unité indiquée par la colonne « Compter en ».'], ['Case vide = article non compté. Pendant l’inventaire de départ (J0), au premier comptage de la réserve, les articles non comptés passent à 0 : l’appli vous le rappelle avant de valider.'],
      ['Mettez 0 pour un article absent.'], ['Motif si écart (hors J0) : ' + MOTIFS.join(', ') + '.'], ['Après l’import, l’appli affiche le récapitulatif habituel : rien n’est enregistré avant « Valider l’inventaire ».']];
    XLSX_EVY.creer([
      { nom: 'Comptage réserve', colonnes: ['N°', 'Article', 'Référence', 'Fournisseur', 'Compter en', 'Stock enregistré', 'Quantité comptée', 'Motif si écart'], lignes: lignes },
      { nom: 'Mode d’emploi', colonnes: ['Mode d’emploi'], lignes: aide }
    ]).then(function (b) { telecharger(b, nomFichier('comptage-reserve')); toast('✔ Fichier de comptage téléchargé'); }).catch(function (e) { toast(msgErr(e)); });
  }
  function importerComptage(file) {
    if (!file) return;
    file.arrayBuffer().then(XLSX_EVY.lire).then(function (cl) {
      var rows = feuilleDe(cl, 'Comptage réserve'), idx = colonnes(rows[0], COLS_I), d = {}, motifs = {}, err = [], n = 0;
      if (idx.id == null || idx.q == null) throw new Error('Colonnes « N° » et « Quantité comptée » introuvables : utilisez le fichier de comptage de l’appli');
      rows.slice(1).forEach(function (r, i) {
        if (!r || vide(r[idx.id]) || vide(r[idx.q])) return;
        var id = nombre(r[idx.id]), q = nombre(r[idx.q]), a = S.byId[id];
        if (!a) { err.push('ligne ' + (i + 2) + ' : N° inconnu ou article archivé'); return; }
        if (q == null || q < 0) { err.push('ligne ' + (i + 2) + ' (' + a.nom + ') : quantité invalide'); return; }
        d[id] = String(q).replace('.', ','); n++;
        if (idx.motif != null && !vide(r[idx.motif])) { var m = MOTIFS.filter(function (x) { return norm(x) === norm(String(r[idx.motif])).trim(); })[0]; if (m) motifs[id] = m; }
      });
      if (!n) throw new Error('Aucune quantité comptée dans le fichier' + (err.length ? ' (' + err.length + ' erreur(s))' : ''));
      choisirEmp(0); S.inv.d = d; S.inv.motifs = motifs; ecrireBrouillon(); S.inv.recap = true;
      S.inv.msg = [err.length ? 'warn' : 'ok', '📥 Fichier importé : ' + n + ' article(s) compté(s)' + (err.length ? '. Lignes ignorées : ' + err.map(esc).join(' · ') : '') + '. Vérifiez le récapitulatif ci-dessous puis validez l’inventaire.'];
      render(); window.scrollTo(0, 0);
    }).catch(function (e) { toast('Lecture du fichier impossible : ' + (e && e.message || e)); });
  }

  // ---------- Équipe (gestion) ----------
  // Règles des codes : assistante = 6 chiffres ; référente / responsable = 10 caractères, lettres et chiffres.
  function regleMdp(role, m) {
    if (role === 'assistante') return /^\d{6}$/.test(m) ? null : 'Le code d’une assistante doit faire 6 chiffres';
    return m.length >= 10 && /[A-Za-z]/.test(m) && /\d/.test(m) ? null : 'Le mot de passe doit faire au moins 10 caractères, avec des lettres et des chiffres';
  }
  function champMdp(id, role, label) {
    var num = role === 'assistante';
    return '<label class="mu">' + label + ' <small>(' + (num ? '6 chiffres' : '10 caractères min., lettres et chiffres') + ')</small><input class="in" id="' + id + '" type="password" autocomplete="new-password"' + (num ? ' inputmode="numeric" maxlength="6"' : '') + '></label>';
  }
  function equipe(corps) {
    return sb.functions.invoke('equipe', { body: corps }).then(function (r) {
      if (r.error) {
        var c = r.error.context;
        if (c && typeof c.json === 'function') return c.json().then(function (j) { throw new Error(j && j.erreur || r.error.message); }, function () { throw new Error(r.error.message); });
        throw new Error(/Failed to send|fetch/i.test(r.error.message) ? 'Service des comptes injoignable (fonction « equipe » pas encore installée ?)' : r.error.message);
      }
      if (r.data && r.data.erreur) throw new Error(r.data.erreur);
      return r.data;
    });
  }
  function vEquipe() {
    var h = '<h2>Équipe</h2><div class="row wrap" style="margin-bottom:10px"><p class="mu grow" style="margin:0">Comptes, rôles, cabinet par défaut et autorisation temporaire d’inventaire de la réserve. Un compte désactivé ne peut plus se connecter ; son historique est conservé.</p>'
      + (S.eqNew ? '' : '<button class="btn" data-act="eqnew">+ Nouveau compte</button>') + '</div>';
    if (S.eqNew) {
      var N = S.eqNew;
      h += '<div class="card" style="border:2px solid var(--gold)"><b>Nouveau compte</b><div class="g2" style="margin-top:8px">'
        + '<label class="mu">Identifiant de connexion<input class="in" id="nid" autocomplete="off" autocapitalize="none" value="' + esc(N.identifiant) + '" placeholder="ex. sarah"></label>'
        + '<label class="mu">Prénom affiché<input class="in" id="nnom" value="' + esc(N.nom) + '"></label>'
        + '<label class="mu">Rôle<select class="in" id="nrole">' + ['assistante', 'referente', 'responsable'].map(function (r) { return '<option value="' + r + '"' + (N.role === r ? ' selected' : '') + '>' + LABEL[r] + '</option>'; }).join('') + '</select></label>'
        + '<label class="mu">Cabinet par défaut<select class="in" id="ncab"><option value="">Aucun</option>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (+N.cabinet === c ? ' selected' : '') + '>Cabinet ' + c + '</option>'; }).join('') + '</select></label>'
        + champMdp('nmdp', N.role, N.role === 'assistante' ? 'Code' : 'Mot de passe') + champMdp('nmdp2', N.role, 'Confirmer')
        + '</div><p class="mu" style="margin:10px 0">Notez le code et donnez-le à la personne : il ne sera plus affiché ensuite.</p>'
        + '<div class="row"><button class="btn l" data-act="eqnewno">Annuler</button><button class="btn" data-act="eqnewok"' + (N.busy ? ' disabled' : '') + '>Créer le compte</button></div></div>';
    }
    var ps = S.profils.slice().sort(function (a, b) { return (b.actif - a.actif) || a.nom.localeCompare(b.nom); });
    return h + ps.map(function (p) {
      if (S.eqEdit === p.id) {
        return '<div class="card"><div class="g2">'
          + '<label class="mu">Identifiant de connexion<input class="in" id="eid" autocomplete="off" autocapitalize="none" value="' + esc(p.identifiant) + '"></label>'
          + '<label class="mu">Prénom affiché<input class="in" id="enom" value="' + esc(p.nom) + '"></label>'
          + '<label class="mu">Rôle<select class="in" id="erole">' + ['assistante', 'referente', 'responsable'].map(function (r) { return '<option value="' + r + '"' + (p.role === r ? ' selected' : '') + '>' + LABEL[r] + '</option>'; }).join('') + '</select></label>'
          + '<label class="mu">Cabinet par défaut<select class="in" id="ecab"><option value="">Aucun</option>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (p.cabinet === c ? ' selected' : '') + '>Cabinet ' + c + '</option>'; }).join('') + '</select></label>'
          + '<label class="mu">Inventaire de la réserve autorisé jusqu’au<input class="in" type="date" id="eres" value="' + esc(p.reserve_jusquau || '') + '"></label>'
          + '</div><label class="row" style="margin:12px 0"><input type="checkbox" id="eact"' + (p.actif ? ' checked' : '') + (p.id === S.me.id ? ' disabled' : '') + ' style="width:20px;height:20px"> Compte actif' + (p.id === S.me.id ? ' <span class="mu">(votre compte)</span>' : '') + '</label>'
          + '<div class="row"><button class="btn l" data-act="eannule">Annuler</button><button class="btn" data-esave="' + p.id + '">Enregistrer</button></div>'
          + '<div style="border-top:1px solid var(--soft);margin-top:14px;padding-top:12px"><b>🔑 Réinitialiser ' + (p.role === 'assistante' ? 'le code' : 'le mot de passe') + '</b> <span class="mu">(si la personne l’a oublié)</span><div class="g2" style="margin-top:8px">'
          + champMdp('rmdp', p.role, 'Nouveau') + champMdp('rmdp2', p.role, 'Confirmer') + '</div><button class="btn l" style="margin-top:10px" data-ereinit="' + p.id + '">Réinitialiser</button></div></div>';
      }
      var res = p.reserve_jusquau && p.reserve_jusquau >= new Date().toISOString().slice(0, 10);
      return '<div class="card row wrap"' + (p.actif ? '' : ' style="opacity:.65"') + '><div class="grow"><b>' + esc(p.nom) + '</b> <span class="mu">(' + esc(p.identifiant) + ')</span>' + (p.actif ? '' : ' <span class="pill ko">désactivé</span>') + '<br><span class="mu">' + LABEL[p.role] + (p.cabinet ? ' · cabinet ' + p.cabinet : '') + (res ? ' · réserve autorisée jusqu’au ' + p.reserve_jusquau.split('-').reverse().join('/') : '') + '</span></div>'
        + '<button class="btn l sm" data-eedit="' + p.id + '">Modifier</button></div>';
    }).join('');
  }
  function creerCompte() {
    var N = S.eqNew, m = $('nmdp').value, m2 = $('nmdp2').value;
    N.identifiant = norm($('nid').value).replace(/\s+/g, ''); N.nom = $('nnom').value.trim();
    if (!N.identifiant || !N.nom) { toast('Identifiant et prénom obligatoires'); return; }
    var pb = regleMdp(N.role, m); if (pb) { toast(pb); return; }
    if (m !== m2) { toast('Les deux saisies ne correspondent pas'); return; }
    N.busy = true; render();
    equipe({ action: 'creer', identifiant: N.identifiant, nom: N.nom, role: N.role, cabinet: N.cabinet ? +N.cabinet : null, mdp: m }).then(function (r) {
      S.eqNew = null; toast('✔ Compte créé · identifiant : ' + r.identifiant); charger();
    }).catch(function (e) { N.busy = false; toast(e.message); render(); });
  }
  function reinitMdp(id) {
    var p = S.profils.filter(function (x) { return x.id === id; })[0], m = $('rmdp').value, m2 = $('rmdp2').value;
    var pb = regleMdp(p.role, m); if (pb) { toast(pb); return; }
    if (m !== m2) { toast('Les deux saisies ne correspondent pas'); return; }
    if (!confirm('Remplacer ' + (p.role === 'assistante' ? 'le code' : 'le mot de passe') + ' de ' + p.nom + ' ?')) return;
    equipe({ action: 'reinit', user_id: id, mdp: m }).then(function () { $('rmdp').value = ''; $('rmdp2').value = ''; toast('✔ Nouveau ' + (p.role === 'assistante' ? 'code' : 'mot de passe') + ' enregistré pour ' + p.nom); })
      .catch(function (e) { toast(e.message); });
  }
  function sauverProfil(id) {
    var p = S.profils.filter(function (x) { return x.id === id; })[0];
    var o = { nom: $('enom').value.trim(), role: $('erole').value, cabinet: $('ecab').value ? +$('ecab').value : null, reserve_jusquau: $('eres').value || null };
    var actif = $('eact').checked, ident = norm($('eid').value).replace(/\s+/g, ''), identChange = ident !== p.identifiant || (id === S.me.id && S.session && S.session.user && String(S.session.user.email).toLowerCase() !== ident + '@' + C.domaine);
    if (!ident) { toast('L’identifiant ne peut pas être vide'); return; }
    if (identChange && !confirm('Nouvel identifiant de connexion pour ' + p.nom + ' : « ' + ident + ' ».\nÀ la prochaine connexion, il faudra taper « ' + ident + ' ». Le code ne change pas.')) return;
    if (!o.nom) { toast('Le prénom ne peut pas être vide'); return; }
    if (id === S.me.id && o.role === 'assistante' && !confirm('Vous allez retirer vos propres droits de gestion. Continuer ?')) return;
    if (p.actif && !actif && !confirm('Désactiver le compte de ' + p.nom + ' ? Elle ne pourra plus se connecter. Son historique est conservé et le compte pourra être réactivé.')) return;
    if (o.role !== p.role) toast(o.role === 'assistante' ? 'Pensez à lui donner un code à 6 chiffres (Réinitialiser)' : p.role === 'assistante' ? 'Pensez à lui donner un mot de passe solide (Réinitialiser)' : '');
    sb.from('profils').update(o).eq('id', id).select().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error('Modification refusée');
      if (id === S.me.id) S.me = r.data[0];
      return actif !== p.actif ? equipe({ action: 'actif', user_id: id, actif: actif }) : null;
    }).then(function () { return identChange ? equipe({ action: 'identifiant', user_id: id, identifiant: ident }) : null;
    }).then(function () { if (identChange && id === S.me.id) S.me.identifiant = ident; S.eqEdit = null; toast('✔ Profil enregistré' + (identChange ? ' · identifiant : ' + ident : '') + (actif !== p.actif ? (actif ? ' · compte réactivé' : ' · compte désactivé') : '')); charger(); })
      .catch(function (e) { toast(msgErr(e)); });
  }
  // ---------- Mon code (tout le monde) ----------
  function vCompte() {
    var r = S.me.role, quoi = r === 'assistante' ? 'code' : 'mot de passe';
    return '<h2>Changer mon ' + quoi + '</h2><div class="card" style="max-width:520px">'
      + '<p class="mu" style="margin-top:0">Connectée en tant que <b>' + esc(S.me.nom) + '</b> (' + esc(S.me.identifiant) + ').</p><div style="display:flex;flex-direction:column;gap:10px">'
      + champMdp('cm0', r, (r === 'assistante' ? 'Code' : 'Mot de passe') + ' actuel').replace(' autocomplete="new-password"', ' autocomplete="current-password"')
      + champMdp('cm1', r, 'Nouveau ' + quoi) + champMdp('cm2', r, 'Confirmer le nouveau ' + quoi)
      + '</div><div class="row" style="margin-top:12px"><button class="btn l" data-tab="' + (gestion() ? 'accueil' : 'sortie') + '">Annuler</button><button class="btn" data-act="cmok"' + (S.cmBusy ? ' disabled' : '') + '>Enregistrer</button></div></div>';
  }
  function changerMonMdp() {
    var r = S.me.role, a = $('cm0').value, m = $('cm1').value, m2 = $('cm2').value;
    var pb = regleMdp(r, m); if (pb) { toast(pb); return; }
    if (m !== m2) { toast('Les deux saisies ne correspondent pas'); return; }
    if (m === a) { toast('Le nouveau doit être différent de l’actuel'); return; }
    S.cmBusy = true; render();
    var email = S.session && S.session.user && S.session.user.email;
    sb.auth.signInWithPassword({ email: email, password: a }).then(function (x) {
      if (x.error) throw new Error((r === 'assistante' ? 'Code' : 'Mot de passe') + ' actuel incorrect');
      return sb.auth.updateUser({ password: m });
    }).then(function (x) {
      if (x.error) throw x.error;
      S.cmBusy = false; toast('✔ ' + (r === 'assistante' ? 'Code' : 'Mot de passe') + ' changé'); S.tab = gestion() ? 'accueil' : 'sortie'; render();
    }).catch(function (e) { S.cmBusy = false; toast(msgErr(e)); render(); });
  }

  // ---------- Événements (délégation) ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || !S.me) return;
    var d = t.dataset;
    if (d.go) { var g = d.go.split(':'); S.tab = g[0]; S.tabChoisi = true; if (g[0] === 'stock') S.stockF = g[1] || ''; if (g[0] === 'inventaire' && g[1] !== undefined) choisirEmp(+g[1]); if (g[0] === 'histo') { S.histTous = true; chargerHisto(); } render(); window.scrollTo(0, 0); return; }
    if (d.tab) { S.fiche = null; S.tab = d.tab; S.tabChoisi = true; if (d.tab === 'histo') chargerHisto(); render(); window.scrollTo(0, 0); return; }
    if (d.act === 'out') { if (confirm('Changer de personne ? La personne suivante devra se connecter avec son identifiant et son code.')) deconnexion(); return; }
    if (d.act === 'maj') return mettreAJour();
    if (d.act === 'sauver') return telechargerSauvegarde();
    if (d.act === 'aexp') return exporterArticles();
    if (d.act === 'asuppr') return supprimerArticle();
    if (d.act === 'aimpno') { S.artImp = null; render(); return; }
    if (d.act === 'aimpok') return appliquerImportArticles();
    if (d.act === 'iexp') return exporterComptage();
    if (d.act === 'valider') return validerSortie();
    if (d.act === 'rvalider') return validerRetour();
    if (d.act === 'rvider') { S.ret.panier = {}; render(); return; }
    if (d.rplus) { setRet(d.rplus, (S.ret.panier[d.rplus] || 0) + 1); S.ret.msg = null; render(); return; }
    if (d.rmoins) { setRet(d.rmoins, (S.ret.panier[d.rmoins] || 0) - 1); render(); return; }
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
    if (d.csub) { S.cmdSub = d.csub; S.fiche = null; render(); return; }
    if (d.sugopen) { S.sugOpen[d.sugopen] = !S.sugOpen[d.sugopen]; render(); return; }
    if (d.cfrom) return depuisSuggestion(+d.cfrom);
    if (d.copen) { ouvrirCommande(+d.copen); window.scrollTo(0, 0); return; }
    if (d.ncadd) { if (!S.nc.l.some(function (l) { return l.article_id === +d.ncadd; })) { var aa = S.byId[d.ncadd]; S.nc.l.push({ article_id: +d.ncadd, quantite: 1, prix: prixChez(aa, +S.nc.fid) }); } S.nc.q = ''; render(); return; }
    if (d.ncdel) { S.nc.l.splice(+d.ncdel, 1); render(); return; }
    if (d.act === 'ncgo') { var N = S.nc; return creerCommande(+N.fid, N.l.map(function (l) { return { article_id: l.article_id, quantite: nb(String(l.quantite).replace(',', '.')), prix: nb(String(l.prix).replace(',', '.')) }; }), N.num.trim()).then(function () { S.nc = { fid: '', num: '', q: '', l: [] }; }); }
    if (d.act === 'rxgo') return receptionner();
    if (d.rxundo) return annulerReception(d.rxundo);
    if (d.rxab) return abandonnerReste(+d.rxab);
    if (d.act === 'cclose') return cloturerCommande();
    if (d.act === 'impno') { S.fiche.imp = null; render(); return; }
    if (d.act === 'impok') return appliquerImport();
    if (d.act === 'caouvre') { S.fiche.ajout = { q: '' }; render(); var ca = document.getElementById('caq'); if (ca) ca.focus(); return; }
    if (d.act === 'cano') { S.fiche.ajout = null; render(); return; }
    if (d.caadd) return ajouterLigne(+d.caadd);
    if (d.act === 'cnumedit') { S.fiche.editNum = true; render(); var ci = document.getElementById('cnum'); if (ci) ci.focus(); return; }
    if (d.act === 'cnumno') { S.fiche.editNum = false; S.fiche.num = null; render(); return; }
    if (d.act === 'cnumok') { var cid = S.fiche.id, nv = (S.fiche.num != null ? S.fiche.num : (document.getElementById('cnum') || {}).value || '').trim(); return sb.from('commandes').update({ numero: nv || null }).eq('id', cid).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } toast('✔ Référence de commande enregistrée'); S.fiche.num = null; S.fiche.editNum = false; chargerCommandes().then(render); }); }
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
    if (d.act === 'fosuppr') return supprimerFo();
    if (d.copie != null) { try { navigator.clipboard.writeText(d.copie).then(function () { toast('✔ Copié'); }); } catch (er) { toast('Copie impossible'); } return; }
    if (d.act === 'eannule') { S.eqEdit = null; render(); return; }
    if (d.esave) return sauverProfil(d.esave);
    if (d.ereinit) return reinitMdp(d.ereinit);
    if (d.act === 'eqnew') { S.eqNew = { identifiant: '', nom: '', role: 'assistante', cabinet: '' }; S.eqEdit = null; render(); return; }
    if (d.act === 'eqnewno') { S.eqNew = null; render(); return; }
    if (d.act === 'eqnewok') return creerCompte();
    if (d.act === 'cmok') return changerMonMdp();
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.id === 'sq') { S.sortie.q = t.value; S.sortie.msg = null; render(); }
    else if (t.id === 'rq') { S.ret.q = t.value; S.ret.msg = null; render(); }
    else if (t.dataset && t.dataset.rqte) { setRet(t.dataset.rqte, t.value); var rb = document.querySelector('.bar'); if (rb) rb.outerHTML = vBarRetour(); }
    else if (t.id === 'stq') { S.stockQ = t.value; render(); }
    else if (t.dataset && t.dataset.sugq) { S.sugQ[t.dataset.sugq] = t.value; }
    else if (t.id === 'ncnum') { S.nc.num = t.value; }
    else if (t.id === 'cnum') { S.fiche.num = t.value; }
    else if (t.id === 'caq') { S.fiche.ajout.q = t.value; render(); var ca = document.getElementById('caq'); if (ca) { ca.focus(); ca.setSelectionRange(ca.value.length, ca.value.length); } }
    else if (t.id === 'ncq') { S.nc.q = t.value; render(); }
    else if (t.dataset && t.dataset.ncl != null) { S.nc.l[+t.dataset.ncl][t.dataset.nck] = t.value; }
    else if (t.dataset && t.dataset.rxq) { (S.fiche.rx[t.dataset.rxq] = S.fiche.rx[t.dataset.rxq] || {}).q = t.value; }
    else if (t.dataset && t.dataset.rxg) { (S.fiche.rx[t.dataset.rxg] = S.fiche.rx[t.dataset.rxg] || {}).g = t.value; }
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
    if (t.id === 'nrole' && S.eqNew) { S.eqNew.role = t.value; S.eqNew.identifiant = $('nid').value; S.eqNew.nom = $('nnom').value; render(); }
    else if (t.id === 'ncab' && S.eqNew) { S.eqNew.cabinet = t.value; }
    else if (t.id === 'aimpf') { var fa = t.files && t.files[0]; t.value = ''; importerArticles(fa); }
    else if (t.id === 'iimpf') { var fc = t.files && t.files[0]; t.value = ''; importerComptage(fc); }
    else if (t.id === 'impf') { var fi = t.files && t.files[0]; t.value = ''; importerFacture(fi); }
    else if (t.dataset && t.dataset.impc != null && S.fiche && S.fiche.imp) { S.fiche.imp.items[+t.dataset.impc].choix = t.value; render(); }
    else if (t.id === 'scab') { S.sortie.cab = +t.value; render(); }
    else if (t.id === 'rcab') { S.ret.cab = +t.value; render(); }
    else if (t.id === 'ncfo') { S.nc.fid = t.value; S.nc.l.forEach(function (l) { l.prix = prixChez(S.byId[l.article_id], +t.value); }); render(); }
    else if (t.id === 'foarch') { S.foArch = t.checked; render(); }
    else if (t.dataset && (t.dataset.afF || t.dataset.foK) && S.fiche) { if (t.dataset.afF) S.fiche.d[t.dataset.afF] = t.type === 'checkbox' ? t.checked : t.value; else S.fiche.foEdit[+t.dataset.foI][t.dataset.foK] = t.value; if (t.tagName === 'SELECT' || t.type === 'checkbox') render(); }
    else if (t.id === 'iemp') { if (t.value === '') { S.inv.emp = null; } else choisirEmp(+t.value); render(); }
    else if (t.id === 'itous') { S.inv.tous = t.checked; render(); }
    else if (t.dataset && t.dataset.imotif) { S.inv.motifs[t.dataset.imotif] = t.value; }
    else if (t.id === 'htous') { S.histTous = t.checked; chargerHisto(); }
  });
  // Nouvelle version publiée ? On compare avec le fichier config.js du serveur, sans cache.
  function verifierVersion() {
    fetch('js/config.js?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var m = t.match(/version = '([^']+)'/);
      if (m && m[1] !== C.version && !S.nouvelleVersion) { S.nouvelleVersion = m[1]; render(); }
    }).catch(function () {});
  }
  function mettreAJour() {
    var f = ['./', 'index.html'];
    Promise.all(f.map(function (u) { return fetch(u, { cache: 'reload' }).catch(function () {}); })).then(function () { location.reload(); });
  }
  setInterval(verifierVersion, 5 * 60 * 1000); setTimeout(verifierVersion, 3000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { verifierVersion(); if (S.me) charger(); } });

  // ---------- Démarrage ----------
  sb.auth.getSession().then(function (r) { if (r.data.session) demarrer(r.data.session); else render(); });
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === 'SIGNED_OUT') { oublierPersonne(); render(); } else if (session) S.session = session; });
})();
