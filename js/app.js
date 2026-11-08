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
    stockQ: '', stockF: '', histTous: false, eqEdit: null, pwAbc: false, dernierInv: {}, recents: [], j0: null, invJ0: {},
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
      toutLire('articles', 'id,code,nom,reference,fournisseur_id,conditionnement,qte_par_boite,consommation,seuil,sans_seuil,cout_moyen,archive', function (q) { return q.eq('archive', false).order('nom'); }),
      toutLire('stocks', 'article_id,emplacement,quantite'),
      toutLire('fournisseurs', 'id,nom'),
      sb.from('profils').select('*').order('nom').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('mouvements').select('*').eq('statut', 'attente').order('cree_le').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('parametres').select('cle,valeur').eq('cle', 'j0').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('inventaires').select('emplacement,date_inv,j0').order('date_inv', { ascending: false }).limit(500).then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('mouvements').select('*').order('cree_le', { ascending: false }).limit(30).then(function (r) { if (r.error) throw r.error; return r.data; })
    ];
    return Promise.all(ps).then(function (x) {
      S.articles = x[0]; S.byId = {}; S.articles.forEach(function (a) { S.byId[a.id] = a; });
      S.stocks = {}; x[1].forEach(function (s) { (S.stocks[s.article_id] = S.stocks[s.article_id] || {})[s.emplacement] = +s.quantite; });
      S.fournisseurs = {}; x[2].forEach(function (f) { S.fournisseurs[f.id] = f.nom; });
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
    if (gestion()) tabs.push(['demandes', 'Demandes' + (S.attente.length ? '<span class="badge">' + S.attente.length + '</span>' : '')], ['stock', 'Stock']);
    tabs.push(['histo', 'Historique']);
    if (gestion()) tabs.push(['equipe', 'Équipe']);
    var h = '<header class="top"><div class="top-in"><img src="assets/logo-evydent.jpg" alt="">'
      + '<div class="top-who"><b>' + esc(S.me.nom) + (C.env === 'dev' ? ' <span class="env">TEST</span>' : '') + '</b><span>' + LABEL[S.me.role] + (S.me.cabinet ? ' · cabinet ' + S.me.cabinet : '') + '</span></div>'
      + '<button class="btn l sm" data-act="out">Changer de personne</button></div>'
      + '<nav class="tabs" aria-label="Menu">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav></header>';
    h += '<main>' + (S.loading ? '<p class="mu">Mise à jour…</p>' : '') + ({ accueil: vAccueil, sortie: vSortie, inventaire: vInventaire, demandes: vDemandes, stock: vStock, histo: vHisto, equipe: vEquipe }[S.tab] || vSortie)() + '</main>';
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
  var STF = { rupture: 'En rupture', commander: 'À commander', sr: 'Sans référence', sf: 'Sans fournisseur', seuil: 'Sans seuil' };
  function estSR(a) { return !a.reference || /^\s*SR\s*$/i.test(a.reference); }
  function filtreStock(a, f) {
    var r = stockDe(a.id, 0), s = +a.seuil || 0;
    if (f === 'rupture') return !a.sans_seuil && s > 0 && r <= 0;
    if (f === 'commander') return !a.sans_seuil && s > 0 && r > 0 && r <= s;
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
    var att = S.attente.length, cmd = cnt.rupture + cnt.commander;
    h += '<div class="tiles">'
      + tuile(att, 'demande' + (att > 1 ? 's' : '') + ' à confirmer', att ? 'warn' : 'ok', 'demandes', att ? 'Sorties au-delà de la réserve' : 'Rien en attente')
      + tuile(cnt.rupture, 'en rupture', cnt.rupture ? 'ko' : 'ok', 'stock:rupture', 'Réserve à zéro')
      + tuile(cnt.commander, 'à commander', cnt.commander ? 'warn' : 'ok', 'stock:commander', 'Sous le seuil d’alerte')
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
    if (d.tab) { S.tab = d.tab; S.tabChoisi = true; if (d.tab === 'histo') chargerHisto(); render(); window.scrollTo(0, 0); return; }
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
    if (d.act === 'eannule') { S.eqEdit = null; render(); return; }
    if (d.esave) return sauverProfil(d.esave);
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.id === 'sq') { S.sortie.q = t.value; S.sortie.msg = null; render(); }
    else if (t.id === 'stq') { S.stockQ = t.value; render(); }
    else if (t.id === 'iq') { S.inv.q = t.value; S.inv.max = 80; render(); }
    else if (t.dataset && t.dataset.iq) { S.inv.d[t.dataset.iq] = t.value.trim(); ecrireBrouillon(); var b2 = document.querySelector('.bar'); if (b2) b2.outerHTML = vBarInv(); }
    else if (t.dataset && t.dataset.qte) { setQte(t.dataset.qte, t.value); var b = document.querySelector('.bar'); if (b) b.outerHTML = vBarSortie(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.id === 'scab') { S.sortie.cab = +t.value; render(); }
    else if (t.id === 'iemp') { if (t.value === '') { S.inv.emp = null; } else choisirEmp(+t.value); render(); }
    else if (t.id === 'itous') { S.inv.tous = t.checked; render(); }
    else if (t.dataset && t.dataset.imotif) { S.inv.motifs[t.dataset.imotif] = t.value; }
    else if (t.id === 'htous') { S.histTous = t.checked; chargerHisto(); }
    else if (t.dataset && t.dataset.qte) render();
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.me) charger(); });

  // ---------- Démarrage ----------
  sb.auth.getSession().then(function (r) { if (r.data.session) demarrer(r.data.session); else render(); });
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === 'SIGNED_OUT') { S.session = null; S.me = null; render(); } else if (session) S.session = session; });
})();
