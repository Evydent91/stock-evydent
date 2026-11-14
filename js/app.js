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
  function cabTxt(e) { return e === 0 ? 'Réserve' : e === 9 ? 'La Sté' : 'Cab. ' + e; }
  // Emplacement 9 = « La Sté » (stérilisation) : sorties et inventaire comme un cabinet, sans retour.
  function lieuTxt(e) { return +e === 9 ? 'la Sté' : 'cabinet ' + e; }
  function pourTxt(e) { return +e === 9 ? '<b>la Sté</b>' : 'le <b>cabinet ' + e + '</b>'; }
  // L'article est-il utilisé à cet emplacement ? (Lieu 1 = cabinets, Lieu 2 = la Sté ; la réserve voit tout)
  function pourLieu(a, e) { e = +e; return e === 9 ? a.lieu_ste === true : e >= 1 && e <= 8 ? a.lieu_cabinets !== false : true; }
  function horsCab(e) { e = +e; return !!S.me.cabinet && e >= 1 && e <= 8 && e !== +S.me.cabinet; }
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
    if (ev) ev.preventDefault();
    var id = ($('lid').value || '').trim(), pw = $('lpw') ? $('lpw').value : (S.pin || '');
    if (!id || !pw) { S.err = !id ? 'Tapez d’abord votre identifiant.' : 'Tapez votre code.'; S.pin = ''; render(); return; }
    S.lbusy = true; S.lid = id; render();
    sb.auth.signInWithPassword({ email: emailDe(id), password: pw }).then(function (r) {
      S.lbusy = false; S.pin = '';
      if (r.error) { S.err = msgErr(r.error); render(); var p = $('lpw'); if (p) { p.value = ''; p.focus(); } return; }
      try { localStorage.setItem('evy-dernier-id', id); } catch (e) {}
      S.err = ''; S.lid = null; window.scrollTo(0, 0); demarrer(r.data.session);
    });
  }
  // À chaque changement de personne : on repart de zéro (cabinet par défaut, panier, inventaire, écrans ouverts)
  function oublierPersonne() {
    S.session = null; S.me = null; S.tab = 'maison'; S.tabChoisi = false; S.fiche = null; S.eqEdit = null; S.eqNew = null; S.cmBusy = false; S.histTous = false; S.histo = []; S.menu = false; S.tour = null; S.pl = null; S.plImp = null; S.pf = null; S.df = null; S.equipe = null; S.dentistes = null; S.conges = null; S.mesConges = null; S.moiEq = null; S.dm = null; S.rgEdit = null; S.cAjout = null;
    S.sortie = { cab: null, q: '', panier: {}, msg: null, busy: false };
    S.ret = { cab: null, q: '', panier: {}, msg: null, busy: false };
    S.inv = { emp: null, d: {}, q: '', tous: false, recap: false, motifs: {}, busy: false, msg: null, max: 80 };
  }
  function deconnexion() { sb.auth.signOut().then(function () { oublierPersonne(); render(); }); }

  // Connexion : pavé numérique pour le code à 6 chiffres (le clavier du téléphone ne s'ouvre pas),
  // ou mot de passe avec lettres pour la référente et la responsable.
  function dernierId() { try { return localStorage.getItem('evy-dernier-id') || ''; } catch (e) { return ''; } }
  function vLogin() {
    var id = $('lid') ? $('lid').value : (S.lid != null ? S.lid : dernierId());
    var pin = S.pin || '', modePin = !S.pwAbc && id.indexOf('@') < 0;
    var h = '<div class="lg"><div class="lg-top"></div><div class="lg-in">'
      + '<div class="lg-hd"><img class="lg-logo" src="assets/logo-evydent.jpg" alt="Logo Evydent Val d’Yerres"><div class="lg-name">Espace dentaire Val d’Yerres</div><div class="lg-sub">Gestion du stock · Espace équipe' + (C.env === 'dev' ? ' · <span class="env">TEST</span>' : '') + '</div></div>'
      + '<form class="lg-card" id="lform" autocomplete="on"><h1>Bonjour</h1><p class="lg-sous m-only">Gestion du stock' + (C.env === 'dev' ? ' <span class="env">TEST</span>' : '') + '</p>'
      + '<label>Identifiant<input id="lid" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Votre identifiant" value="' + esc(id) + '"></label>';
    if (modePin) {
      h += '<div class="pin-l">Mon code</div><div class="pin-pts" aria-label="' + pin.length + ' chiffres sur 6">' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<span class="' + (i < pin.length ? 'on' : '') + '"></span>'; }).join('') + '</div>'
        + (S.err ? '<p class="lg-err" role="alert">' + esc(S.err) + '</p>' : '')
        + '<div class="pin-pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(function (k) { return '<button type="button" class="pk" data-k="' + k + '">' + k + '</button>'; }).join('')
        + '<button type="button" class="pk pk-x" data-k="x" aria-label="Effacer le dernier chiffre">Effacer</button><button type="button" class="pk" data-k="0">0</button>'
        + '<button type="submit" class="pk pk-ok" id="lbtn"' + (pin.length < 6 || S.lbusy ? ' disabled' : '') + '>' + (S.lbusy ? '…' : 'Entrer') + '</button></div>'
        + '<button type="button" class="lnk lg-alt" id="labc">Mot de passe avec lettres (référente, responsable)</button>';
    } else {
      h += '<label>Mot de passe<span class="lg-pw"><input id="lpw" name="password" type="password" autocomplete="current-password" placeholder="Votre mot de passe"></span></label>'
        + (S.err ? '<p class="lg-err" role="alert">' + esc(S.err) + '</p>' : '')
        + '<button class="btn gold" id="lbtn" type="submit"' + (S.lbusy ? ' disabled' : '') + '>Se connecter</button>'
        + '<button type="button" class="lnk lg-alt" id="labc">Code à 6 chiffres (assistantes)</button>';
    }
    return h + '<p class="lg-help">Code oublié ? Demandez à la référente.<span class="m-only"><br>On reste connecté : pas besoin de retaper le code.</span></p></form>'
      + '<div class="lg-foot">Accès réservé au personnel du centre · 01 85 12 00 85<br><small>Version ' + esc(C.version || '') + '</small></div></div></div>';
  }
  function bindLogin() {
    $('lform').addEventListener('submit', connexion);
    $('labc').addEventListener('click', function () { S.lid = $('lid').value; S.pwAbc = !S.pwAbc; S.pin = ''; S.err = ''; render(); var p = $('lpw'); if (p) p.focus(); });
    $('lid').addEventListener('input', function () { S.lid = this.value; });
    $('lform').addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b || S.lbusy) return;
      S.lid = $('lid').value; S.err = '';
      var k = b.dataset.k, p = S.pin || '';
      S.pin = k === 'x' ? p.slice(0, -1) : (p.length < 6 ? p + k : p);
      render();
      if (S.pin.length === 6 && k !== 'x') connexion();
    });
    if (!$('lid').value) $('lid').focus(); else if ($('lpw')) $('lpw').focus();
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
      if (!gestion() && ['maison', 'sortie', 'retour', 'inventaire', 'histo', 'compte', 'aide', 'moi'].indexOf(S.tab) < 0) S.tab = 'maison';
      if (S.inv.emp == null && S.me.cabinet) choisirEmp(S.me.cabinet);
      if (!S.tabChoisi) S.tab = gestion() ? 'hub' : 'maison';
      S.histTous = gestion();
      if (JETON_QR) pointerQR();
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
      toutLire('articles', '*', function (q) { return q.order('nom'); }),
      toutLire('stocks', 'article_id,emplacement,quantite'),
      toutLire('fournisseurs', '*', function (q) { return q.order('nom'); }),
      sb.from('profils').select('*').order('nom').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('mouvements').select('*').eq('statut', 'attente').order('cree_le').then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('parametres').select('cle,valeur').in('cle', ['j0', 'alias_refs', 'derniere_sauvegarde']).then(function (r) { if (r.error) throw r.error; return r.data; }),
      sb.from('inventaires').select('emplacement,date_inv,j0').order('date_inv', { ascending: false }).limit(500).then(function (r) { if (r.error) throw r.error; return r.data; }),
      (gestion() ? sb.from('mouvements').select('*') : sb.from('mouvements').select('*').eq('auteur', S.me.id)).order('cree_le', { ascending: false }).limit(30).then(function (r) { if (r.error) throw r.error; return r.data; }),
      toutLire('article_fournisseurs', 'article_id,fournisseur_id,prix,reference,rang'),
      sb.rpc('classement_sorties', { p_jours: 365 }).then(function (r) { return r.error ? [] : r.data || []; }, function () { return []; }),
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
      S.rang = {}; (x[9] || []).forEach(function (r) { var o = S.rang[r.article_id] = S.rang[r.article_id] || { t: 0, c: {} }; o.t += +r.total; o.c[r.cabinet] = +r.total; });
      S.afPrix = {}; (x[8] || []).forEach(function (p) { (S.afPrix[p.article_id] = S.afPrix[p.article_id] || []).push(p); });
      S.loading = false; render();
      if (gestion()) chargerPlan(); else chargerMesConges();
      if (S.tab === 'histo') chargerHisto();
    }).catch(function (e) { S.loading = false; toast(msgErr(e)); render(); });
  }
  function chargerHisto() {
    var q = sb.from('mouvements').select('*').order('cree_le', { ascending: false }).limit(150);
    if (!gestion() || !S.histTous) q = q.eq('auteur', S.me.id);
    q.then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } S.histo = r.data; if (S.tab === 'histo') render(); });
  }

  // ---------- Rendu général ----------
  function poser(app, h) {
    var ae = document.activeElement, fq = ae && ae.id && ae.tagName === 'INPUT' ? ae.id : null, pos = fq && ae.selectionStart;
    app.innerHTML = h;
    if (fq && $(fq)) { S.refocus = true; $(fq).focus(); try { $(fq).setSelectionRange(pos, pos); } catch (e) {} S.refocus = false; }
  }
  // Numéro de version en haut à droite du bandeau (avec « Bêta test » sur le site de test)
  function coinVersion() {
    var e = document.getElementById('ver-coin');
    if (!e) { e = document.createElement('div'); e.id = 'ver-coin'; e.setAttribute('aria-label', 'Version de l’application'); document.body.appendChild(e); document.body.classList.add('coin'); }
    e.textContent = (C.env === 'dev' ? 'Bêta test · ' : '') + 'v' + (C.version || '');
  }
  function render() {
    JOUR_CACHE = {};
    coinVersion();
    var app = $('app');
    document.body.classList.toggle('ecran-lg', !S.session);
    if (!S.session) { app.innerHTML = vLogin(); bindLogin(); return; }
    if (S.loading && !S.me) { app.innerHTML = '<p class="chargement">Chargement…</p>'; return; }
    if (!S.me || !S.me.actif) {
      app.innerHTML = '<div class="lg"><div class="lg-top"></div><div class="lg-in"><div class="lg-card"><h1>Compte non activé</h1><p>Votre connexion fonctionne, mais votre compte n’a pas encore de profil actif dans l’application. Demandez à la responsable des achats ou à la référente de l’activer.</p><button class="btn l" id="bout">Se déconnecter</button></div></div></div>';
      $('bout').onclick = deconnexion; return;
    }
    if (S.ptRes) { app.innerHTML = vResultatPointage(); document.body.classList.remove('mode-h', 'mode-a'); return; }
    if (gestion() && HUB.indexOf(S.tab) >= 0) {
      poser(app, renderH());
      document.body.classList.remove('mode-a', 'ecran-ok', 'sans-nav'); document.body.classList.add('mode-h');
      placerTour(); return;
    }
    document.body.classList.remove('mode-h');
    if (modeA()) {
      poser(app, renderA());
      document.body.classList.add('mode-a');
      document.body.classList.toggle('ecran-ok', S.tab === 'sortie' && !!S.sortie.ok);
      document.body.classList.toggle('sans-nav', enTache());
      placerTour(); return;
    }
    document.body.classList.remove('mode-a', 'ecran-ok');
    var tabs = gestion() ? [['accueil', 'Accueil'], ['sortie', 'Sortie'], ['retour', 'Retour'], ['inventaire', 'Inventaire']] : [['maison', 'Accueil'], ['sortie', 'Sortie'], ['retour', 'Retour'], ['inventaire', 'Inventaire']];
    if (gestion()) tabs.push(['demandes', 'Demandes' + (S.attente.length ? '<span class="badge">' + S.attente.length + '</span>' : '')], ['stock', 'Stock'], ['commandes', 'Commandes'], ['articles', 'Articles'], ['fournisseurs', 'Fournisseurs']);
    tabs.push(['histo', 'Historique']);
    if (gestion()) tabs.push(['plus', 'Plus']);
    tabs.push(['aide', '❓ Aide']);
    var h = '<header class="top"><div class="top-in">' + (gestion() ? '<button class="btn l sm top-menu" data-tab="hub" aria-label="Menu principal">' + ico('maison', 18, 2.2) + '<span class="m-hide">Menu</span></button>' : '') + '<img src="assets/logo-evydent.jpg" alt="">'
      + '<div class="top-who"><b><span class="nom">' + esc(S.me.nom) + '</span></b><span>' + LABEL[S.me.role] + (S.me.cabinet ? ' · cabinet ' + S.me.cabinet : '') + '</span></div>'
      + '<button class="btn l sm" data-tab="compte" title="Changer mon code" aria-label="Changer mon code">' + ico('code', 20, 2.2) + '</button><button class="btn l sm" data-act="out" aria-label="Changer de personne"><span class="m-hide">Changer de personne</span><span class="m-only avec-ic">' + ico('changer', 18, 2.2) + 'Changer</span></button></div>'
      + '<nav class="tabs" aria-label="Menu">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav></header>';
    if (S.nouvelleVersion) h += '<div class="ban ok" style="max-width:1100px;margin:10px auto 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1">Une nouvelle version de l’application est disponible (' + esc(S.nouvelleVersion) + ').</span><button class="btn sm" data-act="maj">Mettre à jour</button></div>';
    h += '<main>' + vBienvenue() + (S.loading ? '<p class="mu">Mise à jour…</p>' : '') + ({ accueil: vAccueil, sortie: vSortie, inventaire: vInventaire, demandes: vDemandes, stock: vStock, histo: vHisto, equipe: vEquipe, articles: vArticles, fournisseurs: vFournisseurs, commandes: vCommandes, compte: vCompte, retour: vRetour, plus: vPlus, aide: vAide, maison: vMaison, moi: vMoiA }[S.tab] || vSortie)() + '</main>';
    h += '<p class="mu" style="text-align:center;font-size:12px;margin:0 0 90px">Version ' + esc(C.version || '') + '</p>';
    h += vNavMobile();
    h += (S.tab === 'sortie' ? vBarSortie() : S.tab === 'retour' ? vBarRetour() : S.tab === 'inventaire' && S.inv.emp != null && !S.inv.recap ? vBarInv() : '');
    // On remet le curseur dans le champ de saisie en cours, mais jamais sur une liste déroulante :
    // sur iPhone, redonner le focus à une liste la rouvre une seconde fois.
    poser(app, h);
    document.body.classList.toggle('sans-nav', !!S.me && enTache());
    placerTour();
  }

  // ---------- Aide : tutoriel et visite guidée ----------
  // Fiches pas à pas (écran « Aide ») + visite guidée qui montre chaque bouton à l'écran.
  var GUIDES = [
    { id: 'connexion', ic: '🔐', t: 'Se connecter et changer de personne', duree: '1 min', tab: null, e: [
      'Tapez votre <b>identifiant</b> (ex. : sarah), puis votre <b>code à 6 chiffres</b> sur le pavé à grosses touches : la connexion se fait toute seule au 6ᵉ chiffre. L’identifiant est retenu sur le téléphone.',
      'Vous restez connectée : pas besoin de retaper votre code à chaque fois.',
      'Sur un appareil partagé, avant de passer la main : <b>Moi › Changer de personne</b> (en bas de l’écran). L’appli se vide pour la personne suivante.',
      'Code oublié ? Demandez à la référente ou à la responsable : elles vous en donnent un nouveau.'] },
    { id: 'sortie', ic: '📤', t: 'Faire une sortie (prendre dans la réserve)', duree: '2 min', tab: 'sortie', e: [
      'Sur l’accueil, touchez la grande tuile <b>📤 Sortie</b>. Votre cabinet est déjà choisi (★ = le vôtre).',
      'Les articles que votre cabinet sort le plus sont <b>en haut de la liste</b>. « Mes favoris » montre ceux que vous sortez vous-même, « A → Z » l’ordre alphabétique. Sinon, tapez quelques lettres dans <b>Chercher un article</b>.',
      'Appuyez sur <b>+</b> pour chaque unité prise (ou tapez directement le nombre). L’article passe en vert.',
      'Appuyez sur le gros bouton doré <b>Vérifier</b> : votre sortie s’affiche. Corrigez si besoin, puis <b>Valider la sortie</b>. Un écran vert confirme, puis l’appli revient à l’accueil.',
      'Si la réserve n’en a pas assez, la quantité en trop part en <b>demande à confirmer</b> par la référente : c’est normal.',
      'Pour la stérilisation, choisissez <b>La Sté</b> à la place du cabinet (bouton doré en haut) : seuls les articles de la Sté s’affichent. Même chose pour l’inventaire de la Sté.'] },
    { id: 'remplacement', ic: '🔄', t: 'Remplacer une collègue dans un autre cabinet', duree: '1 min', tab: 'sortie', e: [
      'Dans Sortie, Retour ou Inventaire, changez le cabinet dans la liste en haut (ex. : Cab. 6).',
      'Un bandeau orange rappelle que ce n’est pas votre cabinet : l’opération sera notée « hors cabinet ». Rien d’autre à faire.'] },
    { id: 'retour', ic: '↩️', t: 'Rendre des articles à la réserve', duree: '1 min', tab: 'retour', e: [
      'Ouvrez <b>↩️ Retour</b> et cherchez l’article.',
      'Pour un article en boîte, on ne rend que des <b>boîtes fermées</b> : la quantité se compte en boîtes. Les unités en vrac restent au cabinet.',
      'Appuyez sur <b>Valider le retour</b>.'] },
    { id: 'inventaire', ic: '📋', t: 'Faire l’inventaire de son cabinet', duree: '3 min', tab: 'inventaire', e: [
      'Ouvrez <b>📋 Inventaire</b> et choisissez votre cabinet.',
      'Pour chaque article, tapez la quantité <b>réellement présente</b> (en unités). Le bouton <b>0</b> met l’article à zéro en un geste.',
      'Les articles déjà comptés passent en vert. Votre saisie est gardée sur l’appareil même si vous êtes interrompue.',
      'Appuyez sur <b>J’ai fini de compter</b> : le bilan montre ce qui a été utilisé depuis le dernier inventaire (et ce qui serait en plus, à vérifier). Vérifiez, puis <b>Valider l’inventaire</b>.',
      'La réserve est comptée par la référente ou la responsable (ou par vous si elles vous ont donné l’autorisation).'] },
    { id: 'historique', ic: '🕘', t: 'Retrouver ce que j’ai fait', duree: '30 s', tab: 'histo', e: [
      'Ouvrez <b>🕘 Historique</b> : vos derniers mouvements (sorties, retours, inventaires) avec la date et l’heure.',
      'Une erreur ? Prévenez la référente : elle peut corriger.'] },
    { id: 'code', ic: '🔑', t: 'Changer mon code', duree: '30 s', tab: 'compte', e: [
      'Assistantes : <b>Moi › Changer mon code</b>. Référente et responsable : bouton cadenas en haut (ou Menu › Mon code).',
      'Tapez votre code actuel, puis le nouveau deux fois (6 chiffres). Évitez 123456, 000000 ou votre date de naissance.'] },
    { id: 'iphone', ic: '📱', t: 'Mettre l’appli sur l’écran d’accueil du téléphone', duree: '1 min', tab: null, e: [
      '<b>iPhone (Safari)</b> : bouton Partager (carré avec une flèche) › <b>Sur l’écran d’accueil</b> › Ajouter.',
      '<b>Android (Chrome)</b> : menu ⋮ › <b>Ajouter à l’écran d’accueil</b> (ou « Installer l’application »).',
      'L’appli s’ouvre ensuite en plein écran avec l’icône Evydent.',
      'Si un bandeau vert « Nouvelle version disponible » apparaît, appuyez sur <b>Mettre à jour</b>.'] },
    { id: 'conges', ic: '🌴', t: 'Demander des congés', duree: '1 min', tab: 'mconges', e: [
      'En bas, touchez <b>Moi</b>, puis <b>Mes congés</b>.',
      'Touchez le bouton doré <b>Demander des congés</b>. Choisissez « Plusieurs jours » ou « Un seul jour », puis les dates. L’appli compte vos jours de travail.',
      'Ajoutez un petit mot si vous voulez, puis <b>Envoyer la demande</b>.',
      'La référente ou la responsable répond : la réponse s’affiche dans « Mes congés » (en attente, accepté ou refusé). Tant que c’est en attente, vous pouvez annuler.'] }
  ];
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function cleAide() { return 'evy-aide-' + (S.me ? S.me.id : '') + '-' + C.env; }
  function aideVue() { var v = lsGet(cleAide()); try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }
  function marquerVu(id) { var v = aideVue(); v[id] = 1; lsSet(cleAide(), JSON.stringify(v)); }
  function vBienvenue() {
    if (S.tab === 'aide' || aideVue().bienvenue || S.tour) return '';
    return '<div class="ban ok row wrap bienvenue"><span class="grow">👋 <b>Première fois ?</b> Une visite guidée de 2 minutes vous montre chaque bouton.</span><button class="btn sm" data-act="tour">▶️ Visite guidée</button><button class="btn l sm" data-act="bvno">Plus tard</button></div>';
  }
  function vAide() {
    var vu = aideVue(), n = GUIDES.filter(function (g) { return vu[g.id]; }).length;
    var h = '<h2>Aide</h2><div class="card aide-top"><b>Apprendre l’application</b><p class="mu" style="margin:4px 0 10px">La visite guidée vous montre chaque bouton directement à l’écran. Les fiches ci-dessous expliquent chaque geste pas à pas ; touchez-en une pour l’ouvrir.</p>'
      + '<div class="row wrap"><button class="btn" data-act="tour">▶️ Lancer la visite guidée</button><span class="mu">' + n + ' / ' + GUIDES.length + ' fiches lues</span></div>'
      + (C.env === 'dev' ? '<p class="ban warn" style="margin:10px 0 0">Vous êtes sur le <b>site de test</b> : vous pouvez vous entraîner sans risque, rien ne touche le vrai stock.</p>' : '<p class="mu" style="margin:10px 0 0">Ici, chaque sortie ou inventaire validé modifie le vrai stock : entraînez-vous plutôt sur le site de test si la référente vous y a créé un compte.</p>') + '</div>';
    h += GUIDES.map(function (g) {
      return '<details class="card guide"' + (S.aideOuverte === g.id ? ' open' : '') + ' data-guide="' + g.id + '"><summary><span class="gi">' + g.ic + '</span><span class="grow"><b>' + g.t + '</b><small>' + g.duree + (vu[g.id] ? ' · ✓ lue' : '') + '</small></span><span class="chev">›</span></summary>'
        + '<ol class="etapes">' + g.e.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>'
        + (g.tab && (g.tab !== 'histo' || true) ? '<button class="btn l sm" data-essai="' + g.tab + '" data-gid="' + g.id + '">Essayer maintenant →</button>' : '') + '</details>';
    }).join('');
    return h;
  }
  // Visite guidée : chaque étape désigne un élément de l'écran (bouton, champ…)
  function etapesTour() {
    var mob = window.matchMedia('(max-width:700px)').matches, nav = function (t) { return mob ? '.bnav [data-tab="' + t + '"]' : '.tabs [data-tab="' + t + '"]'; };
    var E = [
      { tab: 'sortie', sel: nav('sortie'), t: '📤 Sortie', x: 'Pour prendre des articles dans la réserve. C’est l’écran que vous utiliserez le plus.' },
      { tab: 'sortie', sel: '#scab', t: 'Votre cabinet', x: 'Il est choisi d’office (★). Changez-le seulement si vous remplacez une collègue.' },
      { tab: 'sortie', sel: '#sq', t: 'Recherche', x: 'Tapez quelques lettres du nom ou la référence. Sans recherche, les articles les plus sortis de votre cabinet sont en haut.' },
      { tab: 'sortie', sel: '.stp', t: 'La quantité', x: 'Appuyez sur + pour chaque unité prise, ou tapez le nombre. L’article choisi passe en vert.' },
      { tab: 'sortie', sel: '.bar [data-act="valider"]', t: 'Valider', x: 'Quand tout est prêt, appuyez ici. Le bouton 🧺 (à gauche) montre ce que vous avez choisi.' },
      { tab: 'retour', sel: nav('retour'), t: '↩️ Retour', x: 'Pour rendre à la réserve des boîtes fermées non utilisées.' },
      { tab: 'inventaire', sel: nav('inventaire'), t: '📋 Inventaire', x: 'Pour compter ce qui est réellement présent dans votre cabinet, puis valider.' },
      { tab: 'histo', sel: mob && gestion() ? '.bnav [data-act="menu"]' : nav('histo'), t: '🕘 Historique', x: 'Pour retrouver tout ce que vous avez fait, avec la date et l’heure.' + (mob && gestion() ? ' (Dans le Menu.)' : '') },
      { tab: null, sel: '.top [data-tab="compte"]', t: '🔑 Mon code', x: 'Pour changer votre code à 6 chiffres.' },
      { tab: null, sel: '.top [data-act="out"]', t: '👤 Changer de personne', x: 'À utiliser avant de passer l’appareil à une collègue : l’appli se vide pour elle.' },
      { tab: 'aide', sel: mob ? '.bnav [data-act="menu"]' : nav('aide'), t: '❓ Aide', x: 'Toutes les fiches pas à pas sont ici' + (mob ? ', dans le Menu' : '') + '. Bonne utilisation !' }
    ];
    if (!gestion()) {
      // Assistantes : l'accueil à 3 tuiles remplace les onglets Sortie / Inventaire / Retour
      E[0] = { tab: 'maison', sel: '.tuile.t1', t: '📤 Sortie', x: 'Pour prendre des articles dans la réserve. C’est la tuile que vous utiliserez le plus.' };
      E[4] = { tab: 'sortie', sel: '.bar', t: 'Vérifier puis valider', x: 'Quand vos articles sont choisis, le gros bouton doré « Vérifier » affiche votre sortie ; un dernier bouton la valide. Un écran vert confirme.' };
      E[5] = { tab: 'maison', sel: '.tuile[data-tab="retour"]', t: '↩️ Retour', x: 'Pour rendre à la réserve des boîtes fermées non utilisées.' };
      E[6] = { tab: 'maison', sel: '.tuile[data-tab="inventaire"]', t: '📋 Inventaire', x: 'Pour compter ce qui reste dans votre cabinet. La tuile indique quand l’inventaire du mois est à faire.' };
      E[7] = { tab: 'maison', sel: mob ? '.bnav [data-tab="histo"]' : nav('histo'), t: '🕘 Historique', x: 'Pour retrouver tout ce que vous avez fait, avec la date et l’heure.' };
      E[3] = { tab: 'sortie', sel: '.a-st', t: 'La quantité', x: 'Appuyez sur + pour chaque unité (ou boîte) prise, ou tapez le nombre. L’article choisi passe en vert. En haut : « Les plus sortis », « Mes favoris » ou « A → Z ».' };
      E[8] = { tab: 'moi', sel: '.a-li[data-tab="compte"]', t: 'Mon code', x: 'Dans « Moi » : pour changer votre code à 6 chiffres.' };
      E[9] = { tab: 'moi', sel: '.a-moi-out', t: 'Changer de personne', x: 'À utiliser avant de passer le téléphone à une collègue : l’appli se vide pour elle.' };
      E[10] = { tab: 'maison', sel: mob ? '.bnav [data-tab="aide"]' : nav('aide'), t: '❓ Aide', x: 'Toutes les fiches pas à pas sont ici. Le bouton « Moi » regroupe votre code et « Changer de personne ». Bonne utilisation !' };
    }
    return E;
  }
  function lancerTour() { S.tour = { i: 0 }; marquerVu('bienvenue'); allerEtape(); }
  function allerEtape() {
    var e = etapesTour()[S.tour.i];
    S.menu = false; S.fiche = null;
    if (e.tab && S.tab !== e.tab) { S.tab = e.tab; if (e.tab === 'histo') chargerHisto(); }
    render(); window.scrollTo(0, 0);
  }
  function placerTour() {
    var old = document.getElementById('tour'); if (old) old.remove();
    if (!S.tour) return;
    var E = etapesTour(), e = E[S.tour.i], el = document.querySelector(e.sel);
    var d = document.createElement('div'); d.id = 'tour';
    var r = el ? el.getBoundingClientRect() : null, vh = window.innerHeight, haut = r && r.top > vh / 2;
    d.innerHTML = (r ? '<div class="tour-spot" style="top:' + (r.top - 6) + 'px;left:' + (r.left - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (r.height + 12) + 'px"></div>' : '<div class="tour-voile"></div>')
      + '<div class="tour-bulle" role="dialog" aria-live="polite" style="' + (r ? (haut ? 'bottom:' + (vh - r.top + 16) + 'px' : 'top:' + (r.bottom + 16) + 'px') : 'top:30%') + '">'
      + '<div class="row"><b class="grow">' + e.t + '</b><span class="mu">' + (S.tour.i + 1) + ' / ' + E.length + '</span></div><p>' + e.x + '</p>'
      + '<div class="row"><button class="btn l sm" data-act="tourfin">Quitter</button><span class="grow"></span>' + (S.tour.i ? '<button class="btn l sm" data-act="tourprec">←</button>' : '') + '<button class="btn sm" data-act="toursuiv">' + (S.tour.i === E.length - 1 ? 'Terminer ✓' : 'Suivant →') + '</button></div></div>';
    document.body.appendChild(d);
  }

  // ---------- Icônes dessinées (les mêmes que la maquette) ----------
  var SVGI = {
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2h2M18 18h2v2"/>',
    bas: '<path d="M6 9l6 6 6-6"/>',
    haut: '<path d="M6 15l6-6 6 6"/>',
    graph: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
    crayon: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    poubelle: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    sortie: '<path d="M3 13h5l1 3h6l1-3h5v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 3v9M8 7l4-4 4 4"/>',
    inventaire: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12l2 2 4-4M9 17h6"/>',
    retour: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    maison: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    histo: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    aide: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01"/>',
    moi: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    refaire: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    code: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    tel: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    changer: '<path d="M16 3l4 4-4 4M20 7H9M8 21l-4-4 4-4M4 17h11"/>',
    suiv: '<path d="M9 6l6 6-6 6"/>', prec: '<path d="M15 6l-6 6 6 6"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    cabinet: '<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/>',
    boite: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    attente: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/>',
    loupe: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    croix: '<path d="M6 6l12 12M18 6L6 18"/>',
    reglage: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h3M14 14h3M7 17.5h3"/>',
    equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.2.6 3.5 2.4 3.5 5.2"/>',
    dent: '<path d="M7.5 3.5c-2.5 0-4 2-4 4.5 0 3 1.2 4.5 1.8 7.5.5 2.5 1 5 2.4 5 1.6 0 1.6-4.5 4.3-4.5s2.7 4.5 4.3 4.5c1.4 0 1.9-2.5 2.4-5 .6-3 1.8-4.5 1.8-7.5 0-2.5-1.5-4.5-4-4.5-1.8 0-2.8 1-4.5 1s-2.7-1-4.5-1z"/>',
    fleche: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    invok: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 12l2 2 4-4"/>'
  };
  function ico(n, sz, ep) { return '<svg class="ic" width="' + (sz || 24) + '" height="' + (sz || 24) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (ep || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVGI[n] + '</svg>'; }

  // ---------- Accueil des assistantes : 3 grandes tuiles ----------
  function derniereSortie() {
    var m = (S.recents || []).filter(function (x) { return x.type === 'sortie' && x.statut === 'ok' && x.auteur === S.me.id; });
    if (!m.length) return null;
    var lot = m[0].lot, l = m.filter(function (x) { return x.lot === lot && S.byId[x.article_id]; });
    return l.length ? { cab: l[0].emplacement_vers, l: l } : null;
  }
  function inventaireAFaire() {
    var c = S.me.cabinet, d = c && S.dernierInv[c];
    return c && (!d || (Date.now() - new Date(d).getTime()) / 86400000 > 28);
  }
  function refaireSortie() {
    var ds = derniereSortie(); if (!ds) return;
    S.sortie.panier = {}; ds.l.forEach(function (x) { S.sortie.panier[x.article_id] = (S.sortie.panier[x.article_id] || 0) + +x.quantite; });
    S.sortie.cab = ds.cab || S.me.cabinet || 1; S.sortie.voir = true; S.sortie.ok = null; S.tab = 'sortie'; render(); window.scrollTo(0, 0);
  }
  // ---------- Appli des assistantes : chaque écran a son propre en-tête bleu, comme la maquette ----------
  function modeA() { return !!S.me && !gestion(); }
  var ACC = ['data-act="accueil"', 'Accueil'];
  function hdA(o) {
    return '<header class="a-hd' + (o.fixe ? ' fixe' : '') + (o.cls ? ' ' + o.cls : '') + '">'
      + (o.t ? '<div class="a-hd-row">' + (o.back ? '<button class="a-back" ' + o.back[0] + '>' + ico('prec', 22, 2.4) + o.back[1] + '</button>' : '<span></span>') + '<h1>' + o.t + '</h1>' + (o.cab || '<span></span>') + '</div>' : '')
      + (o.extra || '') + '</header>';
  }
  function cabA(id, cur, avant, label, ste) {
    return '<label class="a-cab"><select id="' + id + '" aria-label="' + (label || 'Cabinet') + '">' + (avant || '') + (ste ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 6, 7, 8]).map(function (c) { return '<option value="' + c + '"' + (+cur === c && cur !== '' && cur != null ? ' selected' : '') + '>' + (c === 9 ? 'La Sté' : 'Cabinet ' + c) + '</option>'; }).join('') + '</select></label>';
  }
  function chercheA(id, v, cls) { return '<label class="a-search' + (cls ? ' ' + cls : '') + '">' + ico('loupe', 20, 2.2) + '<input id="' + id + '" type="search" placeholder="Chercher un article" value="' + esc(v || '') + '" aria-label="Chercher un article" autocomplete="off"></label>'; }
  function trouve(q) { return function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }; }
  function pl(n, mot) { return mot + (Math.abs(n) > 1 ? 's' : ''); }

  // Accueil : 3 grandes tuiles
  function vMaison() {
    var j = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), ds = derniereSortie();
    var mesAtt = (S.recents || []).filter(function (x) { return x.type === 'demande' && x.statut === 'attente' && x.auteur === S.me.id; });
    var h = '<header class="a-hd a-maison"><div class="a-mh-top"><img src="assets/logo-evydent.jpg" alt="Evydent"><span class="grow">Espace dentaire Val d’Yerres</span></div>'
      + '<div><h1>Bonjour ' + esc(S.me.nom) + '</h1><p>' + (S.me.cabinet ? 'Cabinet ' + S.me.cabinet + ' · ' : '') + j + '</p></div></header>';
    h += '<div class="a-corps">' + vBienvenue() + tuilePointer() + '<div class="tuiles">'
      + '<button class="tuile t1" data-tab="sortie"><span class="ti">' + ico('sortie', 34) + '</span><span class="tt"><b>Sortie</b><span>Prendre dans la réserve</span></span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button>'
      + '<button class="tuile" data-tab="inventaire"><span class="ti">' + ico('inventaire', 32) + '</span><span class="tt"><b>Inventaire</b><span>Compter mon cabinet</span>' + (inventaireAFaire() ? '<em>À faire ce mois-ci</em>' : '') + '</span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button>'
      + '<button class="tuile" data-tab="retour"><span class="ti">' + ico('retour', 32) + '</span><span class="tt"><b>Retour</b><span>Rendre des boîtes fermées</span></span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button></div>';
    if (ds) h += '<button class="raccourci" data-act="refaire"><span class="ti">' + ico('refaire', 24, 2.2) + '</span><span><b>Refaire ma dernière sortie</b><br>' + ds.l.slice(0, 3).map(function (x) { return esc(S.byId[x.article_id].nom) + ' × ' + fr(x.quantite); }).join(' · ') + (ds.l.length > 3 ? '…' : '') + '</span></button>';
    if (mesAtt.length) h += '<p class="a-aide">' + mesAtt.length + ' ' + pl(mesAtt.length, 'demande') + ' en attente de validation : ' + mesAtt.slice(0, 3).map(function (x) { var a = S.byId[x.article_id]; return esc(a ? a.nom : '?') + ' × ' + fr(x.quantite); }).join(', ') + '</p>';
    return h + '</div>';
  }

  // Sortie
  function favorisA() { var c = {}; (S.recents || []).concat(S.histo || []).forEach(function (m) { if ((m.type === 'sortie' || m.type === 'demande') && m.auteur === S.me.id) c[m.article_id] = (c[m.article_id] || 0) + 1; }); return c; }
  function sousSortieA(a, v) {
    var d = dispoUnites(a), b = enBoite(a), r = 'réserve ' + fr(d) + (b ? ' ' + pl(d, 'boîte') : '');
    var bas = !a.sans_seuil && +a.seuil > 0 && stockDe(a.id, 0) <= +a.seuil;
    if (v > d) return '<span class="warn">' + (b ? 'boîte entière' : 'à l’unité') + ' · ' + r + ' · le reste part en demande</span>';
    return '<span' + (bas ? ' class="warn"' : '') + '>' + (b ? 'boîte entière' : 'à l’unité') + ' · ' + r + (bas ? ' · bientôt vide' : '') + '</span>';
  }
  function ligneSortieA(a, s, verif) {
    var v = s.panier[a.id] || 0, sub;
    if (verif) sub = '<span>' + (enBoite(a) ? fr(v) + ' ' + pl(v, 'boîte') + ' ' + pl(v, 'entière') : 'à l’unité') + '</span>' + (v > dispoUnites(a) ? '<span class="warn">réserve ' + fr(dispoUnites(a)) + ' : le reste part en demande</span>' : '');
    else sub = sousSortieA(a, v);
    return '<div class="a-it' + (v ? ' choisi' : '') + '"><div class="a-it-n"><b>' + esc(a.nom) + '</b>' + sub + '</div>'
      + '<div class="a-st"><button type="button" data-moins="' + a.id + '" aria-label="Moins un">−</button><input inputmode="decimal" data-qte="' + a.id + '" value="' + (v || '') + '" placeholder="0" aria-label="Quantité en ' + uSortie(a, 2) + '"><button type="button" data-plus="' + a.id + '" aria-label="Plus un">+</button></div></div>';
  }
  function vSortieA() {
    var s = S.sortie, hors = horsCab(s.cab);
    if (s.ok) return vSortieOkA();
    var ids = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; });
    if (s.voir && ids.length) return vSortieVerifA(ids, hors);
    var tri = s.tri || 'usage', q = norm(s.q), max = s.max || 30, l;
    var h = hdA({ back: ACC, t: 'Sortie', cab: cabA('scab', s.cab, '', 'Cabinet ou Sté', true), extra: chercheA('sq', s.q), fixe: true }) + '<div class="a-corps">';
    if (!q) h += '<div class="a-chips">' + [['usage', 'Les plus sortis'], ['fav', 'Mes favoris'], ['az', 'A → Z']].map(function (c) { return '<button class="a-ch' + (tri === c[0] ? ' on' : '') + '" data-stri="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>';
    if (hors) h += '<p class="a-note warn">Ce n’est pas votre cabinet : la sortie sera notée « hors cabinet » (remplacement).</p>';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    if (q) l = S.articles.filter(trouve(q)).sort(parUsage(+s.cab));
    else if (tri === 'fav') { var f = favorisA(); l = S.articles.filter(function (a) { return f[a.id] && pourLieu(a, s.cab); }).sort(function (x, y) { return f[y.id] - f[x.id] || x.nom.localeCompare(y.nom, 'fr'); }); }
    else if (tri === 'az') l = S.articles.filter(function (a) { return pourLieu(a, s.cab); }).sort(function (x, y) { return x.nom.localeCompare(y.nom, 'fr'); });
    else l = S.articles.filter(function (a) { return pourLieu(a, s.cab); }).sort(parUsage(+s.cab));
    if (!l.length) return h + '<p class="a-vide">' + (q ? 'Aucun article trouvé.' : tri === 'fav' ? 'Vos favoris apparaîtront ici : ce sont les articles que vous sortez vous-même le plus souvent.' : +s.cab === 9 ? 'Aucun article n’est encore indiqué pour la Sté (fiche article, « Lieu 2 : La Sté »). Cherchez l’article en haut.' : 'Aucun article.') + '</p></div>';
    h += '<div class="a-liste">' + l.slice(0, q ? 40 : max).map(function (a) { return ligneSortieA(a, s); }).join('') + '</div>';
    if (!q && l.length > max) h += '<button class="a-plus" data-act="splus">Afficher plus d’articles (' + (l.length - max) + ')</button>';
    return h + '</div>';
  }
  function vSortieVerifA(ids, hors) {
    var s = S.sortie, h = hdA({ back: ['data-act="svoir"', 'Modifier'], t: 'Ma sortie', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    h += '<div class="a-pour">' + ico('cabinet', 26) + '<span>Pour ' + pourTxt(s.cab) + (hors ? ' · <span class="warn-t">remplacement (hors cabinet)</span>' : S.me.cabinet && +s.cab === +S.me.cabinet ? ' (le mien)' : '') + '</span></div>';
    h += '<div class="a-liste">' + ids.map(function (k) { return S.byId[k]; }).filter(Boolean).map(function (a) { return ligneSortieA(a, s, true); }).join('') + '</div>';
    return h + '<button class="a-ajout" data-act="svoir">+ Ajouter un article</button><p class="a-aide">Si la réserve n’en a pas assez, la quantité en trop part en demande à confirmer par la référente.</p></div>';
  }
  function vSortieOkA() {
    var o = S.sortie.ok;
    return '<div class="a-ok"><div class="a-ok-c"><span class="a-ok-rond" role="img" aria-label="Validé">' + ico('ok', 64, 2.6) + '</span><h1>' + (o.attente && !o.sorties ? 'Demande envoyée' : 'C’est enregistré') + '</h1>'
      + '<p>' + (o.sorties ? o.sorties + ' ' + pl(o.sorties, 'article') + ' ' + pl(o.sorties, 'sorti') + ' pour ' + pourTxt(o.cab) : '') + (o.resume ? '<br>' + o.resume : '') + '</p>'
      + (o.attente ? '<p class="a-note warn">' + o.attente + ' ' + pl(o.attente, 'article') + ' ' + (o.attente > 1 ? 'dépassent' : 'dépasse') + ' la réserve : demande envoyée à la référente.</p>' : '')
      + (o.hors ? '<p class="a-aide">Noté « hors cabinet » (remplacement).</p>' : '')
      + '<p class="a-ok-auto">Retour à l’accueil dans quelques secondes…</p></div>'
      + '<div class="a-ok-btns"><button class="a-btn navy" data-act="snouv">Nouvelle sortie</button><button class="a-btn blanc" data-act="accueil">Accueil</button></div></div>';
  }
  function vBarSortieA() {
    var s = S.sortie; if (s.ok) return '';
    var n = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; }).length;
    if (s.voir && n) return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn navy" data-act="valider"' + (s.busy ? ' disabled' : '') + '>' + (s.busy ? 'Enregistrement…' : 'Valider la sortie') + '</button><button class="a-lien" data-act="vider">Annuler et vider</button></div></div>';
    if (!n) return '<div class="bar a-bar"><div class="bar-in"><p class="a-indice">Touchez + pour choisir des articles</p></div></div>';
    return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn gold" data-act="svoir"><span>' + n + ' ' + pl(n, 'article') + ' ' + pl(n, 'choisi') + '</span><span class="avec-ic">Vérifier' + ico('suiv', 20, 2.6) + '</span></button></div></div>';
  }

  // Retour en réserve
  function vRetourA() {
    var s = S.ret, hors = horsCab(s.cab), q = norm(s.q);
    var h = hdA({ back: ACC, t: 'Retour', cab: cabA('rcab', s.cab), extra: chercheA('rq', s.q), fixe: true }) + '<div class="a-corps">'
      + '<div class="a-note warn">' + ico('boite', 22) + '<span>On ne rend que des <b>boîtes fermées</b>. Les unités en vrac restent au cabinet.</span></div>';
    if (hors) h += '<p class="a-note warn">Ce n’est pas votre cabinet : le retour sera noté « hors cabinet » (remplacement).</p>';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    var liste = q ? S.articles.filter(trouve(q)).slice(0, 40)
                  : S.articles.filter(function (a) { return s.panier[a.id] > 0 || stockDe(a.id, +s.cab) >= facteur(a); }).sort(parUsage(+s.cab));
    if (!liste.length) return h + '<p class="a-vide">' + (q ? 'Aucun article trouvé.' : 'Aucune boîte fermée enregistrée dans ce cabinet. Cherchez l’article en haut.') + '</p></div>';
    h += (q ? '' : '<p class="a-sect">' + (hors || !S.me.cabinet ? 'Présents dans le cabinet ' + s.cab : 'Présents dans mon cabinet') + '</p>');
    return h + '<div class="a-liste">' + liste.map(function (a) {
      var v = s.panier[a.id] || 0, f = facteur(a), cab = stockDe(a.id, +s.cab), boite = f > 1 || a.conditionnement === 'BOITE';
      var n = f > 1 ? Math.floor(cab / f + 1e-9) : cab, trop = v > n;
      var sub = boite ? fr(n) + ' ' + pl(n, 'boîte') + ' ' + pl(n, 'fermée') + ' au cabinet' : fr(n) + ' au cabinet (à l’unité)';
      return '<div class="a-it' + (v ? ' choisi' : '') + '"><div class="a-it-n"><b>' + esc(a.nom) + '</b><span' + (trop ? ' class="warn"' : '') + '>' + sub + (trop ? ' · plus que ce qui est enregistré' : '') + '</span></div>'
        + '<div class="a-st"><button type="button" data-rmoins="' + a.id + '" aria-label="Moins une boîte">−</button><input inputmode="numeric" data-rqte="' + a.id + '" value="' + (v || '') + '" placeholder="0" aria-label="Quantité à rendre"><button type="button" data-rplus="' + a.id + '" aria-label="Plus une boîte">+</button></div></div>';
    }).join('') + '</div></div>';
  }
  function vBarRetourA() {
    var p = S.ret.panier, ids = Object.keys(p).filter(function (k) { return p[k] > 0; });
    if (!ids.length) return '<div class="bar a-bar"><div class="bar-in"><p class="a-indice">Touchez + pour chaque boîte à rendre</p></div></div>';
    var b = ids.reduce(function (t, k) { return t + p[k]; }, 0), boites = ids.every(function (k) { var a = S.byId[k]; return a && (facteur(a) > 1 || a.conditionnement === 'BOITE'); });
    return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn gold" data-act="rvalider"' + (S.ret.busy ? ' disabled' : '') + '><span>' + b + ' ' + pl(b, boites ? 'boîte' : 'article') + ' à rendre</span><span>' + (S.ret.busy ? 'Enregistrement…' : 'Valider le retour') + '</span></button></div></div>';
  }

  // Inventaire
  function vInventaireA() {
    var I = S.inv;
    if (I.emp == null && S.me.cabinet) choisirEmp(S.me.cabinet);
    var emp = I.emp;
    if (I.recap && emp != null) return vRecapA();
    var opts = (emp == null ? '<option value="">Choisir</option>' : '') + (peutReserve() ? '<option value="0"' + (emp === 0 ? ' selected' : '') + '>Réserve</option>' : '');
    var l = emp != null ? listeInv() : [], tot = l.length, faits = l.filter(function (a) { return I.d[a.id] != null && I.d[a.id] !== ''; }).length;
    var prog = emp != null ? '<div class="a-prog"><div><b>' + faits + ' ' + pl(faits, 'compté') + ' sur ' + tot + '</b><span>gardé sur le téléphone</span></div><i><b style="width:' + (tot ? Math.round(faits * 100 / tot) : 0) + '%"></b></i></div>' : '';
    var h = hdA({ back: ACC, t: 'Inventaire', cab: cabA('iemp', emp == null ? '' : emp, opts, 'Emplacement à compter', true), extra: prog, fixe: true }) + '<div class="a-corps">';
    if (I.msg) h += '<div class="ban ' + I.msg[0] + '" role="status">' + I.msg[1] + '</div>';
    if (j0Actif()) h += '<div class="ban j0"><b>Inventaire de départ</b> jusqu’au ' + S.j0.fin.split('-').reverse().slice(0, 2).join('/') + ' : les quantités comptées <b>remplacent</b> le stock.' + (emp != null && j0Premier(emp) ? ' <b>Les articles non comptés passeront à 0.</b>' : '') + '</div>';
    if (horsCab(emp)) h += '<p class="a-note warn">Ce n’est pas votre cabinet : l’inventaire sera noté « hors cabinet » (remplacement).</p>';
    if (emp == null) return h + '<p class="a-vide">Choisissez le cabinet (ou la Sté) à compter, en haut à droite.</p></div>';
    if (emp === 0) h += '<div class="row wrap"><button class="btn l sm" data-act="iexp">⬇️ Fichier de comptage Excel</button><label class="btn l sm" style="display:inline-flex;align-items:center">⬆️ Importer le comptage<input type="file" id="iimpf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label></div>';
    var reste = I.reste !== false && !I.cherche;
    h += '<div class="a-chips"><button class="a-ch' + (reste ? ' on' : '') + '" data-act="ireste">Pas encore comptés · ' + (tot - faits) + '</button><button class="a-ch' + (!reste && !I.cherche ? ' on' : '') + '" data-act="itout">Tous</button><button class="a-ch' + (I.cherche ? ' on' : '') + '" data-act="icherche">Chercher</button></div>';
    if (I.cherche) h += chercheA('iq', I.q, 'clair');
    var der = S.dernierInv[emp];
    if (!der) h += '<p class="a-aide">Premier inventaire de cet emplacement : tous les articles sont listés. Comptez ceux qui sont présents.</p>';
    else if (emp > 0) h += '<label class="a-aide row"><input type="checkbox" id="itous"' + (I.tous ? ' checked' : '') + ' style="width:20px;height:20px"> Montrer aussi les articles qui ne devraient pas être là</label>';
    if (reste) l = l.filter(function (a) { return I.d[a.id] == null || I.d[a.id] === ''; });
    if (!l.length) return h + '<p class="a-vide">' + (reste && tot ? 'Tout est compté. Touchez « J’ai fini de compter » en bas.' : 'Aucun article.') + '</p></div>';
    var max = I.max || 80;
    h += '<div class="a-liste">' + l.slice(0, max).map(function (a) {
      var v = I.d[a.id], fait = v != null && v !== '';
      return '<div class="a-it' + (fait ? ' choisi' : '') + '"><div class="a-it-n"><b>' + esc(a.nom) + '</b>' + (fait ? '<span class="ok">compté ✓</span>' : '<span>compter en ' + (uInv(a, emp) === 'u.' ? 'unités' : 'boîtes') + '</span>') + '</div>'
        + '<div class="a-q"><button type="button" data-izero="' + a.id + '" aria-label="Aucun">0</button><input inputmode="decimal" data-iq="' + a.id + '" value="' + esc(fait ? v : '') + '" placeholder="—" aria-label="Quantité comptée"></div></div>';
    }).join('') + '</div>';
    if (l.length > max) h += '<button class="a-plus" data-act="iplus">Afficher plus d’articles (' + (l.length - max) + ')</button>';
    return h + '</div>';
  }
  function vRecapA() {
    var emp = S.inv.emp, E = ecartsInv(), Z = aZero(), motif = emp === 0 && !j0Actif(), cab = emp > 0 && !j0Actif();
    var n = nbComptes(), util = E.filter(function (e) { return e.apres < e.avant; }).length;
    var h = hdA({ back: ['data-act="irevenir"', 'Compter'], t: 'Bilan', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    h += '<div class="a-stats"><div><b>' + n + '</b><span>' + pl(n, 'compté') + '</span></div><div><b class="ok">' + (n - E.length) + '</b><span>pas bougé</span></div><div><b class="navy">' + (cab ? util : E.length) + '</b><span>' + (cab ? pl(util, 'utilisé') : pl(E.length, 'changement')) + '</span></div></div>';
    if (E.length) h += '<h2 class="a-h2">' + (cab ? 'Utilisé ' + (emp === 9 ? 'à la Sté' : 'au cabinet') + ' depuis le dernier inventaire' : 'Ce qui change dans le stock') + '</h2><div class="a-liste">' + E.map(function (e) {
      var d = e.apres - e.avant, plus = d > 0, u = uInv(e.a, emp) === 'u.' ? '' : ' ' + pl(d, 'boîte');
      var txt = 'il en restait ' + fr(e.avant) + ' · compté ' + (plus && cab ? fr(e.apres) + ' : ' + fr(d) + ' de plus. Une sortie oubliée ?' : '<strong>' + fr(e.apres) + '</strong>');
      var droite = cab ? (plus ? '+' + fr(d) + '<small>à vérifier</small>' : fr(-d) + '<small>' + pl(-d, 'utilisé') + '</small>') : (plus ? '+' : '') + fr(d) + '<small>' + (u || 'unités') + '</small>';
      return '<div class="a-it"><div class="a-it-n"><b>' + esc(e.a.nom) + '</b><span' + (cab && plus ? ' class="warn"' : '') + '>' + txt + '</span>'
        + (motif ? '<select class="in" data-imotif="' + e.a.id + '"><option value="">Motif…</option>' + MOTIFS.map(function (m) { return '<option' + (S.inv.motifs[e.a.id] === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' : '') + '</div>'
        + '<span class="a-droite' + (cab && plus ? ' warn' : '') + '">' + droite + '</span></div>';
    }).join('') + '</div>';
    else h += '<p class="a-vide">' + (cab ? 'Rien n’a bougé depuis le dernier inventaire.' : 'Le stock correspond à votre comptage.') + '</p>';
    if (Z.length) h += '<p class="a-note warn">Inventaire de départ : ' + Z.length + ' ' + pl(Z.length, 'article') + ' non ' + pl(Z.length, 'compté') + ' passeront à 0 (' + Z.slice(0, 4).map(function (a) { return esc(a.nom); }).join(', ') + (Z.length > 4 ? '…' : '') + ').</p>';
    return h + '<p class="a-aide">Un chiffre faux ? Touchez « Compter » en haut pour corriger avant de valider.</p></div>';
  }
  function vBarInvA() {
    if (S.inv.recap) return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn navy" data-act="ivalider"' + (S.inv.busy ? ' disabled' : '') + '>' + (S.inv.busy ? 'Enregistrement…' : 'Valider l’inventaire') + '</button></div></div>';
    var ok = nbComptes() || aZero().length;
    if (!ok) return '<div class="bar a-bar"><div class="bar-in"><p class="a-indice">Tapez la quantité présente pour chaque article</p></div></div>';
    return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn gold" data-act="iterminer"><span>J’ai fini de compter</span><span class="avec-ic">Voir le bilan' + ico('suiv', 20, 2.6) + '</span></button></div></div>';
  }

  // Historique
  function jourA(d) {
    var x = new Date(d), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    if (x.toDateString() === t.toDateString()) return 'Aujourd’hui';
    if (x.toDateString() === y.toDateString()) return 'Hier';
    var s = x.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function qteA(a, q) { return a && enBoite(a) ? fr(q) + ' ' + pl(q, 'boîte') : fr(q); }
  function evA(e) {
    var m = e.m, a = S.byId[m.article_id], nom = esc(a ? a.nom : m.article_nom ? m.article_nom + ' (supprimé)' : '(article)');
    var hr = new Date(m.cree_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), ic = 'histo', cls = '', t, sous, q = '', warn = false;
    var rempl = m.hors_cabinet ? ' · remplacement' : '';
    if (e.inv) {
      ic = 'invok'; t = 'Inventaire ' + (m.emplacement_de === 0 ? 'de la réserve' : m.emplacement_de === 9 ? 'de la Sté' : 'du cabinet ' + m.emplacement_de);
      sous = hr + ' · ' + e.n + ' ' + pl(e.n, 'article') + (e.u ? ' · ' + e.u + ' ' + pl(e.u, 'utilisé') : '') + (e.p ? ' · ' + e.p + ' à vérifier' : '') + rempl;
    } else if (m.type === 'sortie') { ic = 'fleche'; cls = ' fonce'; t = 'Sortie · ' + nom; sous = hr + ' · ' + lieuTxt(m.emplacement_vers) + rempl; q = qteA(a, m.quantite); }
    else if (m.type === 'demande') {
      ic = 'attente'; cls = ' orange'; t = 'Demande · ' + nom; warn = m.statut === 'attente';
      sous = hr + ' · ' + (m.statut === 'attente' ? 'en attente de la référente' : m.statut === 'refuse' ? 'refusée' : m.statut === 'ok' ? 'confirmée' : (STAT[m.statut] || ['', m.statut])[1]); q = qteA(a, m.quantite);
    } else if (m.type === 'retour') { ic = 'retour'; t = 'Retour · ' + nom; sous = hr + ' · cabinet ' + m.emplacement_de + ' → réserve' + rempl; q = m.quantite_reserve != null && +m.quantite_reserve !== +m.quantite ? fr(m.quantite_reserve) + ' ' + pl(m.quantite_reserve, 'boîte') : qteA(a, m.quantite); }
    else { t = (TYP[m.type] || m.type) + ' · ' + nom; sous = hr; q = fr(m.quantite); }
    if (!e.inv && m.type !== 'demande' && m.statut && m.statut !== 'ok') sous += ' · ' + (STAT[m.statut] || ['', m.statut])[1];
    return '<div class="a-ev"><span class="a-evi' + cls + '">' + ico(ic, 20, 2.2) + '</span><div class="a-it-n"><b>' + t + '</b><span' + (warn ? ' class="warn"' : '') + '>' + sous + '</span></div>' + (q ? '<b>' + q + '</b>' : '') + '</div>';
  }
  function vHistoA() {
    var h = hdA({ cls: 'a-simple', extra: '<h1 class="a-t-g">Mon historique</h1><p class="a-sous">Ce que j’ai sorti, rendu et compté</p>' }) + '<div class="a-corps">';
    if (!S.histo.length) return h + '<p class="a-vide">Aucun mouvement pour l’instant.</p></div>';
    var ev = [], invs = {};
    S.histo.forEach(function (m) {
      if (m.type === 'inventaire') {
        var k = (m.lot || '') + '|' + m.emplacement_de + '|' + String(m.cree_le).slice(0, 16), e = invs[k];
        if (!e) { e = invs[k] = { inv: true, m: m, n: 0, u: 0, p: 0 }; ev.push(e); }
        e.n++; if (+m.ecart < 0) e.u++; else if (+m.ecart > 0) e.p++; return;
      }
      ev.push({ m: m });
    });
    var jours = [], par = {};
    ev.forEach(function (e) { var j = jourA(e.m.cree_le); if (!par[j]) { par[j] = []; jours.push(j); } par[j].push(e); });
    return h + jours.map(function (j) { return '<h2 class="a-jour">' + j + '</h2><div class="a-liste">' + par[j].map(evA).join('') + '</div>'; }).join('') + '</div>';
  }

  // Moi, mon code, aide
  function vMoiA() {
    return '<header class="a-hd a-moi"><span class="a-av">' + esc((S.me.nom || '?').charAt(0).toUpperCase()) + '</span><div><h1>' + esc(S.me.nom) + '</h1><p>' + LABEL[S.me.role] + (S.me.cabinet ? ' · cabinet ' + S.me.cabinet : '') + ' · identifiant ' + esc(S.me.identifiant) + '</p></div></header>'
      + '<div class="a-corps"><div class="a-liste">'
      + '<button class="a-li" data-tab="aide"><span class="a-lii">' + ico('aide', 20) + '</span><span class="a-it-n"><b>Aide et visite guidée</b><span>' + GUIDES.length + ' fiches pas à pas</span></span></button>'
      + (S.visible && S.visible.planning && S.moiEq ? '<button class="a-li" data-tab="mplanning"><span class="a-lii">' + ico('histo', 20) + '</span><span class="a-it-n"><b>Mon planning</b><span>mes jours, mon dentiste, mes horaires</span></span></button>' : '')
      + '<button class="a-li" data-tab="mconges"><span class="a-lii">' + ico('agenda', 20) + '</span><span class="a-it-n"><b>Mes congés</b><span>' + ((S.mesConges || []).filter(function (c) { return c.statut === 'attente'; }).length ? 'demande en attente' : 'demander, suivre la réponse') + '</span></span></button>'
      + '<button class="a-li" data-tab="compte"><span class="a-lii">' + ico('code', 20) + '</span><span class="a-it-n"><b>Changer mon code</b><span>6 chiffres</span></span></button>'
      + '<button class="a-li" data-essai="aide" data-gid="iphone"><span class="a-lii">' + ico('tel', 20) + '</span><span class="a-it-n"><b>Mettre l’appli sur mon téléphone</b><span>icône sur l’écran d’accueil</span></span></button></div>'
      + '<button class="a-btn navy a-moi-out" data-act="out">' + ico('changer', 22, 2.2) + 'Changer de personne</button>'
      + '<p class="a-aide" style="text-align:center">À utiliser avant de passer le téléphone à une collègue&nbsp;:<br>l’appli se vide pour elle.</p>'
      + '<p class="a-aide" style="text-align:center;font-size:12px">Version ' + esc(C.version || '') + (C.env === 'dev' ? ' · site de test' : '') + '</p></div>';
  }
  function vCompteA() { return hdA({ back: ['data-tab="moi"', 'Moi'], t: 'Mon code', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">' + vCompte().replace(/^<h2>[^<]*<\/h2>/, '') + '</div>'; }
  function vAideA() { return hdA({ cls: 'a-simple', extra: '<h1 class="a-t-g">Aide</h1><p class="a-sous">Fiches pas à pas et visite guidée</p>' }) + '<div class="a-corps">' + vAide().replace('<h2>Aide</h2>', '') + '</div>'; }

  function renderA() {
    var ecr = { maison: vMaison, sortie: vSortieA, retour: vRetourA, inventaire: vInventaireA, histo: vHistoA, moi: vMoiA, compte: vCompteA, aide: vAideA, mconges: vMesCongesA, mdemande: vDemandeA, mplanning: vMonPlanningA }[S.tab];
    if (!ecr) { S.tab = 'maison'; ecr = vMaison; }
    var h = S.nouvelleVersion ? '<div class="a-maj"><span>Nouvelle version disponible (' + esc(S.nouvelleVersion) + ')</span><button class="btn sm" data-act="maj">Mettre à jour</button></div>' : '';
    h += '<div class="a-app">' + ecr() + '</div>' + vNavMobile();
    h += S.tab === 'sortie' ? vBarSortieA() : S.tab === 'retour' ? vBarRetourA() : S.tab === 'inventaire' && S.inv.emp != null ? vBarInvA() : S.tab === 'mdemande' ? vBarDemandeA() : '';
    return h;
  }

  // ---------- Accueil de la référente et de la responsable (2 tuiles), Réglages, Équipe, Dentistes ----------
  // Écrans de la maquette « Accueil référente et responsable ». Chaque écran a son en-tête bleu.
  var HUB = ['hub', 'reglages', 'pequipe', 'pfiche', 'pdent', 'dfiche', 'pconges', 'planning', 'pregles', 'heures', 'pointage', 'pvisible', 'ppostes', 'ptypes', 'pqui'];
  var JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'], JC = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  // Affectations possibles d'une demi-journée (en plus des dentistes)
  // Postes (modifiables dans Réglages › Postes) ; École et « Ne travaille pas » sont fixes
  var POSTES_BASE = [
    { code: 'ADMIN', n: 'Admin', xl: 'ADMIN', coul: 'DCEAF7' }, { code: 'STE', n: 'Sté', xl: 'STE', coul: 'C04F15' }, { code: 'ACCUEIL', n: 'Accueil', xl: 'ACCUEIL', coul: 'CAEEFB' },
    { code: 'ADMIN_ORTHO', n: 'Admin ortho', xl: 'ADMIN ORTHO', coul: 'DCEAF7' }, { code: 'RANGEMENT', n: 'Rangement', xl: 'RANGEMENT', coul: 'E2EFDA' }, { code: 'NETTOYAGE', n: 'Nettoyage cab.', xl: 'NETTOYAGE CAB', coul: 'E2EFDA' }];
  function postes() { return Array.isArray(S.postes) && S.postes.length ? S.postes : POSTES_BASE; }
  function posteDe(code) { return postes().filter(function (x) { return x.code === code; })[0]; }
  function listeCodes(cur) {   // [code, nom] pour les listes : postes en service (+ celui déjà choisi), puis École et Ne travaille pas
    return postes().filter(function (x) { return !x.retire || x.code === cur; }).map(function (x) { return [x.code, x.n]; }).concat([['ECOLE', 'École'], ['OFF', 'Ne travaille pas']]);
  }
  // Types de personnel (Réglages › Types de personnel)
  var TYPES_BASE = [{ code: 'assistante', n: 'Assistante / assistant', planning: true, contrat: true, dentiste: true, base: true }, { code: 'interimaire', n: 'Intérimaire', planning: true, contrat: false, dentiste: true, base: true }];
  function typesPers() { var l = Array.isArray(S.typesPers) ? S.typesPers : []; return TYPES_BASE.concat(l.filter(function (x) { return !TYPES_BASE.some(function (b) { return b.code === x.code; }); })); }
  function aDent(type) { return typeDe(type).dentiste !== false; }   // le type travaille-t-il auprès d'un dentiste ?
  function typeDe(code) { return typesPers().filter(function (x) { return x.code === code; })[0] || TYPES_BASE[0]; }
  function nomType(p) { return p.type === 'interimaire' ? 'Intérimaire' : p.type === 'assistante' || !p.type ? (p.statut === 'apprentie' ? 'Apprentie' : 'Assistante') : typeDe(p.type).n; }
  var ACC_H = ['data-tab="hub"', 'Accueil'];
  function dentById(id) { return (S.dentistes || []).filter(function (d) { return String(d.id) === String(id); })[0]; }
  function affTxt(a) {
    if (!a) return '—';
    if (a.slice(0, 2) === 'D:') { var d = dentById(a.slice(2)); return d ? 'Dr ' + d.prenom : 'Dr ?'; }
    var ps = posteDe(a); if (ps) return ps.n;
    return a === 'ECOLE' ? 'École' : a === 'OFF' ? 'Ne travaille pas' : a;
  }
  function enMin(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function dureeDemi(c) { if (!c || !c.a || c.a === 'OFF') return 0; var a = enMin(c.de), b = enMin(c.fi); return a != null && b != null && b > a ? (b - a) / 60 : 0; }
  function heuresJour(t, j) { var x = (t || {})[j] || {}; return dureeDemi(x.am) + dureeDemi(x.pm); }
  function heuresTrame(t) { var s = 0; for (var j = 1; j <= 5; j++) s += heuresJour(t, j); return s; }
  // Heures en « 3h30 » pour les champs ; on accepte aussi 3:30, 3 h 30, 3,5 ou 3
  function hIn(h) { if (h == null || h === '') return ''; var e = Math.floor(+h + 1e-9), m = Math.round((+h - e) * 60); if (m === 60) { e++; m = 0; } return e + 'h' + (m ? (m < 10 ? '0' : '') + m : ''); }
  function hLire(v) { v = String(v).trim().toLowerCase(); if (v === '') return null; var m = v.match(/^(\d{1,2})\s*(?:h|:)\s*(\d{1,2})?\s*(?:min)?$/); if (m) return +m[1] + (m[2] ? Math.min(59, +m[2]) / 60 : 0); var n = parseFloat(v.replace(',', '.')); return isNaN(n) ? null : Math.max(0, n); }
  function fh(h) { var e = Math.floor(h + 1e-9), m = Math.round((h - e) * 60); return e + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : ''); }
  function initiale(n) { return esc(String(n || '?').replace(/^Dr\s+/i, '').charAt(0).toUpperCase()); }
  function planPret() { return !!S.equipe; }
  function nbACommander() { try { return S.articles.filter(function (a) { return filtreStock(a, 'commander'); }).length; } catch (e) { return 0; } }

  function vHub() {
    var j = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    var att = S.attente.length, cmd = nbACommander(), sous = [];
    if (att) sous.push(att + ' ' + pl(att, 'demande') + ' à valider');
    if (cmd) sous.push(cmd + ' à commander');
    var h = '<header class="a-hd a-maison h-hd"><div class="a-mh-top"><img src="assets/logo-evydent.jpg" alt="Evydent"><span class="grow">Espace dentaire Val d’Yerres</span>'
      + '<button class="h-rond" data-tab="reglages" aria-label="Réglages">' + ico('reglage', 22) + '</button></div>'
      + '<div><h1>Bonjour ' + esc(S.me.nom) + '</h1><p>' + LABEL[S.me.role] + ' · ' + j + '</p></div></header>';
    var ca = congesAttente().length;
    h += '<div class="a-corps h-corps">' + vBienvenue()
      + (ca ? '<button class="h-alerte" data-tab="pconges">' + ico('attente', 22) + '<span><b>' + ca + ' ' + pl(ca, 'demande') + ' de congés</b> à valider</span>' + ico('suiv', 20, 2.4) + '</button>' : '')
      + '<div class="h-tuiles">'
      + '<button class="h-tuile fonce" data-tab="accueil"><span class="ti">' + ico('boite', 34) + '</span><span class="tt"><b>Gestion de stock</b><span>' + (sous.length ? sous.join(' · ') : 'Sorties, inventaires, commandes') + '</span></span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button>'
      + (telephone() ? '<div class="h-tuile pc" aria-disabled="true"><span class="ti">' + ico('agenda', 34) + '</span><span class="tt"><b>Planning</b><span><b class="pc-t">À ouvrir sur ordinateur</b>Le planning et les heures se gèrent sur un écran de PC.</span></span></div>'
        : '<button class="h-tuile" data-tab="planning"><span class="ti">' + ico('agenda', 34) + '</span><span class="tt"><b>Planning</b><span>Qui travaille, avec quel dentiste, et les heures</span></span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button>') + tuilePointage() + '</div>'
      + '<button class="h-ligne" data-tab="pconges"><span class="a-lii">' + ico('agenda', 20) + '</span><span class="a-it-n"><b>Congés</b><span>Demandes à valider, prochains congés</span></span>' + ico('suiv', 20, 2.2) + '</button>'
      + '<button class="h-ligne" data-tab="reglages"><span class="a-lii">' + ico('equipe', 20) + '</span><span class="a-it-n"><b>Réglages</b><span>Tous les réglages, regroupés par outil</span></span>' + ico('suiv', 20, 2.2) + '</button>'
      + '<div class="h-bas"><button class="a-btn blanc" data-tab="compte">' + ico('code', 20) + 'Mot de passe</button><button class="a-btn navy" data-act="out">' + ico('changer', 20, 2.2) + 'Changer</button></div>'
      + '</div>';
    return h;
  }

  // Réglages : tous les réglages de l'application, regroupés par outil
  function vReglages() {
    var n = (S.equipe || []).filter(function (p) { return p.actif; }).length, nd = (S.dentistes || []).filter(function (d) { return d.actif; }).length;
    var np = (S.equipe || []).filter(function (p) { return p.actif && p.pointage; }).length, R = regles();
    var it = function (t, d, attr, nouveau) { return '<button class="rg-it" ' + attr + ' data-rgi="' + esc((t + ' ' + d).toLowerCase()) + '"><span><b>' + t + '</b><small>' + d + '</small></span>' + (nouveau ? '<em>Nouveau</em>' : '') + ico('suiv', 18, 2.4) + '</button>'; };
    var bloc = function (lettre, cl, t, d, items) { return '<section class="rg-bloc"><div class="rg-bt"><span class="rg-ic ' + cl + '" aria-hidden="true">' + lettre + '</span><span><h2>' + t + '</h2><small>' + d + '</small></span></div>' + items.join('') + '</section>'; };
    var h = hdA({ back: ACC_H, t: 'Réglages', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps rg-corps">';
    if (!planPret()) h += '<div class="ban warn">La mise à jour 009 de la base n’est pas encore faite : l’équipe et les dentistes ne peuvent pas s’afficher.</div>';
    h += '<label class="rg-cherche">' + ico('loupe', 18, 2) + '<input id="rgq" placeholder="Chercher un réglage" autocomplete="off"></label>';
    h += '<div class="rg-grille">'
      + bloc('É', 'b1', 'Équipe et comptes', 'Commun à tous les outils', [
        it('L’équipe', (planPret() ? n + ' ' + pl(n, 'personne') + ' · ' : '') + 'fiches, semaine type, absences', 'data-tab="pequipe"'),
        it('Les dentistes', (planPret() ? nd + ' ' + pl(nd, 'dentiste') + ' · ' : '') + 'jours de présence, départs anticipés', 'data-tab="pdent"'),
        it('Comptes de connexion', 'Identifiants, codes, rôles, cabinet par défaut', 'data-tab="equipe"'),
        it('Types de personnel', 'Assistante, intérimaire… et vos propres types', 'data-tab="ptypes"', true)])
      + bloc('P', 'b2', 'Planning', 'Organisation des journées', [
        it('Postes', 'Sté, Admin, Accueil… ajouter, renommer, couleur', 'data-tab="ppostes"', true),
        it('Règles des heures', 'Congés, maladie, école, formation, férié, reliquat', 'data-tab="pregles"'),
        it('Ce que voient les assistantes', 'Leur planning' + (S.visible && S.visible.planning ? ' (affiché)' : ' (coupé)') + ', leur reliquat', 'data-tab="pvisible"')])
      + bloc('Q', 'b3', 'Pointage', 'Arrivées, sorties, temps effectif', [
        it('QR code', 'Afficher, imprimer, régénérer', 'data-act="rgqr"'),
        it('Calcul et alertes', (R.pt_reliquat !== false ? 'Reliquat sur le temps pointé' : 'Reliquat sur le planning') + ' · retard ' + R.pt_tol + ' min · départ ' + R.pt_tol_dep + ' min', 'data-tab="pregles"'),
        it('Qui pointe', np + ' ' + pl(np, 'personne') + ' soumise' + (np > 1 ? 's' : '') + ', avec ou sans compte', 'data-tab="pqui"')])
      + bloc('C', 'b4', 'Congés', 'Demandes et absences', [
        it('Demandes et planning des congés', 'À valider, congés du mois', 'data-tab="pconges"')])
      + bloc('S', 'b5', 'Gestion de stock', 'Articles, commandes, inventaire', [
        it('Articles', 'Lieux d’utilisation, types de soins, seuils', 'data-tab="articles"'),
        it('Fournisseurs', 'Coordonnées, comptes', 'data-tab="fournisseurs"')])
      + bloc('A', 'b1', 'Application', 'Données et versions', [
        it('Sauvegarde et journal des versions', 'Télécharger les données, ce qui a changé', 'data-tab="plus"'),
        it('Mon mot de passe', 'Changer mon mot de passe', 'data-tab="compte"')])
      + '</div><p class="rg-vide" hidden>Aucun réglage ne correspond.</p>';
    return h + '</div>';
  }
  // ---------- Réglages › Postes ----------
  function vPPostes() {
    var E = S.postesEd = S.postesEd || JSON.parse(JSON.stringify(postes()));
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'Postes', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    h += '<p class="a-aide" style="margin-top:0">Ce qu’une assistante peut faire quand elle n’est pas au fauteuil. Proposés dans la semaine type, le planning et l’export Excel. « École », « Ne travaille pas » et les absences sont fixes.</p>';
    h += '<div class="a-liste po-l">' + E.map(function (x, i) {
      return '<div class="a-li po' + (x.retire ? ' retire' : '') + '"><span class="po-ord"><button class="btn l sm" data-poup="' + i + '" aria-label="Monter"' + (i ? '' : ' disabled') + '>' + ico('haut', 16, 2.4) + '</button><button class="btn l sm" data-podown="' + i + '" aria-label="Descendre"' + (i < E.length - 1 ? '' : ' disabled') + '>' + ico('bas', 16, 2.4) + '</button></span>'
        + '<label class="mu">Nom affiché<input class="in" data-pon="' + i + '" value="' + esc(x.n) + '"></label>'
        + '<label class="mu">Dans l’Excel<input class="in po-xl" data-poxl="' + i + '" value="' + esc(x.xl || '') + '"></label>'
        + '<label class="mu">Couleur<input class="in po-c" type="color" data-poc="' + i + '" value="#' + esc(x.coul || 'EEF1F4') + '"></label>'
        + '<button class="btn l sm po-r" data-poret="' + i + '">' + (x.retire ? 'Rétablir' : 'Retirer') + '</button></div>';
    }).join('') + '</div>';
    h += '<div class="card po-add"><b>Ajouter un poste</b><div class="h-g2"><label class="mu">Nom affiché<input class="in" id="ponew" placeholder="Ex. : Secrétariat, Stérilisation 2"></label><label class="mu">Couleur<input class="in po-c" type="color" id="ponewc" value="#E2EFDA"></label></div><button class="btn" data-act="poadd">Ajouter</button></div>';
    h += '<p class="a-aide">Un poste retiré n’est plus proposé, mais reste lisible dans les plannings où il apparaît déjà.</p>';
    return h + '<button class="a-btn navy" data-act="posave">Enregistrer les postes</button></div>';
  }
  function sauverParam(cle0, val, msg, apres) {
    sb.from('parametres').upsert({ cle: cle0, valeur: val }, { onConflict: 'cle' }).then(function (r) { if (r.error) throw r.error; toast(msg); if (apres) apres(); render(); }).catch(function (e) { toast(msgErr(e)); });
  }
  // ---------- Réglages › Types de personnel ----------
  function vPTypes() {
    var E = S.typesEd = S.typesEd || JSON.parse(JSON.stringify(typesPers()));
    var util = function (code) { return (S.equipe || []).filter(function (p) { return p.type === code; }).length; };
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'Types de personnel', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    h += '<p class="a-aide" style="margin-top:0">Choisi dans chaque fiche. Indique si la personne apparaît dans le planning, si elle a un contrat d’heures (reliquat) et si elle est rattachée à un dentiste (sinon, sa semaine type ne propose que les postes : Accueil, Admin, Sté…).</p><div class="a-liste">' + E.map(function (t, i) {
      var n = util(t.code);
      return '<div class="a-li ty' + (t.retire ? ' retire' : '') + '"><span class="a-it-n"><b>' + esc(t.n) + '</b><span>' + n + ' ' + pl(n, 'personne') + (t.base ? ' · type de base' : '') + '</span></span>'
        + (t.base ? '<span class="ty-f">' + (t.planning ? 'Planning' : '') + (t.contrat ? ' · contrat' : ' · sans contrat') + (t.dentiste !== false ? ' · rattaché à un dentiste' : '') + '</span>'
          : '<label class="ty-c"><input type="checkbox" data-typl="' + i + '"' + (t.planning !== false ? ' checked' : '') + '>Planning</label><label class="ty-c"><input type="checkbox" data-tyco="' + i + '"' + (t.contrat !== false ? ' checked' : '') + '>Contrat</label><label class="ty-c"><input type="checkbox" data-tyde="' + i + '"' + (t.dentiste !== false ? ' checked' : '') + '>Rattaché à un dentiste</label><button class="btn l sm" data-tyret="' + i + '"' + (n && !t.retire ? ' title="Utilisé dans ' + n + ' fiche(s) : il restera lisible"' : '') + '>' + (t.retire ? 'Rétablir' : 'Retirer') + '</button>') + '</div>';
    }).join('') + '</div>';
    h += '<div class="card po-add"><b>Nouveau type</b><input class="in" id="tynew" placeholder="Ex. : Secrétaire, Hygiéniste, Aide-dentaire"><label class="ty-n"><input type="checkbox" id="tynewpl" checked> Apparaît dans le planning</label><label class="ty-n"><input type="checkbox" id="tynewco" checked> A un contrat d’heures (reliquat)</label><label class="ty-n"><input type="checkbox" id="tynewde"> Rattaché à un dentiste (travaille au fauteuil, a un dentiste attitré, peut remplacer au fauteuil)</label><button class="btn" data-act="tyadd">Ajouter le type</button></div>';
    return h + '<button class="a-btn navy" data-act="tysave">Enregistrer les types</button></div>';
  }
  function actionReglages(d) {
    var E = S.postesEd, T = S.typesEd, i;
    if (d.poup != null && E) { i = +d.poup; var a = E[i]; E[i] = E[i - 1]; E[i - 1] = a; render(); return true; }
    if (d.podown != null && E) { i = +d.podown; var b = E[i]; E[i] = E[i + 1]; E[i + 1] = b; render(); return true; }
    if (d.poret != null && E) { E[+d.poret].retire = !E[+d.poret].retire; render(); return true; }
    if (d.act === 'poadd' && E) {
      var n = $('ponew').value.trim(); if (!n) { toast('Indiquez le nom du poste'); return true; }
      var code = majSansAccent(n).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'POSTE';
      if (['ECOLE', 'OFF', 'CP', 'ARRET', 'FORMATION', 'FERIE'].indexOf(code) >= 0 || E.some(function (x) { return x.code === code; })) code += '_' + (E.length + 1);
      E.push({ code: code, n: n, xl: majSansAccent(n), coul: $('ponewc').value.replace('#', '').toUpperCase() }); render(); return true;
    }
    if (d.act === 'posave' && E) { sauverParam('postes', E, '✔ Postes enregistrés', function () { S.postes = JSON.parse(JSON.stringify(E)); }); return true; }
    if (d.tyret != null && T) { T[+d.tyret].retire = !T[+d.tyret].retire; render(); return true; }
    if (d.act === 'tyadd' && T) {
      var nt = $('tynew').value.trim(); if (!nt) { toast('Indiquez le nom du type'); return true; }
      var ct = norm(nt).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'type';
      if (T.some(function (x) { return x.code === ct; })) { toast('Ce type existe déjà'); return true; }
      T.push({ code: ct, n: nt, planning: $('tynewpl').checked, contrat: $('tynewco').checked, dentiste: $('tynewde').checked }); render(); return true;
    }
    if (d.act === 'tysave' && T) { sauverParam('types_personnel', T.filter(function (x) { return !x.base; }), '✔ Types enregistrés', function () { S.typesPers = T.filter(function (x) { return !x.base; }); }); return true; }
    return false;
  }
  function vPVisible() {
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'Ce que voient les assistantes', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps"><div class="a-liste">'
      + (function () { var V = S.visible || {}; return '<label class="a-li"><span class="a-it-n"><b>Leur planning</b><span>jours, dentiste, horaires</span></span><input type="checkbox" role="switch" class="h-sw" data-vis="planning"' + (V.planning ? ' checked' : '') + ' aria-label="Les assistantes voient leur planning"><span class="pill' + (V.planning ? ' ok' : '') + '">' + (V.planning ? 'Activé' : 'Coupé') + '</span></label>'
        + '<label class="a-li"' + (V.planning ? '' : ' style="opacity:.6"') + '><span class="a-it-n"><b>Leur reliquat d’heures</b><span>possible seulement si le planning est affiché</span></span><input type="checkbox" role="switch" class="h-sw" data-vis="reliquat"' + (V.reliquat ? ' checked' : '') + (V.planning ? '' : ' disabled') + ' aria-label="Les assistantes voient leur reliquat"><span class="pill' + (V.reliquat ? ' ok' : '') + '">' + (V.reliquat ? 'Activé' : 'Coupé') + '</span></label>'; })()
      + '</div><p class="a-aide">Tant que c’est coupé, le planning n’est visible que par la référente et la responsable. Les demandes de congés restent toujours possibles pour les assistantes.</p>';
    return h + '</div>';
  }

  // ---------- Réglages › Qui pointe ----------
  function vPQui() {
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'Qui pointe', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    if (!pointagePret()) return h + '<div class="ban warn">La mise à jour 016 de la base (pointage) n’est pas encore faite.</div></div>';
    var ps = (S.equipe || []).filter(function (p) { return p.actif; }).sort(function (a, b) { return (a.ordre - b.ordre) || (a.id - b.id); });
    var oui = ps.filter(function (p) { return p.pointage; }), non = ps.filter(function (p) { return !p.pointage; });
    var sansC = oui.filter(function (p) { return !p.profil_id; });
    var ligne = function (p) {
      var prof = p.profil_id ? (S.profils || []).filter(function (x) { return x.id === p.profil_id; })[0] : null;
      var compte = p.profil_id ? '<span class="qp-c ok">' + ico('ok', 14, 2.8) + (prof && prof.identifiant ? 'compte « ' + esc(prof.identifiant) + ' »' : 'compte relié') + '</span>'
        : '<span class="qp-c ' + (p.pointage ? 'ko' : 'mu') + '">' + (p.pointage ? 'Pas de compte : ne peut pas scanner' : 'pas de compte') + '</span>';
      return '<div class="qp-l' + (p.pointage ? ' on' : '') + '"><span class="a-av p">' + initiale(p.prenom) + '</span><span class="qp-n"><b>' + esc(p.prenom) + '</b><span>' + esc(nomType(p)) + '</span>' + compte + '</span>'
        + '<button class="btn l sm" data-pf="' + p.id + '">Fiche</button><label class="qp-sw"><input type="checkbox" role="switch" class="h-sw" data-qp="' + p.id + '"' + (p.pointage ? ' checked' : '') + ' aria-label="' + esc(p.prenom) + ' soumis au pointage"><span>' + (p.pointage ? 'Pointe' : 'Non') + '</span></label></div>';
    };
    h += '<p class="a-aide" style="margin-top:0">Les personnes activées scannent le QR code en arrivant et en partant, avec leur compte sur leur téléphone. L’interrupteur s’enregistre tout de suite.</p>'
      + '<div class="qp-kpis"><div><b>' + oui.length + '</b><span>pointe' + (oui.length > 1 ? 'nt' : '') + '</span></div><div><b>' + non.length + '</b><span>ne pointe' + (non.length > 1 ? 'nt' : '') + ' pas</span></div><div class="' + (sansC.length ? 'ko' : 'ok') + '"><b>' + sansC.length + '</b><span>sans compte parmi celles qui pointent</span></div></div>';
    if (sansC.length) h += '<div class="ban warn">' + sansC.map(function (p) { return esc(p.prenom); }).join(', ') + ' ' + (sansC.length > 1 ? 'doivent pointer mais n’ont' : 'doit pointer mais n’a') + ' pas de compte de connexion : à créer dans la fiche, rubrique « Compte et pointage ».</div>';
    h += '<h2 class="a-jour">Pointent (' + oui.length + ')</h2><div class="a-liste qp">' + (oui.length ? oui.map(ligne).join('') : '<p class="a-vide">Personne pour l’instant.</p>') + '</div>';
    h += '<h2 class="a-jour">Ne pointent pas (' + non.length + ')</h2><div class="a-liste qp">' + (non.length ? non.map(ligne).join('') : '<p class="a-vide">Tout le monde pointe.</p>') + '</div>';
    return h + '<p class="a-aide">Les anciennes ne sont pas listées. La référente et la responsable ne pointent pas.</p></div>';
  }
  function basculerPointage(id, v) {
    var p = persById(id); if (!p) return; p.pointage = v; render();
    sb.from('equipe').update({ pointage: v }).eq('id', p.id).then(function (r) { if (r.error) throw r.error; toast('✔ ' + p.prenom + (v ? ' pointe' : ' ne pointe plus')); })
      .catch(function (e) { p.pointage = !v; render(); toast(msgErr(e)); });
  }

  // --- L'équipe ---
  function resumeTrame(p) {
    if (p.type === 'interimaire') return 'Intérimaire · selon les besoins';
    var parts = [];
    for (var j = 1; j <= 5; j++) {
      var x = (p.trame || {})[j] || {}, a = x.am && x.am.a, b = x.pm && x.pm.a;
      var v = a && a !== 'OFF' ? a : b && b !== 'OFF' ? b : 'OFF';
      if (v !== 'OFF' && v !== 'ECOLE') parts.push(JC[j].toLowerCase() + ' ' + affTxt(v).replace(/^Dr /, ''));
    }
    return (p.statut === 'apprentie' ? 'Apprentie' : 'Qualifiée') + (p.ecole_jour ? ' · école le ' + JOURS[p.ecole_jour].toLowerCase() : '') + (parts.length ? ' · ' + parts.join(', ') : '');
  }
  function lignePers(p) {
    var h = heuresTrame(p.trame), c = +p.contrat_h || 0, ecart = p.type !== 'interimaire' && c && Math.abs(h - c) > 0.01;
    return '<button class="a-li" data-pf="' + p.id + '"><span class="a-av p">' + initiale(p.prenom) + '</span><span class="a-it-n"><b>' + esc(p.prenom) + (p.profil_id ? '' : '') + '</b><span>' + esc(resumeTrame(p)) + '</span>'
      + (ecart ? '<span class="warn">Semaine type : ' + fh(h) + ' pour un contrat de ' + fh(c) + '</span>' : '') + '</span>' + ico('suiv', 20, 2.2) + '</button>';
  }
  function vPEquipe() {
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'L’équipe', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    if (!planPret()) return h + '<div class="ban warn">La mise à jour 009 de la base n’est pas encore faite.</div></div>';
    var tri = function (a, b) { return (a.ordre - b.ordre) || a.prenom.localeCompare(b.prenom); };
    var act = S.equipe.filter(function (p) { return p.actif; }).sort(tri), anc = S.equipe.filter(function (p) { return !p.actif; }).sort(tri);
    h += act.length ? '<div class="a-liste">' + act.map(lignePers).join('') + '</div>' : '<p class="a-vide">Personne pour l’instant.</p>';
    h += '<button class="a-plus" data-act="pfnew">+ Ajouter une personne</button>';
    if (anc.length) h += '<details class="h-plie"><summary>Anciennes et anciens · ' + anc.length + '</summary><div class="a-liste">' + anc.map(lignePers).join('') + '</div></details>';
    var lies = {}; S.equipe.forEach(function (p) { if (p.profil_id) lies[p.profil_id] = 1; });
    var seuls = S.profils.filter(function (p) { return !lies[p.id]; });
    if (seuls.length) h += '<h2 class="a-jour">Comptes sans fiche planning</h2><p class="a-aide">Ces personnes se connectent à l’appli mais n’apparaissent pas dans le planning (ex. la responsable).</p>'
      + seuls.map(carteProfil).join('');
    if (S.eqNew && !S.eqNew.lierA) h += vEqNew();
    else if (!S.eqNew) h += '<button class="a-plus" data-act="eqnew">+ Créer un compte de connexion sans fiche planning</button>';
    return h + '</div>';
  }

  // --- Fiche d'une personne ---
  function nouvellePers() { return { prenom: '', type: 'assistante', statut: 'qualifiee', contrat_h: 39, ecole_jour: null, actif: true, trame: {}, consigne: '' }; }
  function ouvrirPers(id) {
    var p = id === 'new' ? nouvellePers() : S.equipe.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) return;
    S.pf = { id: id, d: JSON.parse(JSON.stringify(p)) }; S.eqNew = null; S.eqEdit = null; S.tab = 'pfiche'; render(); window.scrollTo(0, 0);
  }
  function optAff(cur, sansDent) {
    var ds = (S.dentistes || []).filter(function (d) { return (d.actif && !sansDent) || 'D:' + d.id === cur; }).sort(function (a, b) { return a.ordre - b.ordre; });
    return '<option value="">—</option>' + (ds.length ? '<optgroup label="Dentistes">' : '<optgroup label="Dentistes" hidden>') + ds.map(function (d) { var v = 'D:' + d.id; return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>Dr ' + esc(d.prenom) + '</option>'; }).join('') + '</optgroup>'
      + '<optgroup label="Autres">' + listeCodes(cur).map(function (c) { return '<option value="' + c[0] + '"' + (cur === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</optgroup>';
  }
  function demiEdit(j, k, c) {
    c = c || {}; var off = !c.a || c.a === 'OFF';
    return '<div class="h-demi"><span class="h-dl">' + (k === 'am' ? 'Matin' : 'Après-midi') + '</span><select class="in" data-tr="' + j + '.' + k + '.a" aria-label="' + JOURS[j] + ' ' + (k === 'am' ? 'matin' : 'après-midi') + '">' + optAff(c.a, !!(S.pf && S.pf.d && !aDent(S.pf.d.type))) + '</select>'
      + '<span class="h-hh"><input class="in" type="time" data-tr="' + j + '.' + k + '.de" value="' + esc(off ? '' : c.de || '') + '"' + (off ? ' disabled' : '') + ' aria-label="Arrivée"><span>–</span><input class="in" type="time" data-tr="' + j + '.' + k + '.fi" value="' + esc(off ? '' : c.fi || '') + '"' + (off ? ' disabled' : '') + ' aria-label="Départ"></span></div>';
  }
  // Fiche d'une personne : résumé à gauche, rubriques en onglets (sur téléphone : une rubrique à la fois)
  function vPFiche() {
    var F = S.pf; if (!F) { S.tab = 'pequipe'; return vPEquipe(); }
    var p = F.d, nouv = F.id === 'new', t = p.trame || {}, tot = heuresTrame(t), c = +p.contrat_h || 0, ty = typeDe(p.type), tel = telephone();
    var prof = p.profil_id ? S.profils.filter(function (x) { return x.id === p.profil_id; })[0] : null;
    var ONG = [['infos', 'Infos et contrat'], ['semaine', 'Semaine type'], ['absences', 'Absences'], ['compte', 'Compte et pointage'], ['regles', 'Règles et consigne']];
    var og = nouv ? 'infos' : F.onglet || (tel ? null : 'semaine');
    var h = '<header class="a-hd fixe"><div class="a-hd-row"><button class="a-back" ' + (tel && og && !nouv ? 'data-pfong=""' : 'data-tab="pequipe"') + '>' + ico('prec', 22, 2.4) + (tel && og && !nouv ? esc(p.prenom || 'Fiche') : 'L’équipe') + '</button><h1>' + (nouv ? 'Nouvelle fiche' : tel && og ? ONG.filter(function (o) { return o[0] === og; })[0][1] : esc(p.prenom || '…')) + '</h1><span class="a-cale"></span></div></header><div class="a-corps h-fiche fi">';
    // --- résumé
    var at = attitre(p), da = at && dentById(at), auj = dIso(new Date());
    var avenir = (S.conges || []).filter(function (x) { return String(x.equipe_id) === String(F.id) && x.au >= auj && x.statut !== 'refuse'; }).sort(function (a, b) { return a.du < b.du ? -1 : 1; }).slice(0, 3).map(function (x) { return '<span class="fi-av"><i class="' + (x.type === 'FORMATION' ? 'fo' : x.type === 'ARRET' ? 'ar' : 'cp') + '"></i>' + esc(typeTxt(x.type)) + ' ' + periode(x.du, x.au) + (x.statut === 'attente' ? ' · en attente' : '') + '</span>'; });
    (p.offs || []).slice(0, 2).forEach(function (o) { if (offProchains(o, 1).length) avenir.push('<span class="fi-av"><i class="off"></i>Jour off : ' + esc(offTxt(o).split(' depuis')[0]) + '</span>'); });
    var ecT = c && Math.abs(tot - c) > 0.01;
    var resume = '<aside class="fi-g"><section class="fi-carte fi-res"><span class="fi-avt" aria-hidden="true">' + esc((p.prenom || '?').charAt(0).toUpperCase()) + '</span><b class="fi-nom">' + esc(p.prenom || 'Nouvelle personne') + '</b>'
      + '<span class="fi-badges"><span>' + esc(nomType(p)) + (p.statut === 'apprentie' && p.type === 'assistante' ? '' : p.statut === 'apprentie' ? ' · apprentie' : '') + '</span>' + (p.pointage ? '<span class="or">Pointe</span>' : '') + (!p.actif && !nouv ? '<span class="ko">Ancienne</span>' : '') + '</span>'
      + '<div class="fi-tuiles">' + (ty.contrat !== false ? '<div><small>Contrat</small><b>' + (c ? fh(c) : '—') + '</b></div>' : '') + '<div><small>Semaine type</small><b>' + fh(tot) + '</b>' + (c ? '<em class="' + (ecT ? 'plus' : 'ok') + '">' + (ecT ? relTxt(tot - c) : '= contrat') + '</em>' : '') + '</div>'
      + (aDent(p.type) ? '<div><small>Dentiste attitré</small><b>' + (da ? 'Dr ' + esc(da.prenom) : '—') + '</b></div>' : '') + (p.statut === 'apprentie' && p.ecole_jour ? '<div><small>École</small><b>' + JOURS[p.ecole_jour] + '</b></div>' : '') + '</div></section>'
      + (nouv ? '' : '<section class="fi-carte"><h3>À venir</h3>' + (avenir.length ? avenir.join('') : '<span class="mu">Rien de prévu</span>') + '</section>'
        + '<section class="fi-carte"><h3>Compte</h3>' + (prof ? '<span>Se connecte avec <b>' + esc(prof.identifiant) + '</b></span><span class="mu">' + LABEL[prof.role] + (prof.cabinet ? ' · cabinet ' + prof.cabinet : '') + '</span>' : '<span class="mu">Pas de compte de connexion</span>') + '</section>') + '</aside>';
    // --- rubriques
    var avant = '<div class="card"><p class="mu" style="margin:0">Enregistrez d’abord la fiche.</p></div>';
    var R = {};
    R.infos = function () { return '<div class="h-g2">'
      + '<label class="mu">Prénom<input class="in" data-pff="prenom" value="' + esc(p.prenom) + '"></label>'
      + '<label class="mu">Type<select class="in" data-pff="type">' + typesPers().filter(function (t) { return !t.retire || t.code === p.type; }).map(function (t) { return '<option value="' + esc(t.code) + '"' + (p.type === t.code ? ' selected' : '') + '>' + esc(t.n) + '</option>'; }).join('') + '</select></label>'
      + '<label class="mu">Statut<select class="in" data-pff="statut"><option value="qualifiee"' + (p.statut === 'qualifiee' ? ' selected' : '') + '>Qualifiée / qualifié</option><option value="apprentie"' + (p.statut === 'apprentie' ? ' selected' : '') + '>Apprentie / apprenti</option></select></label>'
      + (typeDe(p.type).contrat === false ? '' : '<label class="mu">Heures du contrat par semaine<input class="in" inputmode="decimal" data-pff="contrat_h" value="' + esc(fr(p.contrat_h)) + '"></label>')
      + (p.statut === 'apprentie' ? '<label class="mu">Jour d’école par défaut<select class="in" data-pff="ecole_jour"><option value="">—</option>' + [1, 2, 3, 4, 5].map(function (j) { return '<option value="' + j + '"' + (+p.ecole_jour === j ? ' selected' : '') + '>' + JOURS[j] + '</option>'; }).join('') + '</select></label>' : '')
      + '<label class="row" style="grid-column:1/-1"><input type="checkbox" data-pff="actif"' + (p.actif ? ' checked' : '') + ' style="width:20px;height:20px;flex:none"><span>Fait partie de l’équipe <span class="mu">(décocher pour une ancienne : elle reste dans l’historique)</span></span></label></div>';
      + '</div>'; };
    R.semaine = function () {
      var cel = F.cel || '1.am', cx = cel.split('.'), cj = +cx[0], ck = cx[1];
      var g = '<div class="fi-sem"><span></span>' + [1, 2, 3, 4, 5].map(function (j) { var hj = heuresJour(t, j); return '<span class="fi-sj"><b>' + JC[j] + '</b><small>' + (hj ? fh(hj) : '—') + '</small></span>'; }).join('');
      ['am', 'pm'].forEach(function (k) {
        g += '<span class="fi-sl">' + (k === 'am' ? 'Matin' : 'Après-midi') + '</span>';
        for (var j = 1; j <= 5; j++) {
          var x = (t[j] || {})[k] || {}, a = x.a || 'OFF', cl = a === 'OFF' ? 'off' : a === 'ECOLE' ? 'ec' : a.slice(0, 2) === 'D:' ? 'de' : 'po';
          g += '<button class="fi-c ' + cl + (cel === j + '.' + k ? ' sel' : '') + '" data-pfcel="' + j + '.' + k + '" aria-pressed="' + (cel === j + '.' + k) + '" aria-label="' + JOURS[j] + ' ' + (k === 'am' ? 'matin' : 'après-midi') + '"><b>' + esc(a === 'OFF' ? 'Off' : nomAff(a)) + '</b><small>' + (a !== 'OFF' && x.de ? ft(x.de) + '–' + ft(x.fi) : a === 'OFF' ? 'ne travaille pas' : '') + '</small></button>';
        }
      });
      g += '</div><div class="h-total ' + (ecT ? 'warn' : 'ok') + '"><span>Total de la semaine type</span><b>' + fh(tot) + (c ? ' / ' + fh(c) + ' · ' + (ecT ? relTxt(tot - c) : 'équilibré') : '') + '</b></div>';
      g += '<div class="fi-ed"><b>' + JOURS[cj] + ' ' + (ck === 'am' ? 'matin' : 'après-midi') + '</b>' + demiEdit(cj, ck, (t[cj] || {})[ck]) + '<div class="fi-rac"><button class="btn l sm" data-act="pfcopiejour" data-j="' + cj + '">Copier le ' + JOURS[cj].toLowerCase() + ' sur toute la semaine</button></div></div>';
      return '<p class="mu fi-intro">Touchez une case pour changer ' + (aDent(p.type) ? 'le dentiste ou le poste' : 'le poste') + ' et les horaires. Le planning de chaque semaine part de là.</p>' + g;
    };
    R.absences = function () { return nouv ? avant : '<h3 class="fi-h3">Congés</h3>' + blocConges(false, F.id, p) + '<h3 class="fi-h3">Formations</h3>' + blocConges(false, F.id, p, true) + '<h3 class="fi-h3">Jours off</h3>' + blocOffs(F); };
    R.compte = function () {
      var x = (!pointagePret() ? '' : prof && (prof.role === 'referente' || prof.role === 'responsable') ? '<p class="mu">Pointage journalier : non concernée (' + LABEL[prof.role].toLowerCase() + ').</p>'
        : '<label class="row fi-pt"><input type="checkbox" data-pff="pointage"' + (p.pointage ? ' checked' : '') + ' style="width:22px;height:22px;flex:none"><span><b>Soumise au pointage journalier</b><span class="mu">Scanne le QR code du centre à l’arrivée et à la sortie (tuile « Pointer » de son application).</span></span></label>');
      var h2 = '';
      if (nouv) h2 += '<div class="card"><p class="mu" style="margin:0">Enregistrez d’abord la fiche, puis vous pourrez lui créer un compte.</p></div>';
      else if (prof) h2 += carteProfil(prof) + '<button class="a-lien" data-act="pfdelier">Détacher ce compte de la fiche</button>';
      else {
        var lies = {}; S.equipe.forEach(function (x) { if (x.profil_id) lies[x.profil_id] = 1; });
        var libres = S.profils.filter(function (x) { return !lies[x.id]; });
        h2 += '<div class="card"><p class="mu" style="margin-top:0">' + esc(p.prenom) + ' n’a pas de compte : elle apparaît dans le planning mais ne se connecte pas à l’appli.</p>'
          + (S.eqNew && String(S.eqNew.lierA) === String(F.id) ? '' : '<button class="btn" data-act="pfcompte">+ Créer son compte de connexion</button>')
          + (libres.length ? '<label class="mu" style="display:block;margin-top:12px">Ou relier un compte qui existe déjà<select class="in" id="pflier"><option value="">Choisir…</option>' + libres.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nom) + ' (' + esc(x.identifiant) + ')</option>'; }).join('') + '</select></label>' : '') + '</div>';
        if (S.eqNew && String(S.eqNew.lierA) === String(F.id)) h2 += vEqNew();
      }
      return x + '<h3 class="fi-h3">Compte de connexion</h3>' + h2;
    };
    R.regles = function () {
      var rg = p.regles || {}, k = Object.keys(rg).filter(function (z) { return ABS.indexOf(z) >= 0 && rg[z] !== '' && rg[z] != null; });
      return (aDent(p.type) ? '<label class="mu">Poste quand son dentiste est absent<select class="in" data-pff="repli">' + listeCodes(rg.repli).filter(function (z) { return ['ECOLE', 'OFF'].indexOf(z[0]) < 0; }).map(function (z) { return '<option value="' + z[0] + '"' + ((rg.repli || 'STE') === z[0] ? ' selected' : '') + '>' + z[1] + '</option>'; }).join('') + '</select></label>' : '')
        + '<label class="mu">Consigne (affichée dans le planning)<textarea class="in" rows="3" data-pff="consigne" placeholder="Ex. : pas de samedi, finit à 17 h le mardi…">' + esc(p.consigne || '') + '</textarea></label>'
        + '<div class="fi-lien"><span><b>Heures comptées particulières</b><span class="mu">' + (k.length ? k.map(function (z) { return ABS_TXT[z] + ' ' + fh(+rg[z]); }).join(' · ') : 'règle générale') + '</span></span><button class="btn l sm" data-tab="pregles">Modifier</button></div>';
    };
    var desc = { infos: (nouv ? 'Prénom, type, statut, contrat' : esc(nomType(p)) + (ty.contrat !== false && c ? ' · ' + fh(c) : '')), semaine: fh(tot) + (da ? ' · Dr ' + esc(da.prenom) : ''), absences: (avenir.length ? avenir.length + ' à venir' : 'congés, formations, jours off'), compte: (prof ? esc(prof.identifiant) : 'pas de compte') + (p.pointage ? ' · pointe' : ''), regles: (p.consigne ? '« ' + esc(String(p.consigne).slice(0, 40)) + (p.consigne.length > 40 ? '…' : '') + ' »' : aDent(p.type) ? 'repli : ' + esc(affTxt((p.regles || {}).repli || 'STE')) : 'consigne, heures particulières') };
    if (tel && !og) {
      h += resume + '<div class="fi-liste">' + ONG.map(function (o) { return '<button class="fi-rub" data-pfong="' + o[0] + '"><span><b>' + o[1] + '</b><small>' + desc[o[0]] + '</small></span>' + ico('suiv', 18, 2.4) + '</button>'; }).join('') + '</div>';
      return h + '</div>';
    }
    var corps = '<div class="fi-corps">' + R[og]() + '</div>';
    if (tel) return h + corps + '</div>';
    h += resume + '<section class="fi-d"><nav class="fi-tabs" role="tablist" aria-label="Rubriques de la fiche">' + ONG.map(function (o) { return '<button role="tab" data-pfong="' + o[0] + '" aria-selected="' + (og === o[0]) + '"' + (og === o[0] ? ' class="on"' : '') + (nouv && o[0] !== 'infos' ? ' disabled' : '') + '>' + o[1] + '</button>'; }).join('') + '</nav>' + corps + '</section>';
    return h + '</div>';
  }
  function vBarPFiche() {
    var F = S.pf; if (!F) return '';
    return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn navy" data-act="pfsave"' + (F.busy ? ' disabled' : '') + '>' + (F.busy ? 'Enregistrement…' : 'Enregistrer') + '</button></div></div>';
  }
  function majPers(el) {
    var F = S.pf; if (!F) return;
    if (el.dataset.pff) {
      var k = el.dataset.pff, v = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'contrat_h') v = Math.max(0, nb(String(v).replace(',', '.')));
      if (k === 'ecole_jour') v = v ? +v : null;
      if (k === 'repli') { F.d.regles = Object.assign({}, F.d.regles || {}); F.d.regles.repli = v; return; }
      F.d[k] = v;
    } else if (el.dataset.tr) {
      var p = el.dataset.tr.split('.'), t = F.d.trame = F.d.trame || {}, j = t[p[0]] = t[p[0]] || {}, c = j[p[1]] = j[p[1]] || {};
      c[p[2]] = el.value;
      if (p[2] === 'a') {
        if (!el.value || el.value === 'OFF') { delete c.de; delete c.fi; if (!el.value) delete j[p[1]]; }
        else if (!c.de) { c.de = p[1] === 'am' ? '09:00' : '14:00'; c.fi = p[1] === 'am' ? '13:00' : '19:00'; }
      }
    }
  }
  // ---------- Jours off récurrents (fiche d'une assistante) ----------
  var REC_OFF = [['une', 'Une fois'], ['sem', 'Chaque semaine'], ['2sem', '1 semaine sur 2'], ['mois', '1 fois par mois']];
  var RANG_OFF = [[1, '1er'], [2, '2e'], [3, '3e'], [4, '4e'], [-1, 'Dernier']];
  function offMatch(o, iso) {
    if (!o || !o.du || iso < o.du || (o.au && iso > o.au)) return false;
    var j = jourSem(iso); if (j < 1 || j > 5) return false;
    if (o.rec === 'une') return iso === o.du;
    if ((o.jours || []).indexOf(j) < 0) return false;
    if (o.rec === '2sem') return Math.round((dDe(lundiDe(iso)) - dDe(lundiDe(o.du))) / 864e5 / 7) % 2 === 0;
    if (o.rec === 'mois') { var d = dDe(iso), n = Math.ceil(d.getDate() / 7), fin = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return o.rang === -1 ? d.getDate() + 7 > fin : n === o.rang; }
    return true;
  }
  function offLe(p, iso, demi) { return (p.offs || []).some(function (o) { return (o.demi === 'J' || o.demi === demi) && offMatch(o, iso); }); }
  function offProchains(o, n) {
    var l = [], d = [dIso(new Date()), o.du || dIso(new Date())].sort()[1];
    for (var i = 0; i < 800 && l.length < n; i++, d = addJ(d, 1)) { if (o.au && d > o.au) break; if (offMatch(o, d) && !ferie(d)) l.push(d); }
    return l;
  }
  function jourCourt(iso) { var d = dDe(iso); return JC[jourSem(iso)].toLowerCase() + '. ' + d.getDate() + ' ' + ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''); }
  function offTxt(o) {
    var dm = o.demi === 'AM' ? 'matin' : o.demi === 'PM' ? 'après-midi' : 'journée';
    if (o.rec === 'une') return JOURS[jourSem(o.du)] + ' ' + dateCourte(o.du) + ', ' + dm + ' · une fois';
    var js = (o.jours || []).slice().sort().map(function (j) { return JOURS[j]; }), jt = js.length > 1 ? js.slice(0, -1).join(', ') + ' et ' + js[js.length - 1] : js[0] || '?';
    var r = o.rec === 'sem' ? 'chaque semaine' : o.rec === '2sem' ? 'une semaine sur deux' : (o.rang === -1 ? 'le dernier' : 'le ' + (o.rang === 1 ? '1er' : o.rang + 'e')) + ' du mois';
    return (o.rec === 'mois' ? jt + ', ' + dm + ' · ' + r : jt + ', ' + dm + ' · ' + r) + ' depuis le ' + dateCourte(o.du) + (o.au ? ' jusqu’au ' + dateCourte(o.au) : '');
  }
  function blocOffs(F) {
    var l = F.d.offs || [], E = S.offEd && String(S.offEd.pid) === String(F.id) ? S.offEd : null;
    var h = '<div class="a-liste">' + l.map(function (o) {
      if (E && E.id === o.id) return formOff(E);
      var pr = offProchains(o, 3), fini = !pr.length;
      return '<button class="a-li h-cgl' + (fini ? ' passe' : '') + '" data-offmod="' + esc(o.id) + '" aria-label="Modifier"><span class="a-it-n"><b>' + esc(offTxt(o)) + '</b><span>' + (fini ? 'terminé' : 'Prochains : ' + pr.map(jourCourt).join(' · ')) + '</span></span><span class="h-crayon">' + ico('crayon', 18, 2) + '</span></button>';
    }).join('');
    if (E && !E.id) h += formOff(E);
    else if (!E) h += '<button class="a-li h-lien" data-act="offadd">+ Ajouter un jour off</button>';
    return h + '</div><p class="a-aide">Dans le planning, ces demi-journées passent en « OFF » (0 h). Une case modifiée à la main reste prioritaire.</p>';
  }
  function puces(attr, opts, actif) { return opts.map(function (x) { var on = actif(x[0]); return '<button type="button" class="h-ex-j h-off-p' + (on ? ' on' : '') + '" ' + attr + '="' + x[0] + '" aria-pressed="' + on + '">' + x[1] + '</button>'; }).join(''); }
  function formOff(E) {
    var une = E.rec === 'une', o = offDe(E), pr = o ? offProchains(o, 4) : [];
    return '<div class="a-li h-cadd h-off">' + (E.id ? '<b class="h-ctit">Modifier le jour off</b>' : '')
      + (une ? '' : '<div class="h-off-l"><span class="mu">Jours</span><div class="h-ex-js">' + puces('data-offj', [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven']], function (j) { return E.jours.indexOf(j) >= 0; }) + '</div></div>')
      + '<div class="h-off-l"><span class="mu">Durée</span><div class="h-ex-js">' + puces('data-offd', [['J', 'Journée'], ['AM', 'Matin'], ['PM', 'Après-midi']], function (x) { return E.demi === x; }) + '</div></div>'
      + '<div class="h-off-l"><span class="mu">Récurrence</span><div class="h-ex-js">' + puces('data-offr', REC_OFF, function (x) { return E.rec === x; }) + '</div></div>'
      + (E.rec === 'mois' ? '<div class="h-off-l"><span class="mu">Dans le mois</span><div class="h-ex-js">' + puces('data-offn', RANG_OFF, function (x) { return E.rang === x; }) + '</div></div>' : '')
      + '<div class="h-g2" style="width:100%"><label class="mu">' + (une ? 'Date' : 'À partir du') + '<input class="in" type="date" id="offdu" value="' + esc(E.du || '') + '"></label>'
      + (une ? '' : '<label class="mu">Jusqu’au (facultatif)<input class="in" type="date" id="offau" value="' + esc(E.au || '') + '"></label>') + '</div>'
      + '<p class="h-off-pr">' + (pr.length ? 'Prochains : <b>' + pr.map(jourCourt).join(' · ') + '</b>' : '<span class="warn">' + (une ? 'Choisissez la date.' : !E.jours.length ? 'Touchez au moins un jour.' : 'Aucune date à venir avec ces choix.') + '</span>') + '</p>'
      + '<div class="h-cpied">' + (E.id ? '<button class="h-csup" data-act="offsuppr">' + ico('poubelle', 18, 2) + 'Supprimer</button>' : '<span></span>')
      + '<span class="row"><button class="btn l" data-act="offannule">Annuler</button><button class="btn" data-act="offok"' + (o ? '' : ' disabled') + '>' + (E.id ? 'Enregistrer' : 'Ajouter') + '</button></span></div></div>';
  }
  function offDe(E) {   // jour off construit depuis le formulaire, ou null s'il est incomplet
    if (!E.du || (E.rec !== 'une' && !E.jours.length)) return null;
    var o = { id: E.id || 'o' + Date.now().toString(36), jours: E.rec === 'une' ? [jourSem(E.du)] : E.jours.slice().sort(), demi: E.demi, rec: E.rec, du: E.du, au: E.rec === 'une' ? null : (E.au || null) };
    if (E.rec === 'mois') o.rang = E.rang;
    if (o.au && o.au < o.du) return null;
    return o;
  }
  function sauverOffs(l, msg) {
    var F = S.pf; if (!F || F.id === 'new') return;
    var avant = F.d.offs || []; F.d.offs = l; S.offEd = null; render();
    sb.from('equipe').update({ offs: l }).eq('id', F.id).then(function (r) {
      if (r.error) throw r.error; var p = persById(F.id); if (p) p.offs = l; JOUR_CACHE = {}; toast(msg); render();
    }).catch(function (e) { F.d.offs = avant; toast(msgErr(e)); render(); });
  }
  function actionOff(d, el) {
    var F = S.pf, E = S.offEd; if (!F) return false;
    if (d.act === 'offadd') { S.offEd = { pid: F.id, id: null, jours: [], demi: 'J', rec: 'sem', rang: 1, du: dIso(new Date()), au: '' }; render(); return true; }
    if (d.offmod) { var o = (F.d.offs || []).filter(function (x) { return x.id === d.offmod; })[0]; if (o) { S.offEd = { pid: F.id, id: o.id, jours: (o.jours || []).slice(), demi: o.demi || 'J', rec: o.rec || 'sem', rang: o.rang || 1, du: o.du, au: o.au || '' }; render(); } return true; }
    if (!E) return false;
    if (d.offj) { var j = +d.offj, i = E.jours.indexOf(j); if (i >= 0) E.jours.splice(i, 1); else E.jours.push(j); render(); return true; }
    if (d.offd) { E.demi = d.offd; render(); return true; }
    if (d.offr) { E.rec = d.offr; render(); return true; }
    if (d.offn) { E.rang = +d.offn; render(); return true; }
    if (d.act === 'offannule') { S.offEd = null; render(); return true; }
    if (d.act === 'offsuppr') { if (!confirm('Supprimer ce jour off ?')) return true; sauverOffs((F.d.offs || []).filter(function (x) { return x.id !== E.id; }), 'Jour off supprimé'); return true; }
    if (d.act === 'offok') {
      var n = offDe(E); if (!n) { toast('Complétez le jour off'); return true; }
      var l = (F.d.offs || []).slice(), k = -1; l.forEach(function (x, ii) { if (x.id === E.id) k = ii; });
      if (k >= 0) l[k] = n; else l.push(n);
      sauverOffs(l, E.id ? '✔ Jour off modifié' : '✔ Jour off ajouté'); return true;
    }
    return false;
  }
  function sauverPers() {
    var F = S.pf, p = F.d;
    if (!String(p.prenom || '').trim()) { toast('Le prénom est obligatoire'); return; }
    if (p.statut !== 'apprentie') p.ecole_jour = null;
    var o = { prenom: String(p.prenom).trim(), type: p.type, statut: p.statut, contrat_h: +p.contrat_h || 0, ecole_jour: p.ecole_jour || null, actif: !!p.actif, trame: p.trame || {}, regles: p.regles || {}, consigne: String(p.consigne || '').trim() || null };
    if (pointagePret()) o.pointage = !!p.pointage;
    if (F.id === 'new') o.ordre = S.equipe.reduce(function (m, x) { return Math.max(m, x.ordre || 0); }, 0) + 1;
    F.busy = true; render();
    (F.id === 'new' ? sb.from('equipe').insert(o).select().single() : sb.from('equipe').update(o).eq('id', F.id).select().single()).then(function (r) {
      if (r.error) throw r.error;
      var x = r.data || Object.assign({ id: F.id }, F.d, o);
      F.busy = false; F.id = x.id; F.d = JSON.parse(JSON.stringify(x)); toast('✔ Fiche de ' + x.prenom + ' enregistrée'); chargerPlan();
    }).catch(function (e) { F.busy = false; toast(/type_check/.test(String(e && e.message)) ? 'Ce type de personnel demande la mise à jour 020 de la base' : msgErr(e)); render(); });
  }
  function lierCompte(fid, pid) {
    return sb.from('equipe').update({ profil_id: pid || null }).eq('id', fid).select().single().then(function (r) {
      if (r.error) throw r.error; if (S.pf && String(S.pf.id) === String(fid)) S.pf.d.profil_id = r.data.profil_id; return chargerPlan();
    }).catch(function (e) { toast(msgErr(e)); });
  }

  // --- Dentistes ---
  function assistantesDe(did) {
    var r = {}, k = 'D:' + did;
    (S.equipe || []).forEach(function (p) {
      if (!p.actif) return;
      for (var j = 1; j <= 5; j++) { var x = (p.trame || {})[j] || {}; if ((x.am && x.am.a === k) || (x.pm && x.pm.a === k)) (r[j] = r[j] || []).push(p.prenom); }
    });
    return r;
  }
  function ligneDent(d) {
    var as = assistantesDe(d.id), jours = [1, 2, 3, 4, 5].filter(function (j) { return d.jours && d.jours[j]; });
    var seul = d.actif ? jours.filter(function (j) { return !as[j]; }) : [];
    var noms = {}; jours.forEach(function (j) { (as[j] || []).forEach(function (n) { noms[n] = 1; }); });
    return '<button class="a-li" data-dent="' + d.id + '"><span class="a-av d">' + initiale(d.prenom) + '</span><span class="a-it-n"><b>Dr ' + esc(d.prenom) + '</b><span>' + (jours.length ? jours.map(function (j) { return JC[j].toLowerCase(); }).join(' ') : 'jours à renseigner') + (Object.keys(noms).length ? ' · avec ' + Object.keys(noms).map(esc).join(', ') : '') + '</span>'
      + (seul.length ? '<span class="warn">Sans assistante le ' + seul.map(function (j) { return JOURS[j].toLowerCase(); }).join(', ') + ' (semaine type)</span>' : '') + '</span>' + ico('suiv', 20, 2.2) + '</button>';
  }
  function vPDent() {
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'Les dentistes', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    if (!planPret()) return h + '<div class="ban warn">La mise à jour 009 de la base n’est pas encore faite.</div></div>';
    var tri = function (a, b) { return (a.ordre - b.ordre) || a.prenom.localeCompare(b.prenom); };
    var act = S.dentistes.filter(function (d) { return d.actif; }).sort(tri), anc = S.dentistes.filter(function (d) { return !d.actif; }).sort(tri);
    h += act.length ? '<div class="a-liste">' + act.map(ligneDent).join('') + '</div>' : '<p class="a-vide">Aucun dentiste pour l’instant.</p>';
    h += '<p class="a-aide">Les assistantes de chaque dentiste viennent de leur semaine type (fiche de l’assistante) : elles s’affichent ici automatiquement.</p>';
    h += '<button class="a-plus" data-act="dfnew">+ Ajouter un dentiste</button>';
    if (anc.length) h += '<details class="h-plie"><summary>Anciens dentistes · ' + anc.length + '</summary><div class="a-liste">' + anc.map(ligneDent).join('') + '</div></details>';
    return h + '</div>';
  }
  function ouvrirDent(id) {
    var d = id === 'new' ? { prenom: '', jours: {}, note: '', actif: true } : S.dentistes.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!d) return;
    S.df = { id: id, d: JSON.parse(JSON.stringify(d)) }; S.tab = 'dfiche'; render(); window.scrollTo(0, 0);
  }
  function vDFiche() {
    var F = S.df; if (!F) { S.tab = 'pdent'; return vPDent(); }
    var d = F.d, nouv = F.id === 'new', as = nouv ? {} : assistantesDe(F.id);
    var h = '<header class="a-hd fixe"><div class="a-hd-row"><button class="a-back" data-tab="pdent">' + ico('prec', 22, 2.4) + 'Dentistes</button><h1>' + (nouv ? 'Nouveau' : 'Dr ' + esc(d.prenom || '…')) + '</h1><span class="a-cale"></span></div></header><div class="a-corps h-fiche">';
    h += '<div class="card" style="display:flex;flex-direction:column;gap:12px">'
      + '<label class="mu">Prénom (affiché « Dr … »)<input class="in" data-dff="prenom" value="' + esc(d.prenom) + '"></label>'
      + '<div><span class="mu">Jours de présence habituels</span><div class="h-jours">' + [1, 2, 3, 4, 5].map(function (j) { return '<button type="button" class="h-jbtn' + (d.jours && d.jours[j] ? ' on' : '') + '" data-djour="' + j + '" aria-pressed="' + !!(d.jours && d.jours[j]) + '">' + JC[j] + '</button>'; }).join('') + '</div></div>'
      + '<label class="mu">Spécificités<textarea class="in" rows="2" data-dff="note" placeholder="Ex. : + 1 mercredi par mois">' + esc(d.note || '') + '</textarea></label>'
      + '<label class="row"><input type="checkbox" data-dff="actif"' + (d.actif ? ' checked' : '') + ' style="width:20px;height:20px;flex:none"><span>Travaille au centre <span class="mu">(décocher pour un ancien dentiste)</span></span></label></div>';
    if (!nouv) h += '<h2 class="a-jour">Jours de présence et assistantes</h2><div class="a-liste">' + [1, 2, 3, 4, 5].filter(function (j) { return d.jours && d.jours[j] || as[j]; }).map(function (j) {
      var pres = d.jours && d.jours[j], dep = typeof pres === 'string' ? pres : '';
      return '<div class="a-li h-djl"><span class="a-it-n"><b>' + JOURS[j] + '</b>' + (as[j] ? '<span>' + as[j].map(esc).join(', ') + '</span>' : '<span class="warn">pas d’assistante</span>') + '</span>'
        + (pres ? '<label class="h-dep"><span>Départ anticipé</span><input class="in" type="time" data-ddep="' + j + '" value="' + esc(dep) + '" aria-label="Départ anticipé le ' + JOURS[j].toLowerCase() + ' (vide = heure normale)"></label>' : '<span class="mu">pas présent</span>') + '</div>';
    }).join('') + '</div><p class="a-aide">Départ anticipé : laissez vide s’il finit à l’heure habituelle. Il s’affiche dans le planning sur la case de son assistante, qui garde ses horaires. Pour changer les assistantes, modifiez leur semaine type (Réglages › L’équipe).</p>';
    if (!nouv) h += blocExtra(d);
    h += '<h2 class="a-jour">Congés</h2>' + (nouv ? '<div class="card"><p class="mu" style="margin:0">Enregistrez d’abord la fiche.</p></div>' : blocConges(true, F.id, d)) + '<h2 class="a-jour">Formations</h2>' + (nouv ? '<div class="card"><p class="mu" style="margin:0">Enregistrez d’abord la fiche.</p></div>' : blocConges(true, F.id, d, true));
    return h + '</div>';
  }
  // « Jours en plus » : les jours où le dentiste ne vient pas d'habitude, sur 3 mois ; une touche = il vient ce jour-là (enregistré tout de suite)
  function blocExtra(d) {
    var ex = Array.isArray(d.extra) ? d.extra : [], auj = dIso(new Date()), t = new Date(), mois = [];
    if (!d.actif || [1, 2, 3, 4, 5].every(function (j) { return d.jours && d.jours[j]; })) return '';
    for (var m = 0; m < 3; m++) {
      var x = new Date(t.getFullYear(), t.getMonth() + m, 1), mo = x.getMonth(), js = [];
      for (; x.getMonth() === mo; x.setDate(x.getDate() + 1)) { var j = x.getDay(), iso = dIso(x); if (j >= 1 && j <= 5 && !(d.jours && d.jours[j]) && iso >= auj && !ferie(iso)) js.push(iso); }
      if (js.length) mois.push({ n: MOIS[mo], js: js });
    }
    var plusieurs = [1, 2, 3, 4, 5].filter(function (j) { return !(d.jours && d.jours[j]); }).length > 1;
    var futurs = ex.filter(function (i) { return i >= auj; }), ouvert = S.df && S.df.exOuvert;
    var h = '<h2 class="a-jour">Jours en plus</h2><div class="card h-ex"><button type="button" class="h-pli" data-act="exouvre" aria-expanded="' + !!ouvert + '"><span><b>' + (futurs.length ? futurs.length + ' ' + pl(futurs.length, 'jour') + ' prévu' + (futurs.length > 1 ? 's' : '') : 'Aucun jour prévu') + '</b><span class="mu">' + (futurs.length ? futurs.slice(0, 4).map(jourCourt).join(' · ') + (futurs.length > 4 ? '…' : '') : 'Touchez pour choisir des jours') + '</span></span>' + ico(ouvert ? 'haut' : 'bas', 20, 2.4) + '</button>';
    if (!ouvert) return h + '</div>';
    h += '<p class="mu" style="margin:0 0 4px">Touchez un jour où le Dr ' + esc(d.prenom) + ' vient en plus de ses jours habituels. Le planning en tient compte tout de suite.</p>';
    h += mois.map(function (M) {
      var choisis = M.js.filter(function (i) { return ex.indexOf(i) >= 0; });
      var etat = choisis.length ? '<span class="h-ex-ok">✓ ' + choisis.map(function (i) { return (plusieurs ? JOURS[jourSem(i)].toLowerCase() + ' ' : '') + (+i.slice(8)); }).join(', ') + ' ' + M.n + '</span>' : '<span class="h-ex-ko">à choisir</span>';
      return '<div class="h-ex-m"><div class="h-ex-t"><b>' + M.n.replace(/^./, function (c) { return c.toUpperCase(); }) + '</b>' + etat + '</div><div class="h-ex-js">'
        + M.js.map(function (i) { var on = ex.indexOf(i) >= 0; return '<button type="button" class="h-ex-j' + (on ? ' on' : '') + '" data-dextra="' + i + '" aria-pressed="' + on + '">' + (plusieurs ? '<small>' + JOURS[jourSem(i)].slice(0, 3) + '</small>' : '') + +i.slice(8) + '</button>'; }).join('') + '</div></div>';
    }).join('');
    return h + '</div>';
  }
  function basculerExtra(iso) {
    var F = S.df; if (!F || F.id === 'new' || F.exBusy) return;
    var ex = (Array.isArray(F.d.extra) ? F.d.extra : []).slice(), i = ex.indexOf(iso), dav = new Date(Date.now() - 864e5 * 31);
    if (i >= 0) ex.splice(i, 1); else ex.push(iso);
    ex = ex.filter(function (x) { return x >= dIso(dav); }).sort();   // on ne garde pas les dates de plus d'un mois
    F.exBusy = true; F.d.extra = ex; render();
    sb.from('dentistes').update({ extra: ex }).eq('id', F.id).then(function (r) {
      if (r.error) throw r.error; F.exBusy = false;
      var dd = dentById(F.id); if (dd) dd.extra = ex; JOUR_CACHE = {};
      toast(i >= 0 ? 'Jour retiré' : '✔ Dr ' + F.d.prenom + ' présent ' + periode(iso, iso)); render();
    }).catch(function (e) { F.exBusy = false; F.d.extra = (dentById(F.id) || {}).extra || []; toast(msgErr(e)); render(); });
  }
  function vBarDFiche() {
    var F = S.df; if (!F) return '';
    return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn navy" data-act="dfsave"' + (F.busy ? ' disabled' : '') + '>' + (F.busy ? 'Enregistrement…' : 'Enregistrer') + '</button></div></div>';
  }
  function sauverDent() {
    var F = S.df, d = F.d;
    if (!String(d.prenom || '').trim()) { toast('Le prénom est obligatoire'); return; }
    var o = { prenom: String(d.prenom).trim().replace(/^Dr\.?\s+/i, ''), jours: d.jours || {}, note: String(d.note || '').trim() || null, actif: !!d.actif };
    if (F.id === 'new') o.ordre = S.dentistes.reduce(function (m, x) { return Math.max(m, x.ordre || 0); }, 0) + 1;
    F.busy = true; render();
    (F.id === 'new' ? sb.from('dentistes').insert(o).select().single() : sb.from('dentistes').update(o).eq('id', F.id).select().single()).then(function (r) {
      if (r.error) throw r.error;
      var x = r.data || Object.assign({ id: F.id }, F.d, o);
      F.busy = false; F.id = x.id; F.d = JSON.parse(JSON.stringify(x)); toast('✔ Dr ' + x.prenom + ' enregistré'); chargerPlan();
    }).catch(function (e) { F.busy = false; toast(msgErr(e)); render(); });
  }

  function chargerPlan() {
    if (!gestion()) return Promise.resolve();
    return Promise.all([
      sb.from('equipe').select('*').order('ordre'),
      sb.from('dentistes').select('*').order('ordre'),
      sb.from('conges').select('*').gte('au', dIso(new Date(Date.now() - 120 * 864e5))).order('du'),
      sb.from('parametres').select('cle,valeur').in('cle', ['regles_heures', 'planning_visible', 'simulation_pointage', 'postes', 'types_personnel'])
    ]).then(function (r) {
      if (r[3] && !r[3].error) (r[3].data || []).forEach(function (x) { if (x.cle === 'regles_heures') S.regles = x.valeur; else if (x.cle === 'simulation_pointage') S.simOn = x.valeur === true; else if (x.cle === 'postes') S.postes = x.valeur; else if (x.cle === 'types_personnel') S.typesPers = x.valeur; else S.visible = x.valeur; });
      if (r[0].error || r[1].error) { S.equipe = null; S.dentistes = null; } else { S.equipe = r[0].data; S.dentistes = r[1].data; }
      S.conges = r[2] && !r[2].error ? r[2].data : [];
      render();
    }, function () { S.equipe = null; S.dentistes = null; render(); });
  }

  // Téléphone : le plus petit côté de l'écran fait moins de 600 px (quelle que soit l'orientation)
  function telephone() { try { return Math.min(screen.width, screen.height) < 600; } catch (e) { return false; } }
  function vSurPC() {
    return '<header class="a-hd fixe"><div class="a-hd-row"><button class="a-back" data-tab="hub">' + ico('prec', 22, 2.4) + 'Accueil</button><h1>Planning</h1><span class="hr-vide"></span></div></header>'
      + '<div class="a-corps"><div class="card pc-msg">' + ico('agenda', 34) + '<b>À ouvrir sur ordinateur</b><p class="mu">Le planning et le tableau des heures se gèrent sur un écran de PC. Sur téléphone, vous pouvez gérer les congés et les réglages.</p><button class="btn" data-tab="hub">Retour à l’accueil</button></div></div>';
  }
  function renderH() {
    var ecr = { hub: vHub, reglages: vReglages, pequipe: vPEquipe, pfiche: vPFiche, pdent: vPDent, dfiche: vDFiche, pconges: vPConges, planning: vPlanning, pregles: vPRegles, heures: vHeures, pointage: vPointage, pvisible: vPVisible, ppostes: vPPostes, ptypes: vPTypes, pqui: vPQui }[S.tab] || vHub;
    if ((S.tab === 'planning' || S.tab === 'heures' || S.tab === 'pointage') && telephone()) ecr = vSurPC;
    var h = S.nouvelleVersion ? '<div class="a-maj"><span>Nouvelle version disponible (' + esc(S.nouvelleVersion) + ')</span><button class="btn sm" data-act="maj">Mettre à jour</button></div>' : '';
    h += '<div class="a-app h-app' + (S.tab === 'hub' || ((S.tab === 'reglages' || S.tab === 'pfiche') && !telephone()) ? ' large' : S.tab === 'planning' || S.tab === 'heures' || S.tab === 'pointage' || (S.tab === 'pconges' && !telephone()) ? ' tres-large' : '') + '">' + ecr() + '</div>';
    if (S.tab === 'pfiche') h += vBarPFiche();
    if (S.tab === 'dfiche') h += vBarDFiche();
    return h;
  }

  // ---------- Congés ----------
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var TYPES_C = [['CP', 'Congés'], ['ARRET', 'Arrêt maladie'], ['FORMATION', 'Formation'], ['AUTRE', 'Autre absence']];
  function dIso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dDe(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function periode(du, au) {
    var a = dDe(du), b = dDe(au), an = new Date().getFullYear();
    var f = function (d, mois, annee) { return d.getDate() + (mois ? ' ' + MOIS[d.getMonth()] : '') + (annee && d.getFullYear() !== an ? ' ' + d.getFullYear() : ''); };
    if (du === au) return 'le ' + f(a, true, true);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return 'du ' + f(a, false) + ' au ' + f(b, true, true);
    return 'du ' + f(a, true, a.getFullYear() !== b.getFullYear()) + ' au ' + f(b, true, true);
  }
  function dateCourte(s) { var d = new Date(s); return d.getDate() + ' ' + MOIS[d.getMonth()]; }
  // Jours de travail d'une période d'après la semaine type (personne) ou les jours de présence (dentiste)
  function joursTravail(qui, du, au, dentiste) {
    var n = 0, d = dDe(du), fin = dDe(au);
    for (var i = 0; d <= fin && i < 400; i++) {
      var j = d.getDay();
      if (j >= 1 && j <= 5) {
        if (dentiste) { if (qui.jours && qui.jours[j] || dentExtra(qui, dIso(d))) n++; }
        else { var x = (qui.trame || {})[j] || {}, ok = ['am', 'pm'].some(function (k) { return x[k] && x[k].a && x[k].a !== 'OFF' && x[k].a !== 'ECOLE'; }); if (ok || !qui.trame || !Object.keys(qui.trame).length) n++; }
      }
      d.setDate(d.getDate() + 1);
    }
    return n;
  }
  function nomProfil(id) { var p = (S.profils || []).filter(function (x) { return x.id === id; })[0]; return p ? p.nom : ''; }
  function persById(id) { return (S.equipe || []).filter(function (p) { return String(p.id) === String(id); })[0]; }
  function nomConge(c) { if (c.dentiste_id) { var d = dentById(c.dentiste_id); return d ? 'Dr ' + d.prenom : 'Dentiste'; } var p = persById(c.equipe_id); return p ? p.prenom : '?'; }
  function typeTxt(t) { var x = TYPES_C.filter(function (y) { return y[0] === t; })[0]; return x ? x[1] : t; }
  function congesAttente() { return (S.conges || []).filter(function (c) { return c.statut === 'attente'; }); }
  function chevauche(c) {
    return (S.conges || []).filter(function (o) { return o.id !== c.id && o.equipe_id && (o.statut === 'accepte' || o.statut === 'attente') && o.du <= c.au && o.au >= c.du; });
  }

  // Référente / responsable : congés à valider
  function vPConges() {
    var h = hdA({ back: ACC_H, t: 'Congés', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    var att = congesAttente().sort(function (a, b) { return a.du < b.du ? -1 : 1; });
    h += '<h2 class="a-jour">À valider</h2>';
    h += att.length ? att.map(function (c) {
      var p = persById(c.equipe_id) || {}, n = joursTravail(p, c.du, c.au), ch = chevauche(c);
      return '<div class="card h-cg"><div class="h-cg-t"><span class="a-av p">' + initiale(p.prenom) + '</span><div><b>' + esc(p.prenom || '?') + ' · ' + periode(c.du, c.au) + '</b><span class="mu">' + n + ' ' + pl(n, 'jour') + ' de travail · demandé le ' + dateCourte(c.cree_le) + '</span></div></div>'
        + (c.mot ? '<p class="h-mot">« ' + esc(c.mot) + ' »</p>' : '')
        + (ch.length ? '<p class="warn-t" style="margin:0">Aussi absent' + (ch.length > 1 ? 's' : '') + ' sur cette période : ' + ch.map(function (o) { return esc(nomConge(o)) + ' (' + periode(o.du, o.au) + (o.statut === 'attente' ? ', en attente' : '') + ')'; }).join(', ') + '</p>' : '')
        + '<div class="h-cg-b"><button class="a-btn blanc" data-crefus="' + c.id + '">Refuser</button><button class="a-btn vert" data-cok="' + c.id + '">Accepter</button></div></div>';
    }).join('') : '<p class="a-vide">Aucune demande en attente.</p>';
    h += vMoisConges();
    return h + '<p class="a-aide">Pour saisir directement des congés (ou un arrêt, une formation), ouvrez la fiche de la personne ou du dentiste dans Réglages.</p></div>';
  }
  // Congés : planning synthétique du mois (une ligne par personne, une colonne par jour ouvré)
  var TYPE_CL = { CP: 'cp', ARRET: 'ar', FORMATION: 'fo', ECOLE: 'ec', AUTRE: 'cp' };
  function vMoisConges() {
    var auj = dIso(new Date()), M = S.cgMois = S.cgMois || auj.slice(0, 7), x = M.split('-'), dn = new Date(+x[0], +x[1], 0).getDate(), jours = [];
    for (var i = 1; i <= dn; i++) { var iso = M + '-' + ('0' + i).slice(-2), j = jourSem(iso); if (j >= 1 && j <= 5) jours.push(iso); }
    var du = jours[0], au = jours[jours.length - 1];
    var cs = (S.conges || []).filter(function (c) { return (c.statut === 'accepte' || c.statut === 'attente') && c.du <= au && c.au >= du; });
    var lignes = [];
    (S.equipe || []).filter(function (p) { return p.actif; }).sort(function (a, b) { return a.ordre - b.ordre; }).forEach(function (p) { lignes.push({ nom: p.type === 'interimaire' ? 'Intérimaire' : p.prenom, ouv: 'data-pf="' + p.id + '"', l: cs.filter(function (c) { return String(c.equipe_id) === String(p.id); }), d: false }); });
    (S.dentistes || []).filter(function (d) { return d.actif; }).sort(function (a, b) { return a.ordre - b.ordre; }).forEach(function (d) { lignes.push({ nom: 'Dr ' + d.prenom, ouv: 'data-dent="' + d.id + '"', l: cs.filter(function (c) { return String(c.dentiste_id) === String(d.id); }), d: true, dent: d }); });
    // Tous les dentistes sont affichés (présents et absents) ; pour l'équipe, seulement les personnes absentes ce mois
    var avec = lignes.filter(function (r) { return r.l.length || r.d; }), sans = lignes.filter(function (r) { return !r.l.length && !r.d; });
    var titre = MOIS[+x[1] - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + x[0];
    var h = '<h2 class="a-jour">Congés du mois</h2><div class="card cgm"><div class="cgm-nav"><button class="h-rond gris" data-cgm="-1" aria-label="Mois précédent">' + ico('prec', 20, 2.4) + '</button><b>' + titre + '</b><button class="h-rond gris" data-cgm="1" aria-label="Mois suivant">' + ico('suiv', 20, 2.4) + '</button></div>';
    if (avec.length && !avec.some(function (r) { return !r.d; })) h += '<p class="mu" style="margin:0">Personne de l’équipe n’est absent ce mois-ci.</p>';
    if (!avec.length) h += '<p class="a-vide" style="margin:6px 0">Personne n’est absent ce mois-ci.</p>';
    else {
      var cols = 'grid-template-columns:var(--cgm-nom) repeat(' + jours.length + ',minmax(var(--cgm-j),1fr))';
      h += '<div class="cgm-scroll"><div class="cgm-g" style="' + cols + '"><span class="cgm-n cgm-h"></span>' + jours.map(function (iso) {
        var j = jourSem(iso); return '<span class="cgm-h' + (j === 1 ? ' lun' : '') + (iso === auj ? ' auj' : '') + '"><small>' + JC[j][0] + '</small>' + (+iso.slice(8)) + '</span>';
      }).join('');
      var groupe = null;
      avec.forEach(function (r) {
        if (groupe !== r.d) { groupe = r.d; h += '<span class="cgm-gr" style="grid-column:1/-1">' + (r.d ? 'Dentistes' : 'Équipe') + '</span>'; }
        h += '<button class="cgm-n" ' + r.ouv + '>' + esc(r.nom) + '</button>';
        jours.forEach(function (iso) {
          var c = r.l.filter(function (y) { return y.du <= iso && y.au >= iso; })[0], f = ferie(iso), j = jourSem(iso);
          var cl = 'cgm-c' + (j === 1 ? ' lun' : '') + (iso === auj ? ' auj' : '');
          if (c) { var deb = c.du === iso || j === 1 || iso === du, fin = c.au === iso || j === 5 || iso === au; cl += ' ' + (c.statut === 'attente' ? 'at' : TYPE_CL[c.type] || 'cp') + (deb ? ' deb' : '') + (fin ? ' fin' : ''); }
          else if (f) cl += ' fe';
          else if (r.dent) { var vient = r.dent.jours && r.dent.jours[j] || dentExtra(r.dent, iso); cl += vient ? ' pr' : ' np'; }
          h += '<span class="' + cl + '" title="' + esc(c ? r.nom + ' · ' + (c.statut === 'attente' ? 'demande en attente · ' : '') + typeTxt(c.type) + ' ' + periode(c.du, c.au) : f ? 'Férié : ' + f : r.dent ? r.nom + (cl.indexOf(' pr') >= 0 ? ' présent' : ' ne vient pas ce jour-là') : '') + '"></span>';
        });
      });
      h += '</div></div>';
      h += '<div class="cgm-leg"><span><i class="cp"></i>Congés</span><span><i class="ar"></i>Maladie</span><span><i class="fo"></i>Formation</span><span><i class="at"></i>En attente</span><span><i class="fe"></i>Férié</span><span><i class="pr"></i>Dentiste présent</span><span><i class="np"></i>Ne vient pas</span></div>';
      // Liste lisible du mois, sous la grille
      h += '<div class="cgm-liste">' + cs.slice().sort(function (a, b) { return a.du < b.du ? -1 : a.du > b.du ? 1 : nomConge(a) < nomConge(b) ? -1 : 1; }).map(function (c) {
        return '<div class="cgm-li"><i class="' + (c.statut === 'attente' ? 'at' : TYPE_CL[c.type] || 'cp') + '"></i><b>' + esc(nomConge(c)) + '</b><span>' + periode(c.du, c.au) + (c.type !== 'CP' ? ' · ' + typeTxt(c.type) : '') + (c.statut === 'attente' ? ' · en attente' : '') + '</span></div>';
      }).join('') + '</div>';
    }
    if (sans.length && avec.some(function (r) { return !r.d; })) h += '<p class="mu cgm-sans">Pas d’absence dans l’équipe ce mois : ' + sans.map(function (r) { return esc(r.nom); }).join(', ') + '</p>';
    return h + '</div>';
  }
  function repondre(id, ok) {
    var rep = null;
    if (!ok) { rep = prompt('Motif du refus (facultatif, la personne le verra) :', ''); if (rep === null) return; }
    sb.rpc('repondre_conges', { p_id: +id, p_accepte: ok, p_reponse: rep }).then(function (r) {
      if (r.error) throw r.error; toast(ok ? '✔ Congés acceptés' : 'Demande refusée'); chargerPlan();
    }).catch(function (e) { toast(msgErr(e)); chargerPlan(); });
  }

  // Bloc « Congés » dans les fiches (personne ou dentiste)
  // Bloc « Congés » ou « Formations » dans les fiches (personne ou dentiste). Les formations sont des absences de type FORMATION.
  function blocConges(estDent, id, qui, formation) {
    var auj = dIso(new Date()), lim = dIso(new Date(Date.now() - 60 * 864e5));
    var l = (S.conges || []).filter(function (c) { return (estDent ? String(c.dentiste_id) : String(c.equipe_id)) === String(id) && c.statut !== 'annule' && c.au >= lim && (c.type === 'FORMATION') === !!formation; }).sort(function (a, b) { return a.du < b.du ? -1 : 1; });
    var cle = (estDent ? 'd' : 'p') + id, A = S.cAjout && S.cAjout.cle === cle && !!S.cAjout.formation === !!formation ? S.cAjout : null;
    var h = '<div class="a-liste">' + l.map(function (c) {
      if (A && A.id === c.id) return formConges(A, estDent, formation);
      var n = joursTravail(qui, c.du, c.au, estDent), passe = c.au < auj;
      var st = c.statut === 'attente' ? '<span class="pill warn">en attente</span>' : c.statut === 'refuse' ? '<span class="pill">refusé</span>' : '';
      var plus = '';
      if (estDent && c.statut === 'accepte') { var as = assistantesDe(id), noms = {}; Object.keys(as).forEach(function (j) { as[j].forEach(function (x) { noms[x] = 1; }); }); if (Object.keys(noms).length) plus = '<span>' + Object.keys(noms).map(esc).join(', ') + ' ' + (Object.keys(noms).length > 1 ? 'seront disponibles' : 'sera disponible') + ' pour un autre dentiste</span>'; }
      var quoi = formation ? (c.mot ? '<b class="h-fi">' + esc(c.mot) + '</b> · ' : '') : (c.type !== 'CP' ? typeTxt(c.type) + ' · ' : '');
      var txt = '<span class="a-it-n"><b>' + periode(c.du, c.au) + ' ' + st + '</b><span>' + quoi + n + ' ' + pl(n, 'jour') + (estDent ? ' de présence' : ' de travail') + (!formation && c.mot ? ' · « ' + esc(c.mot) + ' »' : '') + '</span>' + plus + '</span>';
      if (c.statut === 'attente') return '<div class="a-li' + (passe ? ' passe' : '') + '">' + txt + '<span class="h-mini"><button class="btn l sm" data-crefus="' + c.id + '">Refuser</button><button class="btn sm" data-cok="' + c.id + '">Accepter</button></span></div>';
      return '<button class="a-li h-cgl' + (passe ? ' passe' : '') + '" data-cmodif="' + c.id + '" data-cle="' + cle + '"' + (formation ? ' data-cform="1"' : '') + ' aria-label="Modifier">' + txt + '<span class="h-crayon">' + ico('crayon', 18, 2) + '</span></button>';
    }).join('');
    if (A && !A.id) h += formConges(A, estDent, formation);
    else if (!A) h += '<button class="a-li h-lien" data-cadd="' + cle + '"' + (formation ? ' data-cform="1"' : '') + '>' + (formation ? '+ Ajouter une formation' : '+ Ajouter des congés') + '</button>';
    return h + '</div>';
  }
  function formConges(A, estDent, formation) {
    return '<div class="a-li h-cadd">' + (A.id ? '<b class="h-ctit">' + (formation ? 'Modifier la formation' : 'Modifier les congés') + '</b>' : '') + '<div class="h-g2" style="width:100%"><label class="mu">Du<input class="in" type="date" id="cadu" value="' + esc(A.du || '') + '"></label><label class="mu">Au (inclus)<input class="in" type="date" id="caau" value="' + esc(A.au || '') + '"></label>'
      + (formation ? '<label class="mu" style="grid-column:1/-1">Intitulé de la formation (facultatif)<input class="in" id="caint" value="' + esc(A.mot || '') + '" placeholder="Ex. : radioprotection, AFGSU…"></label>'
        : estDent ? '' : '<label class="mu">Type<select class="in" id="catype">' + TYPES_C.filter(function (t) { return t[0] !== 'FORMATION'; }).map(function (t) { return '<option value="' + t[0] + '"' + (A.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>')
      + '</div><div class="h-cpied">' + (A.id ? '<button class="h-csup" data-csuppr="' + A.id + '">' + ico('poubelle', 18, 2) + 'Supprimer</button>' : '<span></span>')
      + '<span class="row"><button class="btn l" data-act="caannule">Annuler</button><button class="btn" data-act="caok">' + (A.id ? 'Enregistrer' : 'Ajouter') + '</button></span></div></div>';
  }
  function ajouterConges() {
    var A = S.cAjout, du = $('cadu').value, au = $('caau').value || du, ty = A.formation ? 'FORMATION' : $('catype') ? $('catype').value : 'CP';
    if (!du) { toast('Choisissez la date de début'); return; }
    if (au < du) { toast('La date de fin est avant la date de début'); return; }
    var o = { du: du, au: au, type: ty, statut: 'accepte', traite_par: S.me.id, traite_le: new Date().toISOString() };
    if (A.formation && $('caint') && $('caint').value.trim()) o.mot = $('caint').value.trim();
    if (A.id) {   // modification : on garde le statut, la personne et le traitement d'origine
      var m = { du: du, au: au, type: ty }; if (A.formation) m.mot = o.mot || null;
      return sb.from('conges').update(m).eq('id', A.id).then(function (r) { if (r.error) throw r.error; S.cAjout = null; toast(A.formation ? '✔ Formation modifiée' : '✔ Congés modifiés'); chargerPlan(); }).catch(function (e) { toast(msgErr(e)); });
    }
    o[A.cle[0] === 'd' ? 'dentiste_id' : 'equipe_id'] = +A.cle.slice(1);
    sb.from('conges').insert(o).then(function (r) { if (r.error) throw r.error; S.cAjout = null; toast(A.formation ? '✔ Formation ajoutée' : '✔ Congés ajoutés'); chargerPlan(); }).catch(function (e) { toast(msgErr(e)); });
  }
  function supprimerConges(id) {
    var fo = S.cAjout && S.cAjout.formation;
    if (!confirm(fo ? 'Supprimer cette formation ?' : 'Supprimer ces congés ?')) return;
    sb.from('conges').delete().eq('id', +id).then(function (r) { if (r.error) throw r.error; S.cAjout = null; toast(fo ? 'Formation supprimée' : 'Congés supprimés'); chargerPlan(); }).catch(function (e) { toast(msgErr(e)); });
  }

  // Assistante : mes congés et demande
  function chargerMesConges() {
    if (gestion() || !S.me) return Promise.resolve();
    return Promise.all([sb.from('equipe').select('*').eq('profil_id', S.me.id).maybeSingle(), sb.from('conges').select('*').order('du', { ascending: false }).limit(60),
      sb.from('parametres').select('cle,valeur').in('cle', ['regles_heures', 'planning_visible'])]).then(function (r) {
      S.moiEq = r[0].error ? null : r[0].data; S.mesConges = r[1].error ? [] : r[1].data || []; S.mesCongesOk = !r[0].error;
      if (S.moiEq && S.moiEq.pointage) chargerMonPointage();
      if (r[2] && !r[2].error) (r[2].data || []).forEach(function (x) { if (x.cle === 'regles_heures') S.regles = x.valeur; else S.visible = x.valeur; });
      render();
    }, function () { S.moiEq = null; S.mesConges = []; render(); });
  }
  function vMesCongesA() {
    var h = hdA({ back: ['data-tab="moi"', 'Moi'], t: 'Mes congés', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    if (S.mesConges == null) return h + '<p class="a-vide">Chargement…</p></div>';
    if (!S.moiEq) return h + '<p class="a-note warn">Votre compte n’est pas encore relié à une fiche du planning : demandez à la référente de le faire (Réglages › L’équipe).</p></div>';
    h += '<button class="a-btn gold h-centre" data-tab="mdemande">' + ico('plus', 22, 2.2) + 'Demander des congés</button><h2 class="a-jour">Mes demandes</h2>';
    var l = S.mesConges.filter(function (c) { return c.statut !== 'annule' && String(c.equipe_id) === String(S.moiEq.id); });
    if (!l.length) return h + '<p class="a-vide">Aucune demande pour l’instant.</p></div>';
    return h + '<div class="a-liste">' + l.map(function (c) {
      var ic = c.statut === 'attente' ? ['attente', ' orange'] : c.statut === 'accepte' ? ['ok', ' vert'] : ['croix', ''];
      var st = c.statut === 'attente' ? '<span class="warn">en attente de validation</span>' : c.statut === 'accepte' ? '<span class="ok">accepté</span>' : '<span>refusé' + (c.reponse ? ' · « ' + esc(c.reponse) + ' »' : '') + '</span>';
      return '<div class="a-ev"><span class="a-evi' + ic[1] + '">' + ico(ic[0], 20, 2.4) + '</span><div class="a-it-n"><b>' + periode(c.du, c.au).replace(/^./, function (x) { return x.toUpperCase(); }) + '</b>' + (c.type !== 'CP' ? '<span>' + typeTxt(c.type) + '</span>' : '') + st + '</div>'
        + (c.statut === 'attente' ? '<button class="a-lien" data-cannule="' + c.id + '">Annuler</button>' : '') + '</div>';
    }).join('') + '</div></div>';
  }
  function vDemandeA() {
    var D = S.dm = S.dm || { un: false, du: '', au: '', mot: '' };
    var h = hdA({ back: ['data-tab="mconges"', 'Retour'], t: 'Demande', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    h += '<div class="h-choix"><button class="' + (!D.un ? 'on' : '') + '" data-dmun="0">Plusieurs jours</button><button class="' + (D.un ? 'on' : '') + '" data-dmun="1">Un seul jour</button></div>';
    var au = D.un ? D.du : D.au, n = D.du && au && au >= D.du && S.moiEq ? joursTravail(S.moiEq, D.du, au) : null;
    h += '<div class="card h-dm"><label class="mu">' + (D.un ? 'Le' : 'Du') + '<input class="in" type="date" id="dmdu" min="' + dIso(new Date()) + '" value="' + esc(D.du) + '"></label>'
      + (D.un ? '' : '<label class="mu">Au (inclus)<input class="in" type="date" id="dmau" min="' + esc(D.du || dIso(new Date())) + '" value="' + esc(D.au) + '"></label>')
      + (n != null ? '<p style="margin:0"><b>' + n + ' ' + pl(n, 'jour') + ' de travail</b> <span class="mu">(d’après vos jours habituels)</span></p>' : '')
      + '<label class="mu">Un petit mot (facultatif)<textarea class="in" rows="2" id="dmmot">' + esc(D.mot) + '</textarea></label></div>'
      + '<p class="a-aide">La référente et la responsable reçoivent la demande ; la première qui répond décide. Vous verrez la réponse dans « Mes congés ».</p>';
    return h + '</div>';
  }
  function vBarDemandeA() { return '<div class="bar a-bar"><div class="bar-in"><button class="a-btn navy" data-act="dmenvoi"' + (S.dm && S.dm.busy ? ' disabled' : '') + '>' + (S.dm && S.dm.busy ? 'Envoi…' : 'Envoyer la demande') + '</button></div></div>'; }
  function envoyerDemande() {
    var D = S.dm; D.du = $('dmdu').value; if (!D.un) D.au = $('dmau').value; D.mot = $('dmmot').value;
    var au = D.un ? D.du : D.au;
    if (!D.du || !au) { toast('Choisissez ' + (D.un ? 'le jour' : 'les dates')); return; }
    if (au < D.du) { toast('La date de fin est avant la date de début'); return; }
    D.busy = true; render();
    sb.rpc('demander_conges', { p_du: D.du, p_au: au, p_mot: D.mot || null }).then(function (r) {
      if (r.error) throw r.error; S.dm = null; S.tab = 'mconges'; toast('✔ Demande envoyée'); chargerMesConges();
    }).catch(function (e) { D.busy = false; toast(msgErr(e)); render(); });
  }

  // ---------- Planning de la semaine ----------
  // Une case = une personne, un jour, une demi-journée (matin AM / après-midi PM).
  // Case enregistrée (table planning) sinon case calculée : jour férié > congés acceptés > semaine type.
  var ABS = ['CP', 'ARRET', 'ECOLE', 'FORMATION', 'FERIE'];
  var ABS_TXT = { CP: 'Congés', ARRET: 'Maladie', ECOLE: 'École', FORMATION: 'Formation', FERIE: 'Férié' };
  var REGLES_DEF = { CP: 9, ARRET: 9, ECOLE: 7, FORMATION: 9, FERIE: 9, ferie: 'habituel', depuis: '2026-11-02', pt_reliquat: true, pt_tol: 5, pt_retards: 3, pt_ecart: 2, pt_tol_dep: 5, pt_departs: 3 };
  function regles() { return Object.assign({}, REGLES_DEF, S.regles || {}); }
  function addJ(iso, n) { var d = dDe(iso); d.setDate(d.getDate() + n); return dIso(d); }
  function lundiDe(iso) { var d = dDe(iso), j = d.getDay() || 7; d.setDate(d.getDate() - j + 1); return dIso(d); }
  function jourSem(iso) { return dDe(iso).getDay(); }
  var FERIES = {};
  function feries(an) {
    if (FERIES[an]) return FERIES[an];
    var a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1, paques = dIso(new Date(an, mois - 1, jour));
    var s = {};
    [['01-01', 'Jour de l’an'], ['05-01', 'Fête du travail'], ['05-08', 'Victoire 1945'], ['07-14', 'Fête nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice'], ['12-25', 'Noël']].forEach(function (x) { s[an + '-' + x[0]] = x[1]; });
    s[addJ(paques, 1)] = 'Lundi de Pâques'; s[addJ(paques, 39)] = 'Ascension'; s[addJ(paques, 50)] = 'Lundi de Pentecôte';
    return (FERIES[an] = s);
  }
  function ferie(iso) { return feries(+iso.slice(0, 4))[iso] || null; }
  function congeLe(eid, iso) { return (S.conges || []).filter(function (c) { return String(c.equipe_id) === String(eid) && c.statut === 'accepte' && c.du <= iso && c.au >= iso; })[0]; }
  function dentAbsent(did, iso) { return (S.conges || []).some(function (c) { return String(c.dentiste_id) === String(did) && c.statut === 'accepte' && c.du <= iso && c.au >= iso; }); }
  function cleCase(eid, iso, demi) { return eid + '|' + iso + '|' + demi; }
  function hm(t) { return t ? String(t).slice(0, 5) : null; }
  // Case de base : jour férié > congés / formation acceptés > semaine type
  function caseBase(p, iso, demi) {
    var j = jourSem(iso); if (j < 1 || j > 5) return { a: 'OFF', v: 1 };
    if (ferie(iso)) return { a: 'FERIE', v: 1 };
    var c = congeLe(p.id, iso);
    if (c) return { a: c.type === 'AUTRE' ? 'CP' : c.type, v: 1 };
    if (offLe(p, iso, demi)) return { a: 'OFF', v: 1, off: 1 };
    var k = demi === 'AM' ? 'am' : 'pm', t = ((p.trame || {})[j] || {})[k];
    // Jour en plus d'un dentiste : son assistante attitrée le suit toute la journée (sauf école), avec ses horaires habituels auprès de lui
    var at = attitre(p), da = at && dentById(at);
    var jt = (p.trame || {})[j] || {}, dejaAvec = ['am', 'pm'].some(function (z) { return jt[z] && jt[z].a === 'D:' + at; });
    if (da && !dejaAvec && dentExtra(da, iso) && dentPresent(da, iso) && !(t && t.a === 'ECOLE')) {
      var hab = horairesAvec(p, 'D:' + at, k);
      return { a: 'D:' + at, de: hab.de, fi: hab.fi, v: 1 };
    }
    return t && t.a ? { a: t.a, de: t.de || null, fi: t.fi || null, v: 1 } : { a: 'OFF', v: 1 };
  }
  // Dentiste attitré d'une assistante : celui avec qui elle travaille le plus dans sa semaine type (au moins 2 jours)
  function attitre(p) {
    var n = {}, best = null; if (!aDent(p.type)) return null;
    Object.keys(p.trame || {}).forEach(function (j) { ['am', 'pm'].forEach(function (k) { var x = (p.trame[j] || {})[k]; if (x && x.a && x.a.slice(0, 2) === 'D:') n[x.a.slice(2)] = (n[x.a.slice(2)] || 0) + 1; }); });
    Object.keys(n).forEach(function (id) { if (n[id] >= 4 && (!best || n[id] > n[best])) best = id; });
    return best;
  }
  function horairesAvec(p, aff, k) {
    for (var j = 1; j <= 5; j++) { var x = ((p.trame || {})[j] || {})[k]; if (x && x.a === aff && x.de) return { de: x.de, fi: x.fi }; }
    return { de: null, fi: null };
  }
  // Règle d'or (rapport d'organisation § 5A) : quand le dentiste d'une assistante est absent, elle couvre d'abord
  // un dentiste présent sans assistante (en priorité ceux qui n'ont personne dans les semaines types ce jour-là,
  // comme Dr Angela le lundi et le jeudi), sinon elle bascule en Sté. Seulement pour les cases non saisies.
  var JOUR_CACHE = {};
  // Jour en plus (ponctuel) : seulement un jour où le dentiste ne vient pas d'habitude
  function dentExtra(d, iso) { return !!(d && Array.isArray(d.extra) && d.extra.indexOf(iso) >= 0 && !(d.jours && d.jours[jourSem(iso)])); }
  function dentPresent(d, iso) { var j = jourSem(iso); return !!(d && d.actif && (d.jours && d.jours[j] || dentExtra(d, iso)) && !dentAbsent(d.id, iso)); }
  function jourCalc(iso) {
    if (JOUR_CACHE[iso]) return JOUR_CACHE[iso];
    var ps = (S.equipe || []).filter(function (p) { return p.actif; }).sort(function (a, b) { return (a.ordre - b.ordre) || (a.id - b.id); }), out = {}, rows = S.pl && S.pl.rows || {}, j = jourSem(iso);
    ps.forEach(function (p) { out[p.id] = { AM: caseBase(p, iso, 'AM'), PM: caseBase(p, iso, 'PM') }; });
    if (j >= 1 && j <= 5 && !ferie(iso)) ['AM', 'PM'].forEach(function (demi) {
      var k = demi === 'AM' ? 'am' : 'pm', pris = {}, trameA = {};
      ps.forEach(function (p) {
        var r = rows[cleCase(p.id, iso, demi)], a = r ? r.aff : out[p.id][demi].a;
        if (a && a.slice(0, 2) === 'D:') pris[a] = 1;
        var t = ((p.trame || {})[j] || {})[k]; if (t && t.a && t.a.slice(0, 2) === 'D:') trameA[t.a] = 1;
      });
      var libres = (S.dentistes || []).filter(function (d) { return dentPresent(d, iso) && !pris['D:' + d.id]; })
        .sort(function (a, b) { return (trameA['D:' + a.id] ? 1 : 0) - (trameA['D:' + b.id] ? 1 : 0) || (a.ordre - b.ordre); });
      // Les apprenties couvrent d'abord les dentistes seuls ; sinon chacune va à son poste de repli (fiche, Sté par défaut)
      ps.slice().sort(function (a, b) { return (a.statut === 'apprentie' ? 0 : 1) - (b.statut === 'apprentie' ? 0 : 1); }).forEach(function (p) {
        if (rows[cleCase(p.id, iso, demi)]) return;
        var c = out[p.id][demi]; if (!c.a || c.a.slice(0, 2) !== 'D:' || dentPresent(dentById(c.a.slice(2)), iso)) return;
        var n = libres.shift();
        out[p.id][demi] = { a: n ? 'D:' + n.id : ((p.regles || {}).repli || 'STE'), de: c.de, fi: c.fi, v: 1, r: c.a };
        if (n) pris['D:' + n.id] = 1;
      });
    });
    return (JOUR_CACHE[iso] = out);
  }
  function caseCalc(p, iso, demi) { var o = jourCalc(iso)[p.id]; return o ? o[demi] : caseBase(p, iso, demi); }
  function caseEff(p, iso, demi) { var r = (S.pl && S.pl.rows || {})[cleCase(p.id, iso, demi)]; if (r && r.aff === 'OFF' && ferie(iso)) return { a: 'FERIE', h: r.heures != null ? +r.heures : null };   // férié importé « OFF » : compté comme férié
    return r ? { a: r.aff, de: hm(r.debut), fi: hm(r.fin), h: r.heures != null ? +r.heures : null } : caseCalc(p, iso, demi); }
  function travailleHabituellement(p, iso, demi) { var t = ((p.trame || {})[jourSem(iso)] || {})[demi === 'AM' ? 'am' : 'pm']; return !!(t && t.a && t.a !== 'OFF'); }
  function heuresDemi(p, iso, demi, c) {
    c = c || caseEff(p, iso, demi);
    if (!c || !c.a || c.a === 'OFF') return 0;
    if (ABS.indexOf(c.a) >= 0) {
      if (c.h != null && c.h !== '') return +c.h;   // heures ajustées à la case
      var R = regles(), perso = (p.regles || {})[c.a], v = perso != null && perso !== '' ? +perso : +R[c.a];
      if (c.a === 'FERIE' && R.ferie !== 'tous' && !travailleHabituellement(p, iso, demi)) return 0;
      return (v || 0) / 2;
    }
    return dureeDemi(c);
  }
  function heuresRegle(p, iso, demi, a) { return heuresDemi(p, iso, demi, { a: a }); }
  function heuresJPrevu(p, iso) { return heuresDemi(p, iso, 'AM') + heuresDemi(p, iso, 'PM'); }
  // Reliquat : une journée pointée en entier compte le temps réel (Réglages › Heures), sauf si le pointage est mis de côté
  function heuresJ(p, iso) {
    var r = p.pointage && regles().pt_reliquat !== false ? ptRow(p.id, iso) : null;
    if (r && r.arrivee && r.sortie && !r.ignorer) { var c = calculJour(p, iso, r); if (c.effMin != null) return c.effMin / 60; }
    return heuresJPrevu(p, iso);
  }
  function heuresSemPrevu(p, lundi) { var s0 = 0; for (var k = 0; k < 5; k++) s0 += heuresJPrevu(p, addJ(lundi, k)); return s0; }
  function ptRow(eid, iso) { return S.ptg && S.ptg.rows ? S.ptg.rows[eid + '|' + iso] : null; }
  function heuresSem(p, lundi) { var s = 0; for (var k = 0; k < 5; k++) s += heuresJ(p, addJ(lundi, k)); return s; }
  // Reliquat avant la semaine affichée : somme des (heures faites − contrat) depuis la date de départ
  function reliquatAvant(p, lundi) {
    var c = +p.contrat_h || 0, w = lundiDe(regles().depuis || lundi), s = 0;
    if (!c) return 0;
    for (var i = 0; w < lundi && i < 260; i++, w = addJ(w, 7)) s += heuresSem(p, w) - c;
    return s;
  }
  function relTxt(r) { return (r > 0 ? '+' : r < 0 ? '−' : '') + fh(Math.abs(r)); }
  function ft(t) { if (!t) return ''; var p = t.split(':'); return +p[0] + 'h' + (p[1] !== '00' ? p[1] : ''); }
  function nomAff(a) { return ABS_TXT[a] || (a === 'OFF' ? '—' : affTxt(a)); }
  function persPlanning() { return (S.equipe || []).filter(function (p) { return p.actif && typeDe(p.type).planning !== false; }).sort(function (a, b) { return (a.type === 'interimaire') - (b.type === 'interimaire') || (a.ordre - b.ordre); }); }

  // Titre de la semaine : une touche ouvre un calendrier pour aller directement à une semaine
  function titreCal(titre, L) {
    return '<span class="pl-titre"><button type="button" class="pl-tbtn" data-act="plcal" aria-label="Choisir une semaine dans le calendrier">' + ico('agenda', 18, 2.2) + '<b>' + titre + '</b></button><input type="date" id="plcal" class="pl-calin" tabindex="-1" aria-hidden="true" value="' + L + '"></span>';
  }
  function chargerSemaine(force) {
    var P = S.pl = S.pl || { lundi: lundiDe(dIso(new Date())), rows: {} };
    var de = [lundiDe(regles().depuis || P.lundi), P.lundi].sort()[0], a = addJ(P.lundi, 4);
    if (!force && P.de && P.de <= de && P.a >= a) return Promise.resolve();
    P.charge = true;
    return toutLire('planning', '*', function (q) { return q.gte('jour', de).lte('jour', a).order('jour'); }).then(function (rows) {
      var o = {}; rows.forEach(function (r) { o[cleCase(r.equipe_id, String(r.jour).slice(0, 10), r.demi)] = r; });
      P.rows = o; P.de = de; P.a = a; P.charge = false; P.err = false; render();
    }).catch(function (e) { P.charge = false; P.err = true; toast(msgErr(e)); render(); });
  }

  // ---------- Tableau de bord des heures ----------
  // Période : une semaine, un mois (les semaines dont le jeudi tombe dans le mois) ou depuis la date de départ du reliquat.
  function hrSemaines(H) {
    var dep = lundiDe(regles().depuis || '2026-11-02'), auj = lundiDe(dIso(new Date())), l = [];
    if (H.mode === 'semaine') return [H.lundi];
    if (H.mode === 'depuis') { for (var L = dep; L <= auj && l.length < 260; L = addJ(L, 7)) l.push(L); return l.length ? l : [auj]; }
    var x = H.mois.split('-'), d1 = H.mois + '-01', dn = dIso(new Date(+x[0], +x[1], 0));
    for (var L2 = lundiDe(addJ(d1, -3)); L2 <= dn; L2 = addJ(L2, 7)) { var jeu = addJ(L2, 3); if (jeu.slice(0, 7) === H.mois) l.push(L2); }
    return l;
  }
  function assurerPlage(a) {   // lignes du planning de la date de départ jusqu'à « a »
    var P = S.pl = S.pl || { lundi: lundiDe(dIso(new Date())), rows: {} }, de = lundiDe(regles().depuis || a);
    if (P.de && P.de <= de && P.a >= a) return null;
    if (P.chargeH) return null;
    var fin = [a, P.a || a].sort()[1]; P.chargeH = true;
    toutLire('planning', '*', function (q) { return q.gte('jour', de).lte('jour', fin).order('jour'); }).then(function (rows) {
      P.rows = P.rows || {}; rows.forEach(function (r) { P.rows[cleCase(r.equipe_id, String(r.jour).slice(0, 10), r.demi)] = r; });
      P.de = de; P.a = fin; P.chargeH = false; JOUR_CACHE = {}; render();
    }).catch(function (e) { P.chargeH = false; toast(msgErr(e)); render(); });
    return true;
  }
  function hrPersonne(p, W) {
    var c = +p.contrat_h || 0, sem = W.map(function (L) { return heuresSem(p, L); }), fait = sem.reduce(function (a, b) { return a + b; }, 0);
    var der = W[W.length - 1], rel = c ? reliquatAvant(p, der) + sem[sem.length - 1] - c : null, abs = {}, rep = { fauteuil: 0, postes: 0, abs: 0 };
    W.forEach(function (L) { for (var k = 0; k < 5; k++) { var iso = addJ(L, k); ['AM', 'PM'].forEach(function (dm) {
      var cz = caseEff(p, iso, dm), hh = heuresDemi(p, iso, dm, cz); if (!hh) return;
      if (ABS.indexOf(cz.a) >= 0) { abs[cz.a] = (abs[cz.a] || 0) + hh; rep.abs += hh; } else if (cz.a.slice(0, 2) === 'D:') rep.fauteuil += hh; else rep.postes += hh;
    }); } });
    return { p: p, c: c, contrat: c * W.length, fait: fait, ecart: c ? fait - c * W.length : null, rel: rel, sem: sem, abs: abs, rep: rep };
  }
  function hrCouleur(v) { return v == null || Math.abs(v) < 0.01 ? 'ok' : v > 0 ? 'plus' : 'moins'; }
  function hrResumeSem(p, L) {   // « École jeu. · Congés lun. » pour une semaine
    var l = [];
    for (var k = 0; k < 5; k++) { var iso = addJ(L, k), am = caseEff(p, iso, 'AM'), pm = caseEff(p, iso, 'PM'), j = JC[jourSem(iso)].toLowerCase() + '.';
      [am, pm].forEach(function (c, i) { var t = ABS.indexOf(c.a) >= 0 ? ABS_TXT[c.a] : c.off ? 'Jour off' : null; if (!t) return; if (i === 1 && am.a === pm.a && !!am.off === !!pm.off) return; l.push(t + ' ' + j + (am.a === pm.a && !!am.off === !!pm.off ? '' : i ? ' ap.-midi' : ' matin')); }); }
    return l.join(' · ') || 'Semaine type';
  }
  function vHeures() {
    var H = S.hr = S.hr || { mode: 'mois', mois: addJ(lundiDe(dIso(new Date())), 3).slice(0, 7), lundi: lundiDe(dIso(new Date())), sel: null };
    var W = hrSemaines(H), der = W[W.length - 1], titre, sous;
    if (H.mode === 'semaine') { titre = 'Semaine du ' + periode(H.lundi, addJ(H.lundi, 4)).replace(/^du /, ''); sous = ''; }
    else if (H.mode === 'mois') { titre = nomMois(H.mois).replace(/^./, function (c) { return c.toUpperCase(); }); sous = W.length + ' semaine' + (W.length > 1 ? 's' : '') + ' · ' + periode(W[0], addJ(der, 4)); }
    else { titre = 'Depuis le ' + dateCourte(regles().depuis || '2026-11-02'); sous = W.length + ' semaine' + (W.length > 1 ? 's' : '') + ' · jusqu’à cette semaine'; }
    var nav = H.mode === 'depuis' ? '<span class="hr-titre"><b>' + titre + '</b></span>'
      : '<button class="h-rond" data-hrnav="-1" aria-label="Précédent">' + ico('prec', 20, 2.4) + '</button><span class="hr-titre"><b>' + titre + '</b></span><button class="h-rond" data-hrnav="1" aria-label="Suivant">' + ico('suiv', 20, 2.4) + '</button>';
    var h = '<header class="a-hd fixe pl-hd"><div class="a-hd-row"><button class="a-back" data-' + (H.sel ? 'hrsel=""' : 'tab="planning"') + '>' + ico('prec', 22, 2.4) + (H.sel ? 'Heures' : 'Planning') + '</button><h1>' + (H.sel ? esc((persById(H.sel) || {}).prenom || 'Heures') : 'Heures') + '</h1><span class="hr-vide"></span></div>'
      + '<div class="hr-nav"><div class="hr-seg" role="group" aria-label="Période">' + [['semaine', 'Semaine'], ['mois', 'Mois'], ['depuis', 'Depuis le début']].map(function (m) { return '<button data-hrmode="' + m[0] + '" aria-pressed="' + (H.mode === m[0]) + '"' + (H.mode === m[0] ? ' class="on"' : '') + '>' + m[1] + '</button>'; }).join('') + '</div>'
      + '<div class="hr-per">' + nav + '</div></div>' + (sous ? '<p class="hr-sous">' + sous + '</p>' : '') + '</header>';
    h += '<div class="a-corps hr-corps">';
    if (!planPret()) return h + '<div class="ban warn">Les mises à jour de la base ne sont pas encore faites.</div></div>';
    if (assurerPlage(addJ(der, 4)) || S.pl.chargeH || assurerPointages(lundiDe(regles().depuis || W[0]), addJ(der, 6))) return h + '<p class="a-vide">Calcul des heures…</p></div>';
    var ps = persPlanning(), R = ps.map(function (p) { return hrPersonne(p, W); });
    if (H.sel) { var x = R.filter(function (r) { return String(r.p.id) === String(H.sel); })[0]; if (x) return h + vHeuresDetail(x, W) + '</div>'; H.sel = null; }
    var avec = R.filter(function (r) { return r.c; }), tf = 0, tc = 0, plus = [], moins = [], absT = {};
    avec.forEach(function (r) { tf += r.fait; tc += r.contrat; if (r.rel > 0.01) plus.push(r); else if (r.rel < -0.01) moins.push(r); });
    R.forEach(function (r) { Object.keys(r.abs).forEach(function (k) { absT[k] = (absT[k] || 0) + r.abs[k]; }); });
    var absTot = Object.keys(absT).reduce(function (a, k) { return a + absT[k]; }, 0), absTop = ABS.filter(function (k) { return absT[k]; }).sort(function (a, b) { return absT[b] - absT[a]; });
    var sumR = function (l) { return l.reduce(function (a, r) { return a + r.rel; }, 0); }, noms = function (l) { return l.map(function (r) { return r.p.prenom; }).join(', '); };
    h += '<section class="hr-kpis" aria-label="Résumé">'
      + '<div class="hr-kpi"><span class="hr-k">Heures faites · équipe</span><b>' + fh(tf) + '</b><span>pour ' + fh(tc) + ' de contrat (' + avec.length + ' ' + pl(avec.length, 'personne') + ')</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">À alléger</span><b class="plus">' + (plus.length ? plus.length + ' ' + pl(plus.length, 'personne') : 'Aucune') + '</b><span>' + (plus.length ? relTxt(sumR(plus)) + ' au total · ' + esc(noms(plus)) : 'personne au-dessus du contrat') + '</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">À rattraper</span><b class="moins">' + (moins.length ? moins.length + ' ' + pl(moins.length, 'personne') : 'Aucune') + '</b><span>' + (moins.length ? relTxt(sumR(moins)) + ' au total · ' + esc(noms(moins)) : 'personne en dessous du contrat') + '</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Absences comptées</span><b>' + fh(absTot) + '</b><span>' + (absTop.length ? absTop.slice(0, 3).map(function (k) { return ABS_TXT[k].toLowerCase() + ' ' + fh(absT[k]); }).join(' · ') : 'aucune') + '</span></div></section>';
    // Tableau par personne
    var maxR = Math.max(4, Math.max.apply(null, avec.map(function (r) { return Math.abs(r.rel || 0); })));
    h += '<div class="hr-cols"><section class="hr-carte hr-tab" aria-labelledby="hr-t1"><div class="hr-ct"><h2 id="hr-t1">Par personne</h2><span class="mu">Touchez une ligne pour le détail</span></div><div class="hr-scroll"><div class="hr-grille">'
      + '<div class="hr-l hr-tete"><span>Personne</span><span>Contrat</span><span>Fait</span><span>Écart</span><span class="c">Reliquat cumulé</span><span>' + (W.length > 1 ? W.length + ' semaines' : 'Semaine') + '</span></div>';
    R.forEach(function (r) {
      var pct = r.rel == null ? 0 : Math.min(50, Math.abs(r.rel) / maxR * 50), cl = hrCouleur(r.rel), wsem = W.length > 12 ? r.sem.slice(-12) : r.sem;
      h += '<button class="hr-l" data-hrsel="' + r.p.id + '"><span class="hr-p"><span class="a-av">' + esc((r.p.prenom || '?')[0]) + '</span><span><b>' + esc(r.p.type === 'interimaire' ? 'Intérimaire' : r.p.prenom) + '</b><small>' + (r.p.statut === 'apprentie' ? 'Apprentie' : r.p.type === 'interimaire' ? 'Sans contrat' : 'Assistante') + (r.c ? ' · ' + fh(r.c) : '') + '</small></span></span>'
        + '<span>' + (r.c ? fh(r.contrat) : '—') + '</span><b>' + fh(r.fait) + '</b><b class="' + hrCouleur(r.ecart) + '">' + (r.ecart == null ? '—' : Math.abs(r.ecart) < 0.01 ? '0 h' : relTxt(r.ecart)) + '</b>'
        + '<span class="hr-rel"><span class="hr-barre"><i class="hr-zero"></i>' + (r.rel != null && Math.abs(r.rel) >= 0.01 ? '<i class="hr-v ' + cl + '" style="' + (r.rel > 0 ? 'left' : 'right') + ':50%;width:' + pct.toFixed(1) + '%"></i>' : '') + '</span><small class="' + cl + '">' + (r.rel == null ? 'pas de contrat' : Math.abs(r.rel) < 0.01 ? 'à jour' : relTxt(r.rel) + (r.rel > 0 ? ' · à alléger' : ' · à rattraper')) + '</small></span>'
        + '<span class="hr-mini" role="img" aria-label="' + esc(wsem.map(fh).join(', ')) + '">' + (r.c ? '<i class="hr-ligne"></i>' : '') + wsem.map(function (v) { var ht = Math.max(3, Math.round(v / (r.c || 39) * 30)); return '<i class="' + (!v ? 'z' : !r.c || Math.abs(v - r.c) < 0.01 ? '' : v > r.c ? 'plus' : 'moins') + '" style="height:' + Math.min(40, ht) + 'px"></i>'; }).join('') + '</span></button>';
    });
    h += '</div></div><p class="a-aide">Ligne pointillée : le contrat de la semaine. Reliquat à gauche : heures à rattraper ; à droite : heures à alléger (cumulé depuis le ' + dateCourte(regles().depuis || '2026-11-02') + ', Réglages › Heures).</p></section>';
    // À surveiller + absences
    var al = R.filter(function (r) { return r.rel != null && Math.abs(r.rel) >= 0.25; }).sort(function (a, b) { return Math.abs(b.rel) - Math.abs(a.rel); });
    var seulsN = 0, parD = {};
    W.forEach(function (L) { for (var k = 0; k < 5; k++) { var iso = addJ(L, k); if (ferie(iso)) continue; dentistesSeuls(iso).seuls.forEach(function (q) { var n = q.quand ? 1 : 2; seulsN += n; parD[q.d.prenom] = (parD[q.d.prenom] || 0) + n; }); } });
    var topD = Object.keys(parD).sort(function (a, b) { return parD[b] - parD[a]; }).slice(0, 2);
    h += '<aside class="hr-cote"><section class="hr-carte" aria-labelledby="hr-t2"><h2 id="hr-t2">À surveiller</h2>'
      + (al.length ? al.map(function (r) {
        var au = r.sem.filter(function (v) { return v > r.c + 0.01; }).length, en = r.sem.filter(function (v) { return v < r.c - 0.01; }).length;
        return '<button class="hr-al ' + hrCouleur(r.rel) + '" data-hrsel="' + r.p.id + '"><b>' + esc(r.p.prenom) + ' · ' + relTxt(r.rel) + (r.rel > 0 ? ' à alléger' : ' à rattraper') + '</b><span>' + (W.length > 1 ? (au ? au + ' ' + pl(au, 'semaine') + ' au-dessus de ' + fh(r.c) : '') + (au && en ? ' · ' : '') + (en ? en + ' ' + pl(en, 'semaine') + ' en dessous' : '') || 'Semaines au contrat, écart venu d’avant' : 'Cette semaine : ' + fh(r.sem[0])) + '</span></button>';
      }).join('') : '<p class="mu">Tout le monde est à jour.</p>')
      + '<div class="hr-al neutre"><b>Dentistes seuls · ' + seulsN + ' ' + pl(seulsN, 'demi-journée') + '</b><span>' + (topD.length ? 'Surtout Dr ' + topD.map(esc).join(' et Dr ') : 'Tous les dentistes présents ont été assistés') + '</span></div></section>'
      + '<section class="hr-carte" aria-labelledby="hr-t3"><h2 id="hr-t3">Absences ' + (H.mode === 'semaine' ? 'de la semaine' : H.mode === 'mois' ? 'du mois' : 'depuis le début') + '</h2>';
    var maxA = Math.max.apply(null, ABS.map(function (k) { return absT[k] || 0; }).concat([1]));
    h += ABS.map(function (k) {
      var qui = R.filter(function (r) { return r.abs[k]; }).map(function (r) { return r.p.prenom; });
      return '<div class="hr-abs"><span><span>' + ABS_TXT[k] + '</span><b>' + fh(absT[k] || 0) + '</b></span><span class="hr-abar"><i class="ab-' + k + '" style="width:' + Math.round((absT[k] || 0) / maxA * 100) + '%"></i></span><small>' + (qui.length ? esc(qui.join(', ')) : 'Aucune') + '</small></div>';
    }).join('') + '<p class="a-aide">Comptées selon Réglages › Heures. Les jours off comptent 0 h.</p></section></aside></div>';
    return h + '</div>';
  }
  function vHeuresDetail(r, W) {
    var p = r.p, cl = hrCouleur(r.rel), mx = Math.max.apply(null, r.sem.concat([r.c || 39])) || 39, ws = W.length > 12 ? W.slice(-12) : W, vs = W.length > 12 ? r.sem.slice(-12) : r.sem;
    var h = '<div class="hr-det"><div class="hr-carte hr-big ' + cl + '"><span class="hr-k">Reliquat au ' + dateCourte(addJ(W[W.length - 1], 4)) + '</span><b>' + (r.rel == null ? '—' : Math.abs(r.rel) < 0.01 ? 'à jour' : relTxt(r.rel)) + '</b><span>' + (r.rel == null ? 'Pas de contrat' : (Math.abs(r.rel) < 0.01 ? '' : (r.rel > 0 ? 'à alléger · ' : 'à rattraper · ')) + fh(r.fait) + ' faites pour ' + fh(r.contrat)) + '</span></div>';
    h += '<section class="hr-carte" aria-labelledby="hr-d1"><h2 id="hr-d1">Semaine par semaine</h2>' + (r.c ? '<p class="mu" style="margin:0">Pointillés : le contrat, ' + fh(r.c) + '</p>' : '') + '<div class="hr-gros" role="img" aria-label="' + esc(vs.map(fh).join(', ')) + '">' + (r.c ? '<i class="hr-ligne" style="bottom:' + Math.round(r.c / mx * 120) + 'px"></i>' : '')
      + vs.map(function (v, i) { return '<span><b>' + fh(v) + '</b><i class="' + (!r.c || Math.abs(v - r.c) < 0.01 ? '' : v > r.c ? 'plus' : 'moins') + '" style="height:' + Math.max(4, Math.round(v / mx * 120)) + 'px"></i><small>' + dDe(ws[i]).getDate() + ' ' + ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][dDe(ws[i]).getMonth()] + '</small></span>'; }).join('') + '</div></section>';
    h += '<section class="hr-carte hr-liste" aria-labelledby="hr-d2"><h2 id="hr-d2">Détail</h2>' + W.slice().reverse().map(function (L) {
      var v = r.sem[W.indexOf(L)], e = r.c ? v - r.c : null;
      return '<button class="hr-li" data-hrouvrir="' + L + '"><span><b>Semaine du ' + dateCourte(L) + '</b><small>' + esc(hrResumeSem(p, L)) + '</small></span><span class="d"><b>' + fh(v) + '</b><small class="' + hrCouleur(e) + '">' + (e == null ? '' : Math.abs(e) < 0.01 ? 'au contrat' : relTxt(e)) + '</small></span></button>';
    }).join('') + '</section>';
    var t = r.rep.fauteuil + r.rep.postes + r.rep.abs || 1;
    h += '<section class="hr-carte" aria-labelledby="hr-d3"><h2 id="hr-d3">Répartition</h2><div class="hr-rep" role="img" aria-label="Au fauteuil ' + fh(r.rep.fauteuil) + ', autres postes ' + fh(r.rep.postes) + ', absences ' + fh(r.rep.abs) + '"><i class="f" style="flex:' + r.rep.fauteuil + '"></i><i class="p" style="flex:' + r.rep.postes + '"></i><i class="a" style="flex:' + r.rep.abs + '"></i></div>'
      + '<div class="hr-leg"><span><i class="f"></i>Au fauteuil<b>' + fh(r.rep.fauteuil) + '</b></span><span><i class="p"></i>Sté, admin, accueil…<b>' + fh(r.rep.postes) + '</b></span><span><i class="a"></i>Absences comptées<b>' + fh(r.rep.abs) + '</b></span></div></section>';
    h += '<button class="btn hr-ouvrir" data-hrouvrir="' + W[W.length - 1] + '">Ouvrir sa semaine dans le planning</button></div>';
    return h;
  }
  // ---------- Pointage journalier (QR code) ----------
  var JETON_QR = null;
  function pointagePret() { return (S.equipe || []).some(function (e) { return 'pointage' in e; }); }
  // Scan lu (caméra de l'appli ou appareil photo du téléphone) : premier scan de la journée fait l'après-midi
  // (après le milieu de sa journée prévue) → on demande « arrivée ou sortie ? »
  function pointerQR() {
    var j = JETON_QR; JETON_QR = null; try { sessionStorage.removeItem('evy-pointer'); } catch (e) {}
    if (!j) return;
    if (CONFIG.env === 'dev') try { localStorage.setItem('evy-jeton-test', j); } catch (e) {}
    if (gestion()) return envoyerPointage(j, null);
    S.ptRes = { busy: true }; render();
    (S.moiEq ? Promise.resolve() : chargerMesConges()).then(function () { return chargerMonPointage(); }).then(function () {
      var r = S.monPt, q = maintenantPt(), m = q.getHours() * 60 + q.getMinutes();
      if (!(r && (r.arrivee || r.sortie)) && m >= milieuJournee(S.moiEq, dIso(q))) { S.ptRes = { choix: j }; render(); return; }
      envoyerPointage(j, null);
    });
  }
  function envoyerPointage(j, sens) {
    S.ptRes = { busy: true }; render();
    var a = { p_jeton: j }; if (sens) a.p_sens = sens; var sim = simPt(); if (sim) a.p_quand = sim.toISOString();
    sb.rpc('pointer', a).then(function (r) {
      if (r.error) throw r.error; S.ptRes = r.data || { etat: 'erreur' }; render();
      if (!gestion() && S.moiEq) chargerMonPointage();
    }).catch(function (e) { S.ptRes = { etat: 'erreur', msg: msgErr(e) }; render(); });
  }
  function milieuJournee(p, iso) {
    var t = (p && p.trame || {})[jourSem(iso)] || {}, ok = function (c) { return c && c.a && c.a !== 'OFF' && c.de && c.fi; };
    var d = ok(t.am) ? enMin(t.am.de) : ok(t.pm) ? enMin(t.pm.de) : null, f = ok(t.pm) ? enMin(t.pm.fi) : ok(t.am) ? enMin(t.am.fi) : null;
    return d != null && f != null && f > d ? Math.round((d + f) / 2) : 13 * 60;
  }
  // Simulation (site de test seulement) : jour et heure choisis par l'assistante pour tester sans attendre
  function simPt() {
    if (CONFIG.env !== 'dev') return null;
    if (S.sim === undefined) try { S.sim = JSON.parse(sessionStorage.getItem('evy-sim') || 'null'); } catch (e) { S.sim = null; }
    if (!S.sim || !S.sim.jour || !S.sim.heure) return null;
    var x = S.sim.heure.split(':'), d = dDe(S.sim.jour); d.setHours(+x[0], +x[1], 0, 0); return d;
  }
  function maintenantPt() { return simPt() || new Date(); }
  function hTs(ts) { if (!ts) return ''; var d = new Date(ts); return d.getHours() + ' h ' + ('0' + d.getMinutes()).slice(-2); }
  function vResultatPointage() {
    var R = S.ptRes, ok = R.etat === 'arrivee' || R.etat === 'sortie', t, g, sous = '';
    if (R.choix) return '<div class="pt-res"><div class="pt-res-in"><span class="pt-ic ch">' + ico('attente', 44, 2.4) + '</span><h1>Arrivée ou sortie ?</h1><p>C’est votre premier pointage aujourd’hui et il est ' + hTs(maintenantPt().toISOString()) + '. Vous arrivez, ou vous partez ?</p>'
      + '<button class="a-btn navy" data-ptsens="arrivee">J’arrive</button><button class="a-btn blanc" data-ptsens="sortie">Je pars (j’ai oublié de pointer mon arrivée)</button><button class="pt-ann" data-act="ptok">Annuler</button></div></div>';
    if (R.busy) { t = 'Pointage…'; g = ''; }
    else if (R.etat === 'arrivee') { t = 'Arrivée enregistrée'; g = hTs(R.heure); sous = 'Bonne journée' + (R.prenom ? ', ' + esc(R.prenom) : '') + ' ! Scannez le même QR code en partant.'; }
    else if (R.etat === 'sortie') { t = 'Sortie enregistrée'; g = hTs(R.heure); sous = (R.sans_arrivee ? 'Votre arrivée n’a pas été pointée : la référente la complètera.' : 'Arrivée à ' + hTs(R.arrivee) + '.') + ' Bonne soirée' + (R.prenom ? ', ' + esc(R.prenom) : '') + ' !'; }
    else if (R.etat === 'simulation_coupee') { t = 'Simulation coupée'; g = ''; sous = 'L’heure simulée n’est pas autorisée. La référente peut l’activer dans Pointage (site de test).'; }
    else if (R.etat === 'doublon') { t = 'Déjà enregistré'; g = ''; sous = 'Votre pointage vient d’être pris en compte, inutile de scanner deux fois.' + (R.arrivee ? ' Arrivée : ' + hTs(R.arrivee) + (R.sortie ? ', sortie : ' + hTs(R.sortie) : '') + '.' : ''); }
    else if (R.etat === 'qr_perime') { t = 'QR code périmé'; g = ''; sous = 'Ce QR code n’est plus valable. Scannez celui affiché au centre.'; }
    else if (R.etat === 'non_soumis') { t = 'Pas de pointage pour vous'; g = ''; sous = 'Votre fiche n’est pas soumise au pointage journalier.'; }
    else if (R.etat === 'sans_fiche') { t = 'Compte non relié'; g = ''; sous = 'Votre compte n’est pas encore relié à votre fiche. Prévenez la référente.'; }
    else { t = 'Pointage impossible'; g = ''; sous = esc(R.msg || 'Réessayez dans un instant.'); }
    return '<div class="pt-res ' + (R.busy ? '' : ok ? 'ok' : 'ko') + '"><div class="pt-res-in">' + (R.busy ? '' : '<span class="pt-ic">' + ico(ok ? 'ok' : R.etat === 'doublon' ? 'attente' : 'croix', 44, 2.4) + '</span>')
      + '<h1>' + t + '</h1>' + (g ? '<p class="pt-h">' + g + '</p>' : '') + (sous ? '<p>' + sous + '</p>' : '') + (R.busy ? '' : '<button class="a-btn navy" data-act="ptok">Continuer</button>') + '</div></div>';
  }
  // Assistante : tuile « Pointer » et scanner intégré (appareil photo du téléphone)
  function chargerMonPointage() {
    if (!S.moiEq) return Promise.resolve();
    return sb.from('pointages').select('*').eq('equipe_id', S.moiEq.id).eq('jour', dIso(maintenantPt())).maybeSingle().then(function (r) { S.monPt = r.error ? null : r.data; render(); }, function () {});
  }
  function tuilePointer() {
    if (!S.moiEq || !S.moiEq.pointage) return '';
    var r = S.monPt, t, sous;
    if ((!r || !r.arrivee) && !(r && r.sortie)) { t = 'Pointer mon arrivée'; sous = 'Scannez le QR code du centre'; }
    else if (!r.sortie) { t = 'Pointer ma sortie'; sous = 'Arrivée à ' + hTs(r.arrivee); }
    else return '<div class="tuile-pt fait"><span class="ti">' + ico('ok', 34, 2.4) + '</span><span class="tt"><b>Journée pointée</b><span>' + (r.arrivee ? 'Arrivée ' + hTs(r.arrivee) : 'Arrivée non pointée (la référente la complètera)') + ' · sortie ' + hTs(r.sortie) + '</span></span></div>' + vSimA();
    return vSimA() + '<button class="tuile-pt' + (r && r.sortie ? ' fait' : '') + '" data-act="scan"><span class="ti">' + ico('qr', 34) + '</span><span class="tt"><b>' + t + '</b><span>' + sous + '</span></span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button>';
  }
  function vSimA() {
    if (CONFIG.env !== 'dev') return '';
    simPt(); var Z = S.sim || {}, jt = ''; try { jt = localStorage.getItem('evy-jeton-test') || ''; } catch (e) {}
    return '<div class="sim"><b>Simulation (site de test)</b><span class="mu">Choisissez un jour et une heure, puis pointez : c’est cette heure qui est enregistrée. Laissez vide pour l’heure réelle.</span>'
      + '<div class="sim-l"><input class="in" type="date" id="simj" value="' + esc(Z.jour || '') + '" aria-label="Jour simulé"><input class="in" type="time" id="simh" value="' + esc(Z.heure || '') + '" aria-label="Heure simulée">'
      + (Z.jour || Z.heure ? '<button class="btn l sm" data-act="simraz">Heure réelle</button>' : '') + '</div>'
      + (jt ? '<button class="btn sm" data-act="simscan">Pointer sans caméra (QR déjà scanné)</button>' : '<span class="mu" style="font-size:13px">Après un premier scan avec la caméra, un bouton « Pointer sans caméra » apparaîtra ici.</span>') + '</div>';
  }
  var SCAN = null;
  function chargerJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise(function (ok, ko) { var sc = document.createElement('script'); sc.src = 'js/vendor/jsqr.js?v=1'; sc.onload = ok; sc.onerror = function () { ko(new Error('Lecteur de QR code introuvable')); }; document.head.appendChild(sc); });
  }
  function fermerScanner() {
    if (!SCAN) return;
    SCAN.fini = true; try { (SCAN.flux && SCAN.flux.getTracks() || []).forEach(function (t) { t.stop(); }); } catch (e) {}
    if (SCAN.el && SCAN.el.parentNode) SCAN.el.parentNode.removeChild(SCAN.el);
    document.body.classList.remove('scan-ouvert'); SCAN = null;
  }
  function msgScan(t, ko) { if (SCAN && SCAN.msg) { SCAN.msg.textContent = t; SCAN.msg.className = 'scan-msg' + (ko ? ' ko' : ''); } }
  function ouvrirScanner() {
    fermerScanner();
    var el = document.createElement('div'); el.className = 'scan'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Scanner le QR code de pointage');
    el.innerHTML = '<div class="scan-hd"><b>Pointage</b><button class="scan-x" aria-label="Fermer">' + ico('croix', 24, 2.4) + '</button></div>'
      + '<div class="scan-zone"><video playsinline muted autoplay></video><span class="scan-cadre" aria-hidden="true"></span></div>'
      + '<p class="scan-msg">Visez le QR code du centre…</p><button class="scan-annuler">Annuler</button>';
    document.body.appendChild(el); document.body.classList.add('scan-ouvert');
    SCAN = { el: el, video: el.querySelector('video'), msg: el.querySelector('.scan-msg'), cv: document.createElement('canvas') };
    el.querySelector('.scan-x').onclick = el.querySelector('.scan-annuler').onclick = function () { fermerScanner(); };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msgScan('Ce téléphone ne permet pas d’ouvrir l’appareil photo ici. Utilisez l’appareil photo du téléphone pour scanner le QR code.', true); return; }
    var S0 = SCAN, det = null;
    try { if ('BarcodeDetector' in window) det = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { det = null; }
    Promise.all([navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }), det ? Promise.resolve() : chargerJsQR()]).then(function (r) {
      if (S0.fini) { r[0].getTracks().forEach(function (t) { t.stop(); }); return; }
      S0.flux = r[0]; S0.video.srcObject = r[0]; var pl2 = S0.video.play(); if (pl2 && pl2.catch) pl2.catch(function () {});
      var dernier = 0;
      (function boucle(ts) {
        if (S0.fini) return;
        if (ts - dernier > 180 && S0.video.readyState >= 2) {
          dernier = ts;
          var lu = function (txt) {
            if (!txt || S0.fini) return;
            var j = null; try { j = new URL(txt).searchParams.get('pointer'); } catch (e) { j = null; }
            if (!j) { msgScan('Ce n’est pas le QR code de pointage du centre.', true); return; }
            S0.fini = true; if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
            fermerScanner(); JETON_QR = j; pointerQR();
          };
          if (det) det.detect(S0.video).then(function (l) { if (l && l[0]) lu(l[0].rawValue); }).catch(function () {});
          else {
            var v = S0.video, k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
            if (w && h) { S0.cv.width = w; S0.cv.height = h; var cx = S0.cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(v, 0, 0, w, h); var q = window.jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (q) lu(q.data); }
          }
        }
        requestAnimationFrame(boucle);
      })(0);
    }).catch(function (e) {
      var refus = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      msgScan(refus ? 'L’accès à l’appareil photo est refusé. Autorisez-le dans les réglages du navigateur, ou scannez le QR code avec l’appareil photo du téléphone.' : 'Impossible d’ouvrir l’appareil photo (' + (e && e.message || e) + ').', true);
    });
  }
  function tuilePointage() {
    if (telephone()) return '<div class="h-tuile pc" aria-disabled="true"><span class="ti">' + ico('qr', 34) + '</span><span class="tt"><b>Pointage</b><span><b class="pc-t">À ouvrir sur ordinateur</b>Le suivi des pointages se fait sur un écran de PC.</span></span></div>';
    var P = S.ptg && S.ptg.rows, auj = dIso(new Date()), n = 0, soum = (S.equipe || []).filter(function (e) { return e.actif && e.pointage; });
    if (P) soum.forEach(function (e) { var r = P[e.id + '|' + auj]; if (r && r.arrivee) n++; });
    return '<button class="h-tuile" data-tab="pointage"><span class="ti">' + ico('qr', 34) + '</span><span class="tt"><b>Pointage</b><span>' + (soum.length ? (P ? n + ' / ' + soum.length + ' arrivée' + (n > 1 ? 's' : '') + ' pointée' + (n > 1 ? 's' : '') + ' aujourd’hui' : 'Arrivées, sorties et temps effectif') : 'QR code, arrivées, sorties et temps effectif') + '</span></span><span class="tc">' + ico('suiv', 22, 2.4) + '</span></button>';
  }
  // Pointages chargés par plage de dates (on garde ce qui est déjà chargé)
  function assurerPointages(de, a, force) {
    if (!pointagePret()) return null;
    var G = S.ptg = S.ptg || { mode: 'semaine', jour: dIso(new Date()), rows: {} };
    if (!force && G.de && G.de <= de && G.a >= a) return null;
    if (G.charge) return true;
    var d0 = G.de && G.de < de && !force ? G.de : de, a0 = G.a && G.a > a && !force ? G.a : a;
    if (force && G.de) { d0 = [G.de, de].sort()[0]; a0 = [G.a, a].sort()[1]; }
    G.charge = true;
    toutLire('pointages', '*', function (q) { return q.gte('jour', d0).lte('jour', a0); }).then(function (rows) {
      var o = {}; rows.forEach(function (x) { o[x.equipe_id + '|' + String(x.jour).slice(0, 10)] = x; });
      G.rows = o; G.de = d0; G.a = a0; G.charge = false; G.err = null; JOUR_CACHE = {}; render();
    }).catch(function (e) { G.charge = false; G.err = msgErr(e); G.de = d0; G.a = a0; render(); });
    return true;
  }
  function chargerPointages(force) { var G = S.ptg = S.ptg || { mode: 'semaine', jour: dIso(new Date()), rows: {} }, L = lundiDe(G.jour); return assurerPointages(L, addJ(L, 6), force); }
  function minLoc(ts) { var d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
  function fMin(m) { return Math.floor(m / 60) + 'h' + ('0' + (m % 60)).slice(-2); }
  // Temps effectif d'une journée : sortie − arrivée, moins la coupure de midi prévue au planning (seulement la partie
  // comprise entre l'arrivée et la sortie)
  function calculJour(p, iso, r) {
    var am = caseEff(p, iso, 'AM'), pm = caseEff(p, iso, 'PM'), trav = function (c) { return c.a && c.a !== 'OFF' && ABS.indexOf(c.a) < 0; };
    // École et formation : comptées dans le prévu et dans le temps effectif (heures de la règle), sans pointage
    var compte = function (c) { return c.a === 'ECOLE' || c.a === 'FORMATION'; };
    var hEF = (compte(am) ? heuresDemi(p, iso, 'AM', am) : 0) + (compte(pm) ? heuresDemi(p, iso, 'PM', pm) : 0);
    var travH = (trav(am) ? dureeDemi(am) : 0) + (trav(pm) ? dureeDemi(pm) : 0), prevu = travH + hEF, absTxt = ABS.indexOf(am.a) >= 0 ? ABS_TXT[am.a] : ABS.indexOf(pm.a) >= 0 ? ABS_TXT[pm.a] : null;
    var hor = [trav(am) && am.de ? ft(am.de) + '–' + ft(am.fi) : compte(am) ? ABS_TXT[am.a] + (am.a === pm.a ? '' : ' le matin') : '', trav(pm) && pm.de ? ft(pm.de) + '–' + ft(pm.fi) : compte(pm) && pm.a !== am.a ? ABS_TXT[pm.a] + ' l’après-midi' : ''].filter(Boolean).join(' · ');
    var o = { prevu: prevu, hEF: hEF, hor: hor || (absTxt || (am.off || pm.off ? 'Jour off' : 'Ne travaille pas')), absTxt: absTxt, travaille: travH > 0, pauseMin: 0, effMin: !travH && hEF ? Math.round(hEF * 60) : null };
    var p1 = trav(am) ? enMin(am.fi) : null, p2 = trav(pm) ? enMin(pm.de) : null;
    if (r && r.arrivee && r.sortie) {
      var a = minLoc(r.arrivee), b = minLoc(r.sortie); if (b < a) b = a;
      if (p1 != null && p2 != null && p2 > p1) o.pauseMin = Math.max(0, Math.min(b, p2) - Math.max(a, p1));
      o.effMin = b - a - o.pauseMin + Math.round(hEF * 60);
    }
    return o;
  }
  function etatPointage(p, iso, r, c) {
    var auj = dIso(new Date()), maintenant = new Date().getHours() * 60 + new Date().getMinutes();
    if (r && r.arrivee && r.sortie) return null;
    if (r && r.sortie && !r.arrivee) return { t: 'Arrivée manquante', k: 'ko' };
    if (r && r.arrivee) return iso < auj ? { t: 'Sortie manquante', k: 'ko' } : iso === auj ? { t: 'Sur place', k: 'on' } : null;
    if (!c.travaille) return null;
    if (iso > auj) return null;
    if (iso === auj && maintenant < 12 * 60) return { t: 'Pas encore pointé', k: 'at' };
    return { t: 'Aucun pointage', k: 'ko' };
  }
  function vPointage() {
    var G = S.ptg = S.ptg || { mode: 'semaine', jour: dIso(new Date()), rows: {} }, J = G.jour, L = lundiDe(J);
    if (G.mode === 'bord') return vPtBord();
    var titre = G.mode === 'jour' ? jourLong(J) : 'Semaine du ' + periode(L, addJ(L, 4)).replace(/^du /, '');
    var h = enTetePt({ mode: G.mode, titre: titre, nav: 'ptnav', fleches: true, auj: J !== dIso(new Date()) ? 'Aujourd’hui' : '', sous: G.mode === 'jour' ? 'Heures prévues = total de la journée, coupure de midi déduite' : 'Semaine du lundi au vendredi' }) + '<div class="a-corps hr-corps">';
    if (!pointagePret()) return h + '<div class="ban warn">La mise à jour 016 de la base (pointage) n’est pas encore faite.</div></div>' + (S.ptQR ? vQR() : '');
    if (assurerPlage(addJ(L, 6)) || S.pl.chargeH || chargerPointages() || G.charge) return h + '<p class="a-vide">Chargement…</p></div>';
    if (G.err) h += '<div class="ban warn">' + esc(G.err) + '</div>';
    var ps = (S.equipe || []).filter(function (e) { return e.actif && e.pointage; }).sort(function (a, b) { return (a.type === 'interimaire') - (b.type === 'interimaire') || a.ordre - b.ordre; });
    if (!ps.length) return h + '<div class="card"><b>Personne n’est soumis au pointage pour l’instant.</b><p class="mu" style="margin:6px 0 0">Cochez « Soumise au pointage journalier » dans la fiche de chaque assistante concernée (Réglages › L’équipe).</p></div></div>' + (S.ptQR ? vQR() : '');
    h += G.mode === 'jour' ? vPointageJour(ps, J) : vPointageSemaine(ps, L);
    if (CONFIG.env === 'dev') h += '<div class="sim"><b>Simulation (site de test uniquement)</b><span class="mu">Autorise les assistantes à pointer avec un jour et une heure choisis (encadré « Simulation » sous leur tuile Pointer), pour tester sans attendre le lendemain. N’existe pas sur le vrai site.</span><button class="btn sm' + (S.simOn ? ' l' : '') + '" data-act="simgestion" aria-pressed="' + !!S.simOn + '">' + (S.simOn ? 'Heure simulée autorisée · Couper' : 'Autoriser l’heure simulée') + '</button></div>';
    return h + '<p class="a-aide">Temps effectif = sortie − arrivée, moins la coupure de midi prévue au planning ce jour-là (seulement la partie passée entre l’arrivée et la sortie). Écart de la semaine : sur les journées pointées en entier. Touchez une ligne ou une case pour corriger un oubli : la correction est signée.</p></div>' + (S.ptEd ? vPtEdit() : '') + (S.ptQR ? vQR() : '') + (S.ptLog ? vPtLog() : '');
  }
  // ---------- Tableau de bord du pointage ----------
  function bornesPrevues(p, iso) {   // début et fin prévus (minutes) des demi-journées travaillées
    var am = caseEff(p, iso, 'AM'), pm = caseEff(p, iso, 'PM'), t = function (c) { return c.a && c.a !== 'OFF' && ABS.indexOf(c.a) < 0 && c.de && c.fi; };
    var d = t(am) ? enMin(am.de) : t(pm) ? enMin(pm.de) : null, f = t(pm) ? enMin(pm.fi) : t(am) ? enMin(am.fi) : null;
    return { d: d, f: f };
  }
  function statsPt(p, W) {
    var R = regles(), tol = +R.pt_tol || 0, tolD = +R.pt_tol_dep || 0, auj = dIso(new Date()), o = { p: p, jT: 0, jC: 0, sortieM: [], arriveeM: [], aucun: [], ret: [], dep: [], arr: [], reel: 0, prevu: 0, sem: [], ign: 0 };
    W.forEach(function (L) {
      var er = 0, ep = 0;
      for (var k = 0; k < 5; k++) {
        var iso = addJ(L, k), r = ptRow(p.id, iso); if (iso > auj && !r) continue;
        var c = calculJour(p, iso, r), b = bornesPrevues(p, iso);
        if (!c.travaille) { if (c.effMin != null) { o.reel += c.effMin / 60; o.prevu += c.prevu; er += c.effMin / 60; ep += c.prevu; } continue; }
        o.jT++;
        if (r && r.arrivee && r.sortie) {
          o.jC++;
          if (r.ignorer) o.ign++;
          else { o.reel += c.effMin / 60; o.prevu += c.prevu; er += c.effMin / 60; ep += c.prevu; }
        } else if (r && r.arrivee) { if (iso < auj) o.sortieM.push(iso); }
        else if (r && r.sortie) o.arriveeM.push(iso);
        else if (iso < auj) o.aucun.push(iso);
        if (r && r.arrivee && b.d != null) { var ma = minLoc(r.arrivee), dr = ma - b.d; o.arr.push(dr); if (dr > tol) o.ret.push({ iso: iso, m: dr }); }
        if (r && r.sortie && b.f != null) { var df = b.f - minLoc(r.sortie); if (df > tolD) o.dep.push({ iso: iso, m: df }); }
      }
      o.sem.push({ L: L, e: er - ep, ok: ep > 0 });
    });
    o.oublis = o.sortieM.length + o.arriveeM.length + o.aucun.length;
    o.ecart = o.reel - o.prevu;
    var am = o.arr.length ? o.arr.reduce(function (a, b) { return a + b; }, 0) / o.arr.length : null;
    o.arrMoy = null;
    if (o.arr.length) { var abs = 0, n = 0; W.forEach(function (L) { for (var k = 0; k < 5; k++) { var iso = addJ(L, k), r = ptRow(p.id, iso); if (r && r.arrivee) { abs += minLoc(r.arrivee); n++; } } }); o.arrMoy = n ? Math.round(abs / n) : null; }
    o.arrEcartMoy = am;
    return o;
  }
  function chargerJournalBord(de, a) {   // scans refusés et corrections de la période (si le journal existe)
    var G = S.ptg, k = de + a; if (G.jbK === k) return; G.jbK = k; G.jb = null;
    toutLire('pointage_journal', 'evenement,jour,quand,equipe_id,qr_ref', function (q) { return q.gte('quand', dDe(de).toISOString()).lt('quand', dDe(addJ(a, 1)).toISOString()); })
      .then(function (l) { if (S.ptg.jbK === k) { S.ptg.jb = l; render(); } }).catch(function () { if (S.ptg.jbK === k) { S.ptg.jb = []; render(); } });
  }
  function jourLong(iso) { var t = dDe(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); }
  // En-tête commun aux vues du pointage : chaque bouton garde toujours la même place (emplacements réservés)
  function enTetePt(o) {
    var B = S.ptg && S.ptg.bord, bord = o.mode === 'bord', sel = bord && B && B.sel;
    return '<header class="a-hd fixe pl-hd pt-hd"><div class="a-hd-row"><button class="a-back" data-' + (sel ? 'ptbsel=""' : 'tab="hub"') + '>' + ico('prec', 22, 2.4) + (sel ? 'Tableau de bord' : 'Accueil') + '</button><h1>' + (sel ? esc((persById(B.sel) || {}).prenom || '') : 'Pointage') + '</h1><span class="pl-hbtns"><button class="pl-imp" data-act="ptlog">' + ico('histo', 18, 2) + '<span class="m-hide">Journal</span></button><button class="pl-imp" data-act="ptqr">' + ico('qr', 18, 2) + '<span class="m-hide">QR code</span></button></span></div>'
      + '<div class="pt-nav"><div class="hr-seg pt-s1" role="group" aria-label="Affichage">' + [['jour', 'Jour'], ['semaine', 'Semaine'], ['bord', 'Tableau de bord']].map(function (m) { return '<button data-ptmode="' + m[0] + '" aria-pressed="' + (o.mode === m[0]) + '"' + (o.mode === m[0] ? ' class="on"' : '') + '>' + m[1] + '</button>'; }).join('') + '</div>'
      + '<div class="hr-seg pt-s2' + (bord ? '' : ' cache') + '" role="group" aria-label="Période"' + (bord ? '' : ' aria-hidden="true"') + '>' + [['semaine', 'Semaine'], ['mois', 'Mois'], ['depuis', 'Depuis le début']].map(function (m) { var on = bord && B && B.per === m[0]; return '<button data-ptbper="' + m[0] + '"' + (bord ? '' : ' tabindex="-1"') + ' aria-pressed="' + !!on + '"' + (on ? ' class="on2"' : '') + '>' + m[1] + '</button>'; }).join('') + '</div>'
      + '<div class="pt-per"><button class="h-rond' + (o.fleches ? '' : ' cache') + '" data-' + o.nav + '="-1" aria-label="Précédent"' + (o.fleches ? '' : ' tabindex="-1"') + '>' + ico('prec', 20, 2.4) + '</button><span class="pt-titre"><b>' + o.titre + '</b></span><button class="h-rond' + (o.fleches ? '' : ' cache') + '" data-' + o.nav + '="1" aria-label="Suivant"' + (o.fleches ? '' : ' tabindex="-1"') + '>' + ico('suiv', 20, 2.4) + '</button></div>'
      + '<button class="pl-auj pt-auj' + (o.auj ? '' : ' cache') + '" data-' + o.nav + '="0"' + (o.auj ? '' : ' tabindex="-1" aria-hidden="true"') + '>' + (o.auj || 'Aujourd’hui') + '</button></div>'
      + '<p class="hr-sous pt-sous">' + (o.sous || '&nbsp;') + '</p></header>';
  }
  function enteteBord(B, titre, sous) {
    var nav = B.per === 'depuis' ? '<span class="hr-titre"><b>' + titre + '</b></span>' : '<button class="h-rond" data-ptbnav="-1" aria-label="Précédent">' + ico('prec', 20, 2.4) + '</button><span class="hr-titre"><b>' + titre + '</b></span><button class="h-rond" data-ptbnav="1" aria-label="Suivant">' + ico('suiv', 20, 2.4) + '</button>';
    return '<header class="a-hd fixe pl-hd"><div class="a-hd-row"><button class="a-back" data-' + (B.sel ? 'ptbsel=""' : 'tab="hub"') + '>' + ico('prec', 22, 2.4) + (B.sel ? 'Tableau de bord' : 'Accueil') + '</button><h1>' + (B.sel ? esc((persById(B.sel) || {}).prenom || '') : 'Pointage') + '</h1><span class="pl-hbtns"><button class="pl-imp" data-act="ptlog">' + ico('histo', 18, 2) + '<span class="m-hide">Journal</span></button><button class="pl-imp" data-act="ptqr">' + ico('qr', 18, 2) + '<span class="m-hide">QR code</span></button></span></div>'
      + '<div class="hr-nav"><div class="hr-seg" role="group" aria-label="Affichage">' + [['jour', 'Jour'], ['semaine', 'Semaine'], ['bord', 'Tableau de bord']].map(function (m) { return '<button data-ptmode="' + m[0] + '" aria-pressed="' + (m[0] === 'bord') + '"' + (m[0] === 'bord' ? ' class="on"' : '') + '>' + m[1] + '</button>'; }).join('') + '</div>'
      + '<div class="hr-seg" role="group" aria-label="Période">' + [['semaine', 'Semaine'], ['mois', 'Mois'], ['depuis', 'Depuis le début']].map(function (m) { return '<button data-ptbper="' + m[0] + '" aria-pressed="' + (B.per === m[0]) + '"' + (B.per === m[0] ? ' class="on2"' : '') + '>' + m[1] + '</button>'; }).join('') + '</div>'
      + '<div class="hr-per">' + nav + '</div></div><p class="hr-sous">' + sous + (regles().pt_reliquat !== false ? ' · <b class="or">Le reliquat utilise le temps pointé</b>' : ' · le reliquat utilise le planning') + '</p></header>';
  }
  function vPtBord() {
    var G = S.ptg, B = G.bord = G.bord || { per: 'mois', mois: addJ(lundiDe(dIso(new Date())), 3).slice(0, 7), lundi: lundiDe(dIso(new Date())), sel: null };
    var W = hrSemaines({ mode: B.per, mois: B.mois, lundi: B.lundi }), der = W[W.length - 1];
    var titre = B.per === 'semaine' ? 'Semaine du ' + periode(B.lundi, addJ(B.lundi, 4)).replace(/^du /, '') : B.per === 'mois' ? nomMois(B.mois).replace(/^./, function (c) { return c.toUpperCase(); }) : 'Depuis le ' + dateCourte(regles().depuis || '2026-11-02');
    var ps = (S.equipe || []).filter(function (e) { return e.actif && e.pointage; }).sort(function (a, b) { return (a.type === 'interimaire') - (b.type === 'interimaire') || a.ordre - b.ordre; });
    var sous = W.length + ' semaine' + (W.length > 1 ? 's' : '') + ' · ' + periode(W[0], addJ(der, 4)) + ' · ' + ps.length + ' ' + pl(ps.length, 'personne') + ' soumise' + (ps.length > 1 ? 's' : '') + ' au pointage';
    var auj0 = dIso(new Date()), estCourant = B.per === 'semaine' ? B.lundi === lundiDe(auj0) : B.per === 'mois' ? B.mois === addJ(lundiDe(auj0), 3).slice(0, 7) : true;
    var h = enTetePt({ mode: 'bord', titre: titre, nav: 'ptbnav', fleches: B.per !== 'depuis', auj: estCourant ? '' : B.per === 'semaine' ? 'Cette semaine' : 'Ce mois-ci', sous: sous + (regles().pt_reliquat !== false ? ' · <b class="or">Le reliquat utilise le temps pointé</b>' : ' · le reliquat utilise le planning') }) + '<div class="a-corps hr-corps">';
    if (!pointagePret()) return h + '<div class="ban warn">La mise à jour 016 de la base (pointage) n’est pas encore faite.</div></div>';
    if (assurerPlage(addJ(der, 6)) || S.pl.chargeH || assurerPointages(lundiDe(regles().depuis || W[0]), addJ(der, 6))) return h + '<p class="a-vide">Chargement…</p></div>' + modalesPt();
    if (!ps.length) return h + '<div class="card"><b>Personne n’est soumis au pointage pour l’instant.</b></div></div>' + modalesPt();
    chargerJournalBord(W[0], addJ(der, 6));
    var X = ps.map(function (p) { return statsPt(p, W); });
    if (B.sel) { var x0 = X.filter(function (x) { return String(x.p.id) === String(B.sel); })[0]; if (x0) return h + vPtBordDetail(x0, W) + '</div>' + modalesPt(); B.sel = null; }
    var R = regles(), tol = +R.pt_tol || 0, jT = 0, jC = 0, sM = 0, aM = 0, nA = 0, ret = [], dep = [], reel = 0, prevu = 0, arr = [];
    X.forEach(function (x) { jT += x.jT; jC += x.jC; sM += x.sortieM.length; aM += x.arriveeM.length; nA += x.aucun.length; ret = ret.concat(x.ret); dep = dep.concat(x.dep); reel += x.reel; prevu += x.prevu; arr = arr.concat(x.arr); });
    var som = function (l) { return l.reduce(function (a, b) { return a + b.m; }, 0); }, oub = sM + aM + nA, pc = jT ? Math.round(jC / jT * 100) : 100;
    var dO = [sM ? sM + ' sortie' + (sM > 1 ? 's' : '') + ' manquante' + (sM > 1 ? 's' : '') : '', aM ? aM + ' arrivée' + (aM > 1 ? 's' : '') + ' manquante' + (aM > 1 ? 's' : '') : '', nA ? nA + ' jour' + (nA > 1 ? 's' : '') + ' sans pointage' : ''].filter(Boolean).join(' · ');
    h += '<section class="hr-kpis" aria-label="Chiffres clés">'
      + '<div class="hr-kpi"><span class="hr-k">Pointages complets</span><b class="' + (pc >= 95 ? 'ok' : 'plus') + '">' + (jT ? pc + ' %' : '—') + '</b><span>' + (jT ? jC + ' ' + pl(jC, 'journée') + ' sur ' + jT + ' travaillée' + (jT > 1 ? 's' : '') : 'aucune journée travaillée pointable') + '</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Oublis</span><b class="' + (oub ? 'ko' : 'ok') + '">' + oub + '</b><span>' + (dO || 'aucun oubli') + '</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Retards</span><b class="' + (ret.length ? 'plus' : 'ok') + '">' + ret.length + '</b><span>' + (ret.length ? fh(som(ret) / 60) + ' cumulées · ' : '') + 'tolérance ' + tol + ' min</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Départs avant l’heure</span><b class="' + (dep.length ? 'plus' : 'ok') + '">' + dep.length + '</b><span>' + (dep.length ? fh(som(dep) / 60) + ' cumulées · ' : '') + 'tolérance ' + (+R.pt_tol_dep || 0) + ' min</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Réel / prévu · équipe</span><b>' + fh(reel) + '</b><span>pour ' + fh(prevu) + ' prévues · <b class="' + hrCouleur(reel - prevu) + '">' + (Math.abs(reel - prevu) < 0.01 ? '0 h' : relTxt(reel - prevu)) + '</b></span></div></section>';
    // tableau par personne
    h += '<div class="hr-cols"><section class="hr-carte hr-tab"><div class="hr-ct"><h2>Par personne</h2><span class="mu">Touchez une ligne pour le détail jour par jour</span></div><div class="hr-scroll"><div class="pb-grille"><div class="pb-l hr-tete"><span>Personne</span><span>Jours pointés</span><span>Oublis</span><span>Retards</span><span>Départs tôt</span><span>Arrivée moy.</span><span>Réel</span><span>Prévu</span><span>Écart</span></div>';
    X.forEach(function (x) {
      h += '<button class="pb-l" data-ptbsel="' + x.p.id + '"><span class="hr-p"><span class="a-av">' + esc((x.p.prenom || '?')[0]) + '</span><b>' + esc(x.p.type === 'interimaire' ? 'Intérimaire' : x.p.prenom) + '</b></span>'
        + '<span>' + x.jC + ' / ' + x.jT + (x.ign ? '<small>' + x.ign + ' non compté' + (x.ign > 1 ? 's' : '') + '</small>' : '') + '</span><b class="' + (x.oublis ? 'ko' : 'mu') + '">' + x.oublis + '</b>'
        + '<span><b class="' + (x.ret.length >= (+R.pt_retards || 3) ? 'plus' : '') + '">' + x.ret.length + '</b><small>' + (x.ret.length ? som(x.ret) + ' min' : '—') + '</small></span>'
        + '<span><b class="' + (x.dep.length >= (+R.pt_departs || 3) ? 'plus' : x.dep.length ? '' : 'mu') + '">' + x.dep.length + '</b><small>' + (x.dep.length ? som(x.dep) + ' min' : '—') + '</small></span><span>' + (x.arrMoy != null ? fMin(x.arrMoy).replace('h', ' h ') : '—') + '</span>'
        + '<b>' + fh(x.reel) + '</b><span>' + fh(x.prevu) + '</span><b class="' + hrCouleur(x.prevu ? x.ecart : null) + '">' + (!x.prevu ? '—' : Math.abs(x.ecart) < 0.01 ? '0 h' : relTxt(x.ecart)) + '</b></button>';
    });
    h += '</div></div>';
    // graphique : écart par semaine
    var mx = Math.max(1, Math.max.apply(null, X.map(function (x) { return Math.max.apply(null, x.sem.map(function (z) { return Math.abs(z.e); }).concat([0])); })));
    h += '<div class="pb-gr"><h3>Écart réel − prévu, semaine par semaine</h3><div class="pb-cartes">' + X.map(function (x) {
      var sem = x.sem.length > 8 ? x.sem.slice(-8) : x.sem;
      return '<div class="pb-carte"><span class="pb-ct"><b>' + esc(x.p.prenom) + '</b><b class="' + hrCouleur(x.prevu ? x.ecart : null) + '">' + (!x.prevu ? '—' : Math.abs(x.ecart) < 0.01 ? '0 h' : relTxt(x.ecart)) + '</b></span>'
        + '<span class="pb-bars" role="img" aria-label="' + esc(sem.map(function (z) { return dateCourte(z.L) + ' ' + (z.ok ? relTxt(z.e) : 'pas de pointage'); }).join(', ')) + '"><i class="pb-zero"></i>' + sem.map(function (z) { var hp = Math.max(2, Math.round(Math.abs(z.e) / mx * 26)); return '<span><i class="' + (!z.ok ? 'vide' : Math.abs(z.e) < 0.01 ? 'nul' : z.e > 0 ? 'plus' : 'moins') + '" style="height:' + (z.ok ? hp : 2) + 'px;' + (z.e >= 0 ? 'bottom:28px' : 'top:28px') + '"></i></span>'; }).join('') + '</span>'
        + '<span class="pb-dates">' + sem.map(function (z) { return '<span>' + dDe(z.L).getDate() + '/' + (dDe(z.L).getMonth() + 1) + '</span>'; }).join('') + '</span></div>';
    }).join('') + '</div><p class="mu" style="margin:0;font-size:13.5px">Au-dessus du trait : plus d’heures que prévu (orange) ; en dessous : moins (bleu). Gris : pas de journée pointée.</p></div></section>';
    // à surveiller : regroupé par sujet, du plus urgent au moins urgent
    var jb = G.jb, sq = function (d) { return JC[jourSem(d)].toLowerCase() + '. ' + dDe(d).getDate() + '/' + (dDe(d).getMonth() + 1); };
    var grp = { oublis: [], retards: [], departs: [], ecarts: [], refus: [], corr: [] };
    X.forEach(function (x) {
      x.sortieM.forEach(function (d) { grp.oublis.push({ q: x.p.prenom, t: 'sortie manquante', w: sq(d), a: 'data-pted="' + x.p.id + '|' + d + '"', k: d }); });
      x.arriveeM.forEach(function (d) { grp.oublis.push({ q: x.p.prenom, t: 'arrivée manquante', w: sq(d), a: 'data-pted="' + x.p.id + '|' + d + '"', k: d }); });
      x.aucun.forEach(function (d) { grp.oublis.push({ q: x.p.prenom, t: 'aucun pointage', w: sq(d), a: 'data-pted="' + x.p.id + '|' + d + '"', k: d }); });
      if (x.ret.length >= (+R.pt_retards || 3)) grp.retards.push({ q: x.p.prenom, t: x.ret.length + ' retards · ' + som(x.ret) + ' min', w: '', a: 'data-ptbsel="' + x.p.id + '"' });
      if (x.dep.length >= (+R.pt_departs || 3)) grp.departs.push({ q: x.p.prenom, t: x.dep.length + ' départs avant l’heure · ' + som(x.dep) + ' min', w: '', a: 'data-ptbsel="' + x.p.id + '"' });
      x.sem.forEach(function (z) { if (z.ok && Math.abs(z.e) > (+R.pt_ecart || 2)) grp.ecarts.push({ q: x.p.prenom, t: relTxt(z.e) + (z.e > 0 ? ' en plus' : ' en moins'), w: 'sem. ' + dDe(z.L).getDate() + '/' + (dDe(z.L).getMonth() + 1), a: 'data-ptbsel="' + x.p.id + '"' }); });
    });
    grp.oublis.sort(function (a, b) { return a.k < b.k ? 1 : -1; });
    (jb || []).forEach(function (e) {
      var pe = e.equipe_id ? persById(e.equipe_id) : null, q = pe ? pe.prenom : '—', w = jlDate(e.quand).slice(0, 5);
      if (/^(QR_PERIME|SANS_FICHE|NON_SOUMIS|SIMULATION_COUPEE)$/.test(e.evenement)) grp.refus.push({ q: q, t: (EVT_PT[e.evenement] || e.evenement).toLowerCase(), w: w, a: 'data-act="ptlog"' });
      else if (e.evenement === 'CORRECTION' || e.evenement === 'EFFACEMENT') grp.corr.push({ q: q, t: e.evenement === 'CORRECTION' ? 'correction' : 'effacement', w: w, a: 'data-act="ptlog"' });
    });
    var SV = G.surv = G.surv || { ouvert: { oublis: true, retards: true, departs: true }, tout: {} };
    var defs = [['oublis', 'Oublis à compléter', 'ko'], ['retards', 'Retards répétés', 'plus'], ['departs', 'Départs anticipés répétés', 'plus'], ['ecarts', 'Écarts de semaine', 'moins'], ['refus', 'Scans refusés', 'neutre'], ['corr', 'Corrections à la main', 'neutre']];
    var nTot = defs.reduce(function (a, d) { return a + grp[d[0]].length; }, 0);
    h += '<aside class="hr-cote"><section class="hr-carte sv"><div class="sv-t"><h2>À surveiller</h2><span class="mu">' + (nTot ? nTot + ' ' + pl(nTot, 'point') : 'rien à signaler') + '</span></div>'
      + defs.filter(function (d) { return grp[d[0]].length; }).map(function (d) {
        var l = grp[d[0]], ouv = !!SV.ouvert[d[0]], tout = !!SV.tout[d[0]], vis = tout ? l : l.slice(0, 3);
        return '<div class="sv-g"><button class="sv-h" data-svg="' + d[0] + '" aria-expanded="' + ouv + '"><span class="sv-n ' + d[2] + '">' + l.length + '</span><b>' + d[1] + '</b>' + ico(ouv ? 'haut' : 'bas', 18, 2.4) + '</button>'
          + (ouv ? '<div class="sv-l">' + vis.map(function (x) { return '<button class="sv-li" ' + x.a + '><b>' + esc(x.q) + '</b><span>' + esc(x.t) + '</span><small>' + esc(x.w) + '</small></button>'; }).join('')
            + (l.length > 3 ? '<button class="sv-plus" data-svtout="' + d[0] + '">' + (tout ? 'Voir moins' : 'Voir les ' + l.length) + '</button>' : '') + '</div>' : '') + '</div>';
      }).join('') + (nTot ? '' : '<p class="mu" style="margin:0;padding:0 16px 14px">Rien à signaler sur la période.</p>') + '</section>';
    var cA = [0, 0, 0]; arr.forEach(function (m) { cA[m <= 0 ? 0 : m <= tol ? 1 : 2]++; }); var tA = Math.max(1, arr.length);
    h += '<section class="hr-carte"><h2>Heures d’arrivée</h2><p class="mu" style="margin:0 0 4px;font-size:14px">Arrivée pointée par rapport à l’heure prévue, toutes les journées</p>'
      + [['En avance / à l’heure', 'ok', cA[0]], ['1 à ' + tol + ' min', 'tol', cA[1]], ['Retard (+' + tol + ' min)', 'ret', cA[2]]].map(function (z) { return '<div class="pb-dist"><span>' + z[0] + '</span><span class="pb-db"><i class="' + z[1] + '" style="width:' + Math.round(z[2] / tA * 100) + '%"></i></span><b>' + z[2] + '</b></div>'; }).join('') + '</section></aside></div>';
    return h + '</div>' + modalesPt();
  }
  function modalesPt() { return (S.ptEd ? vPtEdit() : '') + (S.ptQR ? vQR() : '') + (S.ptLog ? vPtLog() : ''); }
  function vPtBordDetail(x, W) {
    var p = x.p, c = +p.contrat_h || 0, auj = dIso(new Date()), tol = +regles().pt_tol || 0, som = function (l) { return l.reduce(function (a, b) { return a + b.m; }, 0); };
    var h = '<div class="hr-kpis">'
      + '<div class="hr-kpi ' + hrCouleur(x.prevu ? x.ecart : null) + '-bg"><span class="hr-k">Écart de la période</span><b class="' + hrCouleur(x.prevu ? x.ecart : null) + '">' + (!x.prevu ? '—' : Math.abs(x.ecart) < 0.01 ? '0 h' : relTxt(x.ecart)) + '</b><span>' + fh(x.reel) + ' réelles · ' + fh(x.prevu) + ' prévues</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Contrat</span><b>' + (c ? fh(c * W.length) : '—') + '</b><span>' + (c ? fh(c) + ' × ' + W.length + ' semaine' + (W.length > 1 ? 's' : '') : 'pas de contrat') + '</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Retards</span><b class="' + (x.ret.length ? 'plus' : 'ok') + '">' + x.ret.length + (x.ret.length ? ' · ' + som(x.ret) + ' min' : '') + '</b><span>' + (x.arrMoy != null ? 'arrivée moyenne ' + fMin(x.arrMoy).replace('h', ' h ') : 'aucune arrivée pointée') + '</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Départs avant l’heure</span><b class="' + (x.dep.length ? 'plus' : 'ok') + '">' + x.dep.length + (x.dep.length ? ' · ' + som(x.dep) + ' min' : '') + '</b><span>tolérance ' + (+regles().pt_tol_dep || 0) + ' min</span></div>'
      + '<div class="hr-kpi"><span class="hr-k">Oublis</span><b class="' + (x.oublis ? 'ko' : 'ok') + '">' + x.oublis + '</b><span>' + (x.oublis ? [x.sortieM.length ? x.sortieM.length + ' sortie(s)' : '', x.arriveeM.length ? x.arriveeM.length + ' arrivée(s)' : '', x.aucun.length ? x.aucun.length + ' jour(s) sans pointage' : ''].filter(Boolean).join(' · ') : 'aucun') + '</span></div></div>';
    // jour par jour
    h += '<section class="hr-carte hr-tab"><div class="hr-ct"><h2>Jour par jour</h2><span class="mu">Touchez un jour pour corriger</span></div><div class="hr-scroll"><div class="pd-grille"><div class="pd-l hr-tete"><span>Jour</span><span>Prévu</span><span>Arrivée</span><span>Sortie</span><span>Réel</span><span>Prévu</span><span>Écart</span><span>Remarques</span></div>';
    W.slice().reverse().forEach(function (L) {
      for (var k = 4; k >= 0; k--) {
        var iso = addJ(L, k), r = ptRow(p.id, iso); if (iso > auj && !r) continue;
        var cj = calculJour(p, iso, r), b = bornesPrevues(p, iso), tg = [];
        if (!cj.travaille && cj.effMin == null && !r) continue;
        if (r && r.arrivee && b.d != null && minLoc(r.arrivee) - b.d > tol) tg.push(['Retard ' + (minLoc(r.arrivee) - b.d) + ' min', 'ret']);
        if (r && r.sortie && b.f != null && b.f - minLoc(r.sortie) > (+regles().pt_tol_dep || 0)) tg.push(['Départ ' + (b.f - minLoc(r.sortie)) + ' min avant', 'ret']);
        if (r && r.arrivee && !r.sortie && iso < auj) tg.push(['Sortie manquante', 'ko']);
        if (r && r.sortie && !r.arrivee) tg.push(['Arrivée manquante', 'ko']);
        if (!r && cj.travaille && iso < auj) tg.push(['Aucun pointage', 'ko']);
        if (r && r.ignorer) tg.push(['Non compté (prévu gardé)', 'n']);
        if (r && r.corrige_par) tg.push(['Corrigé par ' + (nomProfil(r.corrige_par) || '?'), 'n']);
        if (cj.hEF) tg.push([(cj.absTxt || 'École') + ' ' + fh(cj.hEF), 'n']);
        var ec = cj.effMin != null ? cj.effMin / 60 - cj.prevu : null;
        h += '<button class="pd-l" data-pted="' + p.id + '|' + iso + '"><b>' + JC[jourSem(iso)] + '. ' + dateCourte(iso) + '</b><span>' + esc(cj.hor) + '</span><span class="' + (tg.some(function (t) { return /^Retard/.test(t[0]); }) ? 'plus' : '') + '">' + (r && r.arrivee ? hTs(r.arrivee) : '—') + '</span><span class="' + (r && r.arrivee && !r.sortie && iso < auj ? 'ko' : '') + '">' + (r && r.sortie ? hTs(r.sortie) : '—') + '</span>'
          + '<b>' + (cj.effMin != null ? fh(cj.effMin / 60) : '—') + '</b><span>' + fh(cj.prevu) + '</span><b class="' + hrCouleur(ec) + '">' + (ec == null ? '' : Math.abs(ec) < 0.01 ? '0' : Math.abs(ec) < 1 ? (ec > 0 ? '+' : '−') + Math.round(Math.abs(ec) * 60) + ' min' : relTxt(ec)) + '</b>'
          + '<span class="pd-tags">' + tg.map(function (t) { return '<span class="pt-ev ' + (t[1] === 'ret' ? 'plus' : t[1]) + '">' + esc(t[0]) + '</span>'; }).join('') + '</span></button>';
      }
    });
    h += '</div></div></section>';
    // théorique / contrat / réel / reliquat par semaine
    var ws = W.length > 8 ? W.slice(-8) : W;
    h += '<section class="hr-carte"><h2>Théorique, contrat et réel · semaine par semaine</h2><div class="hr-scroll"><table class="pd-t"><thead><tr><th></th>' + ws.map(function (L) { return '<th>Sem. du ' + dateCourte(L) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + '<tr><th>Théorique (planning)</th>' + ws.map(function (L) { return '<td>' + fh(heuresSemPrevu(p, L)) + '</td>'; }).join('') + '</tr>'
      + '<tr><th>Contrat</th>' + ws.map(function () { return '<td>' + (c ? fh(c) : '—') + '</td>'; }).join('') + '</tr>'
      + '<tr><th>Compté (réel si pointé)</th>' + ws.map(function (L) { return '<td><b>' + fh(heuresSem(p, L)) + '</b></td>'; }).join('') + '</tr>'
      + '<tr><th>Reliquat fin de semaine</th>' + ws.map(function (L) { var rl = c ? reliquatAvant(p, L) + heuresSem(p, L) - c : null; return '<td><b class="' + hrCouleur(rl) + '">' + (rl == null ? '—' : Math.abs(rl) < 0.01 ? 'à jour' : relTxt(rl)) + '</b></td>'; }).join('') + '</tr></tbody></table></div>'
      + '<p class="mu" style="margin:6px 0 0;font-size:13.5px">' + (regles().pt_reliquat !== false ? 'Le reliquat compte le temps réel des journées pointées en entier, sinon le prévu.' : 'Le reliquat utilise le planning (Réglages › Heures).') + ' Le report de ces lignes dans le planning sera étudié ensuite.</p></section>';
    return h;
  }
  // Heure d'arrivée ou de sortie, avec « +12 min de retard » / « parti 20 min avant » en couleur
  function celHeure(ts, prevu, sens) {
    if (!ts) return '<b class="pt-h0">—</b>';
    var m = minLoc(ts), tol = +(sens === 'a' ? regles().pt_tol : regles().pt_tol_dep) || 0, d = prevu == null ? null : sens === 'a' ? m - prevu : prevu - m, mauvais = d != null && d > tol;
    var lib = d == null || Math.abs(d) < 1 ? '' : sens === 'a' ? (d > 0 ? 'retard ' + fMinCourt(d) : 'avance ' + fMinCourt(-d)) : (d > 0 ? 'parti ' + fMinCourt(d) + ' avant' : 'parti ' + fMinCourt(-d) + ' après');
    return '<span class="pt-hc' + (mauvais ? ' mal' : '') + '"><b>' + (mauvais ? '<i aria-hidden="true">' + (sens === 'a' ? '▲' : '▼') + '</i>' : '') + hTs(ts) + '</b>' + (lib ? '<small>' + lib + '</small>' : '') + '</span>';
  }
  function fMinCourt(m) { m = Math.round(m); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2); }
  function vPointageJour(ps, J) {
    var tot = 0, totP = 0, h = '<section class="hr-carte hr-tab"><div class="hr-scroll"><div class="pt-grille"><div class="pt-l hr-tete"><span>Personne</span><span>Prévu au planning</span><span>Arrivée</span><span>Sortie</span><span>Pause déduite</span><span>Temps effectif</span><span>Écart</span></div>';
    ps.forEach(function (p) {
      var r = S.ptg.rows[p.id + '|' + J], c = calculJour(p, J, r), et = etatPointage(p, J, r, c), ec = c.effMin != null ? c.effMin / 60 - c.prevu : null, b = bornesPrevues(p, J);
      if (c.effMin != null) { tot += c.effMin; totP += c.prevu; }
      h += '<button class="pt-l" data-pted="' + p.id + '|' + J + '"><span class="hr-p"><span class="a-av">' + esc((p.prenom || '?')[0]) + '</span><span><b>' + esc(p.type === 'interimaire' ? 'Intérimaire' : p.prenom) + '</b>' + (r && r.corrige_par ? '<small>corrigé par ' + esc(nomProfil(r.corrige_par) || '?') + '</small>' : r && r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</span></span>'
        + '<span class="pt-prev"><b>' + esc(c.hor) + '</b>' + (c.prevu ? '<em>= ' + fh(c.prevu) + '</em>' : '') + '</span>'
        + celHeure(r && r.arrivee, b.d, 'a') + celHeure(r && r.sortie, b.f, 's')
        + '<span>' + (c.effMin != null ? (c.pauseMin ? fMin(c.pauseMin) : '0h00') : '') + '</span>'
        + '<span>' + (c.effMin != null ? '<b class="pt-eff">' + fh(c.effMin / 60) + '</b>' + (c.hEF ? '<small>dont ' + (c.absTxt || 'école').toLowerCase() + ' ' + fh(c.hEF) + '</small>' : '') : et ? '<span class="pt-et ' + et.k + '">' + et.t + '</span>' : '<span class="mu">—</span>') + '</span>'
        + '<b class="' + hrCouleur(ec) + '">' + (ec == null ? '' : Math.abs(ec) < 0.01 ? '0 h' : relTxt(ec)) + '</b></button>';
    });
    return h + '</div></div></section>' + (tot ? '<p class="mu" style="margin:0">Total des journées complètes : <b>' + fh(tot / 60) + '</b> pour ' + fh(totP) + ' prévues.</p>' : '');
  }
  function vPointageSemaine(ps, L) {
    var h = '<section class="hr-carte hr-tab"><div class="hr-scroll"><div class="pt-gs"><div class="pt-s hr-tete"><span>Personne</span>' + [0, 1, 2, 3, 4].map(function (k) { var d = addJ(L, k); return '<span>' + JC[k + 1] + ' ' + dDe(d).getDate() + '</span>'; }).join('') + '<span>Effectif</span><span>Prévu</span><span>Écart</span></div>';
    var auj = dIso(new Date());
    ps.forEach(function (p) {
      var te = 0, tp = 0, tpp = 0, manq = 0;
      h += '<div class="pt-s"><span class="hr-p"><span class="a-av">' + esc((p.prenom || '?')[0]) + '</span><b>' + esc(p.type === 'interimaire' ? 'Intérimaire' : p.prenom) + '</b></span>';
      for (var k = 0; k < 5; k++) {
        var iso = addJ(L, k), r = S.ptg.rows[p.id + '|' + iso], c = calculJour(p, iso, r), et = etatPointage(p, iso, r, c);
        tp += c.prevu; if (c.effMin != null) { te += c.effMin; tpp += c.prevu; } else if (c.travaille && iso < auj) manq++;
        var bs = bornesPrevues(p, iso), tl = +regles().pt_tol || 0, rt = r && r.arrivee && bs.d != null && minLoc(r.arrivee) - bs.d > tl, dp = r && r.sortie && bs.f != null && bs.f - minLoc(r.sortie) > (+regles().pt_tol_dep || 0);
        h += '<button class="pt-sc' + (rt || dp ? ' mal' : '') + '" data-pted="' + p.id + '|' + iso + '">' + (c.effMin != null ? '<b>' + fh(c.effMin / 60) + '</b><small>' + (r && r.arrivee && r.sortie ? hTs(r.arrivee).replace(' h ', 'h') + '–' + hTs(r.sortie).replace(' h ', 'h') + (c.hEF ? ' + ' + c.absTxt.toLowerCase() : '') : esc(c.absTxt || '')) + '</small>' + (rt || dp ? '<span class="pt-mal">' + (rt ? '▲ retard ' + fMinCourt(minLoc(r.arrivee) - bs.d) : '') + (rt && dp ? ' · ' : '') + (dp ? '▼ parti ' + fMinCourt(bs.f - minLoc(r.sortie)) + ' avant' : '') + '</span>' : '') : et ? '<span class="pt-et ' + et.k + '">' + et.t + '</span>' : '<small class="mu">' + esc(c.absTxt || (c.travaille ? '—' : 'repos')) + '</small>') + '</button>';
      }
      var ec = te / 60 - tpp;
      h += '<b>' + fh(te / 60) + '</b><span>' + fh(tp) + '</span><span class="pt-ec"><b class="' + hrCouleur(tpp ? ec : null) + '">' + (!tpp ? '—' : Math.abs(ec) < 0.01 ? '0 h' : relTxt(ec)) + '</b>' + (manq ? '<small class="ko">' + manq + ' jour' + (manq > 1 ? 's' : '') + ' sans pointage complet</small>' : '') + '</span></div>';
    });
    return h + '</div></div></section>';
  }
  function vPtEdit() {
    var E = S.ptEd, p = persById(E.eid) || {}, r = S.ptg.rows[E.eid + '|' + E.jour], t = function (ts) { if (!ts) return ''; var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
    return '<div class="pl-modal" role="dialog" aria-modal="true" aria-label="Corriger le pointage"><button class="pl-fond" data-act="ptedfermer" aria-label="Fermer"></button><div class="pl-fen">'
      + '<div class="pl-ft"><span class="a-av">' + esc((p.prenom || '?')[0]) + '</span><div><b>' + esc(p.prenom || '') + '</b><span class="mu">' + JOURS[jourSem(E.jour)] + ' ' + dateCourte(E.jour) + '</span></div><button class="h-rond gris" data-act="ptedfermer" aria-label="Fermer">' + ico('croix', 20, 2.4) + '</button></div>'
      + '<div class="h-g2"><label class="mu">Arrivée<input class="in" type="time" id="ptarr" value="' + t(r && r.arrivee) + '"></label><label class="mu">Sortie<input class="in" type="time" id="ptsor" value="' + t(r && r.sortie) + '"></label></div>'
      + '<label class="mu">Note (facultatif)<input class="in" id="ptnote" value="' + esc(r && r.note || '') + '" placeholder="Ex. : oubli de pointage, badge à 17 h 05"></label>'
      + '<label class="pt-ign"><input type="checkbox" id="ptign"' + (r && r.ignorer ? ' checked' : '') + '><span><b>Ne pas compter ce pointage</b><span class="mu">Le reliquat garde les heures prévues au planning pour cette journée. Le pointage reste visible et dans le journal.</span></span></label>'
      + (r && r.corrige_par ? '<p class="mu" style="margin:0">Corrigé par ' + esc(nomProfil(r.corrige_par)) + ' le ' + dateCourte(r.corrige_le) + ' à ' + hTs(r.corrige_le) + '.</p>' : '')
      + '<div class="h-cpied">' + (r ? '<button class="h-csup" data-act="ptsuppr">' + ico('poubelle', 18, 2) + 'Effacer le pointage</button>' : '<span></span>')
      + '<span class="row"><button class="btn l" data-act="ptedfermer">Annuler</button><button class="btn" data-act="ptsave">Enregistrer</button></span></div></div></div>';
  }
  function sauverPointage(supprimer) {
    var E = S.ptEd, cle = E.eid + '|' + E.jour, r = S.ptg.rows[cle];
    var ts = function (v) { if (!v) return null; var x = v.split(':'), d = dDe(E.jour); d.setHours(+x[0], +x[1], 0, 0); return d.toISOString(); };
    var q;
    if (supprimer) { if (!confirm('Effacer le pointage de cette journée ?')) return; q = sb.from('pointages').delete().eq('equipe_id', +E.eid).eq('jour', E.jour); }
    else {
      var a = $('ptarr').value, b = $('ptsor').value;
      if (b && !a) { toast('Indiquez l’heure d’arrivée'); return; }
      if (a && b && b <= a) { toast('La sortie doit être après l’arrivée'); return; }
      var ligne = { equipe_id: +E.eid, jour: E.jour, arrivee: ts(a), sortie: ts(b), note: $('ptnote').value.trim() || null, corrige_par: S.me.id, corrige_le: new Date().toISOString() };
      if ($('ptign').checked || (r && 'ignorer' in r)) ligne.ignorer = $('ptign').checked;
      q = sb.from('pointages').upsert(ligne, { onConflict: 'equipe_id,jour' });
    }
    q.then(function (x) { if (x.error) { if (/ignorer/.test(String(x.error.message))) throw new Error('La mise à jour 019 de la base n’est pas encore faite (case « Ne pas compter »)'); throw x.error; } S.ptEd = null; toast(supprimer ? 'Pointage effacé' : '✔ Pointage corrigé'); assurerPointages(S.ptg.de || E.jour, S.ptg.a || E.jour, true); }).catch(function (e) { toast(msgErr(e)); });
  }
  // QR code du centre : affichage, impression, régénération
  function basculerSimulation() {
    var v = !S.simOn;
    sb.from('parametres').upsert({ cle: 'simulation_pointage', valeur: v }, { onConflict: 'cle' }).then(function (r) { if (r.error) throw r.error; S.simOn = v; toast(v ? 'Simulation autorisée' : 'Simulation coupée'); render(); }).catch(function (e) { toast(msgErr(e)); render(); });
  }
  function chargerQR() {
    if (window.QRCodeEVY) return Promise.resolve();
    return new Promise(function (ok, ko) { var sc = document.createElement('script'); sc.src = 'js/vendor/qrcode.js?v=1'; sc.onload = ok; sc.onerror = function () { ko(new Error('Module QR code introuvable')); }; document.head.appendChild(sc); });
  }
  function urlPointage(j) { return location.origin + location.pathname + '?pointer=' + encodeURIComponent(j); }
  function qrSvg(texte, taille) {
    var q = window.QRCodeEVY(texte, 'M'), n = q.getModuleCount(), m = 4, t = n + 2 * m, d = '';
    for (var l = 0; l < n; l++) for (var c = 0; c < n; c++) if (q.isDark(l, c)) d += 'M' + (c + m) + ' ' + (l + m) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + ' ' + t + '" width="' + taille + '" height="' + taille + '" shape-rendering="crispEdges" role="img" aria-label="QR code de pointage"><rect width="' + t + '" height="' + t + '" fill="#fff"/><path d="' + d + '" fill="#1f2a33"/></svg>';
  }
  function ouvrirQR() {
    S.ptQR = { charge: true }; render();
    Promise.all([chargerQR(), sb.from('pointage_cle').select('*').eq('id', 1).maybeSingle()]).then(function (r) {
      if (r[1].error) throw r[1].error; S.ptQR = r[1].data || { err: 'Aucun QR code' }; render();
    }).catch(function (e) { S.ptQR = { err: msgErr(e) }; render(); });
  }
  function vQR() {
    var Q = S.ptQR, h = '<div class="pl-modal" role="dialog" aria-modal="true" aria-label="QR code de pointage"><button class="pl-fond" data-act="ptqrfermer" aria-label="Fermer"></button><div class="pl-fen pt-qrf">'
      + '<div class="pl-ft"><span class="a-av p">' + ico('qr', 20) + '</span><div><b>QR code de pointage</b><span class="mu">À afficher au centre</span></div><button class="h-rond gris" data-act="ptqrfermer" aria-label="Fermer">' + ico('croix', 20, 2.4) + '</button></div>';
    if (Q.charge) return h + '<p class="a-vide">Chargement…</p></div></div>';
    if (Q.err) return h + '<div class="ban warn">' + esc(Q.err) + '</div></div></div>';
    return h + '<div class="pt-qr">' + qrSvg(urlPointage(Q.jeton), 260) + '</div>'
      + '<p class="mu" style="margin:0;text-align:center">Les assistantes le scannent avec la tuile « Pointer » de l’application (ou l’appareil photo du téléphone), à l’arrivée puis à la sortie.</p><p class="pt-ref">Référence : <b>' + esc(refQR(Q)) + '</b> · créé le ' + dateCourte(Q.cree_le) + ' à ' + hTs(Q.cree_le) + '</p>'
      + '<div class="h-cpied"><button class="h-csup" data-act="ptregen">' + ico('refaire', 18, 2) + 'Régénérer</button><span class="row"><button class="btn" data-act="ptimprimer">' + ico('sortie', 18, 2) + 'Imprimer</button></span></div>'
      + '<p class="a-aide" style="margin:0">Régénérer crée un nouveau QR code : l’ancien ne fonctionne plus (à faire si une photo du QR code a circulé). Pensez à réimprimer l’affiche.</p></div></div>';
  }
  function refQR(Q) { return (Q.numero ? 'n° ' + Q.numero + ' · ' : '') + String(Q.jeton || '').slice(0, 6); }
  // Journal du pointage (fichier texte) : tous les événements d'une période, avec la référence du QR code
  var EVT_PT = { ARRIVEE: 'Arrivée', SORTIE: 'Sortie', DOUBLON: 'Doublon (ignoré)', QR_PERIME: 'QR périmé', NON_SOUMIS: 'Non soumis', SANS_FICHE: 'Compte non relié', SIMULATION_COUPEE: 'Simulation refusée', CORRECTION: 'Correction', EFFACEMENT: 'Effacement', QR_REGENERE: 'QR régénéré' };
  function vPtLog() {
    var E = S.ptLog, l = E.l;
    var h = '<div class="pl-modal" role="dialog" aria-modal="true" aria-label="Journal du pointage"><button class="pl-fond" data-act="ptlogfermer" aria-label="Fermer"></button><div class="pl-fen pt-logf">'
      + '<div class="pl-ft"><span class="a-av p">' + ico('histo', 20) + '</span><div><b>Journal du pointage</b><span class="mu">Tout ce qui s’est passé sur la période</span></div><button class="h-rond gris" data-act="ptlogfermer" aria-label="Fermer">' + ico('croix', 20, 2.4) + '</button></div>'
      + '<div class="pt-logbar"><label class="mu">Du<input class="in" type="date" id="ptlogdu" value="' + esc(E.du) + '"></label><label class="mu">Au<input class="in" type="date" id="ptlogau" value="' + esc(E.au) + '"></label>'
      + '<label class="mu">Personne<select class="in" id="ptlogqui"><option value="">Tout le monde</option>' + (S.equipe || []).filter(function (p) { return p.pointage || (l || []).some(function (x) { return String(x.equipe_id) === String(p.id); }); }).map(function (p) { return '<option value="' + p.id + '"' + (String(E.qui) === String(p.id) ? ' selected' : '') + '>' + esc(p.prenom) + '</option>'; }).join('') + '</select></label>'
      + '<button class="a-btn blanc" data-act="ptlogok"' + (!l ? ' disabled' : '') + '>' + ico('sortie', 18, 2) + 'Télécharger (.txt)</button></div>';
    if (E.err) return h + '<div class="ban warn">' + esc(E.err) + '</div></div></div>';
    if (!l) return h + '<p class="a-vide">Chargement…</p></div></div>';
    var v = journalFiltre(), Q = E.q;
    h += '<p class="mu" style="margin:0">' + v.length + ' ' + pl(v.length, 'événement') + (Q ? ' · QR code en service : <b>' + esc(refQR(Q)) + '</b>' : '') + '</p>';
    if (!v.length) return h + '<p class="a-vide">Aucun événement sur cette période.</p></div></div>';
    h += '<div class="pt-logt"><table><thead><tr><th>Date et heure</th><th>Événement</th><th>Personne</th><th>Compte utilisé</th><th>Jour</th><th>Heure pointée</th><th>QR code</th><th>Détail</th></tr></thead><tbody>'
      + v.map(function (x) {
        var p = x.equipe_id ? persById(x.equipe_id) : null, k = /^(ARRIVEE|SORTIE)$/.test(x.evenement) ? 'ok' : /^(CORRECTION|EFFACEMENT|QR_REGENERE|DOUBLON)$/.test(x.evenement) ? 'neutre' : 'ko';
        return '<tr><td>' + esc(jlDate(x.quand)) + '</td><td><span class="pt-ev ' + k + '">' + esc(EVT_PT[x.evenement] || x.evenement) + '</span></td><td>' + esc(p ? p.prenom : '') + '</td><td>' + esc(jlProfil(x.profil_id)) + '</td><td>' + esc(jlJour(x.jour)) + '</td><td>' + (x.heure_pt ? esc(jlH(x.heure_pt)) + (x.simule ? ' <small>(simulée)</small>' : '') : '') + '</td><td>' + esc(x.qr_ref || '') + '</td><td>' + esc(x.detail || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return h + '</div></div>';
  }
  function jlDate(ts) { var d = new Date(ts); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  function jlH(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function jlJour(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function jlProfil(id) { var p = (S.profils || []).filter(function (x) { return x.id === id; })[0]; return p ? p.nom + ' (' + p.identifiant + ')' : id ? 'compte ' + String(id).slice(0, 8) : ''; }
  function journalFiltre() { var E = S.ptLog; return (E.l || []).filter(function (x) { return !E.qui || String(x.equipe_id) === String(E.qui); }); }
  function chargerJournalPt() {
    var E = S.ptLog; if (!E.du || !E.au || E.au < E.du) { toast('Choisissez une période valide'); return; }
    E.l = null; E.err = null; render();
    var debut = dDe(E.du).toISOString(), fin = dDe(addJ(E.au, 1)).toISOString(), cle = E.du + E.au; E.cle = cle;
    Promise.all([
      toutLire('pointage_journal', '*', function (q) { return q.gte('jour', E.du).lte('jour', E.au); }),
      toutLire('pointage_journal', '*', function (q) { return q.is('jour', null).gte('quand', debut).lt('quand', fin); }),
      sb.from('pointage_cle').select('*').eq('id', 1).maybeSingle()
    ]).then(function (r) {
      if (!S.ptLog || S.ptLog.cle !== cle) return;
      var vus = {}; E.l = r[0].concat(r[1]).filter(function (x) { if (vus[x.id]) return false; vus[x.id] = 1; return true; }).sort(function (a, b) { return a.quand < b.quand ? -1 : a.quand > b.quand ? 1 : a.id - b.id; });
      E.q = r[2] && r[2].data; render();
    }).catch(function (e) { if (!S.ptLog) return; E.err = /pointage_journal/.test(String(e && e.message)) ? 'La mise à jour 018 de la base n’est pas encore faite.' : msgErr(e); render(); });
  }
  function exporterJournalPt() {
    var E = S.ptLog, l = journalFiltre(), Q = E.q, mtn = new Date();
    var col = function (t, n) { t = String(t == null ? '' : t); return t.length >= n ? t.slice(0, n - 1) + ' ' : t + new Array(n - t.length + 1).join(' '); };
    var qui = E.qui ? persById(E.qui) : null;
    var tete = ['JOURNAL DU POINTAGE — Espace dentaire Val d’Yerres' + (CONFIG.env === 'dev' ? ' — SITE DE TEST' : ''),
      'Période : du ' + jlJour(E.du) + ' au ' + jlJour(E.au) + (qui ? ' · ' + qui.prenom : ''),
      'Exporté le ' + jlDate(mtn.toISOString()) + ' par ' + S.me.nom,
      'QR code en service : ' + (Q ? refQR(Q) + ' (créé le ' + jlDate(Q.cree_le) + ')' : '—'),
      'Événements : ' + l.length,
      'Heures en heure de Paris. « Pointée » = heure enregistrée (différente de l’heure réelle si simulée).',
      new Array(150).join('-'),
      col('DATE ET HEURE', 21) + col('ÉVÉNEMENT', 20) + col('PERSONNE', 14) + col('COMPTE UTILISÉ', 26) + col('JOUR', 12) + col('POINTÉE', 16) + col('QR CODE', 20) + 'DÉTAIL',
      new Array(150).join('-')];
    var lignes = l.map(function (x) {
      var p = x.equipe_id ? persById(x.equipe_id) : null;
      return col(jlDate(x.quand), 21) + col(EVT_PT[x.evenement] || x.evenement, 20) + col(p ? p.prenom : x.equipe_id ? '#' + x.equipe_id : '', 14) + col(jlProfil(x.profil_id), 26) + col(jlJour(x.jour), 12)
        + col(x.heure_pt ? jlH(x.heure_pt) + (x.simule ? ' (simulée)' : '') : '', 16) + col(x.qr_ref || '', 20) + (x.detail || '');
    });
    var txt = '﻿' + tete.concat(lignes.length ? lignes : ['(aucun événement sur cette période)']).join('\r\n') + '\r\n';
    telecharger(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'journal-pointage-' + E.du + '-au-' + E.au + (qui ? '-' + norm(qui.prenom) : '') + (CONFIG.env === 'dev' ? '-TEST' : '') + '.txt');
    toast('✔ Journal téléchargé (' + l.length + ' ' + pl(l.length, 'événement') + ')');
  }
  function imprimerQR() {
    var Q = S.ptQR; if (!Q || !Q.jeton) return;
    var w = window.open('', '_blank'); if (!w) { toast('Autorisez l’ouverture de fenêtres pour imprimer'); return; }
    w.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>QR code de pointage</title><style>body{margin:0;font-family:"Source Sans 3",system-ui,sans-serif;color:#1f2a33;display:flex;justify-content:center}main{width:170mm;text-align:center;padding:18mm 0}h1{font-family:Georgia,serif;font-size:30pt;margin:0 0 4mm;color:#2b3e4c}p{font-size:15pt;margin:3mm 0}svg{width:120mm;height:120mm;margin:8mm auto;display:block}small{color:#555f68;font-size:10pt}</style></head><body><main><h1>Pointage</h1><p><b>Espace dentaire Val d’Yerres</b></p>'
      + qrSvg(urlPointage(Q.jeton), 400) + '<p>Scannez avec l’appareil photo de votre téléphone<br><b>en arrivant</b> et <b>en partant</b>.</p><small>Réf. ' + esc(refQR(Q)) + ' · QR code du ' + dateCourte(Q.cree_le) + '</small></main><script>setTimeout(function(){print()},300)<\/script></body></html>');
    w.document.close();
  }
  function regenererQR() {
    if (!confirm('Créer un nouveau QR code ? L’ancien ne fonctionnera plus : il faudra réimprimer l’affiche.')) return;
    sb.rpc('regenerer_qr').then(function (r) { if (r.error) throw r.error; toast('✔ Nouveau QR code créé'); ouvrirQR(); }).catch(function (e) { toast(msgErr(e)); });
  }
  function celluleJour(p, iso) {
    var am = caseEff(p, iso, 'AM'), pm = caseEff(p, iso, 'PM'), ab = function (c) { return ABS.indexOf(c.a) >= 0; };
    var cls = 'pl-c', h;
    if (am.a === pm.a && (ab(am) || am.a === 'OFF')) { cls += am.a === 'OFF' ? ' off' : ' abs'; h = '<b>' + (am.a === 'OFF' && (am.off || pm.off) ? 'Jour off' : nomAff(am.a)) + '</b>'; }
    else if (am.a === pm.a) { cls += ' on'; h = '<b>' + esc(nomAff(am.a)) + '</b><span>' + ft(am.de) + '–' + ft(am.fi) + ' · ' + ft(pm.de) + '–' + ft(pm.fi) + '</span>'; }
    else {
      var demi = function (c) { return '<span class="pl-d' + (ab(c) ? ' abs' : c.a === 'OFF' ? ' off' : '') + '"><b>' + (c.off ? 'Off' : esc(nomAff(c.a))) + '</b>' + (c.de ? ' ' + ft(c.de) + '–' + ft(c.fi) : '') + '</span>'; };
      cls += ' mix'; h = demi(am) + demi(pm);
    }
    var rg = am.r || pm.r, dpt = pm.a && pm.a.slice(0, 2) === 'D:' ? dentById(pm.a.slice(2)) : null, hd = dpt && dpt.jours && dpt.jours[jourSem(iso)];
    if (typeof hd === 'string' && hd) h += '<small class="pl-r dep">Dr ' + esc(dpt.prenom) + ' part à ' + ft(hd) + '</small>';
    if (rg) { cls += ' reg'; h += '<small class="pl-r">' + esc(affTxt(rg)) + ' absent</small>'; }
    return '<button class="' + cls + '" data-plc="' + p.id + '|' + iso + '" aria-label="' + esc(p.prenom) + ', ' + JOURS[jourSem(iso)] + '">' + h + '</button>';
  }
  // Dentistes présents qui travaillent sans assistante ce jour-là (journée entière, matin ou après-midi)
  function dentistesSeuls(iso) {
    var ps = persPlanning(), j = jourSem(iso), pres = (S.dentistes || []).filter(function (d) { return dentPresent(d, iso); }).sort(function (a, b) { return a.ordre - b.ordre; });
    var seuls = [];
    pres.forEach(function (d) {
      var cle = 'D:' + d.id, am = ps.some(function (p) { return caseEff(p, iso, 'AM').a === cle; }), pm = ps.some(function (p) { return caseEff(p, iso, 'PM').a === cle; });
      if (!am || !pm) seuls.push({ d: d, quand: !am && !pm ? '' : !am ? 'matin' : 'après-midi' });
    });
    return { pres: pres.length, seuls: seuls };
  }
  function celluleSeuls(iso) {
    if (ferie(iso)) return '<div class="pl-seul vide"><span>Férié</span></div>';
    var x = dentistesSeuls(iso);
    if (!x.pres) return '<div class="pl-seul vide"><span>Aucun dentiste</span></div>';
    if (!x.seuls.length) return '<div class="pl-seul ok"><b>Aucun</b><span>' + x.pres + ' ' + pl(x.pres, 'présent') + ' · tous assistés</span></div>';
    return '<div class="pl-seul"><b>' + x.seuls.length + ' ' + (x.seuls.length > 1 ? 'seuls' : 'seul') + '</b>' + x.seuls.map(function (s2) { return '<span>Dr ' + esc(s2.d.prenom) + (s2.quand ? ' (' + s2.quand + ')' : '') + '</span>'; }).join('') + '<small>' + x.pres + ' ' + pl(x.pres, 'présent') + '</small></div>';
  }
  function vPlanning() {
    if (!S.pl || (!S.pl.de && !S.pl.charge && !S.pl.err)) { chargerSemaine(); if (!S.pl.rows || !S.pl.de) return '<div class="a-corps"><p class="a-vide">Chargement…</p></div>'; }
    var P = S.pl, L = P.lundi, ps = persPlanning(), auj = dIso(new Date());
    assurerPointages(lundiDe(regles().depuis || L), addJ(L, 6));
    var fin = addJ(L, 4), titre = 'Semaine du ' + periode(L, fin).replace(/^du /, '');
    var h = '<header class="a-hd fixe pl-hd"><div class="a-hd-row"><button class="a-back" data-tab="hub">' + ico('prec', 22, 2.4) + 'Accueil</button><h1>Planning</h1>'
      + '<span class="pl-hbtns"><button class="pl-imp" data-tab="heures">' + ico('graph', 18, 2.2) + '<span class="m-hide">Heures</span></button><button class="pl-imp" data-act="plexp">' + ico('sortie', 18) + '<span class="m-hide">Exporter</span></button><label class="pl-imp">' + ico('boite', 18) + '<span class="m-hide">Importer l’Excel</span><input type="file" id="plimpf" accept=".xlsm,.xlsx" hidden></label></span></div>'
      + '<div class="pl-nav"><span class="pl-g"></span><button class="h-rond" data-plsem="-7" aria-label="Semaine précédente">' + ico('prec', 20, 2.4) + '</button>' + titreCal(titre, L) + '<button class="h-rond" data-plsem="7" aria-label="Semaine suivante">' + ico('suiv', 20, 2.4) + '</button>'
      + '<span class="pl-g d">' + (lundiDe(auj) !== L ? '<button class="pl-auj" data-plsem="0">Cette semaine</button>' : '') + '</span></div></header>';
    h += '<div class="a-corps pl-corps">';
    if (!planPret()) return h + '<div class="ban warn">Les mises à jour 009 à 011 de la base ne sont pas encore faites.</div></div>';
    if (S.plImp) h += vImportPlanning();
    if (P.charge) h += '<p class="mu">Chargement…</p>';
    h += '<div class="pl-scroll"><div class="pl-grille"><div class="pl-tete pl-nom">Assistantes</div>';
    for (var k = 0; k < 5; k++) { var iso = addJ(L, k), fe = ferie(iso); h += '<div class="pl-tete' + (iso === auj ? ' auj' : '') + '"><b>' + JOURS[k + 1] + '</b><span>' + dateCourte(iso) + (fe ? ' · <em>' + fe + '</em>' : '') + '</span></div>'; }
    h += '<div class="pl-tete pl-h"><b>Heures</b><span>semaine · reliquat</span></div>';
    ps.forEach(function (p) {
      h += '<div class="pl-nom"><span class="a-av p">' + initiale(p.prenom) + '</span><span><b>' + esc(p.prenom) + '</b><small>' + (p.type === 'interimaire' ? 'intérimaire' : (p.statut === 'apprentie' ? 'apprentie · ' : '') + fh(+p.contrat_h || 0)) + '</small></span></div>';
      for (var k2 = 0; k2 < 5; k2++) h += celluleJour(p, addJ(L, k2));
      var hs = heuresSem(p, L), c = +p.contrat_h || 0;
      if (!c) h += '<div class="pl-h"><span><b>' + fh(hs) + '</b></span></div>';
      else {
        var r = reliquatAvant(p, L) + hs - c;
        h += '<div class="pl-h"><span><b>' + fh(hs) + '</b> / ' + fh(c) + '</span>' + (Math.abs(r) < 0.01 ? '<span class="ok">à jour</span>' : r < 0 ? '<span class="moins">' + relTxt(r) + ' · à rattraper</span>' : '<span class="plus">' + relTxt(r) + ' · à alléger</span>') + '</div>';
      }
    });
    h += '<div class="pl-nom pl-seul-t"><span class="a-av d">' + ico('dent', 16) + '</span><span><b>Dentistes seuls</b><small>sans assistante</small></span></div>';
    for (var k3 = 0; k3 < 5; k3++) h += celluleSeuls(addJ(L, k3));
    h += '<div class="pl-h"></div>';
    h += '</div></div>';
    h += '<div class="pl-notes"><span class="pl-n vert"><b>Semaine remplie automatiquement</b> d’après les fiches (semaine type, école, congés acceptés, jours fériés, règle d’or) : corrigez seulement les exceptions.</span>'
      + '<span class="pl-n">Touchez une case pour choisir le dentiste et les heures. Reliquat : heures faites moins heures du contrat, cumulées depuis le ' + dateCourte(regles().depuis) + ' (Réglages › Règles des heures).</span></div>';
    return h + '</div>' + (P.cas ? vCasePlanning() : '') + (S.plExp ? vExportPlanning() : '');
  }

  // Fenêtre d'une case (une personne, un jour)
  function optAffPl(cur, sansDent) {
    return optAff(cur, sansDent).replace('<optgroup label="Autres">', '<optgroup label="Absences">' + ['CP', 'ARRET', 'FORMATION', 'FERIE'].map(function (a) { return '<option value="' + a + '"' + (cur === a ? ' selected' : '') + '>' + ABS_TXT[a] + '</option>'; }).join('') + '</optgroup><optgroup label="Autres">');
  }
  function ouvrirCase(v) {
    var x = v.split('|'), p = persById(x[0]); if (!p) return;
    var am = caseEff(p, x[1], 'AM'), pm = caseEff(p, x[1], 'PM');
    S.pl.cas = { eid: p.id, jour: x[1], r: am.r || pm.r || null, jc: am.a === pm.a, AM: { a: am.a, de: am.de, fi: am.fi, h: am.h != null ? am.h : null }, PM: { a: pm.a, de: pm.de, fi: pm.fi, h: pm.h != null ? pm.h : null }, enreg: !!(S.pl.rows[cleCase(p.id, x[1], 'AM')] || S.pl.rows[cleCase(p.id, x[1], 'PM')]) };
    render();
  }
  function vCasePlanning() {
    var K = S.pl.cas, p = persById(K.eid), iso = K.jour; if (!p) return '';
    // Interrupteur « Journée complète » : un seul choix pour le matin et l'après-midi (horaires gardés par demi-journée)
    var abs = function (c) { return ABS.indexOf(c.a) >= 0; };
    var champH = function (cle, val, regle, lib) {
      return '<span class="h-hh pl-hh"><label class="mu">' + lib + '<span class="h-hval"><input class="in" inputmode="text" data-plk="' + cle + '" value="' + esc(hIn(val)) + '" placeholder="' + hIn(regle) + '" aria-label="' + lib + ' (ex. 3h30)"></span></label><small class="mu">vide = règle (' + fh(regle) + ')</small></span>';
    };
    var dem = function (d) {
      var c = K[d], off = !c.a || c.a === 'OFF' || ABS.indexOf(c.a) >= 0;
      if (abs(c) && !K.jc) return '<div class="pl-cd"><span class="h-dl">' + (d === 'AM' ? 'Matin' : 'Après-midi') + '</span><select class="in" data-plk="' + d + '.a">' + optAffPl(c.a, !aDent(p.type)) + '</select>' + champH(d + '.h', c.h, heuresRegle(p, iso, d, c.a), 'Heures comptées') + '</div>';
      if (abs(c) && K.jc) return '';
      return '<div class="pl-cd"><span class="h-dl">' + (d === 'AM' ? 'Matin' : 'Après-midi') + '</span>' + (K.jc ? '' : '<select class="in" data-plk="' + d + '.a">' + optAffPl(c.a, !aDent(p.type)) + '</select>')
        + '<span class="h-hh"><input class="in" type="time" data-plk="' + d + '.de" value="' + esc(off ? '' : c.de || '') + '"' + (off ? ' disabled' : '') + ' aria-label="Arrivée"><span>–</span><input class="in" type="time" data-plk="' + d + '.fi" value="' + esc(off ? '' : c.fi || '') + '"' + (off ? ' disabled' : '') + ' aria-label="Départ"></span></div>';
    };
    var hj = heuresDemi(p, iso, 'AM', K.AM) + heuresDemi(p, iso, 'PM', K.PM);
    var L = lundiDe(iso), avant = 0; for (var k = 0; k < 5; k++) { var d2 = addJ(L, k); avant += d2 === iso ? hj : heuresJ(p, d2); }
    var c = +p.contrat_h || 0, relA = c ? reliquatAvant(p, L) : 0, relB = relA + avant - c;
    var fe = ferie(iso);
    return '<div class="pl-modal" role="dialog" aria-modal="true" aria-label="' + esc(p.prenom) + '"><button class="pl-fond" data-act="plfermer" aria-label="Fermer"></button><div class="pl-fen">'
      + '<div class="pl-ft"><span class="a-av p">' + initiale(p.prenom) + '</span><div><b>' + esc(p.prenom) + '</b><span class="mu">' + JOURS[jourSem(iso)] + ' ' + dateCourte(iso) + (fe ? ' · ' + fe : '') + '</span></div><button class="h-rond gris" data-act="plfermer" aria-label="Fermer">' + ico('croix', 20, 2.4) + '</button></div>'
      + (K.r ? '<p class="pl-regle"><b>Règle d’or :</b> ' + esc(affTxt(K.r)) + ' est absent ce jour-là ; proposition : ' + esc(nomAff(K.AM.a)) + (K.PM.a !== K.AM.a ? ' / ' + esc(nomAff(K.PM.a)) : '') + '. Enregistrez pour confirmer ou changez.</p>' : '')
      + (p.consigne ? '<p class="pl-consigne"><b>Consigne :</b> « ' + esc(p.consigne) + ' »</p>' : '')
      + '<label class="pl-jc"><span><b>Journée complète</b><small>même dentiste ou poste le matin et l’après-midi</small></span><input type="checkbox" role="switch" class="h-sw" data-pljc="1"' + (K.jc ? ' checked' : '') + ' aria-label="Journée complète"></label>'
      + (K.jc ? '<div class="pl-cd"><span class="h-dl">Journée</span><select class="in" data-plk="J.a">' + optAffPl(K.AM.a, !aDent(p.type)) + '</select>'
        + (abs(K.AM) && K.AM.a === K.PM.a ? champH('J.h', K.AM.h != null && K.AM.h !== '' || K.PM.h != null && K.PM.h !== '' ? (+K.AM.h || 0) + (+K.PM.h || 0) : null, heuresRegle(p, iso, 'AM', K.AM.a) + heuresRegle(p, iso, 'PM', K.AM.a), 'Heures comptées pour la journée') : '') + '</div>' : '')
      + dem('AM') + dem('PM')
      + '<div class="pl-vite"><span class="mu">Toute la journée :</span>' + ['CP', 'ARRET', 'ECOLE', 'FORMATION'].map(function (a) { return '<button data-plabs="' + a + '">' + ABS_TXT[a] + '</button>'; }).join('') + '</div>'
      + '<div class="pl-tot"><span>Heures ce jour</span><b>' + fh(hj) + '</b></div>'
      + (c ? '<div class="pl-rel"><div><span>Semaine de ' + esc(p.prenom) + '</span><b>' + fh(avant) + ' / ' + fh(c) + '</b></div><div><span>Reliquat des semaines précédentes</span><b>' + relTxt(relA) + '</b></div><div><span>Reliquat après cette semaine</span><b class="' + (relB < -0.01 ? 'moins' : relB > 0.01 ? 'plus' : 'ok') + '">' + relTxt(relB) + (relB < -0.01 ? ' · à rattraper' : relB > 0.01 ? ' · à alléger' : ' · à jour') + '</b></div></div>' : '')
      + '<div class="pl-btns"><button class="a-btn blanc" data-act="plreset"' + (K.enreg ? '' : ' disabled') + '>Semaine type</button><button class="a-btn navy" data-act="plsave"' + (K.busy ? ' disabled' : '') + '>' + (K.busy ? 'Enregistrement…' : 'Enregistrer') + '</button></div>'
      + '</div></div>';
  }
  function majCase(el) {
    var K = S.pl.cas, x = el.dataset.plk.split('.');
    if (x[0] === 'J' && x[1] === 'h') { var vh = hLire(el.value); ['AM', 'PM'].forEach(function (d) { K[d].h = vh == null ? null : vh / 2; }); return; }
    if (x[0] === 'J') { ['AM', 'PM'].forEach(function (d) { majCase({ value: el.value, dataset: { plk: d + '.a' } }); }); return; }
    var c = K[x[0]];
    if (x[1] === 'h') { c.h = hLire(el.value); return; }
    c[x[1]] = el.value || null;
    if (x[1] === 'a') c.h = null;
    if (x[1] === 'a') {
      if (!el.value || el.value === 'OFF' || ABS.indexOf(el.value) >= 0) { c.de = null; c.fi = null; }
      else if (!c.de) { var p = persById(K.eid), t = (((p.trame || {})[jourSem(K.jour)] || {})[x[0] === 'AM' ? 'am' : 'pm']) || {}; c.de = t.de || (x[0] === 'AM' ? '09:00' : '14:00'); c.fi = t.fi || (x[0] === 'AM' ? '13:00' : '19:00'); }
    }
  }
  function sauverCase() {
    var K = S.pl.cas;
    var rows = ['AM', 'PM'].map(function (d) { var c = K[d]; return { equipe_id: K.eid, jour: K.jour, demi: d, aff: c.a || 'OFF', debut: c.de || null, fin: c.fi || null, heures: ABS.indexOf(c.a) >= 0 && c.h != null && c.h !== '' ? +c.h : null, modifie_par: S.me.id, modifie_le: new Date().toISOString() }; });
    K.busy = true; render();
    sb.from('planning').upsert(rows, { onConflict: 'equipe_id,jour,demi' }).then(function (r) {
      if (r.error) throw r.error;
      rows.forEach(function (x) { S.pl.rows[cleCase(x.equipe_id, x.jour, x.demi)] = x; });
      S.pl.cas = null; toast('✔ Case enregistrée'); render();
    }).catch(function (e) { K.busy = false; toast(msgErr(e)); render(); });
  }
  function caseSemaineType() {
    var K = S.pl.cas;
    if (!confirm('Revenir à la semaine type pour ce jour ? La saisie de ce jour sera effacée.')) return;
    sb.from('planning').delete().eq('equipe_id', K.eid).eq('jour', K.jour).then(function (r) {
      if (r.error) throw r.error;
      delete S.pl.rows[cleCase(K.eid, K.jour, 'AM')]; delete S.pl.rows[cleCase(K.eid, K.jour, 'PM')];
      S.pl.cas = null; toast('Jour remis selon la semaine type'); render();
    }).catch(function (e) { toast(msgErr(e)); });
  }

  // Import de l'Excel du planning (feuilles mensuelles : lignes « AD » avec les dates, matin / après-midi + horaires)
  var MOIS_N = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  var JOUR_N = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
  var CODE_XL = { off: 'OFF', ecole: 'ECOLE', cp: 'CP', conges: 'CP', arret: 'ARRET', maladie: 'ARRET', admin: 'ADMIN', ste: 'STE', acceuil: 'ACCUEIL', accueil: 'ACCUEIL', adminortho: 'ADMIN_ORTHO', rangement: 'RANGEMENT', nettoyagecab: 'NETTOYAGE', nettoyage: 'NETTOYAGE', formation: 'FORMATION', ferie: 'FERIE' };
  function cle(s) { return norm(String(s == null ? '' : s)).replace(/[^a-z0-9]/g, ''); }
  function dateXl(s) {
    var m = /^\s*(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+([a-zéèûôç]+)\s+(\d{4})/i.exec(norm(String(s || '')));
    if (!m) return null;
    var mo = MOIS_N[cle(m[3])]; if (!mo) return null;
    var d = new Date(+m[4], mo - 1, +m[2]);
    if (d.getMonth() !== mo - 1 || d.getDay() !== JOUR_N[m[1]] || d.getDay() < 1 || d.getDay() > 5) return null;
    return dIso(d);
  }
  function heureXl(v) {
    if (typeof v !== 'number' || !(v > 0) || v >= 1) return null;
    var m = Math.round(v * 1440); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  }
  // ---------- Export du planning par mois, sur la matrice Excel du centre ----------
  // Une feuille par mois choisi ; un bloc « AD » par semaine (comme le planning Excel) : matin / après-midi colorés
  // par dentiste ou poste, horaires dessous, heures de la semaine à droite (pas de reliquat). Le fichier se réimporte.
  var COUL_XL = { joao: 'F2AA84', angela: 'EEEB5E', jordan: 'FFC000', jeremy: 'B4E5A2', sacha: 'B6F8E8', eyal: ['084F6B', 'FFFFFF'], bruno: '4E95D9', nathan: 'D86ECC', david: 'A6CAEC', johanna: 'A9CBAB', katia: 'DF9999', anastasia: 'F7AFF5',
    STE: 'C04F15', ADMIN: 'DCEAF7', ADMIN_ORTHO: 'DCEAF7', ACCUEIL: 'CAEEFB', RANGEMENT: 'E2EFDA', NETTOYAGE: 'E2EFDA', ECOLE: 'C9A4E4', FORMATION: 'FF9B9B', CP: ['0070C0', 'FFFFFF'], ARRET: ['595959', 'FFFFFF'], OFF: ['595959', 'FFFFFF'], FERIE: ['595959', 'FFFFFF'] };
  var COUL_AUTRES = ['F6ACC8', 'C6E0B4', 'FFE699', 'BDD7EE', 'F8CBAD', 'D9D2E9'];
  var TXT_XL = { ADMIN: 'ADMIN', STE: 'STE', ACCUEIL: 'ACCUEIL', ADMIN_ORTHO: 'ADMIN ORTHO', RANGEMENT: 'RANGEMENT', NETTOYAGE: 'NETTOYAGE CAB', ECOLE: 'ECOLE', OFF: 'OFF', CP: 'CP', ARRET: 'ARRET', FORMATION: 'FORMATION', FERIE: 'FERIE' };
  var MOIS_XL = ['JANV', 'FEV', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUIL', 'AOUT', 'SEPT', 'OCT', 'NOV', 'DEC'];
  function majSansAccent(t) { return norm(String(t || '')).toUpperCase(); }
  function xlAff(a) { if (a && a.slice(0, 2) === 'D:') { var d = dentById(a.slice(2)); return d ? majSansAccent(d.prenom) : '?'; } var ps = posteDe(a); if (ps) return majSansAccent(ps.xl || ps.n); return TXT_XL[a] || a || 'OFF'; }
  function posteXL(k) { var ps = postes().filter(function (x) { return cle(x.xl || '') === k || cle(x.n) === k; })[0]; return ps ? ps.code : null; }
  function xlCoul(a) {
    var c = null;
    if (a && a.slice(0, 2) === 'D:') { var d = dentById(a.slice(2)); c = d && COUL_XL[cle(d.prenom)]; if (!c && d) c = COUL_AUTRES[(d.ordre || d.id) % COUL_AUTRES.length]; }
    else { var ps = posteDe(a); c = ps && ps.coul ? ps.coul : COUL_XL[a || 'OFF']; }
    return Array.isArray(c) ? { fond: c[0], coul: c[1] } : { fond: c || 'FFFFFF' };
  }
  function moisPropose() {   // de novembre 2026 (départ du planning) à 6 mois après aujourd'hui
    var l = [], t = new Date(), d = new Date(2026, 10, 1), fin = new Date(t.getFullYear(), t.getMonth() + 6, 1);
    var dep = dDe(regles().depuis || '2026-11-02'); if (dep < d) d = new Date(dep.getFullYear(), dep.getMonth(), 1);
    for (; d <= fin && l.length < 36; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) l.push(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2));
    return l;
  }
  function nomMois(m) { var x = m.split('-'); return MOIS[+x[1] - 1] + ' ' + x[0]; }
  function semainesDuMois(m) {
    var x = m.split('-'), d1 = x[0] + '-' + x[1] + '-01', dn = dIso(new Date(+x[0], +x[1], 0)), l = [];
    for (var L = lundiDe(d1); L <= dn; L = addJ(L, 7)) if (addJ(L, 4) >= d1) l.push(L);
    return l;
  }
  function vExportPlanning() {
    var E = S.plExp, ms = moisPropose();
    return '<div class="pl-modal" role="dialog" aria-modal="true" aria-label="Exporter le planning"><button class="pl-fond" data-act="plexpfermer" aria-label="Fermer"></button><div class="pl-fen">'
      + '<div class="pl-ft"><span class="a-av p">' + ico('sortie', 20) + '</span><div><b>Exporter le planning</b><span class="mu">Fichier Excel sur la matrice du centre</span></div><button class="h-rond gris" data-act="plexpfermer" aria-label="Fermer">' + ico('croix', 20, 2.4) + '</button></div>'
      + '<p class="mu" style="margin:0">Choisissez un ou plusieurs mois. Chaque mois est une feuille, avec une semaine par bloc (matin et après-midi, horaires, heures de la semaine).</p>'
      + '<div class="pl-mois">' + ms.map(function (m) { var on = E.mois.indexOf(m) >= 0; return '<button type="button" class="h-ex-j pl-mo' + (on ? ' on' : '') + '" data-plmois="' + m + '" aria-pressed="' + on + '">' + nomMois(m).replace(/^./, function (c) { return c.toUpperCase(); }) + '</button>'; }).join('') + '</div>'
      + '<div class="pl-btns"><button class="a-btn blanc" data-act="plexpfermer">Annuler</button><button class="a-btn navy" data-act="plexpok"' + (E.busy || !E.mois.length ? ' disabled' : '') + '>' + (E.busy ? 'Préparation…' : 'Exporter' + (E.mois.length > 1 ? ' (' + E.mois.length + ' mois)' : '')) + '</button></div>'
      + '</div></div>';
  }
  function exporterPlanning() {
    var E = S.plExp, mois = E.mois.slice().sort(); if (!mois.length) return;
    var sems = {}; mois.forEach(function (m) { semainesDuMois(m).forEach(function (L) { sems[L] = 1; }); });
    var Ls = Object.keys(sems).sort(), de = [lundiDe(regles().depuis || Ls[0]), Ls[0]].sort()[0], a = addJ(Ls[Ls.length - 1], 4);
    E.busy = true; render();
    toutLire('planning', '*', function (q) { return q.gte('jour', de).lte('jour', a).order('jour'); }).then(function (rows) {
      var P = S.pl; rows.forEach(function (r) { P.rows[cleCase(r.equipe_id, String(r.jour).slice(0, 10), r.demi)] = r; });
      JOUR_CACHE = {};
      return XLSX_EVY.creerMiseEnForme(mois.map(feuilleMois));
    }).then(function (blob) {
      telecharger(blob, nomFichier(norm('planning-' + nomMois(mois[0]) + (mois.length > 1 ? '-a-' + nomMois(mois[mois.length - 1]) : '')).replace(/ /g, '-')));
      S.plExp = null; toast('✔ Planning exporté'); render();
    }).catch(function (e) { E.busy = false; toast(msgErr(e)); render(); });
  }
  function feuilleMois(m) {
    var cases = [], fus = [], haut = {}, r = 0, ps = persPlanning(), x = m.split('-');
    var B = { bord: 'fin' }, put = function (rr, c, v, st) { cases.push({ r: rr, c: c, v: v, st: st }); };
    var colL = function (c) { var s2 = ''; c++; while (c > 0) { var k = (c - 1) % 26; s2 = String.fromCharCode(65 + k) + s2; c = Math.floor((c - 1) / 26); } return s2; };
    var fz = function (r1, c1, r2, c2) { fus.push(colL(c1) + (r1 + 1) + ':' + colL(c2) + (r2 + 1)); };
    var titre = 'PLANNING ASSISTANTES DENTAIRE ' + MOIS_XL[+x[1] - 1] + ' ' + x[0];
    put(0, 1, titre, { gras: true, taille: 18, ali: 'left' }); haut[0] = 34; r = 2;
    semainesDuMois(m).forEach(function (L) {
      // En-tête de la semaine : AD + les 5 dates (4 colonnes chacune), puis AM / PM
      put(r, 0, 'AD', { gras: true, bord: 'moyen' });
      for (var k = 0; k < 5; k++) {
        var iso = addJ(L, k), fe = ferie(iso), dd = dDe(iso), txt = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'][k + 1] + ' ' + dd.getDate() + ' ' + MOIS[dd.getMonth()] + ' ' + dd.getFullYear();
        var hors = iso.slice(0, 7) !== m;
        for (var c = 0; c < 4; c++) put(r, 1 + 4 * k + c, c ? null : txt + (fe ? ' (' + fe + ')' : ''), { gras: true, bord: 'moyen', fond: hors ? 'EDEDED' : 'FFFFFF', coul: hors ? '7F7F7F' : null });
        fz(r, 1 + 4 * k, r, 4 + 4 * k);
        ['AM', 'PM'].forEach(function (dm, j) { put(r + 1, 1 + 4 * k + 2 * j, dm, B); put(r + 1, 2 + 4 * k + 2 * j, null, B); fz(r + 1, 1 + 4 * k + 2 * j, r + 1, 2 + 4 * k + 2 * j); });
      }
      put(r, 21, 'HEURES HEBDO', { gras: true, bord: 'moyen', retour: true });
      put(r + 1, 0, null, B); put(r + 1, 21, 'semaine / contrat', { bord: 'fin', taille: 9, coul: '595959' });
      haut[r] = 20; r += 2;
      ps.forEach(function (p) {
        put(r, 0, p.type === 'interimaire' ? 'INTERIMAIRE' : majSansAccent(p.prenom), { gras: true, bord: 'moyen' }); put(r + 1, 0, null, { bord: 'moyen' }); fz(r, 0, r + 1, 0);
        for (var k = 0; k < 5; k++) {
          var iso = addJ(L, k);
          ['AM', 'PM'].forEach(function (dm, j) {
            var cz = caseEff(p, iso, dm), a = cz.a || 'OFF', col0 = 1 + 4 * k + 2 * j, st = Object.assign({ bord: 'fin' }, xlCoul(a));
            put(r, col0, xlAff(a), st); put(r, col0 + 1, null, st); fz(r, col0, r, col0 + 1);
            var tr = ABS.indexOf(a) < 0 && a !== 'OFF', de = tr ? enMin(cz.de) : null, fi = tr ? enMin(cz.fi) : null, TF = { bord: 'fin', fmt: 'h:mm' };
            put(r + 1, col0, de != null ? { h: de / 60 } : null, TF); put(r + 1, col0 + 1, fi != null ? { h: fi / 60 } : null, TF);
          });
        }
        var hs = heuresSem(p, L), cth = +p.contrat_h || 0;
        put(r, 21, { h: hs }, { gras: true, bord: 'moyen', fmt: '[h]:mm' }); put(r + 1, 21, cth ? 'contrat ' + fh(cth) : '', { bord: 'moyen', taille: 9, coul: '595959' }); 
        haut[r] = 18; haut[r + 1] = 15; r += 2;
      });
      // Dentistes présents sans assistante
      put(r, 0, 'DENTISTES SEULS', { gras: true, taille: 9, bord: 'fin', retour: true, fond: 'FBEFE6' });
      for (var k2 = 0; k2 < 5; k2++) {
        var sx = ferie(addJ(L, k2)) ? null : dentistesSeuls(addJ(L, k2)), t2 = !sx ? '' : !sx.seuls.length ? 'aucun' : sx.seuls.map(function (q) { return majSansAccent(q.d.prenom) + (q.quand ? ' (' + q.quand + ')' : ''); }).join(', ');
        for (var c2 = 0; c2 < 4; c2++) put(r, 1 + 4 * k2 + c2, c2 ? null : t2, { bord: 'fin', taille: 9, retour: true, fond: 'FBEFE6' });
        fz(r, 1 + 4 * k2, r, 4 + 4 * k2);
      }
      haut[r] = 26; r += 2;
    });
    var larg = [14]; for (var i = 0; i < 20; i++) larg.push(8.7); larg.push(13);
    return { nom: MOIS_XL[+x[1] - 1] + ' ' + x[0], cases: cases, fusions: fus, larg: larg, haut: haut, figer: true, paysage: true };
  }
  function importerPlanning(file) {
    if (!file) return;
    S.plImp = { lecture: true }; render();
    var pers = {}; (S.equipe || []).forEach(function (p) { pers[cle(p.type === 'interimaire' ? 'interimaire' : p.prenom)] = p; });
    var dents = {}; (S.dentistes || []).forEach(function (d) { dents[cle(d.prenom)] = d; });
    file.arrayBuffer().then(XLSX_EVY.lire).then(function (cl) {
      var R = { rows: {}, inconnusN: {}, inconnusA: {}, feuilles: [], doublons: {}, ignorees: [] };
      Object.keys(cl).forEach(function (nomF) {
        var rows = cl[nomF] || [], dates = null, src = 0;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i] || [];
          if (r[0] === 'AD') {
            // Bloc d'une semaine : le 1er jour doit être un lundi daté ; les 4 suivants doivent concorder (sinon brouillon ignoré)
            var d0 = dateXl(r[1]);
            if (!d0 || jourSem(d0) !== 1) { dates = null; continue; }
            dates = [0, 1, 2, 3, 4].map(function (k) { return addJ(d0, k); });
            var bon = [1, 5, 9, 13, 17].every(function (c, k) {
              var v = r[c]; if (v == null || String(v).trim() === '') return true;
              var m = /^\s*(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/i.exec(norm(String(v)));
              if (!m || JOUR_N[m[1].toLowerCase()] !== k + 1) return false;
              var dd = dateXl(v); return !dd || dd === dates[k];
            });
            if (!bon) dates = null;
            continue;
          }
          if (!dates || typeof r[0] !== 'string' || !r[0].trim()) continue;
          var nom = cle(r[0]), p = pers[nom], tr = rows[i + 1] || [];
          if (!p && nom === 'dentistesseuls') continue;   // ligne ajoutée par l'export de l'appli
          if (!p) { if (nom && nom !== 'ad') R.inconnusN[r[0].trim()] = 1; continue; }
          dates.forEach(function (iso, k) {
            if (!iso) return;
            [['AM', 1 + 4 * k, 1 + 4 * k, 2 + 4 * k], ['PM', 3 + 4 * k, 3 + 4 * k, 4 + 4 * k]].forEach(function (x) {
              var v = r[x[1]]; if (v == null || String(v).trim() === '') return;
              var ck = cle(v), aff = CODE_XL[ck] || posteXL(ck) || (dents[ck] ? 'D:' + dents[ck].id : null);
              if (!aff) { R.inconnusA[String(v).trim()] = 1; return; }
              var de = heureXl(tr[x[2]]), fi = heureXl(tr[x[3]]);
              if (ABS.indexOf(aff) >= 0 || aff === 'OFF') { de = null; fi = null; }
              var kk = cleCase(p.id, iso, x[0]);
              if (R.rows[kk] && R.rows[kk].f !== nomF) R.doublons[lundiDe(iso)] = nomF;
              R.rows[kk] = { equipe_id: p.id, jour: iso, demi: x[0], aff: aff, debut: de, fin: fi, f: nomF }; src++;
            });
          });
        }
        if (src) R.feuilles.push(nomF);
      });
      var l = Object.keys(R.rows).map(function (k) { return R.rows[k]; });
      if (!l.length) throw new Error('Aucune case de planning reconnue dans ce fichier');
      var js = l.map(function (x) { return x.jour; }).sort();
      R.liste = l; R.du = js[0]; R.au = js[js.length - 1];
      R.nbPers = Object.keys(l.reduce(function (o, x) { o[x.equipe_id] = 1; return o; }, {})).length;
      R.nbSem = Object.keys(l.reduce(function (o, x) { o[lundiDe(x.jour)] = 1; return o; }, {})).length;
      S.plImp = R; render(); window.scrollTo(0, 0);
    }).catch(function (e) { S.plImp = null; toast('Lecture du fichier impossible : ' + (e && e.message || e)); render(); });
  }
  function vImportPlanning() {
    var R = S.plImp;
    if (R.lecture) return '<div class="card"><b>Lecture du fichier…</b></div>';
    var inN = Object.keys(R.inconnusN), inA = Object.keys(R.inconnusA), dbl = Object.keys(R.doublons).sort();
    return '<div class="card pl-impc"><b>Import du planning Excel</b><p style="margin:6px 0">' + R.liste.length + ' demi-journées · ' + R.nbPers + ' ' + pl(R.nbPers, 'personne') + ' · ' + R.nbSem + ' semaines, ' + periode(R.du, R.au) + '.</p>'
      + '<p class="mu" style="margin:0 0 6px">Feuilles lues : ' + R.feuilles.map(esc).join(', ') + '. Les feuilles sans dates valides (brouillons, pointage) sont ignorées. Les adresses e-mail et la feuille « Horodatage » ne sont pas importées.</p>'
      + (dbl.length ? '<p class="warn-t" style="margin:0 0 6px">Semaines présentes dans deux feuilles (la dernière feuille est gardée) : ' + dbl.map(function (w) { return dateCourte(w) + ' (' + esc(R.doublons[w]) + ')'; }).join(', ') + '.</p>' : '')
      + (inN.length ? '<p class="warn-t" style="margin:0 0 6px">Lignes ignorées (personne inconnue) : ' + inN.map(esc).join(', ') + '.</p>' : '')
      + (inA.length ? '<p class="warn-t" style="margin:0 0 6px">Cases ignorées (affectation inconnue) : ' + inA.map(esc).join(', ') + '.</p>' : '')
      + '<p style="margin:0 0 10px">Pour ces jours et ces personnes, le contenu de l’appli sera <b>remplacé</b> par celui du fichier. Rien n’est enregistré avant « Importer ».</p>'
      + (R.busy ? '<p><b>Import en cours… ' + (R.fait || 0) + ' / ' + R.liste.length + '</b></p>' : '<div class="row"><button class="btn l" data-act="plimpno">Annuler</button><button class="btn" data-act="plimpok">Importer ' + R.liste.length + ' demi-journées</button></div>') + '</div>';
  }
  function appliquerImportPlanning() {
    var R = S.plImp, l = R.liste.map(function (x) { return { equipe_id: x.equipe_id, jour: x.jour, demi: x.demi, aff: x.aff, debut: x.debut, fin: x.fin, modifie_par: S.me.id }; }), i = 0;
    R.busy = true; R.fait = 0; render();
    function suite() {
      if (i >= l.length) return Promise.resolve();
      var lot = l.slice(i, i + 400); i += 400;
      return sb.from('planning').upsert(lot, { onConflict: 'equipe_id,jour,demi' }).then(function (r) { if (r.error) throw r.error; R.fait = Math.min(i, l.length); render(); return suite(); });
    }
    suite().then(function () { S.plImp = null; toast('✔ Planning importé : ' + l.length + ' demi-journées'); S.pl.de = null; chargerSemaine(true); })
      .catch(function (e) { R.busy = false; toast('Import interrompu : ' + msgErr(e)); render(); });
  }

  // Réglages › Règles des heures
  function vPRegles() {
    var R = regles(), E = S.rgEdit;
    var h = hdA({ back: ['data-tab="reglages"', 'Réglages'], t: 'Heures', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    h += '<p class="a-aide">Heures comptées dans la semaine quand la personne ne travaille pas ce jour-là (journée entière ; une demi-journée compte la moitié) :</p><div class="a-liste">'
      + [['CP', 'Congés'], ['ARRET', 'Maladie'], ['ECOLE', 'École (apprentie)'], ['FORMATION', 'Formation'], ['FERIE', 'Jour férié']].map(function (x) {
        return '<label class="a-li"><span class="a-it-n"><b>' + x[1] + '</b></span><span class="h-hval"><input class="in" inputmode="decimal" data-rg="' + x[0] + '" value="' + esc(fr(R[x[0]])) + '" aria-label="Heures pour ' + x[1] + '"> h</span></label>';
      }).join('') + '</div>';
    h += '<h2 class="a-jour">Jour férié</h2><div class="a-liste">'
      + '<label class="a-li"><input type="radio" name="rgferie" data-rgf="habituel"' + (R.ferie !== 'tous' ? ' checked' : '') + '><span class="a-it-n"><b>Compte seulement si elle travaille ce jour-là d’habitude</b></span></label>'
      + '<label class="a-li"><input type="radio" name="rgferie" data-rgf="tous"' + (R.ferie === 'tous' ? ' checked' : '') + '><span class="a-it-n"><b>Compte pour tout le monde</b></span></label></div>';
    h += '<h2 class="a-jour">Reliquat</h2><div class="a-liste"><label class="a-li"><span class="a-it-n"><b>Compté à partir du</b><span>les semaines d’avant ne comptent pas</span></span><input class="in" type="date" data-rg="depuis" value="' + esc(R.depuis || '') + '" style="max-width:170px"></label></div>';
    if (pointagePret()) h += '<h2 class="a-jour">Pointage</h2><div class="a-liste">'
      + '<label class="a-li"><span class="a-it-n"><b>Le reliquat utilise le temps pointé</b><span>Journée pointée en entier : temps réel ; sinon : heures prévues au planning. Décoché : tout revient au planning.</span></span><input type="checkbox" data-rg="pt_reliquat"' + (R.pt_reliquat !== false ? ' checked' : '') + ' style="width:22px;height:22px;flex:none"></label>'
+ '</div><h3 class="rg-sous">Retards</h3><div class="a-liste">'
      + '<label class="a-li"><span class="a-it-n"><b>Tolérance de retard</b><span>Une arrivée compte comme un retard au-delà de</span></span><span class="h-hval"><input class="in" inputmode="numeric" data-rg="pt_tol" value="' + esc(String(R.pt_tol)) + '"> min</span></label>'
      + '<label class="a-li"><span class="a-it-n"><b>Alerte retards répétés</b><span>« À surveiller » à partir de ce nombre de retards sur la période</span></span><span class="h-hval"><input class="in" inputmode="numeric" data-rg="pt_retards" value="' + esc(String(R.pt_retards)) + '"> fois</span></label>'
      + '</div><h3 class="rg-sous">Départs anticipés</h3><div class="a-liste">'
      + '<label class="a-li"><span class="a-it-n"><b>Tolérance de départ anticipé</b><span>Une sortie compte comme un départ avant l’heure au-delà de</span></span><span class="h-hval"><input class="in" inputmode="numeric" data-rg="pt_tol_dep" value="' + esc(String(R.pt_tol_dep)) + '"> min</span></label>'
      + '<label class="a-li"><span class="a-it-n"><b>Alerte départs anticipés répétés</b><span>« À surveiller » à partir de ce nombre de départs avant l’heure sur la période</span></span><span class="h-hval"><input class="in" inputmode="numeric" data-rg="pt_departs" value="' + esc(String(R.pt_departs)) + '"> fois</span></label>'
      + '</div><h3 class="rg-sous">Écarts</h3><div class="a-liste">'
      + '<label class="a-li"><span class="a-it-n"><b>Alerte écart de la semaine</b><span>« À surveiller » si réel − prévu dépasse (heures)</span></span><span class="h-hval"><input class="in" inputmode="decimal" data-rg="pt_ecart" value="' + esc(fr(R.pt_ecart)) + '"> h</span></label></div>'
      + '<p class="a-aide">Une journée particulière peut être exclue depuis sa correction (« Ne pas compter ce pointage »).</p>';
    h += '<button class="a-btn navy" data-act="rgsave">Enregistrer les règles générales</button>';
    h += '<h2 class="a-jour">Règles et consignes par personne</h2><div class="a-liste">' + persPlanning().map(function (p) {
      var rg = p.regles || {}, k = Object.keys(rg).filter(function (x) { return ABS.indexOf(x) >= 0 && rg[x] !== '' && rg[x] != null; });
      if (E && String(E.id) === String(p.id)) {
        return '<div class="a-li h-cadd"><b>' + esc(p.prenom) + '</b><p class="mu" style="margin:4px 0 8px">Laissez vide pour garder la règle générale.</p><div class="h-g2">'
          + ['CP', 'ARRET', 'ECOLE', 'FORMATION', 'FERIE'].map(function (a) { return '<label class="mu">' + ABS_TXT[a] + ' (h)<input class="in" inputmode="decimal" data-rgp="' + a + '" value="' + esc(E.r[a] != null ? fr(E.r[a]) : '') + '" placeholder="' + fr(R[a]) + '"></label>'; }).join('')
          + '</div><label class="mu" style="display:block;margin-top:8px">Consigne<textarea class="in" rows="2" id="rgcons">' + esc(E.consigne || '') + '</textarea></label>'
          + '<div class="row" style="margin-top:10px"><button class="btn l" data-act="rgpno">Annuler</button><button class="btn" data-act="rgpok">Enregistrer</button></div></div>';
      }
      return '<button class="a-li" data-rgp-ouvrir="' + p.id + '"><span class="a-av p">' + initiale(p.prenom) + '</span><span class="a-it-n"><b>' + esc(p.prenom) + '</b><span>' + (k.length ? k.map(function (a) { return ABS_TXT[a] + ' ' + fh(+rg[a]); }).join(' · ') : 'règle générale') + '</span>' + (p.consigne ? '<span class="h-cons">« ' + esc(p.consigne) + ' »</span>' : '') + '</span>' + ico('suiv', 20, 2.2) + '</button>';
    }).join('') + '</div><p class="a-aide">Une règle par personne remplace la règle générale pour elle seule. La consigne s’affiche dans le planning quand vous touchez une de ses cases.</p>';
    return h + '</div>';
  }
  function sauverRegles() {
    var R = regles(), o = {};
    ['CP', 'ARRET', 'ECOLE', 'FORMATION', 'FERIE'].forEach(function (a) { var el = document.querySelector('[data-rg="' + a + '"]'); var v = el ? nb(String(el.value).replace(',', '.')) : R[a]; o[a] = Math.max(0, v || 0); });
    var f = document.querySelector('[data-rgf="tous"]'); o.ferie = f && f.checked ? 'tous' : 'habituel';
    var dp = document.querySelector('[data-rg="depuis"]'); o.depuis = dp && dp.value || R.depuis;
    var pr = document.querySelector('[data-rg="pt_reliquat"]'); o.pt_reliquat = pr ? pr.checked : R.pt_reliquat !== false;
    [['pt_tol', 5], ['pt_retards', 3], ['pt_ecart', 2], ['pt_tol_dep', 5], ['pt_departs', 3]].forEach(function (z) { var el = document.querySelector('[data-rg="' + z[0] + '"]'); var v = el ? nb(String(el.value).replace(',', '.')) : R[z[0]]; o[z[0]] = isNaN(v) || v == null ? z[1] : Math.max(0, v); });
    sb.from('parametres').upsert({ cle: 'regles_heures', valeur: o }, { onConflict: 'cle' }).then(function (r) {
      if (r.error) throw r.error; S.regles = o; if (S.pl) S.pl.de = null; toast('✔ Règles enregistrées'); render();
    }).catch(function (e) { toast(msgErr(e)); });
  }
  function sauverReglePers() {
    var E = S.rgEdit, r = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-rgp]'), function (el) { var v = String(el.value).trim(); if (v !== '') r[el.dataset.rgp] = Math.max(0, nb(v.replace(',', '.'))); });
    var cons = $('rgcons').value.trim() || null, pe = persById(E.id);
    if (pe && pe.regles && pe.regles.repli) r.repli = pe.regles.repli;
    sb.from('equipe').update({ regles: r, consigne: cons }).eq('id', E.id).then(function (x) {
      if (x.error) throw x.error; S.rgEdit = null; toast('✔ Règles enregistrées'); chargerPlan();
    }).catch(function (e) { toast(msgErr(e)); });
  }
  function basculerVisible(k, v) {
    var o = Object.assign({ planning: false, reliquat: false }, S.visible || {}); o[k] = v; if (!o.planning) o.reliquat = false;
    sb.from('parametres').upsert({ cle: 'planning_visible', valeur: o }, { onConflict: 'cle' }).then(function (r) {
      if (r.error) throw r.error; S.visible = o; toast(o.planning ? '✔ Les assistantes voient leur planning' + (o.reliquat ? ' et leur reliquat' : '') : 'Planning masqué pour les assistantes'); render();
    }).catch(function (e) { toast(msgErr(e)); render(); });
  }

  // Assistante : mon planning (si la référente l'a activé)
  function chargerMonPlanning() {
    if (!S.moiEq) return;
    var P = S.pl = S.pl || { lundi: lundiDe(dIso(new Date())), rows: {} };
    if (P.charge) return;
    var de = [lundiDe(regles().depuis || P.lundi), P.lundi].sort()[0], a = addJ(P.lundi, 4);
    P.charge = true;
    Promise.all([
      toutLire('planning', '*', function (q) { return q.eq('equipe_id', S.moiEq.id).gte('jour', de).lte('jour', a); }),
      sb.from('dentistes').select('id,prenom,actif,jours,ordre')
    ]).then(function (r) {
      var o = {}; r[0].forEach(function (x) { o[cleCase(x.equipe_id, String(x.jour).slice(0, 10), x.demi)] = x; });
      P.rows = o; P.de = de; P.a = a; P.charge = false; if (!r[1].error) S.dentistes = r[1].data; S.conges = S.mesConges || []; render();
    }).catch(function (e) { P.charge = false; toast(msgErr(e)); });
  }
  function vMonPlanningA() {
    var p = S.moiEq, h = hdA({ back: ['data-tab="moi"', 'Moi'], t: 'Mon planning', cab: '<span class="a-cale"></span>', fixe: true }) + '<div class="a-corps">';
    if (!p || !(S.visible && S.visible.planning)) return h + '<p class="a-vide">Le planning n’est pas encore affiché pour les assistantes.</p></div>';
    if (!S.pl || !S.pl.de) { chargerMonPlanning(); return h + '<p class="a-vide">Chargement…</p></div>'; }
    var L = S.pl.lundi;
    h += '<div class="pl-nav clair"><button class="h-rond gris" data-plsem="-7" aria-label="Semaine précédente">' + ico('prec', 20, 2.4) + '</button>' + titreCal('Semaine du ' + periode(L, addJ(L, 4)).replace(/^du /, ''), L) + '<button class="h-rond gris" data-plsem="7" aria-label="Semaine suivante">' + ico('suiv', 20, 2.4) + '</button></div><div class="a-liste">';
    for (var k = 0; k < 5; k++) {
      var iso = addJ(L, k), am = caseEff(p, iso, 'AM'), pm = caseEff(p, iso, 'PM'), t;
      if (am.a === pm.a) t = '<b>' + esc(nomAff(am.a)) + '</b>' + (am.de ? '<span>' + ft(am.de) + '–' + ft(am.fi) + ' · ' + ft(pm.de) + '–' + ft(pm.fi) + '</span>' : '');
      else t = '<b>' + esc(nomAff(am.a)) + ' · ' + esc(nomAff(pm.a)) + '</b><span>' + (am.de ? 'matin ' + ft(am.de) + '–' + ft(am.fi) : 'matin —') + ' · ' + (pm.de ? 'après-midi ' + ft(pm.de) + '–' + ft(pm.fi) : 'après-midi —') + '</span>';
      h += '<div class="a-li"><span class="h-jc">' + JC[k + 1] + '<small>' + dDe(iso).getDate() + '</small></span><span class="a-it-n">' + t + '</span></div>';
    }
    h += '</div>';
    var hs = heuresSem(p, L), c = +p.contrat_h || 0;
    h += '<div class="h-total ok"><span>Heures de la semaine</span><b>' + fh(hs) + (c ? ' / ' + fh(c) : '') + '</b></div>';
    if (S.visible.reliquat && c) { var r = reliquatAvant(p, L) + hs - c; h += '<div class="h-total ' + (r < -0.01 ? 'warn' : 'ok') + '"><span>Mon reliquat</span><b>' + relTxt(r) + '</b></div>'; }
    return h + '</div>';
  }

  // ---------- Navigation téléphone : barre du bas + menu ----------
  var ICO = { accueil: '🏠', sortie: '📤', retour: '↩️', inventaire: '📋', demandes: '⏳', stock: '📦', commandes: '🛒', articles: '🏷️', fournisseurs: '🚚', histo: '🕘', equipe: '👥', hub: '🏠', plus: '⚙️', compte: '🔑', aide: '❓', maison: '🏠', moi: '👤' };
  var NOMS = { accueil: 'Accueil', sortie: 'Sortie', retour: 'Retour', inventaire: 'Inventaire', demandes: 'Demandes', stock: 'Stock', commandes: 'Commandes', articles: 'Articles', fournisseurs: 'Fournisseurs', histo: 'Historique', equipe: 'Équipe', hub: 'Menu principal', plus: 'Plus', compte: 'Mon code', aide: 'Aide', maison: 'Accueil', moi: 'Moi' };
  function retourAcc(titre) { return '<div class="tache-hd">' + (!gestion() ? '<button class="retour-acc" data-act="accueil">' + ico('prec', 18, 2.6) + 'Accueil</button>' : '') + '<h2>' + titre + '</h2></div>'; }
  function enTache() { return !gestion() && ['sortie', 'retour', 'inventaire', 'mdemande'].indexOf(S.tab) >= 0; }
  function vNavMobile() {
    if (!gestion()) {
      if (enTache()) return '';
      var cur = ['compte', 'mconges', 'mdemande', 'mplanning'].indexOf(S.tab) >= 0 ? 'moi' : S.tab;
      return '<nav class="bnav a4" aria-label="Menu principal">' + ['maison', 'histo', 'aide', 'moi'].map(function (t) {
        return '<button data-tab="' + t + '" class="' + (cur === t ? 'on' : '') + '"><span class="bi">' + ico(t, 24) + '</span><span>' + NOMS[t] + '</span></button>';
      }).join('') + '</nav>';
    }
    var bas = ['accueil', 'sortie', 'inventaire', 'commandes'];
    var menu = gestion() ? ['hub', 'demandes', 'retour', 'stock', 'articles', 'fournisseurs', 'histo', 'plus', 'aide', 'compte'] : ['aide', 'compte'];
    var att = gestion() ? S.attente.length : 0, dansMenu = menu.indexOf(S.tab) >= 0;
    var h = '<nav class="bnav" aria-label="Menu principal">' + bas.map(function (t) {
      return '<button data-tab="' + t + '" class="' + (S.tab === t && !S.menu ? 'on' : '') + '"><span class="bi">' + ICO[t] + '</span><span>' + NOMS[t] + '</span></button>';
    }).join('') + '<button data-act="menu" class="' + (S.menu || dansMenu ? 'on' : '') + '" aria-expanded="' + !!S.menu + '"><span class="bi">☰' + (att ? '<span class="badge">' + att + '</span>' : '') + '</span><span>' + (dansMenu && !S.menu ? NOMS[S.tab] : 'Menu') + '</span></button></nav>';
    if (S.menu) h += '<button class="sheet-bg" data-act="menu" aria-label="Fermer le menu"></button><div class="sheet" role="dialog" aria-label="Menu"><div class="sheet-grip"></div><div class="sheet-grid">'
      + menu.map(function (t) { return '<button data-tab="' + t + '" class="' + (S.tab === t ? 'on' : '') + '"><span class="bi">' + ICO[t] + (t === 'demandes' && att ? '<span class="badge">' + att + '</span>' : '') + '</span><span>' + NOMS[t] + '</span></button>'; }).join('')
      + '<button data-act="out"><span class="bi">👤</span><span>Changer de personne</span></button></div></div>';
    return h;
  }

  // ---------- Sortie ----------
  // Classement : d'abord ce qui sort le plus de ce cabinet, puis le plus sorti de tout le centre, puis l'ordre alphabétique
  function sortiesDe(a, cab) { var r = S.rang[a.id]; return r ? (cab ? r.c[cab] || 0 : r.t) : 0; }
  function parUsage(cab) {
    return function (x, y) { return sortiesDe(y, cab) - sortiesDe(x, cab) || sortiesDe(y) - sortiesDe(x) || x.nom.localeCompare(y.nom); };
  }
  // Unité dans laquelle on sort l'article (ce que compte le + / −)
  function enBoite(a) { return facteur(a) === 1 && a.conditionnement === 'BOITE'; }
  function uSortie(a, n) { var p = Math.abs(n) > 1 ? 's' : ''; return enBoite(a) ? 'boîte' + p : 'unité' + p; }
  function ligneSortie(a, s) {
    var v = s.panier[a.id] || 0, d = dispoUnites(a), trop = v > d, n = sortiesDe(a, +s.cab), f = facteur(a);
    var mode = enBoite(a) ? '<span class="mode boite">📦 Sortie à la <strong>boîte entière</strong></span>'
      : '<span class="mode unite">🔹 Sortie à l’<strong>unité</strong>' + (f > 1 ? ' · boîte de ' + fr(a.qte_par_boite) : '') + '</span>';
    return '<div class="it' + (v ? ' choisi' : '') + '"><div class="it-n"><b>' + esc(a.nom) + (a.reference && a.reference !== 'SR' ? '<span class="ref">' + esc(a.reference) + '</span>' : '') + '</b>' + mode
      + '<span class="' + (trop ? 'pill warn' : '') + '">Réserve : ' + fr(d) + ' ' + uSortie(a, d) + (f > 1 ? ' (' + fr(stockDe(a.id, 0)) + ' boîte' + (stockDe(a.id, 0) > 1 ? 's' : '') + ')' : '') + (trop ? ' · au-delà : demande à confirmer' : '') + '</span>'
      + (n ? '<span class="use">📈 ' + fr(n) + ' ' + uSortie(a, n) + ' sortie' + (n > 1 ? 's' : '') + ' en 12 mois</span>' : '') + '</div>'
      + '<div class="stpw"><div class="stp"><button type="button" data-moins="' + a.id + '" aria-label="Moins un">−</button><input inputmode="decimal" data-qte="' + a.id + '" value="' + (v || '') + '" placeholder="0" aria-label="Quantité en ' + uSortie(a, 2) + '"><button type="button" data-plus="' + a.id + '" aria-label="Plus un">+</button></div><small class="stpu ' + (enBoite(a) ? 'boite' : 'unite') + '">en ' + uSortie(a, 2) + '</small></div></div>';
  }
  function vSortie() {
    var s = S.sortie, hors = horsCab(s.cab);
    if (s.ok) return vSortieOk();
    var ids0 = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; });
    if (s.voir && ids0.length) return vSortieVerif();
    var h = retourAcc('Sortie');
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    h += '<div class="card filtre"><div class="frow"><label class="mu fcab"><span class="m-hide">Cabinet</span><select class="in" id="scab" aria-label="Cabinet">'
      + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (c) { return '<option value="' + c + '"' + (+s.cab === c ? ' selected' : '') + '>' + cabTxt(c) + (S.me.cabinet === c ? ' ★' : '') + '</option>'; }).join('')
      + '</select></label><label class="mu fq"><span class="m-hide">Rechercher un article</span><input class="in" id="sq" type="search" placeholder="🔍 Nom ou référence" value="' + esc(s.q) + '" aria-label="Rechercher un article"></label></div>'
      + (hors ? '<p class="ban warn" style="margin:10px 0 0">Ce n’est pas votre cabinet : la sortie sera enregistrée « hors cabinet » (remplacement).</p>' : '') + '</div>';
    var q = norm(s.q), ids = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; }), tri = parUsage(+s.cab);
    if (q) {
      var trouves = S.articles.filter(function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }).sort(tri).slice(0, 40);
      return h + (trouves.length ? '<div class="card liste">' + trouves.map(function (a) { return ligneSortie(a, s); }).join('') + '</div>' : '<p class="mu">Aucun article trouvé.</p>');
    }
    if (s.voir && ids.length) return h + '<div class="sect row"><span class="grow">🧺 Dans la sortie · ' + ids.length + ' article(s)</span><button class="lnk" data-act="svoir">← Tous les articles</button></div><div class="card liste">' + ids.map(function (k) { return S.byId[k]; }).filter(Boolean).map(function (a) { return ligneSortie(a, s); }).join('') + '</div>';
    var autres = S.articles.filter(function (a) { return pourLieu(a, s.cab); }).sort(tri), max = s.max || 30;
    h += '<div class="sect">⭐ Les plus sortis · ' + lieuTxt(s.cab) + '</div><div class="card liste">' + autres.slice(0, max).map(function (a) { return ligneSortie(a, s); }).join('') + '</div>';
    if (autres.length > max) h += '<button class="btn l plus" data-act="splus">Afficher plus d’articles (' + (autres.length - max) + ' restants)</button>';
    return h;
  }
  function vSortieVerif() {
    var s = S.sortie, ids = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; }), hors = horsCab(s.cab);
    var h = '<div class="tache-hd"><button class="retour-acc" data-act="svoir">' + ico('prec', 18, 2.6) + 'Modifier</button><h2>Ma sortie</h2></div>';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    h += '<div class="card pour">' + ico('cabinet', 24) + '<span>Pour ' + pourTxt(s.cab) + (hors ? ' <span class="pill warn">hors cabinet · remplacement</span>' : S.me.cabinet && +s.cab === +S.me.cabinet ? ' (le mien)' : '') + '</span></div>';
    h += '<div class="card liste">' + ids.map(function (k) { return S.byId[k]; }).filter(Boolean).map(function (a) { return ligneSortie(a, s); }).join('') + '</div>';
    h += '<button class="btn l ajout" data-act="svoir">+ Ajouter un article</button>';
    if (ids.some(function (k) { var a = S.byId[k]; return a && s.panier[k] > dispoUnites(a); })) h += '<p class="ban warn">Certaines quantités dépassent la réserve : la partie en trop partira en demande à confirmer par la référente.</p>';
    return h + '<button class="lnk annul" data-act="vider">Annuler et vider</button>';
  }
  function vSortieOk() {
    var o = S.sortie.ok;
    return '<div class="ok-ecran"><span class="ok-rond" role="img" aria-label="Validé">' + ico('ok', 60, 2.6) + '</span><h2>' + (o.attente && !o.sorties ? 'Demande envoyée' : 'C’est enregistré') + '</h2>'
      + '<p>' + (o.sorties ? o.sorties + ' article(s) sorti(s) pour ' + pourTxt(o.cab) : '') + (o.resume ? '<br>' + o.resume : '') + '</p>'
      + (o.attente ? '<p class="ban warn">⏳ ' + o.attente + ' article(s) dépassent la réserve : demande envoyée à la référente.</p>' : '')
      + (o.hors ? '<p class="mu">Enregistré « hors cabinet » (remplacement).</p>' : '')
      + (!gestion() ? '<p class="ok-auto">Retour à l’accueil dans quelques secondes…</p>' : '')
      + '<div class="ok-btns"><button class="btn gros" data-act="snouv">Nouvelle sortie</button><button class="btn l gros" data-act="accueil">Accueil</button></div></div>';
  }
  function vBarSortie() {
    if (modeA()) return vBarSortieA();
    if (S.sortie.ok) return '';
    var n = Object.keys(S.sortie.panier).filter(function (k) { return S.sortie.panier[k] > 0; }).length;
    if (S.sortie.voir && n) return '<div class="bar"><div class="bar-in"><button class="btn gros" data-act="valider"' + (S.sortie.busy ? ' disabled' : '') + '>' + (S.sortie.busy ? 'Enregistrement…' : 'Valider la sortie') + '</button></div></div>';
    if (!n) return '<div class="bar"><div class="bar-in"><span class="grow mu">Touchez + pour choisir des articles</span></div></div>';
    return '<div class="bar"><div class="bar-in"><button class="btn gold gros verif" data-act="svoir"><span>' + n + ' article(s) choisi(s)</span><span class="avec-ic">Vérifier' + ico('suiv', 20, 2.6) + '</span></button></div></div>';
  }
  // ---------- Retour d'un cabinet vers la réserve (tout le monde) ----------
  // Saisie dans l'unité de la réserve, en entiers : boîtes fermées pour un article rangé en boîte.
  function vRetour() {
    var s = S.ret, hors = horsCab(s.cab);
    var h = retourAcc('Retour en réserve') + '<p class="ban warn avec-ic" style="margin:0 0 10px">' + ico('boite', 22) + '<span>On ne rend que des <b>boîtes fermées</b>. Les unités en vrac restent au cabinet.</span></p>';
    if (s.msg) h += '<div class="ban ' + s.msg[0] + '" role="status">' + s.msg[1] + '</div>';
    h += '<div class="card filtre"><div class="frow"><label class="mu fcab"><span class="m-hide">Depuis le cabinet</span><select class="in" id="rcab" aria-label="Depuis le cabinet">'
      + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (+s.cab === c ? ' selected' : '') + '>Cab. ' + c + (S.me.cabinet === c ? ' ★' : '') + '</option>'; }).join('')
      + '</select></label><label class="mu fq"><span class="m-hide">Rechercher un article</span><input class="in" id="rq" type="search" placeholder="🔍 Nom ou référence" value="' + esc(s.q) + '" aria-label="Rechercher un article"></label></div>'
      + (hors ? '<p class="ban warn" style="margin:10px 0 0">Ce n’est pas votre cabinet : le retour sera enregistré « hors cabinet » (remplacement).</p>' : '') + '</div>';
    var q = norm(s.q), ids = Object.keys(s.panier).filter(function (k) { return s.panier[k] > 0; });
    // Sans recherche : les articles dont le cabinet a au moins une boîte fermée (ou une unité), plus ceux déjà choisis
    var liste = q ? S.articles.filter(function (a) { return norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0; }).slice(0, 40)
                  : S.articles.filter(function (a) { return s.panier[a.id] > 0 || stockDe(a.id, +s.cab) >= facteur(a); }).sort(parUsage(+s.cab));
    if (!liste.length) return h + '<p class="mu">' + (q ? 'Aucun article trouvé.' : 'Aucune boîte fermée enregistrée dans ce cabinet. Cherchez l’article avec 🔍.') + '</p>';
    return h + (q ? '' : '<div class="sect">📦 Présents dans le cabinet ' + s.cab + '</div>') + '<div class="card liste">' + liste.map(function (a) {
      var v = s.panier[a.id] || 0, f = facteur(a), cab = stockDe(a.id, +s.cab), boites = f > 1 ? Math.floor(cab / f + 1e-9) : null, trop = f > 1 ? v > boites : v > cab;
      return '<div class="it"><div class="it-n"><b>' + esc(a.nom) + (a.reference && a.reference !== 'SR' ? '<span class="ref">' + esc(a.reference) + '</span>' : '') + '</b>'
        + '<span class="' + (trop ? 'pill warn' : '') + '">Au cabinet ' + s.cab + ' : ' + fr(cab) + ' u.' + (f > 1 ? ' (' + boites + ' boîte(s) entière(s) de ' + fr(a.qte_par_boite) + ')' : '') + (trop ? ' · plus que le stock enregistré' : '') + '</span>'
        + '<span style="display:block;font-weight:600;color:var(--ink2)">Retour en ' + (f > 1 || a.conditionnement === 'BOITE' ? 'boîtes' : 'unités') + '</span></div>'
        + '<div class="stp"><button type="button" data-rmoins="' + a.id + '" aria-label="Moins un">−</button><input inputmode="numeric" data-rqte="' + a.id + '" value="' + (v || '') + '" placeholder="0" aria-label="Quantité"><button type="button" data-rplus="' + a.id + '" aria-label="Plus un">+</button></div></div>';
    }).join('') + '</div>';
  }
  function vBarRetour() {
    if (modeA()) return vBarRetourA();
    var n = Object.keys(S.ret.panier).filter(function (k) { return S.ret.panier[k] > 0; }).length;
    if (!n) return '<div class="bar"><div class="bar-in"><span class="grow mu">Touchez + pour chaque boîte à rendre</span></div></div>';
    var b = Object.keys(S.ret.panier).reduce(function (t, k) { return t + (S.ret.panier[k] || 0); }, 0);
    return '<div class="bar"><div class="bar-in"><button class="btn l" data-act="rvider" aria-label="Vider">✕</button><button class="btn gold gros verif" data-act="rvalider"' + (S.ret.busy ? ' disabled' : '') + '><span>' + b + ' à rendre</span><span>Valider le retour</span></button></div></div>';
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
      if (d.sorties) m.push('✔ ' + d.sorties + ' article(s) sorti(s) pour ' + (+s.cab === 9 ? 'la Sté' : 'le cabinet ' + s.cab) + '.');
      if (d.en_attente) m.push('⏳ ' + d.en_attente + ' article(s) dépassent la réserve : demande envoyée à la responsable, voyez-la pour confirmer.');
      if (d.hors_cabinet) m.push('Enregistré « hors cabinet ».');
      var resume = lignes.slice(0, 4).map(function (l) { var a = S.byId[l.article_id]; return esc(a ? a.nom : '?') + ' × ' + fr(l.quantite); }).join(' · ') + (lignes.length > 4 ? '…' : '');
      s.ok = { sorties: d.sorties || 0, attente: d.en_attente || 0, hors: d.hors_cabinet, cab: s.cab, resume: resume };
      s.msg = null; s.panier = {}; s.q = ''; s.voir = false; s.max = 30;
      window.scrollTo(0, 0); charger();
      if (!gestion()) { var t0 = s.ok; setTimeout(function () { if (S.sortie.ok === t0 && S.tab === 'sortie') { S.sortie.ok = null; S.tab = 'maison'; render(); } }, 6000); }
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
      if (!q && !pourLieu(a, emp) && !(stockDe(a.id, emp) > 0) && d[a.id] == null) return false;
      return !q || norm(a.nom + ' ' + (a.reference || '')).indexOf(q) >= 0;
    }).sort(parUsage(emp || null));
  }
  function nbComptes() { return Object.keys(S.inv.d).filter(function (k) { return S.inv.d[k] !== '' && S.inv.d[k] != null && S.byId[k]; }).length; }
  function vInventaire() {
    var I = S.inv, emp = I.emp, h = retourAcc('Inventaire');
    if (I.msg) h += '<div class="ban ' + I.msg[0] + '" role="status">' + I.msg[1] + '</div>';
    if (j0Actif()) h += '<div class="ban j0">🚩 <b>Inventaire de départ (J0)</b> jusqu’au ' + S.j0.fin.split('-').reverse().slice(0, 2).join('/') + ' : les quantités comptées <b>remplacent</b> le stock, sans perte ni gain.' + (emp != null && j0Premier(emp) ? ' <b>Les articles non comptés de cet emplacement passeront à 0.</b>' : '') + (gestion() ? ' <button class="lnk" data-act="j0off">Terminer le J0</button>' : '') + '</div>';
    else if (gestion()) h += (I.j0ask ? '<div class="ban j0"><b>Lancer l’inventaire de départ (J0) ?</b><br>Pendant 7 jours, chaque inventaire remplacera directement le stock : aucune perte, aucun gain, aucun motif. Au premier comptage de chaque emplacement, les articles non comptés passeront à 0.<div class="row" style="margin-top:10px"><button class="btn l sm" data-act="j0non">Non</button><button class="btn sm" data-act="j0oui">Oui, lancer le J0</button></div></div>' : '<button class="btn l sm" style="margin-bottom:12px" data-act="j0ask">🚩 Lancer l’inventaire de départ (J0)</button>');
    var opts = (peutReserve() ? '<option value="0"' + (emp === 0 ? ' selected' : '') + '>Réserve</option>' : '') + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (c) { return '<option value="' + c + '"' + (emp === c ? ' selected' : '') + '>' + (c === 9 ? 'La Sté' : 'Cabinet ' + c + (S.me.cabinet === c ? ' (le mien)' : '')) + '</option>'; }).join('');
    h += '<div class="card' + (emp != null ? ' filtre' : '') + '"><div class="' + (emp != null ? 'frow' : 'g2') + '"><label class="mu fcab"><span class="m-hide">Emplacement à compter</span><select class="in" id="iemp" aria-label="Emplacement à compter"><option value="">— Choisir —</option>' + opts.replace(/>Cabinet (\d)( \(le mien\))?</g, function (m0, c, mien) { return '>Cab. ' + c + (mien ? ' ★' : '') + '<'; }) + '</select></label>'
      + (emp != null ? '<label class="mu fq"><span class="m-hide">Rechercher</span><input class="in" id="iq" type="search" placeholder="🔍 Nom ou référence" value="' + esc(I.q) + '" aria-label="Rechercher"></label>' : '') + '</div>'
      + (emp != null && horsCab(emp) ? '<p class="ban warn" style="margin:10px 0 0">Ce n’est pas votre cabinet : l’inventaire sera enregistré « hors cabinet » (remplacement).</p>' : '')
      + (!peutReserve() ? '<p class="mu" style="margin:8px 0 0">L’inventaire de la réserve est fait par la responsable ou la référente (ou sur autorisation).</p>' : '') + '</div>';
    if (emp == null) return h + (peutReserve() ? '<p class="mu">💡 Pour compter la réserve avec un fichier Excel, choisissez <b>Réserve</b> : les boutons « Fichier de comptage Excel » et « Importer le comptage » apparaissent.</p>' : '');
    if (emp === 0 && !I.recap && peutReserve()) h += '<div class="row wrap" style="margin:0 0 10px"><button class="btn l sm" data-act="iexp">⬇️ Fichier de comptage Excel</button><label class="btn l sm" style="display:inline-flex;align-items:center">⬆️ Importer le comptage<input type="file" id="iimpf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label></div>';
    if (I.recap) return h + vRecap();
    var der = S.dernierInv[emp];
    h += '<p class="mu">' + (der ? 'Dernier inventaire : ' + new Date(der).toLocaleDateString('fr-FR') : 'Premier inventaire de cet emplacement : tous les articles sont listés, saisissez ceux qui sont présents.') + ' Votre saisie est gardée sur cet appareil jusqu’à la validation.</p>';
    if (emp > 0 && der) h += '<label class="row" style="margin:0 0 10px"><input type="checkbox" id="itous"' + (I.tous ? ' checked' : '') + ' style="width:20px;height:20px"> Afficher tous les articles (produit trouvé qui n’était pas prévu)</label>';
    var l = listeInv(), max = I.max || 80, tot = l.length, faits = l.filter(function (a) { return I.d[a.id] != null && I.d[a.id] !== ''; }).length;
    h += '<div class="prog"><div class="row"><b class="grow">' + faits + ' compté(s) sur ' + tot + '</b><span class="mu">gardé sur cet appareil</span></div><div class="prog-b"><i style="width:' + (tot ? Math.round(faits * 100 / tot) : 0) + '%"></i></div>'
      + '<div class="chips"><button class="chip' + (I.reste ? ' on' : '') + '" data-act="ireste">Pas encore comptés · ' + (tot - faits) + '</button><button class="chip' + (!I.reste ? ' on' : '') + '" data-act="itout">Tous</button></div></div>';
    if (I.reste) l = l.filter(function (a) { return I.d[a.id] == null || I.d[a.id] === ''; });
    if (!l.length) h += '<p class="mu">Aucun article.</p>';
    else h += '<div class="sect">' + (emp ? '⭐ Les plus sortis du cabinet ' + emp + ' en premier' : '⭐ Les plus sortis du centre en premier') + ' · ' + nbComptes() + ' compté(s)</div><div class="card liste">' + l.slice(0, max).map(function (a) {
      var v = I.d[a.id];
      return '<div class="it' + (v != null && v !== '' ? ' choisi' : '') + '"><div class="it-n"><b>' + esc(a.nom) + (a.reference && !estSR(a) ? '<span class="ref">' + esc(a.reference) + '</span>' : '') + '</b><span>en ' + uInv(a, emp) + (gestion() ? ' · théorique : ' + fr(theo(a, emp)) : '') + '</span></div>'
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
    // Dans un cabinet, ce qui manque a été UTILISÉ pour les soins (ce n'est pas un écart) ; ce qui est en plus est à vérifier.
    var cab = emp > 0 && !j0Actif(), utilises = E.filter(function (e) { return e.apres < e.avant; }).length, enPlus = E.length - utilises;
    var h = '<div class="card"><b>' + (cab ? 'Bilan · ' : 'Récapitulatif · ') + cabTxt(emp) + '</b><p class="mu" style="margin:4px 0 8px">' + nbComptes() + ' article(s) comptés · '
      + (cab ? utilises + ' utilisé(s) depuis le dernier inventaire' + (enPlus ? ' · ' + enPlus + ' en plus, à vérifier' : '') : E.length + ' écart(s)') + (Z.length ? ' · ' + Z.length + ' non comptés passeront à 0' : '') + '</p>';
    if (!E.length) h += '<p>' + (cab ? 'Rien n’a bougé depuis le dernier inventaire.' : 'Aucun écart : le stock correspond à votre comptage.') + '</p>';
    else h += E.map(function (e) {
      var d = e.apres - e.avant, u = uInv(e.a, emp);
      var txt = cab ? (d < 0 ? 'il en restait ' + fr(e.avant) + ' · compté <strong>' + fr(e.apres) + '</strong> → <strong>' + fr(-d) + ' ' + u + ' utilisé(s)</strong>'
                             : '<span style="color:var(--warn);font-weight:600">il en restait ' + fr(e.avant) + ' · compté ' + fr(e.apres) + ' : ' + fr(d) + ' de plus. Une sortie oubliée ?</span>')
                    : fr(e.avant) + ' → <strong>' + fr(e.apres) + '</strong> ' + u + ' (' + (d > 0 ? '+' : '') + fr(d) + ')';
      return '<div class="it"><div class="it-n"><b>' + esc(e.a.nom) + '</b><span>' + txt + '</span></div>'
        + (motif ? '<select class="in" style="max-width:200px" data-imotif="' + e.a.id + '"><option value="">Motif…</option>' + MOTIFS.map(function (m) { return '<option' + (S.inv.motifs[e.a.id] === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' : '') + '</div>';
    }).join('');
    if (Z.length) h += '<p class="ban warn" style="margin:10px 0 0">Inventaire de départ : ' + Z.length + ' article(s) présents dans le stock mais non comptés passeront à 0' + ' (' + Z.slice(0, 4).map(function (a) { return esc(a.nom); }).join(', ') + (Z.length > 4 ? '…' : '') + ').</p>';
    if (cab && utilises) h += '<p class="mu" style="margin:10px 0 0">Ce qui a été utilisé pour les soins est enregistré comme consommation du cabinet (ce n’est pas une perte).</p>';
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

  function vBarInv() { if (modeA()) return vBarInvA(); var n = nbComptes(), ok = n || aZero().length; return '<div class="bar"><div class="bar-in"><button class="btn gold gros verif" data-act="iterminer"' + (ok ? '' : ' disabled') + '>' + (ok ? '<span>J’ai fini de compter</span><span class="avec-ic">Voir le bilan' + ico('suiv', 20, 2.6) + '</span>' : '<span>Comptez au moins un article</span>') + '</button></div></div>'; }

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
    A.forEach(function (a) { var cm = +a.cout_moyen || 0, f = facteur(a); valR += stockDe(a.id, 0) * cm; for (var c = 1; c <= 9; c++) valC += stockDe(a.id, c) / f * cm; });
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
    var emps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (e) { var s = etatInventaire(e); s.emp = e; return s; });
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
    var h = '<h2>Stock</h2><div class="tiles stk"><div class="tile"><b>' + S.articles.length + '</b><span>articles</span></div><div class="tile ok"><b>' + eur(val) + '</b><span>valeur de la réserve</span><small>au coût moyen TTC</small></div></div>'
      + '<div class="card filtre"><input class="in" id="stq" type="search" placeholder="🔍 Article, référence, fournisseur" value="' + esc(S.stockQ) + '" aria-label="Rechercher"></div>'
      + '<div class="chips" style="margin:0 0 10px"><button class="chip' + (!S.stockF ? ' on' : '') + '" data-go="stock:">Tous</button>' + Object.keys(STF).map(function (f) { return '<button class="chip' + (S.stockF === f ? ' on' : '') + '" data-go="stock:' + f + '">' + STF[f] + '</button>'; }).join('') + '</div>'
      + (S.stockF ? '<p class="mu">' + l.length + ' article(s) · ' + STF[S.stockF] + '</p>' : '');
    h += '<div class="scroll"><table class="tbl tbl-s"><thead><tr><th>Article</th><th class="n">Réserve</th><th class="n">Cabinets</th><th>État</th></tr></thead><tbody>';
    h += l.slice(0, 300).map(function (a) {
      var r = stockDe(a.id, 0), cabs = 0, det = [];
      for (var c = 1; c <= 9; c++) { var v = stockDe(a.id, c); if (v) { cabs += v; det.push((c === 9 ? 'Sté' : c) + ':' + fr(v)); } }
      var etat = a.sans_seuil ? '<span class="pill">sans seuil</span>' : !(+a.seuil > 0) ? '<span class="pill">seuil ?</span>' : r <= 0 ? '<span class="pill ko">rupture</span>' : r <= +a.seuil ? '<span class="pill warn">à commander</span>' : '<span class="pill ok">ok</span>';
      return '<tr><td>' + esc(a.nom) + '<span class="ref">' + esc(a.reference || '') + '</span><br><span class="mu" style="font-size:13px">' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + '</span></td><td class="n" data-l="Réserve">' + fr(r) + ' ' + uRes(a) + '</td><td class="n" data-l="Cabinets" title="' + esc(det.join(' · ')) + '">' + (cabs ? fr(cabs) + ' u.' : '—') + '</td><td>' + etat + '</td></tr>';
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
    return h + '<div class="scroll"><table class="tbl tbl-h"><thead><tr><th>Date</th><th>Mouvement</th><th class="n">Qté</th><th>Par</th></tr></thead><tbody>' + S.histo.map(function (m) {
      var a = S.byId[m.article_id] || { nom: m.article_nom ? m.article_nom + ' (supprimé)' : '(article)' }, st = STAT[m.statut] || ['', m.statut];
      var lieu = m.type === 'retour' ? ' ' + cabTxt(m.emplacement_de) + ' → réserve' : m.type === 'sortie' || m.type === 'demande' ? ' → ' + cabTxt(m.emplacement_vers) : m.emplacement_de != null ? ' · ' + cabTxt(m.emplacement_de) : '';
      return '<tr><td>' + quand(m.cree_le) + '</td><td>' + (TYP[m.type] || m.type) + lieu + ' · <b>' + esc(a.nom) + '</b> ' + (m.statut !== 'ok' ? '<span class="pill ' + st[0] + '">' + st[1] + '</span> ' : '') + (m.hors_cabinet ? '<span class="pill warn">hors cabinet</span>' : '') + (m.ecart ? '<br><span class="mu">écart ' + fr(m.ecart) + (m.valeur ? ' · ' + eur(m.valeur) : '') + '</span>' : '') + '</td><td class="n">' + (m.type === 'retour' && m.quantite_reserve != null && +m.quantite_reserve !== +m.quantite ? fr(m.quantite_reserve) + ' boîte(s)<br><small class="mu">' + fr(m.quantite) + ' u.</small>' : fr(m.quantite)) + '</td><td>' + esc(m.auteur_nom || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ---------- Articles (gestion) ----------
  var AF = { tous: 'Tous', sr: 'Sans référence', sf: 'Sans fournisseur', seuil: 'Sans seuil', ste: 'La Sté', nolieu: 'Sans lieu', archive: 'Archivés' };
  function vArticles() {
    if (S.fiche && S.fiche.type === 'article') return vFicheArticle();
    var q = norm(S.artQ), f = S.artF || 'tous';
    var base = f === 'archive' ? S.archives : S.articles;
    var l = base.filter(function (a) { return (f === 'tous' || f === 'archive' || (f === 'ste' ? a.lieu_ste === true : f === 'nolieu' ? a.lieu_cabinets === false && a.lieu_ste !== true : filtreStock(a, f))) && (!q || norm(a.nom + ' ' + (a.reference || '') + ' ' + (S.fournisseurs[a.fournisseur_id] || '')).indexOf(q) >= 0); });
    var h = '<h2>Articles</h2><div class="card row wrap"><input class="in grow" id="aq" type="search" placeholder="Rechercher un article, une référence, un fournisseur" value="' + esc(S.artQ) + '"><button class="btn" data-act="anew">+ Nouvel article</button></div>'
      + '<div class="chips" style="margin:0 0 10px">' + Object.keys(AF).map(function (k) { return '<button class="chip' + (f === k ? ' on' : '') + '" data-af="' + k + '">' + AF[k] + '</button>'; }).join('') + '</div>'
      + '<div class="row wrap" style="margin:0 0 10px"><button class="btn l sm" data-act="aexp">⬇️ Exporter Excel</button><label class="btn l sm" style="display:inline-flex;align-items:center">⬆️ Importer Excel<input type="file" id="aimpf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label><span class="mu">Modifier les fiches en masse</span></div>'
      + (S.artImp ? vImportArticles() : '')
      + '<p class="mu">' + l.length + ' article(s)</p>';
    h += '<div class="card">' + l.slice(0, S.artMax || 100).map(function (a) {
      return '<button class="it lrow" data-aopen="' + a.id + '"><span class="it-n"><b>' + esc(a.nom) + (a.reference && !estSR(a) ? '<span class="ref">' + esc(a.reference) + '</span>' : ' <span class="pill warn">SR</span>') + '</b><span>' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + ' · ' + condTxt(a) + ' · réserve ' + fr(stockDe(a.id, 0)) + ' ' + uRes(a) + (a.lieu_ste === true ? ' · ' + (a.lieu_cabinets !== false ? 'cabinets + Sté' : 'Sté') : a.lieu_cabinets === false ? ' · <span class="pill warn">sans lieu</span>' : '') + (a.type_soins ? ' · ' + esc(a.type_soins) : '') + '</span></span><span aria-hidden="true">›</span></button>';
    }).join('') + '</div>';
    if (l.length > (S.artMax || 100)) h += '<button class="btn l" style="width:100%" data-act="amore">Afficher plus</button>';
    return h;
  }
  function lieuxTxt(a) { var l = []; if (a.lieu_cabinets !== false) l.push('Cabinets'); if (a.lieu_ste === true) l.push('La Sté'); return l.length ? l.join(' + ') : '<span class="pill warn">aucun : l’article n’apparaît dans aucune liste</span>'; }
  function condTxt(a) { return a.conditionnement === 'BOITE' ? 'boîte de ' + fr(a.qte_par_boite) + (a.consommation === 'Unité' && +a.qte_par_boite > 1 ? ', sortie à l’unité' : ', sortie à la boîte') : 'à l’unité'; }
  function ouvrirArticle(id) {
    S.fiche = { type: 'article', id: id, edit: id === 'new', d: null, fo: [], hist: [], cor: null };
    if (id === 'new') { S.fiche.d = { nom: '', reference: 'SR', conditionnement: 'Unité', qte_par_boite: 1, consommation: 'Unité', conso_verifiee: false, seuil: 0, sans_seuil: false, cout_moyen: 0, prix: 0, lieu_cabinets: true, lieu_ste: false, type_soins: '' }; render(); return; }
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
    var f = facteur(a), r = stockDe(a.id, 0), cabs = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(function (c) { return Math.abs(stockDe(a.id, c)) > 1e-9; });
    if (Math.abs(r) < 1e-9 && !cabs.length) return '<div class="ban ok">📦 <b>Aucun stock</b> : réserve, cabinets et Sté à 0.</div>';
    var uc = cabs.reduce(function (t, c) { return t + stockDe(a.id, c); }, 0), cm = +a.cout_moyen || 0, val = r * cm + uc / f * cm, parts = [];
    if (Math.abs(r) > 1e-9) parts.push(fr(r) + ' ' + uRes(a) + ' en réserve');
    if (cabs.length) parts.push(fr(uc) + ' u. dans ' + cabs.length + ' cabinet' + (cabs.length > 1 ? 's' : '') + ' (' + cabs.map(function (c) { return c === 9 ? 'Sté' : c; }).join(', ') + ')');
    return '<div class="ban warn">📦 <b>En stock</b> : ' + parts.join(' + ') + (cm ? ' · valeur ≈ ' + eur(val) : '') + '.</div>';
  }
  function vFicheArticle() {
    var F = S.fiche, a = F.d;
    var h = '<button class="lnk" data-act="fclose">← Tous les articles</button>';
    if (!a) return h + '<p class="mu">Chargement…</p>';
    if (F.edit) return h + synthStock(a) + vEditArticle();
    var f = facteur(a), cabs = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(function (c) { return stockDe(a.id, c); });
    h += '<div class="card"><div class="row wrap"><div class="grow"><h2 style="margin:0">' + esc(a.nom) + '</h2><span class="mu">Réf. ' + (a.reference && !estSR(a) ? esc(a.reference) : '<span class="pill warn">SR</span>') + ' · ' + esc(S.fournisseurs[a.fournisseur_id] || 'SF') + (a.archive ? ' · <span class="pill ko">archivé</span>' : '') + '</span></div><button class="btn" data-act="aedit">✏️ Modifier</button></div></div>';
    h += synthStock(a);
    h += '<div class="card"><b>📦 Conditionnement et stock</b><dl class="dl">'
      + '<dt>Conditionnement</dt><dd>' + condTxt(a) + (a.conditionnement === 'BOITE' && +a.qte_par_boite > 1 && !a.conso_verifiee ? ' <span class="pill warn">consommation à vérifier</span>' : '') + '</dd>'
      + '<dt>Réserve</dt><dd>' + fr(stockDe(a.id, 0)) + ' ' + uRes(a) + (f > 1 ? ' (' + fr(stockDe(a.id, 0) * f) + ' u.)' : '') + '</dd>'
      + '<dt>Cabinets</dt><dd>' + (cabs.length ? cabs.map(function (c) { return (c === 9 ? 'Sté' : 'cab. ' + c) + ' : ' + fr(stockDe(a.id, c)) + ' u.'; }).join(' · ') : 'aucun') + '</dd>'
      + '<dt>Lieux d’utilisation</dt><dd>' + lieuxTxt(a) + '</dd>'
      + '<dt>Type de soins</dt><dd>' + (a.type_soins ? esc(a.type_soins) : '<span class="mu">—</span>') + '</dd>'
      + '<dt>Seuil d’alerte</dt><dd>' + (a.sans_seuil ? 'aucun (voulu)' : +a.seuil > 0 ? fr(a.seuil) + ' ' + uRes(a) : '<span class="pill warn">à renseigner</span>') + '</dd>'
      + '<dt>Coût moyen</dt><dd>' + eur(a.cout_moyen) + ' / ' + (a.conditionnement === 'BOITE' ? 'boîte' : 'unité') + '</dd></dl>'
      + (F.cor ? vCorrection() : '<button class="btn l sm" data-act="cor">🛠 Corriger les quantités sans impact financier</button>') + '</div>';
    h += '<div class="card"><b>🚚 Fournisseurs et prix</b>' + (F.fo.length ? F.fo.map(function (x) { return '<div class="it"><div class="it-n"><b>' + (x.rang === 0 ? '★ ' : '') + esc(S.fournisseurs[x.fournisseur_id] || '?') + '</b><span>' + (x.reference ? 'réf. ' + esc(x.reference) + ' · ' : '') + eur(x.prix) + '</span></div></div>'; }).join('') : '<p class="mu">Aucun fournisseur (SF).</p>') + '</div>';
    h += '<div class="card"><b>📈 Historique des prix</b>' + (F.hist.length ? '<div class="scroll"><table class="tbl tbl-p"><tbody>' + F.hist.map(function (p) { return '<tr><td>' + p.date_prix.split('-').reverse().join('/') + '</td><td>' + esc(S.fournisseurs[p.fournisseur_id] || '') + '</td><td class="n">' + eur(p.prix) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="mu">Aucun prix enregistré.</p>') + '</div>';
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
      + '<label class="row" style="margin-top:6px"><input type="checkbox" data-af-f="conso_verifiee"' + (a.conso_verifiee ? ' checked' : '') + ' style="width:20px;height:20px"> Consommation vérifiée</label></div>'
      + '<div class="card"><b>📍 Lieux d’utilisation</b> <span class="mu">(l’article n’apparaît que dans les listes de ces lieux ; la recherche trouve tout)</span>'
      + '<label class="row" style="margin-top:8px"><input type="checkbox" data-af-f="lieu_cabinets"' + (a.lieu_cabinets !== false ? ' checked' : '') + ' style="width:20px;height:20px"> Lieu 1 : Cabinets (n’importe quel cabinet)</label>'
      + '<label class="row" style="margin-top:6px"><input type="checkbox" data-af-f="lieu_ste"' + (a.lieu_ste === true ? ' checked' : '') + ' style="width:20px;height:20px"> Lieu 2 : La Sté</label>'
      + '<label class="mu" style="display:block;margin-top:10px">Type de soins<input class="in" data-af-f="type_soins" value="' + esc(a.type_soins || '') + '" placeholder="ex. Endo, Chirurgie…"></label></div>';
    h += '<div class="card"><b>🚚 Fournisseurs</b> <span class="mu">(★ le premier = principal)</span>' + F.foEdit.map(function (x, i) {
      return '<div class="row wrap forow" style="margin-top:8px"><span style="width:18px">' + (i === 0 ? '★' : '') + '</span><select class="in grow" data-fo-i="' + i + '" data-fo-k="fournisseur_id">' + optFo(x.fournisseur_id, 'Choisir…') + '</select>'
        + '<input class="in" style="width:110px" inputmode="decimal" placeholder="Prix €" data-fo-i="' + i + '" data-fo-k="prix" value="' + esc(x.prix || '') + '"><input class="in" style="width:130px" placeholder="Réf." data-fo-i="' + i + '" data-fo-k="reference" value="' + esc(x.reference || '') + '">'
        + (i > 0 ? '<button class="btn l sm" data-fotop="' + i + '" title="Mettre en principal">★</button>' : '') + '<button class="btn l sm" data-fodel="' + i + '" aria-label="Retirer">✕</button></div>';
    }).join('') + '<button class="btn l sm" style="margin-top:10px" data-act="foadd">+ Ajouter un fournisseur</button></div>';
    return h + '<div class="row wrap actrow"><button class="btn l" data-act="aannule">Annuler</button><button class="btn" data-act="asave"' + (F.busy ? ' disabled' : '') + '>Enregistrer</button>' + (!nouv ? '<span class="grow"></span><button class="btn l sm" data-act="aarch">' + (a.archive ? 'Réactiver' : 'Archiver') + '</button><button class="btn ko sm" data-act="asuppr">🗑 Supprimer</button>' : '') + '</div>';
  }
  function sauverArticle() {
    var F = S.fiche, a = F.d, nouv = F.id === 'new';
    var o = { nom: String(a.nom || '').trim(), reference: String(a.reference || '').trim() || 'SR', conditionnement: a.conditionnement, qte_par_boite: Math.max(1, nb(a.qte_par_boite) || 1),
      consommation: a.consommation, seuil: a.sans_seuil ? 0 : Math.max(0, nb(a.seuil)), sans_seuil: !!a.sans_seuil, conso_verifiee: !!a.conso_verifiee,
      lieu_cabinets: a.lieu_cabinets !== false, lieu_ste: a.lieu_ste === true, type_soins: String(a.type_soins || '').trim() || null };
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
  function stockPartout(id) { var t = []; for (var e = 0; e <= 9; e++) { var q = stockDe(id, e); if (Math.abs(q) > 1e-9) t.push(cabTxt(e) + ' : ' + fr(q)); } return t; }
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
      + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (e) { return '<label class="mu">' + cabTxt(e) + '<input class="in" inputmode="decimal" data-cor="' + e + '" value="' + esc(c.v[e]) + '"></label>'; }).join('')
      + '</div><div class="row" style="margin-top:10px"><button class="btn l sm" data-act="corx">Annuler</button><button class="btn sm" data-act="cor2">Enregistrer la correction</button></div></div>';
  }
  function corChanges() { var a = S.fiche.d, c = S.fiche.cor, out = []; for (var e = 0; e <= 9; e++) { var v = Math.max(0, nb(String(c.v[e]).replace(',', '.'))), s = stockDe(a.id, e); if (Math.abs(v - s) > 1e-9) out.push({ emp: e, avant: s, apres: v }); } return out; }
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
      return h + '<div class="row wrap actrow"><button class="btn l" data-act="foannule">Annuler</button><button class="btn" data-act="fosave">Enregistrer</button>' + (F.id !== 'new' ? '<span class="grow"></span><button class="btn l sm" data-act="foarchive">' + (f.archive ? 'Réactiver' : 'Archiver') + '</button><button class="btn ko sm" data-act="fosuppr">🗑 Supprimer</button>' : '') + '</div>';
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
  // ---------- Bilan des écarts (Plus) ----------
  var PERIODES = [['mois', 'Ce mois-ci'], ['prec', 'Mois dernier'], ['3m', '3 derniers mois'], ['12m', '12 derniers mois']];
  function bornes(p) {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth();
    if (p === 'mois') return [new Date(y, m, 1), null];
    if (p === 'prec') return [new Date(y, m - 1, 1), new Date(y, m, 1)];
    if (p === '3m') return [new Date(y, m - 2, 1), null];
    return [new Date(y, m - 11, 1), null];
  }
  function chargerEcarts() {
    var E = S.ecarts = S.ecarts || { p: 'mois' }, b = bornes(E.p);
    E.charge = true; E.l = null;
    var q = sb.from('mouvements').select('cree_le,type,statut,article_id,article_nom,emplacement_de,ecart,valeur,motif,auteur_nom').not('ecart', 'is', null).neq('statut', 'annule').gte('cree_le', b[0].toISOString()).order('cree_le', { ascending: false }).limit(5000);
    if (b[1]) q = q.lt('cree_le', b[1].toISOString());
    q.then(function (r) { E.charge = false; E.l = r.error ? [] : r.data; E.err = r.error ? msgErr(r.error) : null; render(); });
  }
  function vEcarts() {
    if (!S.ecarts) setTimeout(chargerEcarts, 0);
    var E = S.ecarts || { p: 'mois' };
    var h = '<div class="card"><div class="row wrap"><b class="grow">📉 Bilan des écarts de stock</b></div><div class="chips" style="margin:8px 0 10px">'
      + PERIODES.map(function (x) { return '<button class="chip' + (E.p === x[0] ? ' on' : '') + '" data-ecp="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    if (E.charge || !E.l) return h + '<p class="mu">Chargement…</p></div>';
    if (E.err) return h + '<p class="ban ko">' + esc(E.err) + '</p></div>';
    var j0 = 0, corr = 0, L = [], conso = 0, consoN = 0;
    E.l.forEach(function (m) {
      if (/^Inventaire de départ/.test(m.motif || '')) { j0++; return; }
      // Inventaire d'un cabinet : ce qui manque a été utilisé pour les soins, ce n'est pas une perte
      if (m.type === 'inventaire' && m.emplacement_de > 0 && +m.ecart < 0) { conso += +m.valeur || 0; consoN++; return; }
      if (m.type === 'correction') { corr++; return; }
      L.push(m);
    });
    var pertes = 0, gains = 0, parEmp = {}, parArt = {}, parMotif = {};
    L.forEach(function (m) {
      var v = +m.valeur || 0, e = m.type === 'sortie' ? 0 : (m.emplacement_de == null ? 0 : m.emplacement_de), a = S.byId[m.article_id], nom = a ? a.nom : (m.article_nom || 'article supprimé');
      if (v < 0) pertes += v; else gains += v;
      var pe = parEmp[e] = parEmp[e] || { n: 0, p: 0, g: 0 }; pe.n++; if (v < 0) pe.p += v; else pe.g += v;
      var pa = parArt[nom] = parArt[nom] || { q: 0, v: 0, n: 0 }; pa.q += +m.ecart || 0; pa.v += v; pa.n++;
      var mo = m.type === 'sortie' ? 'Sortie au-delà de la réserve' : m.type === 'retour' ? 'Retour (stock cabinet trop bas)' : (m.motif || (m.type === 'inventaire' ? 'Inventaire' : 'Régularisation'));
      var pm = parMotif[mo] = parMotif[mo] || { n: 0, v: 0 }; pm.n++; pm.v += v;
    });
    if (consoN) h += '<div class="ban ok" style="margin:0 0 10px">🦷 <b>Utilisé dans les cabinets et à la Sté : ' + eur(-conso) + '</b> (' + consoN + ' article(s), d’après les inventaires des cabinets). C’est la consommation normale des soins : elle n’est pas comptée dans les pertes.</div>';
    if (!L.length) h += '<p class="mu">Aucun écart sur cette période.</p>';
    else {
      h += '<div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="tile ko"><b>' + eur(pertes) + '</b><span>Pertes</span></div><div class="tile ok"><b>' + eur(gains) + '</b><span>Gains</span></div><div class="tile ' + (pertes + gains < 0 ? 'warn' : 'ok') + '"><b>' + eur(pertes + gains) + '</b><span>Solde</span><small>' + L.length + ' écart(s)</small></div></div>';
      h += '<b style="display:block;margin:12px 0 4px">Par emplacement</b>' + Object.keys(parEmp).sort(function (a, b) { return a - b; }).map(function (e) {
        var x = parEmp[e]; return '<div class="it"><div class="it-n"><b>' + cabTxt(+e) + '</b><span>' + x.n + ' écart(s)</span></div><div style="text-align:right"><b style="color:var(--ko)">' + eur(x.p) + '</b><br><small class="mu">gains ' + eur(x.g) + '</small></div></div>';
      }).join('');
      var top = Object.keys(parArt).map(function (k) { return [k, parArt[k]]; }).filter(function (x) { return x[1].v < 0; }).sort(function (a, b) { return a[1].v - b[1].v; }).slice(0, 10);
      if (top.length) h += '<b style="display:block;margin:14px 0 4px">Les 10 plus grosses pertes</b>' + top.map(function (x) {
        return '<div class="it"><div class="it-n"><b>' + esc(x[0]) + '</b><span>' + fr(x[1].q) + ' · ' + x[1].n + ' fois</span></div><b style="color:var(--ko)">' + eur(x[1].v) + '</b></div>';
      }).join('');
      h += '<b style="display:block;margin:14px 0 4px">Par motif</b>' + Object.keys(parMotif).sort(function (a, b) { return parMotif[a].v - parMotif[b].v; }).map(function (k) {
        return '<div class="it"><div class="it-n"><b>' + esc(k) + '</b><span>' + parMotif[k].n + ' écart(s)</span></div><b>' + eur(parMotif[k].v) + '</b></div>';
      }).join('');
    }
    if (j0 || corr) h += '<p class="mu" style="margin:10px 0 0;font-size:13px">Non comptés dans le bilan : ' + (j0 ? j0 + ' ligne(s) de l’inventaire de départ (J0)' : '') + (j0 && corr ? ' et ' : '') + (corr ? corr + ' correction(s) sans impact financier' : '') + '.</p>';
    return h + '<p class="mu" style="margin:8px 0 0;font-size:13px">Valeurs au coût moyen TTC. Détail ligne par ligne dans l’Historique.</p></div>';
  }

  function vPlus() {
    var j = joursDepuis(S.sauv && S.sauv.date), h = '<h2>Plus</h2>';
    h += '<div class="card"><div class="row wrap sauvrow"><div class="grow"><b>💾 Sauvegarde</b><br><span class="mu">'
      + (S.sauv && S.sauv.date ? 'Dernière : ' + new Date(S.sauv.date).toLocaleDateString('fr-FR') + ' par ' + esc(S.sauv.par || '?') + (j ? ' (il y a ' + j + ' jour' + (j > 1 ? 's' : '') + ')' : ' (aujourd’hui)') : 'Aucune sauvegarde téléchargée pour l’instant')
      + '</span></div><button class="btn' + (sauvegardeEnRetard() ? ' gold' : '') + '" data-act="sauver"' + (S.sauvBusy ? ' disabled' : '') + '>' + (S.sauvBusy ? 'Préparation…' : 'Télécharger la sauvegarde') + '</button></div>'
      + '<p class="mu" style="margin:8px 0 0">Un fichier Excel avec une feuille par tableau : stock par emplacement, articles, prix par fournisseur, fournisseurs, commandes, mouvements, inventaires, équipe. À ranger dans un dossier sûr, une fois par mois. Les mots de passe des comptes fournisseurs n’y figurent pas.</p></div>';
    h += vEcarts();
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
      var stock = { nom: 'Stock', colonnes: ['Article', 'Référence', 'Fournisseur', 'Unité réserve', 'Réserve', 'Cab. 1', 'Cab. 2', 'Cab. 3', 'Cab. 4', 'Cab. 5', 'Cab. 6', 'Cab. 7', 'Cab. 8', 'La Sté', 'Coût moyen TTC', 'Valeur réserve TTC', 'Archivé'],
        lignes: D.articles.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom); }).map(function (a) {
          var s = st[a.id] || {}, r = s[0] || 0;
          return [a.nom, a.reference, nomF[a.fournisseur_id] || 'SF', a.conditionnement === 'BOITE' ? 'boîte de ' + a.qte_par_boite : 'unité', r].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (c) { return s[c] || 0; })).concat([+a.cout_moyen, Math.round(r * a.cout_moyen * 100) / 100, a.archive]);
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
    ['Livré', 'conditionnement'], ['Unités par boîte', 'qte_par_boite'], ['Sortie au cabinet', 'consommation'], ['Seuil', 'seuil'], ['Sans seuil', 'sans_seuil'], ['Conso. vérifiée', 'conso_verifiee'],
    ['Lieu 1 : Cabinets', 'lieu_cabinets'], ['Lieu 2 : La Sté', 'lieu_ste'], ['Type de soins', 'type_soins'], ['Archivé', 'archive'], ['Supprimer', 'supprimer']];
  function afPrincipal(a) { return a.fournisseur_id ? (S.afPrix[a.id] || []).filter(function (p) { return p.fournisseur_id === a.fournisseur_id; })[0] || null : null; }
  function exporterArticles() {
    var tous = S.articles.concat(S.archives).sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    var lignes = tous.map(function (a) {
      var p = afPrincipal(a);
      return [a.id, a.nom, a.reference || 'SR', S.fournisseurs[a.fournisseur_id] || 'SF', p ? +p.prix : +a.prix || 0, p && p.reference || '', a.conditionnement === 'BOITE' ? 'Boîte' : 'Unité', +a.qte_par_boite,
        a.consommation === 'BOITE' ? 'Boîte' : 'Unité', +a.seuil, a.sans_seuil ? 'oui' : 'non', a.conso_verifiee ? 'oui' : 'non', a.lieu_cabinets !== false ? 'oui' : 'non', a.lieu_ste === true ? 'oui' : 'non', a.type_soins || '', a.archive ? 'oui' : 'non', null, fr(stockDe(a.id, 0)) + ' ' + uRes(a), +a.cout_moyen];
    });
    var aide = [['Modifiez les cases à changer, puis importez le fichier avec « Importer Excel » dans l’onglet Articles.'], ['Une case laissée VIDE garde la valeur actuelle de la fiche.'], ['Ne modifiez pas la colonne N° : elle relie la ligne à la fiche.'],
      ['Nouvel article : ajoutez une ligne en bas SANS N°, avec au moins le Nom.'], ['Fournisseur principal : nom exact d’un fournisseur de la feuille Fournisseurs, ou SF pour « sans fournisseur ».'], ['Référence : SR pour « sans référence ».'],
      ['Livré / Sortie au cabinet : Boîte ou Unité.  Sans seuil, Conso. vérifiée, Archivé : oui ou non.'],
      ['Lieu 1 : Cabinets / Lieu 2 : La Sté : oui ou non. Un article peut avoir les deux. Il n’apparaît dans les listes de Sortie et d’Inventaire que pour ses lieux (la recherche trouve tout).'], ['Type de soins : texte libre pour l’instant (une liste fixe sera créée à partir de ce que vous écrivez). Écrivez un tiret « - » pour vider la case.'], ['Prix TTC : prix chez le fournisseur principal (le dernier prix connu).'], ['Les colonnes « (info) » ne sont pas importées : la réserve se met à jour par l’inventaire.'], ['Supprimer une fiche : écrivez oui dans la colonne « Supprimer ». Effacer une ligne du fichier ne supprime rien. Une fiche qui a encore du stock (réserve ou cabinets) ou qui est attendue dans une commande en cours ne peut pas être supprimée.']];
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
      var CH = { nom: 'Nom', reference: 'Référence', fournisseur_id: 'Fournisseur', prix: 'Prix TTC', ref_fo: 'Réf. fournisseur', conditionnement: 'Livré', qte_par_boite: 'Unités par boîte', consommation: 'Sortie au cabinet', seuil: 'Seuil', sans_seuil: 'Sans seuil', conso_verifiee: 'Conso. vérifiée', archive: 'Archivé', lieu_cabinets: 'Lieu 1 : Cabinets', lieu_ste: 'Lieu 2 : La Sté', type_soins: 'Type de soins' };
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
        if (!vide(cell('type_soins'))) { var ts = String(cell('type_soins')).trim(); v.type_soins = /^[-–—]$/.test(ts) ? '' : ts; }
        ['sans_seuil', 'conso_verifiee', 'archive', 'lieu_cabinets', 'lieu_ste'].forEach(function (k) { if (!vide(cell(k))) { var b = ouiNon(cell(k)); if (b == null) err.push(CH[k] + ' : oui ou non'); else v[k] = b; } });
        if (err.length) { R.erreurs.push('Ligne ' + n + (a ? ' (' + a.nom + ')' : '') + ' : ' + err.join(', ')); return; }
        R.nb++;
        if (!a) { if (!v.nom) { R.erreurs.push('Ligne ' + n + ' : nouvel article sans nom'); return; } R.nouveaux.push({ ligne: n, v: v }); return; }
        var pr = afPrincipal(a), act = { nom: a.nom, reference: a.reference || 'SR', fournisseur_id: a.fournisseur_id || null, prix: pr ? +pr.prix : +a.prix || 0, ref_fo: pr && pr.reference || '', conditionnement: a.conditionnement, qte_par_boite: +a.qte_par_boite, consommation: a.consommation, seuil: +a.seuil, sans_seuil: !!a.sans_seuil, conso_verifiee: !!a.conso_verifiee, archive: !!a.archive, lieu_cabinets: a.lieu_cabinets !== false, lieu_ste: a.lieu_ste === true, type_soins: a.type_soins || '' };
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
    var upd = {}; ['nom', 'reference', 'conditionnement', 'qte_par_boite', 'consommation', 'seuil', 'sans_seuil', 'conso_verifiee', 'archive', 'lieu_cabinets', 'lieu_ste', 'type_soins'].forEach(function (k) { if (k in v) upd[k] = v[k]; });
    if ('type_soins' in upd) upd.type_soins = upd.type_soins || null;
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
    if (S.eqNew && !S.eqNew.lierA) h += vEqNew();
    var ps = S.profils.slice().sort(function (a, b) { return (b.actif - a.actif) || a.nom.localeCompare(b.nom); });
    return h + ps.map(carteProfil).join('');
  }
  function vEqNew() {
      var N = S.eqNew;
      return '<div class="card" style="border:2px solid var(--gold)"><b>Nouveau compte</b><div class="g2" style="margin-top:8px">'
        + '<label class="mu">Identifiant de connexion<input class="in" id="nid" autocomplete="off" autocapitalize="none" value="' + esc(N.identifiant) + '" placeholder="ex. sarah"></label>'
        + '<label class="mu">Prénom affiché<input class="in" id="nnom" value="' + esc(N.nom) + '"></label>'
        + '<label class="mu">Rôle<select class="in" id="nrole">' + ['assistante', 'referente', 'responsable'].map(function (r) { return '<option value="' + r + '"' + (N.role === r ? ' selected' : '') + '>' + LABEL[r] + '</option>'; }).join('') + '</select></label>'
        + '<label class="mu">Cabinet par défaut<select class="in" id="ncab"><option value="">Aucun</option>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (c) { return '<option value="' + c + '"' + (+N.cabinet === c ? ' selected' : '') + '>Cabinet ' + c + '</option>'; }).join('') + '</select></label>'
        + champMdp('nmdp', N.role, N.role === 'assistante' ? 'Code' : 'Mot de passe') + champMdp('nmdp2', N.role, 'Confirmer')
        + '</div><p class="mu" style="margin:10px 0">Notez le code et donnez-le à la personne : il ne sera plus affiché ensuite.</p>'
        + '<div class="row"><button class="btn l" data-act="eqnewno">Annuler</button><button class="btn" data-act="eqnewok"' + (N.busy ? ' disabled' : '') + '>Créer le compte</button></div></div>';
  }
  function carteProfil(p) {
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
    }
  function creerCompte() {
    var N = S.eqNew, m = $('nmdp').value, m2 = $('nmdp2').value;
    N.identifiant = norm($('nid').value).replace(/\s+/g, ''); N.nom = $('nnom').value.trim();
    if (!N.identifiant || !N.nom) { toast('Identifiant et prénom obligatoires'); return; }
    var pb = regleMdp(N.role, m); if (pb) { toast(pb); return; }
    if (m !== m2) { toast('Les deux saisies ne correspondent pas'); return; }
    N.busy = true; render();
    equipe({ action: 'creer', identifiant: N.identifiant, nom: N.nom, role: N.role, cabinet: N.cabinet ? +N.cabinet : null, mdp: m }).then(function (r) {
      if (!N.lierA) return r;
      // Compte créé depuis une fiche du planning : on relie la fiche au compte
      return sb.from('profils').select('id').eq('identifiant', r.identifiant).maybeSingle().then(function (x) { return x.data ? lierCompte(N.lierA, x.data.id).then(function () { return r; }) : r; });
    }).then(function (r) {
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
      + '</div><div class="row" style="margin-top:12px"><button class="btn l" data-tab="' + (gestion() ? 'hub' : 'moi') + '">Annuler</button><button class="btn" data-act="cmok"' + (S.cmBusy ? ' disabled' : '') + '>Enregistrer</button></div></div>';
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
      S.cmBusy = false; toast('✔ ' + (r === 'assistante' ? 'Code' : 'Mot de passe') + ' changé'); S.tab = gestion() ? 'hub' : 'moi'; render();
    }).catch(function (e) { S.cmBusy = false; toast(msgErr(e)); render(); });
  }

  // ---------- Événements (délégation) ----------
  // Quand on revient dans une recherche (après avoir ajouté un article), tout le texte est sélectionné :
  // il suffit de taper pour chercher autre chose, sans obtenir « gantservi ».
  var RECHERCHES = ['sq', 'rq', 'iq', 'ncq', 'caq', 'aq', 'fq', 'stq'];
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (S.refocus || !t || RECHERCHES.indexOf(t.id) < 0 || !t.value) return;
    setTimeout(function () { try { t.setSelectionRange(0, t.value.length); } catch (x) { try { t.select(); } catch (y) {} } }, 60);
  });
  document.addEventListener('toggle', function (e) { var g = e.target && e.target.dataset && e.target.dataset.guide; if (g && e.target.open) { marquerVu(g); S.aideOuverte = g; } }, true);
  window.addEventListener('resize', function () { if (S.tour) placerTour(); });
  // Fiche d'une personne : les totaux d'heures se recalculent quand on quitte un horaire ou la case du contrat
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.plk && S.pl && S.pl.cas) { setTimeout(function () { var a = document.activeElement; if (a && a.dataset && a.dataset.plk) return; if (S.pl && S.pl.cas) render(); }, 0); return; }
    if (!S.pf || !t || !t.dataset || !(t.dataset.tr || t.dataset.pff === 'contrat_h')) return;
    setTimeout(function () { var a = document.activeElement; if (a && a.dataset && (a.dataset.tr || a.dataset.pff)) return; if (S.tab === 'pfiche') render(); }, 0);
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || !S.me) return;
    var d = t.dataset;
    if (d.go) { var g = d.go.split(':'); S.tab = g[0]; S.tabChoisi = true; if (g[0] === 'stock') S.stockF = g[1] || ''; if (g[0] === 'inventaire' && g[1] !== undefined) choisirEmp(+g[1]); if (g[0] === 'histo') { S.histTous = true; chargerHisto(); } render(); window.scrollTo(0, 0); return; }
    if (d.act === 'ireste') { S.inv.reste = true; S.inv.cherche = false; S.inv.q = ''; render(); return; }
    if (d.act === 'itout') { S.inv.reste = false; S.inv.cherche = false; S.inv.q = ''; render(); return; }
    if (d.act === 'icherche') { S.inv.cherche = !S.inv.cherche; S.inv.q = ''; render(); var iq = $('iq'); if (iq) iq.focus(); return; }
    if (d.stri) { S.sortie.tri = d.stri; S.sortie.max = 30; render(); window.scrollTo(0, 0); return; }
    if (d.act === 'refaire') return refaireSortie();
    if (d.act === 'accueil') { S.sortie.ok = null; S.sortie.voir = false; S.tab = gestion() ? 'accueil' : 'maison'; render(); window.scrollTo(0, 0); return; }
    if (d.act === 'snouv') { S.sortie.ok = null; S.tab = 'sortie'; render(); window.scrollTo(0, 0); return; }
    if (d.act === 'tour') { lancerTour(); return; }
    if (d.act === 'toursuiv') { if (S.tour.i >= etapesTour().length - 1) { S.tour = null; marquerVu('visite'); render(); toast('✔ Visite terminée — les fiches restent dans Aide'); } else { S.tour.i++; allerEtape(); } return; }
    if (d.act === 'tourprec') { S.tour.i = Math.max(0, S.tour.i - 1); allerEtape(); return; }
    if (d.act === 'tourfin') { S.tour = null; render(); return; }
    if (d.act === 'bvno') { marquerVu('bienvenue'); render(); return; }
    if (d.essai) { marquerVu(d.gid); S.aideOuverte = d.gid; S.tab = d.essai; S.tabChoisi = true; if (d.essai === 'histo') chargerHisto(); render(); window.scrollTo(0, 0); return; }
    if (d.act === 'menu') { S.menu = !S.menu; render(); return; }
    if (d.tab) { if (d.tab === 'pointage' && S.tab !== 'pointage') { S.ptg = S.ptg || { rows: {} }; S.ptg.mode = 'semaine'; S.ptg.jour = dIso(new Date()); if (S.ptg.bord) S.ptg.bord.sel = null; }   // le pointage s'ouvre toujours sur la semaine en cours
    if (d.tab === 'ppostes') S.postesEd = null; if (d.tab === 'ptypes') S.typesEd = null; S.menu = false; S.fiche = null; if (d.tab === 'sortie') S.sortie.ok = null; S.tab = d.tab; S.tabChoisi = true; if (d.tab === 'histo') chargerHisto(); if (d.tab === 'plus') chargerEcarts(); render(); window.scrollTo(0, 0); return; }
    if (d.act === 'out') { if (confirm('Changer de personne ? La personne suivante devra se connecter avec son identifiant et son code.')) deconnexion(); return; }
    if (d.act === 'maj') return mettreAJour();
    if (d.ecp) { S.ecarts = S.ecarts || {}; S.ecarts.p = d.ecp; chargerEcarts(); render(); return; }
    if (d.act === 'sauver') return telechargerSauvegarde();
    if (d.act === 'aexp') return exporterArticles();
    if (d.act === 'asuppr') return supprimerArticle();
    if (d.act === 'aimpno') { S.artImp = null; render(); return; }
    if (d.act === 'aimpok') return appliquerImportArticles();
    if (d.act === 'iexp') return exporterComptage();
    if (d.act === 'svoir') { S.sortie.voir = !S.sortie.voir; render(); window.scrollTo(0, 0); return; }
    if (d.act === 'splus') { S.sortie.max = (S.sortie.max || 30) + 40; render(); return; }
    if (d.act === 'valider') return validerSortie();
    if (d.act === 'rvalider') return validerRetour();
    if (d.act === 'rvider') { S.ret.panier = {}; render(); return; }
    if (d.rplus) { setRet(d.rplus, (S.ret.panier[d.rplus] || 0) + 1); S.ret.msg = null; render(); return; }
    if (d.rmoins) { setRet(d.rmoins, (S.ret.panier[d.rmoins] || 0) - 1); render(); return; }
    if (d.act === 'vider') { S.sortie.panier = {}; S.sortie.voir = false; render(); return; }
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
    if (d.act === 'cor') { var a0 = S.fiche.d, v0 = {}; for (var e0 = 0; e0 <= 9; e0++) v0[e0] = fr(stockDe(a0.id, e0)); S.fiche.cor = { etape: 1, v: v0 }; render(); return; }
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
    if (d.pf) return ouvrirPers(d.pf);
    if (d.dent) return ouvrirDent(d.dent);
    if (d.act === 'pfnew') return ouvrirPers('new');
    if (d.act === 'dfnew') return ouvrirDent('new');
    if (d.act === 'pfsave') return sauverPers();
    if (d.act === 'dfsave') return sauverDent();
    if (d.dextra) return basculerExtra(d.dextra);
    if (d.djour && S.df) { var dj = S.df.d.jours = S.df.d.jours || {}; if (dj[d.djour]) delete dj[d.djour]; else dj[d.djour] = true; render(); return; }
    if (d.cgm) { var cx = (S.cgMois || dIso(new Date()).slice(0, 7)).split('-'), cdt = new Date(+cx[0], +cx[1] - 1 + (+d.cgm), 1); S.cgMois = cdt.getFullYear() + '-' + ('0' + (cdt.getMonth() + 1)).slice(-2); render(); return; }
    if (d.act === 'exouvre' && S.df) { S.df.exOuvert = !S.df.exOuvert; render(); return; }
    if (d.act === 'pfcompte' && S.pf) { var pr = S.pf.d.prenom || ''; S.eqNew = { identifiant: norm(pr).replace(/[^a-z0-9]/g, ''), nom: pr, role: 'assistante', cabinet: '', lierA: S.pf.id }; S.eqEdit = null; render(); return; }
    if (d.act === 'pfdelier' && S.pf) { if (confirm('Détacher le compte de connexion de cette fiche ? Le compte reste actif, il n’est simplement plus relié au planning.')) lierCompte(S.pf.id, null); return; }
    if (d.act === 'plcal') { var ci = document.getElementById('plcal'); if (ci) { try { if (ci.showPicker) ci.showPicker(); else { ci.focus(); ci.click(); } } catch (er) { ci.focus(); ci.click(); } } return; }
    if (d.plsem != null && S.pl) { S.pl.lundi = d.plsem === '0' ? lundiDe(dIso(new Date())) : addJ(S.pl.lundi, +d.plsem); S.pl.cas = null; if (gestion()) chargerSemaine(); else S.pl.de = null; render(); return; }
    if (d.plc) return ouvrirCase(d.plc);
    if (d.act === 'ptok') { S.ptRes = null; render(); return; }
    if (d.pfong != null && S.pf) { S.pf.onglet = d.pfong || null; render(); window.scrollTo(0, 0); return; }
    if (d.pfcel && S.pf) { S.pf.cel = d.pfcel; render(); return; }
    if (d.act === 'pfcopiejour' && S.pf) { var tj = S.pf.d.trame = S.pf.d.trame || {}, src = JSON.parse(JSON.stringify(tj[d.j] || {})); for (var jj2 = 1; jj2 <= 5; jj2++) if (String(jj2) !== String(d.j)) tj[jj2] = JSON.parse(JSON.stringify(src)); toast('Copié sur toute la semaine · pensez à enregistrer'); render(); return; }
    if ((d.poup != null || d.podown != null || d.poret != null || d.tyret != null || /^(poadd|posave|tyadd|tysave)$/.test(d.act || '')) && actionReglages(d)) return;
    if (d.act === 'rgqr') { S.tab = 'pointage'; S.ptg = S.ptg || { mode: 'semaine', jour: dIso(new Date()), rows: {} }; ouvrirQR(); return; }
    if (d.act === 'scan') return ouvrirScanner();
    if (d.ptsens && S.ptRes && S.ptRes.choix) return envoyerPointage(S.ptRes.choix, d.ptsens);
    if (d.act === 'simraz') { S.sim = null; try { sessionStorage.removeItem('evy-sim'); } catch (e) {} chargerMonPointage(); render(); return; }
    if (d.act === 'simscan') { var jt0 = ''; try { jt0 = localStorage.getItem('evy-jeton-test') || ''; } catch (e) {} if (jt0) { JETON_QR = jt0; pointerQR(); } return; }
    if (d.act === 'simgestion') return basculerSimulation();
    if (d.act === 'ptqr') return ouvrirQR();
    if (d.act === 'ptlog' && S.ptg) { var lL = lundiDe(S.ptg.jour); S.ptLog = S.ptg.mode === 'jour' ? { du: S.ptg.jour, au: S.ptg.jour } : { du: lL, au: addJ(lL, 6) }; chargerJournalPt(); return; }
    if (d.act === 'ptlogfermer') { S.ptLog = null; render(); return; }
    if (d.act === 'ptlogok' && S.ptLog) return exporterJournalPt();
    if (d.act === 'ptqrfermer') { S.ptQR = null; render(); return; }
    if (d.act === 'ptimprimer') return imprimerQR();
    if (d.act === 'ptregen') return regenererQR();
    if (d.ptmode && S.ptg) { S.ptg.mode = d.ptmode; render(); return; }
    if (d.svg && S.ptg && S.ptg.surv) { S.ptg.surv.ouvert[d.svg] = !S.ptg.surv.ouvert[d.svg]; render(); return; }
    if (d.svtout && S.ptg && S.ptg.surv) { S.ptg.surv.tout[d.svtout] = !S.ptg.surv.tout[d.svtout]; render(); return; }
    if (d.ptbper && S.ptg && S.ptg.bord) { S.ptg.bord.per = d.ptbper; S.ptg.bord.sel = null; render(); return; }
    if (d.ptbnav != null && d.ptbnav !== '' && S.ptg && S.ptg.bord) { var Bn = S.ptg.bord, bn = +d.ptbnav; if (!bn) { Bn.lundi = lundiDe(dIso(new Date())); Bn.mois = addJ(Bn.lundi, 3).slice(0, 7); render(); return; } if (Bn.per === 'semaine') Bn.lundi = addJ(Bn.lundi, 7 * bn); else { var bx = Bn.mois.split('-'), bd = new Date(+bx[0], +bx[1] - 1 + bn, 1); Bn.mois = bd.getFullYear() + '-' + ('0' + (bd.getMonth() + 1)).slice(-2); } render(); return; }
    if (d.ptbsel != null && S.ptg && S.ptg.bord) { S.ptg.bord.sel = d.ptbsel || null; render(); window.scrollTo(0, 0); return; }
    if (d.ptnav != null && d.ptnav !== '' && S.ptg) { var pn = +d.ptnav, G = S.ptg; if (!pn) G.jour = dIso(new Date()); else if (G.mode === 'semaine') G.jour = addJ(lundiDe(G.jour), 7 * pn); else { var jx = addJ(G.jour, pn); while (jourSem(jx) < 1 || jourSem(jx) > 5) jx = addJ(jx, pn); G.jour = jx; } render(); return; }
    if (d.pted && S.ptg) { var pe = d.pted.split('|'); S.ptEd = { eid: pe[0], jour: pe[1] }; render(); return; }
    if (d.act === 'ptedfermer') { S.ptEd = null; render(); return; }
    if (d.act === 'ptsave' && S.ptEd) return sauverPointage(false);
    if (d.act === 'ptsuppr' && S.ptEd) return sauverPointage(true);
    if (d.hrmode && S.hr) { S.hr.mode = d.hrmode; render(); window.scrollTo(0, 0); return; }
    if (d.hrnav && S.hr) { var Hn = S.hr, sn = +d.hrnav; if (Hn.mode === 'semaine') Hn.lundi = addJ(Hn.lundi, 7 * sn); else { var xm = Hn.mois.split('-'), dm2 = new Date(+xm[0], +xm[1] - 1 + sn, 1); Hn.mois = dm2.getFullYear() + '-' + ('0' + (dm2.getMonth() + 1)).slice(-2); } render(); return; }
    if (d.hrsel != null && S.hr) { S.hr.sel = d.hrsel || null; render(); window.scrollTo(0, 0); return; }
    if (d.hrouvrir) { S.pl = S.pl || { rows: {} }; S.pl.lundi = d.hrouvrir; S.tab = 'planning'; render(); window.scrollTo(0, 0); return; }
    if (d.act === 'plexp' && S.pl) { var mw = addJ(S.pl.lundi, 2).slice(0, 7); S.plExp = { mois: [mw] }; render(); return; }
    if (d.act === 'plexpfermer') { S.plExp = null; render(); return; }
    if (d.act === 'plexpok' && S.plExp) return exporterPlanning();
    if (d.plmois && S.plExp && !S.plExp.busy) { var em = S.plExp.mois, ei = em.indexOf(d.plmois); if (ei >= 0) em.splice(ei, 1); else em.push(d.plmois); render(); return; }
    if (d.act === 'plfermer' && S.pl) { S.pl.cas = null; render(); return; }
    if (d.plabs && S.pl && S.pl.cas) { ['AM', 'PM'].forEach(function (k) { S.pl.cas[k] = { a: d.plabs, de: null, fi: null }; }); S.pl.cas.jc = true; render(); return; }
    if (d.act === 'plsave') return sauverCase();
    if (d.act === 'plreset') return caseSemaineType();
    if (d.act === 'plimpno') { S.plImp = null; render(); return; }
    if (d.act === 'plimpok') return appliquerImportPlanning();
    if (d.rgpOuvrir) { var pr2 = persById(d.rgpOuvrir); S.rgEdit = { id: pr2.id, r: Object.assign({}, pr2.regles || {}), consigne: pr2.consigne || '' }; render(); return; }
    if (d.act === 'rgpno') { S.rgEdit = null; render(); return; }
    if (d.act === 'rgpok') return sauverReglePers();
    if (d.act === 'rgsave') return sauverRegles();
    if (d.cok) return repondre(d.cok, true);
    if (d.crefus) return repondre(d.crefus, false);
    if ((d.act && d.act.slice(0, 3) === 'off') || d.offmod || d.offj || d.offd || d.offr || d.offn) { if (actionOff(d)) return; }
    if (d.csuppr) return supprimerConges(d.csuppr);
    if (d.cmodif) { var cm = (S.conges || []).filter(function (c) { return String(c.id) === String(d.cmodif); })[0]; if (cm) { S.cAjout = { cle: d.cle, id: cm.id, du: cm.du, au: cm.au, type: cm.type, mot: cm.mot || '', formation: !!d.cform }; render(); } return; }
    if (d.cadd) { S.cAjout = { cle: d.cadd, type: 'CP', formation: !!d.cform }; render(); return; }
    if (d.act === 'caannule') { S.cAjout = null; render(); return; }
    if (d.act === 'caok') return ajouterConges();
    if (d.cannule) { if (!confirm('Annuler cette demande de congés ?')) return; sb.rpc('annuler_conges', { p_id: +d.cannule }).then(function (r) { if (r.error) throw r.error; toast('Demande annulée'); chargerMesConges(); }).catch(function (e) { toast(msgErr(e)); }); return; }
    if (d.dmun != null && S.dm) { var x1 = $('dmdu'), x2 = $('dmau'), x3 = $('dmmot'); if (x1) S.dm.du = x1.value; if (x2) S.dm.au = x2.value; if (x3) S.dm.mot = x3.value; S.dm.un = d.dmun === '1'; render(); return; }
    if (d.act === 'dmenvoi') return envoyerDemande();
    if (d.act === 'planbientot') { toast('Arrive à l’étape du planning'); return; }
    if (d.act === 'eqnew') { S.eqNew = { identifiant: '', nom: '', role: 'assistante', cabinet: '' }; S.eqEdit = null; render(); return; }
    if (d.act === 'eqnewno') { S.eqNew = null; render(); return; }
    if (d.act === 'eqnewok') return creerCompte();
    if (d.act === 'cmok') return changerMonMdp();
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.id === 'rgq') {   // recherche dans les réglages : on masque sans redessiner (le curseur reste dans le champ)
      var qq = norm(t.value).trim(), vus = 0;
      document.querySelectorAll('.rg-bloc').forEach(function (b) { var n = 0; b.querySelectorAll('[data-rgi]').forEach(function (x) { var ok = !qq || norm(x.dataset.rgi).indexOf(qq) >= 0 || norm(b.querySelector('h2').textContent).indexOf(qq) >= 0; x.hidden = !ok; if (ok) n++; }); b.hidden = !n; vus += n; });
      var v0 = document.querySelector('.rg-vide'); if (v0) v0.hidden = !!vus; return;
    }
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
    else if (t.dataset && (t.dataset.pff || t.dataset.tr) && S.pf && t.tagName !== 'SELECT' && t.type !== 'checkbox') majPers(t);
    else if (t.dataset && t.dataset.dff && S.df && t.type !== 'checkbox') S.df.d[t.dataset.dff] = t.value;
    else if (t.id === 'caint' && S.cAjout) S.cAjout.mot = t.value;
    else if (t.dataset && t.dataset.plk && S.pl && S.pl.cas && t.tagName !== 'SELECT') majCase(t);
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!S.me) return;
    if (t.dataset && (t.dataset.pff || t.dataset.tr) && S.pf) { majPers(t); if (t.tagName === 'SELECT' || t.type === 'checkbox') render(); return; }
    if (t.dataset && t.dataset.dff && S.df) { S.df.d[t.dataset.dff] = t.type === 'checkbox' ? t.checked : t.value; if (t.type === 'checkbox') render(); return; }
    if (t.dataset && S.postesEd && (t.dataset.pon != null || t.dataset.poxl != null || t.dataset.poc != null)) { var pe = S.postesEd[+(t.dataset.pon || t.dataset.poxl || t.dataset.poc)]; if (t.dataset.pon != null) pe.n = t.value.trim() || pe.n; else if (t.dataset.poxl != null) pe.xl = t.value.trim(); else pe.coul = t.value.replace('#', '').toUpperCase(); return; }
    if (t.dataset && S.typesEd && (t.dataset.typl != null || t.dataset.tyco != null || t.dataset.tyde != null)) { var te = S.typesEd[+(t.dataset.typl || t.dataset.tyco || t.dataset.tyde)]; if (t.dataset.typl != null) te.planning = t.checked; else if (t.dataset.tyco != null) te.contrat = t.checked; else te.dentiste = t.checked; return; }
    if (t.dataset && t.dataset.ddep && S.df) { var jj = S.df.d.jours = S.df.d.jours || {}; jj[t.dataset.ddep] = t.value ? t.value : true; render(); return; }
    if ((t.id === 'ptlogdu' || t.id === 'ptlogau') && S.ptLog) { S.ptLog[t.id === 'ptlogdu' ? 'du' : 'au'] = t.value; chargerJournalPt(); return; }
    if (t.id === 'ptlogqui' && S.ptLog) { S.ptLog.qui = t.value; render(); return; }
    if ((t.id === 'simj' || t.id === 'simh') && CONFIG.env === 'dev') { S.sim = S.sim || {}; S.sim[t.id === 'simj' ? 'jour' : 'heure'] = t.value; if (S.sim.jour && !S.sim.heure) S.sim.heure = '08:30'; if (S.sim.heure && !S.sim.jour) S.sim.jour = dIso(new Date()); try { sessionStorage.setItem('evy-sim', JSON.stringify(S.sim)); } catch (e) {} chargerMonPointage(); render(); return; }
    if ((t.id === 'offdu' || t.id === 'offau') && S.offEd) { S.offEd[t.id === 'offdu' ? 'du' : 'au'] = t.value; render(); return; }
    if (t.id === 'plcal' && S.pl && t.value) { S.pl.lundi = lundiDe(t.value); S.pl.cas = null; if (gestion()) chargerSemaine(); else S.pl.de = null; render(); return; }
    if (t.dataset && t.dataset.pljc && S.pl && S.pl.cas) {
      var K2 = S.pl.cas; K2.jc = t.checked;
      if (t.checked && K2.PM.a !== K2.AM.a) majCase({ value: K2.AM.a && K2.AM.a !== 'OFF' ? K2.AM.a : K2.PM.a, dataset: { plk: 'J.a' } });
      render(); return;
    }
    if (t.dataset && t.dataset.plk && S.pl && S.pl.cas) { majCase(t); if (t.tagName === 'SELECT') render(); return; }
    if (t.id === 'plimpf') { var fp = t.files && t.files[0]; t.value = ''; importerPlanning(fp); return; }
    if (t.dataset && t.dataset.vis) { basculerVisible(t.dataset.vis, t.checked); return; }
    if (t.dataset && t.dataset.qp) { basculerPointage(t.dataset.qp, t.checked); return; }
    if ((t.id === 'dmdu' || t.id === 'dmau') && S.dm) { S.dm[t.id === 'dmdu' ? 'du' : 'au'] = t.value; if (t.id === 'dmdu' && S.dm.au && S.dm.au < t.value) S.dm.au = t.value; var mm = $('dmmot'); if (mm) S.dm.mot = mm.value; render(); return; }
    if (t.id === 'caint' && S.cAjout) { S.cAjout.mot = t.value; return; }
    if ((t.id === 'cadu' || t.id === 'caau' || t.id === 'catype') && S.cAjout) { S.cAjout[t.id === 'cadu' ? 'du' : t.id === 'caau' ? 'au' : 'type'] = t.value; if (t.id === 'cadu' && !S.cAjout.au) { S.cAjout.au = t.value; render(); } return; }
    if (t.id === 'pflier' && S.pf && t.value) { if (confirm('Relier ce compte de connexion à la fiche de ' + S.pf.d.prenom + ' ?')) lierCompte(S.pf.id, t.value); else t.value = ''; return; }
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
  // QR code de pointage : l'adresse contient ?pointer=<jeton> ; on le garde le temps de la connexion puis on l'enlève de l'adresse
  try {
    var uq = new URL(location.href), jq = uq.searchParams.get('pointer');
    if (jq) { sessionStorage.setItem('evy-pointer', jq); uq.searchParams.delete('pointer'); history.replaceState(null, '', uq.pathname + uq.search + uq.hash); }
    JETON_QR = jq || sessionStorage.getItem('evy-pointer');
  } catch (e) { JETON_QR = null; }
  sb.auth.getSession().then(function (r) { if (r.data.session) demarrer(r.data.session); else render(); });
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === 'SIGNED_OUT') { oublierPersonne(); render(); } else if (session) S.session = session; });
})();
