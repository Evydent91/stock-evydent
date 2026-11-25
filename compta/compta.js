// Comptabilité du cabinet — site séparé /compta, prévu pour rejoindre Evydent (js/app.js) sans rien réécrire.
// Le fichier a trois parties :
//  1. SOCLE : copies exactes des outils d'Evydent (js/app.js). À SUPPRIMER à l'intégration : ils y existent déjà.
//  2. MODULE « Comptabilité » (préfixe kt : S.kt, vKt…(), ktAction(d), data-kt…, classes .kt-…). À recopier tel quel
//     dans une section de js/app.js, puis : 'kt…' dans HUB, la table des écrans, le menu de gauche et Plus sur téléphone.
//  3. DÉMARRAGE du site séparé (connexion, rendu, clics). À SUPPRIMER à l'intégration : Evydent a les siens.
(function () {
  'use strict';
  var C = window.CONFIG, sb = window.supabase.createClient(C.url, C.key);
  var S = { session: null, me: null, tab: 'ktdb', kt: null, lid: null, err: '', lbusy: false };

  // =====================================================================
  // 1. SOCLE — copies de js/app.js (même code, mêmes noms)
  // =====================================================================
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nb(x) { return Math.round((+x || 0) * 100) / 100; }
  function fr(x) { var v = nb(x); return String(v).replace('.', ','); }
  function eur(x) { return (+x || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  var tt;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 3200); }
  // Fenêtres de l'appli (remplacent confirm / prompt du navigateur). texte : \n = retour à la ligne, « • » = puce.
  function fenetre(o) {
    return new Promise(function (res) {
      var prec = document.activeElement, bg = document.createElement('div'), S2 = o.saisie;
      var corps = String(o.texte || '').split(/\n\n+/).filter(Boolean).map(function (b) {
        var l = b.split('\n'), h = '', ul = [];
        var vide = function () { if (ul.length) { h += '<ul>' + ul.join('') + '</ul>'; ul = []; } };
        l.forEach(function (x) { if (/^[•…]/.test(x)) ul.push('<li>' + esc(x.replace(/^•\s*/, '')) + '</li>'); else { vide(); h += '<p>' + esc(x) + '</p>'; } });
        vide(); return h;
      }).join('');
      bg.className = 'dlg-bg';
      bg.innerHTML = '<div class="dlg' + (o.danger ? ' danger' : '') + (o.large ? ' large' : '') + '" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">' + esc(o.titre) + '</h2>' + corps
        + (o.choix ? '<div class="dlg-ch' + (o.grille ? ' gr' : '') + '" role="radiogroup">' + o.choix.map(function (c, i) { return '<label class="dlg-c' + (c.off ? ' off' : '') + (c.coul ? ' coul' : '') + '"' + (c.coul ? ' style="--c:' + c.coul + '"' : '') + '>' + (c.coul ? '<i class="dlg-pas" aria-hidden="true"></i>' : '') + '<input type="radio" name="dlgch" value="' + i + '"' + (c.on && !c.off ? ' checked' : '') + (c.off ? ' disabled' : '') + '><span><b>' + esc(c.t) + '</b><small>' + esc(c.s || '') + '</small>' + (c.date ? '<input type="date" class="dlg-d" data-dlgd="' + i + '" min="' + (c.min || '') + '" value="' + esc(c.date === true ? '' : c.date) + '" aria-label="' + esc(c.t) + '">' : '') + '</span></label>'; }).join('') + '</div>' : '')
        + (o.html || '')
        + (S2 ? '<label class="dlg-l">' + esc(S2.label || '') + '<input id="dlg-in"' + (S2.type === 'nombre' ? ' inputmode="decimal"' : '') + ' autocomplete="off" value="' + esc(S2.valeur || '') + '"' + (S2.attendu ? ' placeholder="' + esc(S2.attendu) + '"' : '') + '></label>' : '')
        + (o.boutons ? '<div class="dlg-b dlg-bs">' + o.boutons.map(function (b, i) { return '<button type="button" class="btn ' + (b.cls || 'l') + '" data-dlgb="' + i + '">' + esc(b.t) + '</button>'; }).join('') + '</div>' : '')
        + (o.boutons && o.sansOk ? '' : '<div class="dlg-b">' + (o.seul ? '' : '<button type="button" class="btn l" data-dlg="0">' + esc(o.non || 'Annuler') + '</button>') + '<button type="button" class="btn' + (o.danger ? ' ko' : '') + '" data-dlg="1">' + esc(o.ok || 'Confirmer') + '</button></div>') + '</div>';
      document.body.appendChild(bg);
      var inp = bg.querySelector('#dlg-in'), bok = bg.querySelector('[data-dlg="1"]') || bg.querySelector('[data-dlgb]');
      var verif = function () { if (S2 && S2.attendu) bok.disabled = norm(inp.value.trim()) !== norm(String(S2.attendu).trim()); };
      var fin = function (v) { document.removeEventListener('keydown', cle, true); bg.remove(); if (prec && prec.focus) try { prec.focus(); } catch (e) {} res(v); };
      var oui = function () {
        if (bok.disabled) return;
        if (o.lire) { var ex = o.lire(bg); if (ex === false) return; }
        if (o.choix) { var rr = bg.querySelector('input[name="dlgch"]:checked'); if (!rr) return; var ci = +rr.value, cc = o.choix[ci]; if (cc.date) { var dv = bg.querySelector('[data-dlgd="' + ci + '"]').value; if (!dv) { bg.querySelector('[data-dlgd="' + ci + '"]').focus(); return; } fin({ i: ci, v: cc.v, date: dv, texte: inp ? inp.value : null, extra: ex }); } else fin({ i: ci, v: cc.v, texte: inp ? inp.value : null, extra: ex }); return; }
        fin(S2 ? inp.value : true);
      };
      var non = function () { fin(S2 || o.choix ? null : false); };
      bg.addEventListener('focusin', function (e) { var dd = e.target.closest && e.target.closest('[data-dlgd]'); if (dd) { var rr = bg.querySelector('input[name="dlgch"][value="' + dd.dataset.dlgd + '"]'); if (rr) rr.checked = true; } });
      var cle = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); non(); }
        else if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); e.stopPropagation(); oui(); }
        else if (e.key === 'Tab') { var f = [].slice.call(bg.querySelectorAll('input,button:not([disabled])')), i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      };
      document.addEventListener('keydown', cle, true);
      bg.addEventListener('click', function (e) {
        e.stopPropagation();
        var bb = e.target.closest('[data-dlgb]'); if (bb) { fin({ bouton: o.boutons[+bb.dataset.dlgb].v }); return; }
        var b = e.target.closest('[data-dlg]'); if (b) { if (b.dataset.dlg === '1') oui(); else non(); return; }
        if (e.target === bg && !o.danger) non();
      });
      if (o.choix && o.onChoix) bg.addEventListener('change', function (e) { if (e.target.name === 'dlgch') o.onChoix(o.choix[+e.target.value], bg); });
      if (inp && !o.choix) { inp.addEventListener('input', verif); verif(); inp.focus(); if (!S2.attendu) inp.select(); } else if (o.choix && bg.querySelector('input[name="dlgch"]:checked')) bg.querySelector('input[name="dlgch"]:checked').focus(); else (o.danger ? bg.querySelector('[data-dlg="0"]') || bok : bok).focus();
    });
  }
  function demander(titre, texte, ok, danger) { return fenetre({ titre: titre, texte: texte, ok: ok, danger: danger }); }
  function saisir(titre, texte, o) { return fenetre(Object.assign({ titre: titre, texte: texte, saisie: o }, { ok: o.ok, danger: o.danger })); }
  function msgErr(e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Identifiant ou mot de passe incorrect.';
    if (/banned/i.test(m)) return 'Ce compte est désactivé. Voyez la référente ou la responsable.';
    if (/row-level security|permission denied/i.test(m)) return 'Action non autorisée pour votre compte.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion internet. Réessayez.';
    return m;
  }
  function emailDe(id) { id = String(id || '').trim(); return id.indexOf('@') >= 0 ? id.toLowerCase() : norm(id).replace(/\s+/g, '') + '@' + C.domaine; }
  var SVGI = {
    calendrier: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17.5h.01M12 17.5h.01" stroke-width="2.6"/>',
    grille: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    carte: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM10.5 10.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM5 16c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4M14.5 9.5h4.5M14.5 13h3"/>',
    cle: '<path d="M12 11a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM12 11h9M18 11v3M21 11v2.5"/>',
    couches: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/>',
    cloche: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
    quipointe: '<path d="M15 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 20c0-3.5 3-6 8-6 1.2 0 2.3.1 3.2.4M15.5 18l2 2 4-4.5"/>',
    fiole: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3M7.5 15h9"/>',
    sauve: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16"/>',
    transfert: '<path d="M4 8h13M13.5 4.5L17 8l-3.5 3.5M20 16H7M10.5 12.5L7 16l3.5 3.5"/>',
    diplome: '<path d="M2 9.5L12 5l10 4.5-10 4.5z"/><path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5"/><path d="M22 9.5V15"/>',
    trombone: '<path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7L14 5.5a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 8"/>',
    etoile: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    app: '<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2"/>',
    scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 8v8M10 8v8M13 8v8M16.5 8v8"/>',
    lampe: '<path d="M8 2h8l-1 6H9zM9 8v12a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8M12 12v3"/>',
    panne: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    valise: '<rect x="5" y="7" width="14" height="12" rx="2"/><path d="M9.5 7V4.5h5V7M9.5 10.5v5M14.5 10.5v5M8 19v1.5M16 19v1.5"/>',
    rotatif: '<rect x="2.5" y="5.5" width="5" height="5" rx="1.6"/><path d="M5 10.5V15M7.5 7.2L19.8 6a1.7 1.7 0 0 1 1.7 1.7v3.6a1.7 1.7 0 0 1-1.7 1.7L7.5 9.3M14 7.2v4.6"/>',
    camion: '<path d="M3 7h12v9H3zM15 10h4l2 3v3h-6z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2h2M18 18h2v2"/>',
    fauteuil: '<path d="M2.49 5.22L4.89 11.8A1.5 1.5 0 0 0 7.71 10.78L5.31 4.2A1.5 1.5 0 0 0 2.49 5.22zM8.5 14.5L14.5 14.5A1.5 1.5 0 0 0 14.5 11.5L8.5 11.5A1.5 1.5 0 0 0 8.5 14.5zM15.2 16.18L17.56 18.03A1.5 1.5 0 0 0 19.41 15.67L17.04 13.82A1.5 1.5 0 0 0 15.2 16.18zM11.5 14.5v4.5M8 20.5h7"/>',
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
    imprimer: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/>',
    plein: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    telecharger: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
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
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    reglage: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h3M14 14h3M7 17.5h3"/>',
    equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.2.6 3.5 2.4 3.5 5.2"/>',
    dent: '<path d="M7.5 3.5c-2.5 0-4 2-4 4.5 0 3 1.2 4.5 1.8 7.5.5 2.5 1 5 2.4 5 1.6 0 1.6-4.5 4.3-4.5s2.7 4.5 4.3 4.5c1.4 0 1.9-2.5 2.4-5 .6-3 1.8-4.5 1.8-7.5 0-2.5-1.5-4.5-4-4.5-1.8 0-2.8 1-4.5 1s-2.7-1-4.5-1z"/>',
    fleche: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    invok: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 12l2 2 4-4"/>',
    panier: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6.2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    etiquette: '<path d="M20 12l-8 8-9-9V3h8z"/><path d="M7.5 7.5h.01"/>',
    camion: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7"/><circle cx="5.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>'
  };
  function ico(n, sz, ep) { return '<svg class="ic" width="' + (sz || 24) + '" height="' + (sz || 24) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (ep || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVGI[n] + '</svg>'; }
  function hdA(o) {
    return '<header class="a-hd' + (o.fixe ? ' fixe' : '') + (o.cls ? ' ' + o.cls : '') + '">'
      + (o.t ? '<div class="a-hd-row">' + (o.back ? '<button class="a-back" ' + o.back[0] + '>' + ico('prec', 22, 2.4) + o.back[1] + '</button>' : '<span></span>') + '<h1>' + o.t + '</h1>' + (o.cab || '<span></span>') + '</div>' : '')
      + (o.extra || '') + '</header>';
  }
  function pl(n, mot) { return mot + (Math.abs(n) > 1 ? 's' : ''); }
  // o = { at: 'data-tab="x"', ic, te (eq pl pt cg st ap mo oc warn ok ko), lettre, t, s, sw (warn ok ko), droite, ton, gros, chev }
  function tlL(o) {
    var g = o.lettre ? '<span class="tl-av" aria-hidden="true">' + esc(o.lettre) + '</span>' : o.ic ? '<span class="tl-i te-' + (o.te || 'eq') + '">' + ico(o.ic, 22, 2) + '</span>' : '';
    var tag = o.at ? 'button' : 'div';
    return '<' + tag + ' class="tl-l' + (o.cls ? ' ' + o.cls : '') + '"' + (o.at ? ' ' + o.at : '') + '>' + g + '<span class="tl-n"><b>' + o.t + '</b>' + (o.s ? '<span' + (o.sw ? ' class="' + o.sw + '"' : '') + '>' + o.s + '</span>' : '') + '</span>'
      + (o.droite != null && o.droite !== '' ? '<span class="tl-d' + (o.gros ? ' gros' : '') + (o.ton ? ' ' + o.ton : '') + '">' + o.droite + '</span>' : '')
      + (o.at && o.chev !== false ? '<span class="tl-ch">' + ico('suiv', 16, 2.6) + '</span>' : '') + '</' + tag + '>';
  }
  function tlListe(l) { l = l.filter(Boolean); return l.length ? '<div class="tl-liste">' + l.map(function (o) { return typeof o === 'string' ? o : tlL(o); }).join('') + '</div>' : ''; }
  function tlSec(t) { return '<h2 class="tl-sec">' + t + '</h2>'; }
  function tlAl(at, ic, ton, t, s) { return '<button class="tl-al ' + (ton || 'warn') + '" ' + at + '>' + ico(ic, 20, 2) + '<span><b>' + t + '</b>' + (s ? '<span>' + s + '</span>' : '') + '</span>' + ico('suiv', 16, 2.6) + '</button>'; }
  function tlStat(items) { return '<div class="tl-stat" style="grid-template-columns:repeat(' + items.length + ',minmax(0,1fr))">' + items.map(function (i) { return '<div><b' + (i.ton ? ' class="' + i.ton + '"' : '') + '>' + i.v + '</b><span>' + i.t + '</span></div>'; }).join('') + '</div>'; }
  // Téléphone : le plus petit côté de l'écran fait moins de 600 px (quelle que soit l'orientation)
  function telephone() { try { return Math.min(screen.width, screen.height) < 600; } catch (e) { return false; } }
  // Tablette : écran tactile qui n'est pas un téléphone (iPad, tablette Android) : mêmes pages que l'ordinateur, en-têtes plus compacts
  function tablette() { try { return !telephone() && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches; } catch (e) { return false; } }
  // Bandeau de date commun à toutes les pages : flèches et calendrier à gauche, choix de l'affichage à droite, précision en dessous
  function bandeDate(nav, droite, sous) { return '<div class="nd-bande">' + nav + '<span class="grow"></span>' + (droite ? '<span class="nd-dr">' + droite + '</span>' : '') + '</div>' + (sous != null && !(sous === '' && tablette()) ? '<p class="nd-sous">' + (sous || '&nbsp;') + '</p>' : ''); }

  // =====================================================================
  // 2. MODULE « Comptabilité » (mise à jour 036 de la base) — préfixe kt
  //    Factures (comptes, entité ASSO / SAS, règlement), paiements groupés, charges du mois,
  //    CA, part du CA en dentaire (repère 12 %), dépôt et découpe des PDF scannés, export, reprise de l'Excel.
  //    Accès : comptes listés dans compta_acces + code à 6 chiffres (verrouillage après N minutes sans activité).
  // =====================================================================
  var KT_MODES = { virement: 'Virement', cheque: 'Chèque', cb: 'CB', prelevement: 'Prélèvement' };
  var KT_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var KT_TABS = ['ktdb', 'ktfac', 'ktpai', 'ktchg', 'ktajout', 'ktexp', 'ktreg', 'ktplus'];
  var KT_DOTS = { conso: '#2b3e4c', labo: '#c9b97a', implant: '#7d8c97' };
  var KT_VENDOR = (location.pathname.indexOf('/compta/') >= 0 ? '../' : '') + 'js/vendor/';
  var KT_OCR = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var KT_PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
  var KT_DOC = null;   // PDF ouvert dans la découpe (pdf.js)
  SVGI.ktfacture = '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>';
  SVGI.ktcarte = '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>';
  SVGI.ktbanque = '<path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18"/>';
  SVGI.ktphoto = '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>';
  SVGI.ktciseau = '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 7.9L20 18M8.1 16.1L20 6"/>';
  SVGI.kteuro = '<path d="M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9"/>';

  // ---------- Dates, montants ----------
  function ktIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function ktMois(iso) { return String(iso || '').slice(0, 7) + '-01'; }
  function ktAjMois(m, n) { return ktIso(new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); }
  function ktNomMois(m, court) { var n = KT_MOIS[+m.slice(5, 7) - 1] || ''; n = court && n.length > 5 ? n.slice(0, n === 'juillet' ? 4 : n === 'septembre' ? 4 : 3) + '.' : n; return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + m.slice(0, 4); }
  function ktDateC(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—'; }
  function ktDateL(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function ktPct(v, ca) { return ca > 0 ? v / ca * 100 : null; }
  function ktP(x) { return x == null ? '—' : (Math.round(x * 10) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }
  function ktE(x) { return Math.round(+x || 0).toLocaleString('fr-FR') + ' €'; }
  function ktNum(s) { if (s == null) return null; s = String(s).replace(/[\s €]/g, '').replace(',', '.'); if (s === '') return null; var n = parseFloat(s); return isNaN(n) ? null : Math.round(n * 100) / 100; }
  function ktSaisieNb(x) { return x == null || x === '' ? '' : (+x).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ktAge(f) { if (!f.date_facture) return null; return Math.max(0, Math.round((Date.now() - new Date(f.date_facture + 'T12:00:00')) / 864e5)); }

  // ---------- État ----------
  function ktEt() {
    if (!S.kt) S.kt = { etat: null, ouvert: false, pret: false, charge: false, an: null, mois: ktMois(ktIso(new Date())), per: 'mois', f: 'regler', compte: '', q: '', sel: {}, pm: '',
      comptes: [], params: {}, fourn: [], fac: [], pai: {}, ca: {}, chg: [], fich: [], pin: '', pin1: null, err: '', busy: false, actif: Date.now(), prol: 0, dec: null, imp: null, expAn: false };
    return S.kt;
  }
  function ktEcrit() { var K = ktEt(); return !!(K.etat && K.etat.role === 'directrice'); }
  function ktCompte(code) { return ktEt().comptes.filter(function (c) { return c.code === code; })[0] || { code: code, nom: code || 'Sans compte', groupe: 'facture' }; }
  function ktComptes(g) { return ktEt().comptes.filter(function (c) { return c.groupe === g && c.actif !== false; }); }
  function ktSeuil() { var v = +ktEt().params.seuil_dentaire; return v > 0 ? v : 12; }
  function ktFo(nom) { var n = norm(nom).trim(); return n ? ktEt().fourn.filter(function (x) { return norm(x.nom) === n; })[0] || null : null; }
  function ktTon(p) { return p == null ? '' : p < ktSeuil() ? 'ok' : 'ko'; }

  // ---------- Accès : état, code, verrouillage ----------
  function ktDemarrer() {
    var K = ktEt();
    return sb.rpc('compta_etat').then(function (r) {
      if (r.error) { K.etat = { acces: false, manque: /compta_etat|function/i.test(r.error.message || '') }; render(); return; }
      K.etat = r.data || { acces: false }; K.ouvert = !!K.etat.ouvert;
      if (K.ouvert) { K.actif = Date.now(); ktCharger(); }
      render();
    });
  }
  function ktActivite() { if (S.kt) S.kt.actif = Date.now(); }
  // Toutes les 30 s : on prolonge tant qu'il y a de l'activité, on verrouille après N minutes sans rien
  function ktVeille() {
    var K = S.kt; if (!K || !K.ouvert) return;
    var min = (K.etat && K.etat.verrou_min) || 15, now = Date.now();
    if (now - K.actif > min * 60000) { ktVerrouiller(true, 'Verrouillée après ' + min + ' minutes sans activité.'); return; }
    if (now - K.prol > 120000 && now - K.actif < 150000) {
      K.prol = now;
      sb.rpc('compta_prolonger').then(function (r) { if (!r.error && r.data !== true) ktVerrouiller(false, 'La comptabilité s’est verrouillée.'); });
    }
  }
  function ktVerrouiller(serveur, msg) {
    var K = ktEt();
    if (serveur) sb.rpc('compta_fermer').then(function () {});
    K.ouvert = false; K.pret = false; K.fac = []; K.chg = []; K.pai = {}; K.ca = {}; K.fourn = []; K.fich = []; K.sel = {}; K.dec = null; K.imp = null; KT_DOC = null;
    K.pin = ''; K.err = msg || ''; if (K.etat) K.etat.ouvert = false;
    document.querySelectorAll('.dlg-bg').forEach(function (x) { x.remove(); });
    render();
  }
  function ktTouche(k) {
    var K = ktEt(); if (K.busy || (K.etat && K.etat.bloque_jusqu && new Date(K.etat.bloque_jusqu) > new Date())) return;
    K.err = '';
    K.pin = k === 'x' ? K.pin.slice(0, -1) : K.pin.length < 6 ? K.pin + k : K.pin;
    render();
    if (K.pin.length === 6 && k !== 'x') ktValiderCode();
  }
  function ktValiderCode() {
    var K = ktEt(), pin = K.pin;
    if (!K.etat.code) {   // premier code : le taper deux fois
      if (!K.pin1) { K.pin1 = pin; K.pin = ''; render(); return; }
      if (K.pin1 !== pin) { K.pin1 = null; K.pin = ''; K.err = 'Les deux codes ne sont pas les mêmes. Recommencez.'; render(); return; }
      K.busy = true; render();
      sb.rpc('compta_definir_code', { p_ancien: null, p_nouveau: pin }).then(function (r) {
        K.busy = false; K.pin = ''; K.pin1 = null;
        if (r.error || !r.data || !r.data.ok) { K.err = r.error ? msgErr(r.error) : 'Code refusé : 6 chiffres.'; render(); return; }
        K.etat.code = true; ktOuvert(); toast('✔ Code de la comptabilité enregistré');
      });
      return;
    }
    K.busy = true; render();
    sb.rpc('compta_ouvrir', { p_code: pin }).then(function (r) {
      K.busy = false; K.pin = '';
      if (r.error) { K.err = msgErr(r.error); render(); return; }
      var x = r.data || {};
      if (x.ok) { ktOuvert(); return; }
      if (x.erreur === 'bloque') { K.etat.bloque_jusqu = x.jusqu || new Date(Date.now() + 15 * 60000).toISOString(); K.err = ''; }
      else K.err = 'Code incorrect.' + (x.reste != null ? ' Encore ' + x.reste + ' ' + pl(x.reste, 'essai') + ' avant le blocage de 15 minutes.' : '');
      render();
    });
  }
  function ktOuvert() { var K = ktEt(); K.ouvert = true; K.etat.ouvert = true; K.err = ''; K.actif = Date.now(); K.prol = Date.now(); ktCharger(); render(); }
  function vKtCode() {
    var K = ktEt(), E = K.etat || {}, bl = E.bloque_jusqu && new Date(E.bloque_jusqu) > new Date();
    var titre = !E.code ? (K.pin1 ? 'Retapez le même code' : 'Choisissez votre code') : 'Code de la comptabilité';
    var sous = !E.code ? 'Un code à 6 chiffres, rien que pour la comptabilité. Il s’ajoute à votre connexion habituelle.' : 'Connectée comme <b>' + esc(S.me.nom) + '</b>. Ce code s’ajoute à votre connexion habituelle.';
    return '<div class="lg kt-lg"><div class="lg-top"></div><div class="lg-in"><div class="lg-hd"><span class="kt-lg-lo" aria-hidden="true">' + ico('kteuro', 44, 2) + '</span><div class="lg-name">Comptabilité</div><div class="lg-sub">Espace dentaire Val d’Yerres' + (C.env === 'dev' ? ' · test' : '') + '</div></div>'
      + '<div class="lg-card"><h1>' + titre + '</h1><p class="kt-lg-p">' + sous + '</p>'
      + (bl ? '<p class="lg-err" role="alert">Trop d’essais. Réessayez à ' + new Date(E.bloque_jusqu).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.</p>'
        : '<div class="pin-pts" aria-label="' + K.pin.length + ' chiffres sur 6">' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<span class="' + (i < K.pin.length ? 'on' : '') + '"></span>'; }).join('') + '</div>'
        + (K.err ? '<p class="lg-err" role="alert">' + esc(K.err) + '</p>' : '')
        + '<div class="pin-pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(function (k) { return '<button type="button" class="pk" data-ktk="' + k + '">' + k + '</button>'; }).join('')
        + '<button type="button" class="pk pk-x" data-ktk="x" aria-label="Effacer le dernier chiffre">Effacer</button><button type="button" class="pk" data-ktk="0">0</button><button type="button" class="pk pk-ok" data-act="ktsortir">' + (K.busy ? '…' : 'Quitter') + '</button></div>')
        + '</div><p class="lg-foot">Se verrouille après ' + (E.verrou_min || 15) + ' minutes sans activité.<br>Les autres comptes d’Evydent n’ont pas accès à cette page.</p></div></div>';
  }
  function vKtRefus() {
    var E = ktEt().etat || {};
    return '<div class="lg kt-lg"><div class="lg-top"></div><div class="lg-in"><div class="lg-card"><h1>Accès réservé</h1><p class="kt-lg-p">'
      + (E.manque ? 'La mise à jour <b>036</b> de la base n’est pas encore faite : lancez <code>036_compta.sql</code> dans Supabase.' : 'La comptabilité est réservée à la directrice. Votre compte (' + esc(S.me ? S.me.nom : '') + ') n’y a pas accès.')
      + '</p><button class="btn l" data-act="ktsortir">Se déconnecter</button></div></div></div>';
  }

  // ---------- Chargement ----------
  function ktQ(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function ktCharger() {
    var K = ktEt(), an = K.mois.slice(0, 4), y0 = an + '-01-01', y1 = an + '-12-01';
    K.charge = true;
    return Promise.all([
      ktQ(sb.from('compta_comptes').select('*').order('ordre')),
      ktQ(sb.from('compta_parametres').select('*')),
      ktQ(sb.from('compta_fournisseurs').select('*').order('nom')),
      ktQ(sb.from('compta_factures').select('*').or('and(mois.gte.' + y0 + ',mois.lte.' + y1 + '),paiement_id.is.null,a_verifier.is.true').order('date_facture', { ascending: true, nullsFirst: true }).order('id').limit(10000)),
      ktQ(sb.from('compta_ca').select('*').gte('mois', y0).lte('mois', y1)),
      ktQ(sb.from('compta_charges').select('*').gte('mois', y0).lte('mois', y1).order('ordre').order('id')),
      ktQ(sb.from('compta_paiements').select('*').gte('date_paiement', (+an - 1) + '-01-01').order('date_paiement'))
    ]).then(function (r) {
      K.comptes = r[0]; K.params = {}; r[1].forEach(function (p) { K.params[p.cle] = p.valeur; });
      K.fourn = r[2]; K.fac = r[3]; K.ca = {}; r[4].forEach(function (c) { K.ca[c.mois] = +c.montant; }); K.chg = r[5];
      K.pai = {}; r[6].forEach(function (p) { K.pai[p.id] = p; });
      var manque = K.fac.filter(function (f) { return f.paiement_id && !K.pai[f.paiement_id]; }).map(function (f) { return f.paiement_id; });
      return (manque.length ? ktQ(sb.from('compta_paiements').select('*').in('id', manque)) : Promise.resolve([])).then(function (l) { l.forEach(function (p) { K.pai[p.id] = p; }); });
    }).then(ktChargerFichiers).then(function () {
      K.an = an; K.charge = false; K.pret = true;
      Object.keys(K.sel).forEach(function (id) { if (!K.fac.some(function (f) { return f.id === +id && !f.paiement_id; })) delete K.sel[id]; });
      render();
    }).catch(function (e) { K.charge = false; K.pret = true; toast(msgErr(e)); render(); });
  }
  // PDF déposés ces 6 derniers mois qui n'ont pas encore de facture : « à découper »
  function ktChargerFichiers() {
    var K = ktEt(), d = new Date(); d.setDate(d.getDate() - 183);
    return ktQ(sb.from('compta_fichiers').select('*').gte('cree_le', d.toISOString()).order('cree_le', { ascending: false })).then(function (l) {
      if (!l.length) { K.fich = []; return; }
      return ktQ(sb.from('compta_factures').select('id,fichier_id').in('fichier_id', l.map(function (x) { return x.id; }))).then(function (l2) {
        var avec = {}; l2.forEach(function (x) { avec[x.fichier_id] = 1; });
        K.fich = l.filter(function (x) { return !avec[x.id]; });
      });
    });
  }
  function ktAllerMois(n) {
    var K = ktEt(), m = n === 0 ? ktMois(ktIso(new Date())) : ktAjMois(K.mois, n);
    K.mois = m; K.sel = {};
    if (m.slice(0, 4) !== K.an) { K.pret = false; ktCharger(); }
    render();
  }

  // ---------- Calculs ----------
  function ktFacMois(m) { return ktEt().fac.filter(function (f) { return f.mois === m; }); }
  function ktChgMontant(c) { return c.compte_code === 'salaires' ? (+c.brut || 0) + (+c.charges || 0) : (+c.montant || 0); }
  function ktChiffres(m) {
    var K = ktEt(), r = { ca: K.ca[m], par: {}, dentaire: 0, autres: 0, ent: { ASSO: 0, SAS: 0 } };
    ktFacMois(m).forEach(function (f) { var c = ktCompte(f.compte_code), v = +f.montant_ttc || 0; r.par[c.code] = (r.par[c.code] || 0) + v; if (c.groupe === 'dentaire') r.dentaire += v; else r.autres += v; r.ent[f.entite] += v; });
    K.chg.forEach(function (c) { if (c.mois !== m) return; var v = ktChgMontant(c); r.par[c.compte_code] = (r.par[c.compte_code] || 0) + v; r.autres += v; r.ent[c.entite] += v; });
    return r;
  }
  function ktCumul(m) {
    var a = { ca: null, par: {}, dentaire: 0, autres: 0, ent: { ASSO: 0, SAS: 0 } }, x = m.slice(0, 4) + '-01-01';
    while (x <= m) {
      var r = ktChiffres(x);
      if (r.ca != null) a.ca = (a.ca || 0) + r.ca;
      a.dentaire += r.dentaire; a.autres += r.autres; a.ent.ASSO += r.ent.ASSO; a.ent.SAS += r.ent.SAS;
      Object.keys(r.par).forEach(function (k) { a.par[k] = (a.par[k] || 0) + r.par[k]; });
      x = ktAjMois(x, 1);
    }
    return a;
  }
  function ktARegler() { return ktEt().fac.filter(function (f) { return !f.paiement_id; }).sort(function (a, b) { return String(a.date_facture || '').localeCompare(String(b.date_facture || '')) || a.id - b.id; }); }
  function ktChgVides(m) { var K = ktEt(); return ktComptes('charge').filter(function (c) { return !K.chg.some(function (x) { return x.mois === m && x.compte_code === c.code && ktChgMontant(x) > 0; }); }); }
  function ktAlertes() {
    var K = ktEt(), m = K.mois, out = [], R = ktARegler(), n30 = R.filter(function (f) { return ktAge(f) > 30; }).length, v = K.fac.filter(function (f) { return f.a_verifier; }).length;
    if (R.length) out.push({ at: 'data-tab="ktfac" data-ktfil="regler"', ic: 'attente', ton: n30 ? 'ko' : 'warn', t: R.length + ' ' + pl(R.length, 'facture') + ' à régler', s: eur(R.reduce(function (s, f) { return s + (+f.montant_ttc || 0); }, 0)) + ' TTC' + (n30 ? ', dont ' + n30 + ' de plus de 30 jours' : '') });
    if (v || K.fich.length) out.push({ at: 'data-tab="ktajout"', ic: 'ktfacture', ton: 'warn', t: (v ? v + ' ' + pl(v, 'facture') + ' à vérifier' : '') + (v && K.fich.length ? ' · ' : '') + (K.fich.length ? K.fich.length + ' PDF à découper' : ''), s: 'arrivées du stock ou déposées' });
    if (m <= ktMois(ktIso(new Date())) && K.ca[m] == null) out.push({ at: 'data-tab="ktchg"', ic: 'kteuro', ton: 'warn', t: 'CA de ' + KT_MOIS[+m.slice(5, 7) - 1] + ' à saisir', s: 'pour calculer la part du CA' });
    var cv = m <= ktMois(ktIso(new Date())) ? ktChgVides(m) : [];
    if (cv.length) out.push({ at: 'data-tab="ktchg"', ic: 'ktbanque', ton: 'warn', t: 'Charges de ' + KT_MOIS[+m.slice(5, 7) - 1], s: cv.slice(0, 3).map(function (c) { return c.nom.toLowerCase(); }).join(', ') + (cv.length > 3 ? '…' : '') + ' à saisir' });
    return out;
  }

  // ---------- En-têtes communs ----------
  function vKtNavMois() {
    var K = ktEt(), tel = telephone();
    return '<span class="kt-nav"><button class="kt-rond" data-ktm="-1" aria-label="Mois précédent">' + ico('prec', 20, 2.4) + '</button><button class="kt-mois" data-ktm="0" title="Revenir au mois en cours">' + ktNomMois(K.mois, tel) + '</button><button class="kt-rond" data-ktm="1" aria-label="Mois suivant">' + ico('suiv', 20, 2.4) + '</button></span>';
  }
  function vKtSeg(l, cur, attr, label) { return '<div class="hr-seg" role="group" aria-label="' + label + '">' + l.map(function (x) { var on = cur === x[0]; return '<button ' + attr + '="' + x[0] + '" aria-pressed="' + on + '"' + (on ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>'; }
  function vKtHd(t, droite, bande) {
    var tel = telephone();
    return hdA({ fixe: true, cls: 'kt-hd', t: t, back: S.tab === 'ktdb' ? null : tel && ['ktajout', 'ktexp', 'ktreg'].indexOf(S.tab) >= 0 ? ['data-tab="ktplus"', 'Plus'] : ['data-tab="ktdb"', tel ? 'Accueil' : 'Tableau de bord'], cab: droite || '<span class="a-cale"></span>', extra: bande || '' });
  }
  function vKtBtnsFac() {
    if (!ktEcrit() || telephone()) return '<span class="a-cale"></span>';
    return '<span class="pl-hbtns"><button class="pl-imp" data-tab="ktajout" aria-label="Déposer des PDF" title="Déposer des PDF">' + ico('haut', 18, 2.2) + '<span class="m-hide">Déposer des PDF</span></button><button class="pl-imp kt-plein" data-act="ktnew" aria-label="Saisir une facture" title="Saisir une facture">' + ico('plus', 18, 2.4) + '<span class="m-hide">Saisir une facture</span></button></span>';
  }
  function ktPill(p, court) { return p == null ? '<span class="kt-p nu">CA à saisir</span>' : '<span class="kt-p ' + ktTon(p) + '">' + (p < ktSeuil() ? (court ? 'Sous ' : 'Sous les ') : (court ? 'Dès ' : 'Au-dessus de ')) + ktP(ktSeuil()).replace(',0', '') + '</span>'; }

  // ---------- Tableau de bord ----------
  function vKtTdb() {
    if (telephone()) return vKtTdbTel();
    var K = ktEt(), m = K.mois, M = ktChiffres(m), A = ktCumul(m), cum = K.per === 'an', X = cum ? A : M;
    var pM = ktPct(M.dentaire, M.ca), pA = ktPct(A.dentaire, A.ca), pX = cum ? pA : pM, nomM = KT_MOIS[+m.slice(5, 7) - 1];
    var h = vKtHd('Comptabilité', vKtBtnsFac(), bandeDate(vKtNavMois(), vKtSeg([['mois', 'Le mois'], ['an', 'Depuis janvier']], K.per, 'data-ktper', 'Période'), cum ? 'De janvier à ' + nomM + ' ' + m.slice(0, 4) : 'Factures rattachées à ' + nomM + (K.ca[m] != null ? '' : ' · CA pas encore saisi')));
    h += '<div class="kt-corps">';
    var al = ktAlertes();
    if (al.length) h += '<div class="kt-alertes">' + al.map(function (a) { return '<button class="h-alerte' + (a.ton === 'ko' ? ' kt-ko' : '') + '" ' + a.at + '>' + ico(a.ic, 22) + '<span><b>' + a.t + '</b> · ' + a.s + '</span>' + ico('suiv', 20, 2.4) + '</button>'; }).join('') + '</div>';
    var kpi = function (cls, t, v, s) { return '<div class="kt-kpi' + (cls ? ' ' + cls : '') + '"><small>' + t + '</small><b>' + v + '</b><span>' + s + '</span></div>'; };
    h += '<div class="kt-kpis">'
      + kpi('fonce', cum ? 'CA depuis janvier' : 'CA du mois', X.ca != null ? ktE(X.ca) : '—', ktEcrit() ? '<button class="kt-lien" data-act="ktca">' + (M.ca != null ? 'Modifier le CA de ' + nomM : 'Saisir le CA de ' + nomM) + '</button>' : 'Saisi à la main')
      + kpi('', 'Dépenses dentaires', ktE(X.dentaire), 'Consommables + labo + implants')
      + kpi('', 'Part du CA · ' + (cum ? 'depuis janvier' : nomM), ktP(pX), ktPill(pX))
      + kpi('', cum ? 'Le mois seul' : 'Depuis janvier', ktP(cum ? pM : pA), ktPill(cum ? pM : pA)) + '</div>';
    // dentaire : mois et cumul
    var dc = ktComptes('dentaire'), lig = function (c) {
      var vm = M.par[c.code] || 0, va = A.par[c.code] || 0, p1 = ktPct(vm, M.ca), p2 = ktPct(va, A.ca), rep = c.repere != null && c.repere !== '' ? +c.repere : null;
      return '<button class="kt-tbl" data-tab="ktfac" data-ktcp="' + esc(c.code) + '"><span><i class="kt-dot" style="background:' + (KT_DOTS[c.code] || '#9aa5ae') + '"></i>' + esc(c.nom) + '</span><span class="d">' + ktE(vm) + '</span><span class="d">' + ktP(p1) + '</span><span class="d">' + (rep != null ? '<span class="kt-p ' + (p1 == null ? 'nu' : p1 < rep ? 'ok' : 'ko') + '">' + String(rep).replace('.', ',') + ' %</span>' : '<span class="mu">—</span>') + '</span><span class="d">' + ktE(va) + '</span><span class="d">' + ktP(p2) + '</span></button>';
    };
    h += '<div class="kt-deux"><section class="kt-card"><h2>Consommables, laboratoire, implants <em>repère total : ' + ktP(ktSeuil()).replace(',0', '') + ' du CA</em></h2><div class="kt-tb">'
      + '<div class="kt-tbl h" aria-hidden="true"><span>Compte</span><span class="d">' + ktNomMois(m).split(' ')[0] + '</span><span class="d">% CA</span><span class="d">Repère</span><span class="d">Depuis janv.</span><span class="d">% CA</span></div>'
      + dc.map(lig).join('')
      + '<div class="kt-tbl tot"><span>Total dentaire</span><span class="d">' + ktE(M.dentaire) + '</span><span class="d ' + ktTon(pM) + '">' + ktP(pM) + '</span><span class="d">' + ktPill(pM, true) + '</span><span class="d">' + ktE(A.dentaire) + '</span><span class="d ' + ktTon(pA) + '">' + ktP(pA) + '</span></div></div></section>'
      + '<section class="kt-card"><h2>Mois par mois <em>part du CA en dentaire</em></h2>' + vKtBarres() + '</section></div>';
    // autres dépenses
    var autres = ktComptes('facture').concat(ktComptes('charge')), vides = cum ? [] : ktChgVides(m).map(function (c) { return c.code; });
    var ligA = function (c) { var v = X.par[c.code] || 0, vide = vides.indexOf(c.code) >= 0; return '<button class="kt-al" data-tab="' + (c.groupe === 'charge' ? 'ktchg' : 'ktfac') + '"' + (c.groupe === 'charge' ? '' : ' data-ktcp="' + esc(c.code) + '"') + '><span>' + esc(c.nom) + '</span><b' + (vide && !v ? ' class="kt-vide"' : '') + '>' + (vide && !v ? 'à saisir' : ktE(v)) + '</b><em>' + (v ? ktP(ktPct(v, X.ca)) : '—') + '</em></button>'; };
    var moitie = Math.ceil(autres.length / 2), tot = X.dentaire + X.autres;
    h += '<section class="kt-card"><h2>Autres dépenses ' + (cum ? 'depuis janvier' : 'du mois') + ' <em>factures et relevés bancaires</em></h2><div class="kt-autres"><div>' + autres.slice(0, moitie).map(ligA).join('') + '</div><div>' + autres.slice(moitie).map(ligA).join('') + '</div></div>'
      + '<div class="kt-ents"><span>ASSO · Evydent<b>' + ktE(X.ent.ASSO) + '</b></span><span>SAS · Prestadental<b>' + ktE(X.ent.SAS) + '</b></span><span>Total des dépenses<b>' + ktE(tot) + '</b></span><span>Reste après dépenses<b' + (X.ca != null && X.ca - tot < 0 ? ' class="ko"' : '') + '>' + (X.ca != null ? ktE(X.ca - tot) : '—') + '</b></span></div></section>';
    return h + '</div>';
  }
  function vKtBarres(compact) {
    var K = ktEt(), an = K.mois.slice(0, 4), seuil = ktSeuil(), l = [], mx = seuil * 1.4, H = compact ? 120 : 170;
    for (var i = 0; i < 12; i++) { var x = an + '-' + String(i + 1).padStart(2, '0') + '-01', r = ktChiffres(x), p = ktPct(r.dentaire, r.ca); l.push({ x: x, p: p }); if (p != null && p > mx) mx = p; }
    return '<div class="kt-bars" style="height:' + (H + 22) + 'px"><div class="kt-seuil" style="bottom:' + Math.round(seuil / mx * H) + 'px"><em>' + ktP(seuil).replace(',0', '') + '</em></div>'
      + l.map(function (b) { var cls = b.x === K.mois ? 'cur' : b.p != null && b.p >= seuil ? 'k' : ''; return '<button class="kt-bar" data-ktmois="' + b.x + '" title="' + ktNomMois(b.x) + ' : ' + ktP(b.p) + '"><b>' + (b.p != null ? ktP(b.p).replace(' %', '') : '') + '</b><i class="' + cls + '" style="height:' + (b.p != null ? Math.max(3, Math.round(b.p / mx * H)) : 0) + 'px"></i></button>'; }).join('')
      + '</div><div class="kt-mx">' + l.map(function (b) { var n = KT_MOIS[+b.x.slice(5, 7) - 1]; return '<span>' + (compact ? n.charAt(0).toUpperCase() : n.charAt(0).toUpperCase() + n.slice(1, n === 'juillet' ? 4 : 3)) + '</span>'; }).join('') + '</div>';
  }
  function vKtTdbTel() {
    var K = ktEt(), m = K.mois, M = ktChiffres(m), A = ktCumul(m), pM = ktPct(M.dentaire, M.ca), pA = ktPct(A.dentaire, A.ca);
    var h = '<header class="a-hd tl-hb kt-hd"><div class="tl-hb-r"><div><h1>Comptabilité</h1><p>' + esc(S.me.nom) + ' · ' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</p></div><button class="tl-moi" data-tab="ktplus" aria-label="Plus">' + esc((S.me.nom || '?').charAt(0).toUpperCase()) + '</button></div><div class="kt-hd-mois">' + vKtNavMois() + '</div></header>';
    h += '<div class="a-corps tl-c kt-tel">' + tlStat([{ v: M.ca != null ? Math.round(M.ca / 1000) + ' k€' : '—', t: 'CA du mois' }, { v: ktP(pM), t: 'Dentaire / CA', ton: ktTon(pM) }, { v: ktP(pA), t: 'Depuis janvier', ton: ktTon(pA) }]);
    var al = ktAlertes();
    if (al.length) h += tlSec('À faire') + al.map(function (a) { return tlAl(a.at, a.ic, a.ton, a.t, a.s); }).join('');
    h += tlSec('Dentaire · repère ' + ktP(ktSeuil()).replace(',0', '')) + tlListe(ktComptes('dentaire').map(function (c) { var v = M.par[c.code] || 0, n = ktFacMois(m).filter(function (f) { return f.compte_code === c.code; }).length; return { at: 'data-tab="ktfac" data-ktcp="' + esc(c.code) + '" data-ktfil="mois"', ic: c.code === 'labo' ? 'dent' : c.code === 'implant' ? 'rotatif' : 'boite', te: c.code === 'labo' ? 'pl' : c.code === 'implant' ? 'ap' : 'eq', t: esc(c.nom), s: ktE(v) + ' · ' + n + ' ' + pl(n, 'facture'), droite: ktP(ktPct(v, M.ca)) }; }));
    h += tlSec('Autres dépenses du mois') + tlListe(ktComptes('facture').concat(ktComptes('charge')).map(function (c) { var v = M.par[c.code] || 0; return { at: 'data-tab="' + (c.groupe === 'charge' ? 'ktchg' : 'ktfac') + '"' + (c.groupe === 'charge' ? '' : ' data-ktcp="' + esc(c.code) + '" data-ktfil="mois"'), t: esc(c.nom), droite: v ? ktE(v) : '—' }; }));
    if (ktEcrit()) h += '<label class="btn gros kt-photo">' + ico('ktphoto', 22, 2) + 'Photographier une facture<input type="file" id="ktphoto" accept="image/*,application/pdf" capture="environment" hidden></label>';
    return h + '</div>';
  }

  // ---------- Factures ----------
  function ktReglement(f) {
    var K = ktEt(), p = f.paiement_id && K.pai[f.paiement_id];
    if (p) { var n = K.fac.filter(function (x) { return x.paiement_id === p.id; }).length; return ['ok', KT_MODES[p.mode] + (p.mode === 'cheque' && p.n_cheque ? ' n° ' + p.n_cheque : '') + ' · ' + ktDateC(p.date_paiement) + (n > 1 ? ' · ' + n + ' factures' : '')]; }
    if (f.paiement_id) return ['ok', 'Réglée'];
    var a = ktAge(f);
    return [a > 30 ? 'ko' : 'warn', 'À régler' + (a != null ? ' · ' + a + ' j' : '')];
  }
  function ktListe() {
    var K = ktEt(), m = K.mois, q = norm(K.q).trim(), l;
    if (K.f === 'regler') l = ktARegler().filter(function (f) { return (f.mois || '') <= ktAjMois(m, 0); });
    else if (K.f === 'verif') l = K.fac.filter(function (f) { return f.a_verifier; });
    else l = ktFacMois(m).filter(function (f) { return K.f !== 'reglees' || f.paiement_id; });
    if (q) l = l.filter(function (f) { return norm([f.fournisseur, f.numero, f.note, String(f.montant_ttc || '').replace('.', ','), ktCompte(f.compte_code).nom].join(' ')).indexOf(q) >= 0; });
    return l;
  }
  function vKtFactures() {
    var K = ktEt(), tel = telephone(), base = ktListe(), nR = ktARegler().length, nV = K.fac.filter(function (f) { return f.a_verifier; }).length;
    var l = K.compte ? base.filter(function (f) { return f.compte_code === K.compte; }) : base;
    var seg = vKtSeg([['regler', 'À régler' + (nR ? ' · ' + nR : '')], ['mois', tel ? 'Le mois' : 'Tout le mois'], ['reglees', 'Réglées'], ['verif', 'À vérifier' + (nV ? ' · ' + nV : '')]], K.f, 'data-ktfil', 'Afficher');
    var rech = '<label class="kt-q">' + ico('loupe', 18, 2.2) + '<input type="search" id="ktq" placeholder="Fournisseur, n°, montant…" aria-label="Chercher une facture" value="' + esc(K.q) + '" autocomplete="off"></label>';
    var sous = K.f === 'regler' ? 'Toutes les factures pas encore réglées, jusqu’à ' + ktNomMois(K.mois).toLowerCase() : K.f === 'verif' ? 'Factures arrivées du stock ou déposées : compte, montant et entité à confirmer' : 'Factures rattachées à ' + ktNomMois(K.mois).toLowerCase();
    var h = vKtHd('Factures', vKtBtnsFac(), tel ? bandeDate(vKtNavMois(), '', null) + '<div class="kt-hd-seg">' + seg + '</div>' : bandeDate(vKtNavMois() + rech, seg, sous));
    h += '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '">';
    if (tel) h += rech;
    var cpts = ktComptes('dentaire').concat(ktComptes('facture'));
    h += '<div class="kt-tys" role="tablist" aria-label="Comptes"><button role="tab" aria-selected="' + !K.compte + '" class="' + (!K.compte ? 'on' : '') + '" data-ktcp="">Tous <b>' + base.length + '</b></button>'
      + cpts.map(function (c) { var n = base.filter(function (f) { return f.compte_code === c.code; }).length, on = K.compte === c.code; return '<button role="tab" aria-selected="' + on + '" class="' + (on ? 'on' : '') + '" data-ktcp="' + esc(c.code) + '">' + (KT_DOTS[c.code] ? '<i class="kt-dot" style="background:' + KT_DOTS[c.code] + '"></i>' : '') + esc(c.nom.replace(/ \(.*\)$/, '').replace(' & matériel', '').replace(' et contrats annuels', ' et contrats')) + ' <b>' + n + '</b></button>'; }).join('') + '</div>';
    var sel = Object.keys(K.sel).map(Number), selF = K.fac.filter(function (f) { return sel.indexOf(f.id) >= 0; });
    if (selF.length) h += '<div class="kt-sel"><span><b>' + selF.length + ' ' + pl(selF.length, 'facture') + '</b> ' + pl(selF.length, 'cochée') + ' · ' + eur(selF.reduce(function (s, f) { return s + (+f.montant_ttc || 0); }, 0)) + '</span><button class="btn l kt-btn-cl" data-act="ktdesel">Décocher</button><button class="btn gold" data-act="ktpayer">' + ico('ok', 18, 2.4) + 'Régler ensemble</button></div>';
    if (!l.length) h += '<p class="a-vide kt-vide-l">' + (K.q ? 'Aucune facture ne correspond à « ' + esc(K.q) + ' ».' : K.f === 'regler' ? 'Rien à régler. ✔' : K.f === 'verif' ? 'Rien à vérifier.' : 'Aucune facture pour ce mois.') + (ktEcrit() && !K.q && K.f !== 'regler' ? ' <button class="kt-lien" data-act="ktnew">Saisir une facture</button>' : '') + '</p>';
    else if (tel) {
      var vieux = l.filter(function (f) { return !f.paiement_id && ktAge(f) > 30; }), autres = l.filter(function (f) { return vieux.indexOf(f) < 0; });
      if (vieux.length && K.f === 'regler') h += tlSec('Plus de 30 jours · ' + vieux.length) + '<div class="tl-liste">' + vieux.map(vKtLigneTel).join('') + '</div>' + (autres.length ? tlSec('Plus récentes · ' + autres.length) : '');
      h += autres.length ? '<div class="tl-liste">' + autres.map(vKtLigneTel).join('') + '</div>' : '';
    } else {
      var tot = l.reduce(function (s, f) { return s + (+f.montant_ttc || 0); }, 0), reg = l.filter(function (f) { return f.paiement_id; }).reduce(function (s, f) { return s + (+f.montant_ttc || 0); }, 0);
      h += '<section class="kt-tab"><div class="kt-r h" aria-hidden="true"><span></span><span class="kt-rb"><span>Fournisseur</span><span>N° de facture</span><span>Date</span><span>Compte</span><span>Entité</span><span class="d">Montant TTC</span><span>Règlement</span><span>PDF</span><span></span></span></div>'
        + l.map(vKtLigne).join('')
        + '<div class="kt-pied"><span><b>' + l.length + ' ' + pl(l.length, 'facture') + '</b> · ' + eur(tot) + ' TTC</span><span>Réglées : <b>' + eur(reg) + '</b></span><span>À régler : <b class="kt-w">' + eur(tot - reg) + '</b></span><span class="grow"></span><span class="mu">Touchez une ligne pour l’ouvrir</span></div></section>';
    }
    return h + '</div>';
  }
  function vKtCase(f) { return f.paiement_id || !ktEcrit() || f.a_verifier || f.montant_ttc == null ? '<span class="kt-case"></span>' : '<label class="kt-case"><input type="checkbox" data-ktsel="' + f.id + '"' + (ktEt().sel[f.id] ? ' checked' : '') + ' aria-label="Cocher la facture ' + esc((f.fournisseur || '') + ' ' + (f.numero || '')) + '"></label>'; }
  function vKtLigne(f) {
    var r = ktReglement(f), c = ktCompte(f.compte_code);
    return '<div class="kt-r' + (ktEt().sel[f.id] ? ' on' : '') + '">' + vKtCase(f)
      + '<button class="kt-rb" data-ktf="' + f.id + '"><span class="kt-fo"><b>' + esc(f.fournisseur || 'Fournisseur ?') + '</b>' + (f.source === 'stock' ? '<span class="kt-tag">stock</span>' : '') + '</span><span>' + (f.numero ? esc(f.numero) : '<span class="mu">—</span>') + '</span><span>' + ktDateC(f.date_facture) + '</span>'
      + '<span class="kt-cpt">' + (KT_DOTS[c.code] ? '<i class="kt-dot" style="background:' + KT_DOTS[c.code] + '"></i>' : '') + esc(c.nom.replace(/ \(.*\)$/, '')) + '</span><span><span class="kt-ent ' + (f.entite === 'SAS' ? 'sas' : 'asso') + '">' + f.entite + '</span></span><span class="d"><b>' + (f.montant_ttc != null ? eur(f.montant_ttc) : '<span class="kt-w">montant ?</span>') + '</b></span>'
      + '<span>' + (f.a_verifier ? '<span class="kt-p nu">À vérifier</span> ' : '') + '<span class="kt-p ' + r[0] + '">' + esc(r[1]) + '</span></span><span class="kt-pdf">' + (f.fichier_id ? ico('ktfacture', 19, 2) : '<span class="mu">—</span>') + '</span><span class="kt-ch">' + ico('suiv', 16, 2.4) + '</span></button></div>';
  }
  function vKtLigneTel(f) {
    var r = ktReglement(f);
    return '<div class="tl-l kt-lt">' + vKtCase(f) + '<button class="kt-ltb" data-ktf="' + f.id + '"><span class="tl-n"><b>' + esc(f.fournisseur || 'Fournisseur ?') + '</b><span>' + esc([f.numero, ktDateC(f.date_facture), ktCompte(f.compte_code).nom.replace(/ \(.*\)$/, ''), f.entite].filter(Boolean).join(' · ')) + '</span></span><span class="kt-ltd"><b>' + (f.montant_ttc != null ? eur(f.montant_ttc) : '?') + '</b><span class="kt-p ' + (f.a_verifier && !f.paiement_id ? 'nu' : r[0]) + '">' + esc(f.a_verifier && !f.paiement_id ? 'À vérifier' : r[0] === 'ok' ? r[1].split(' · ')[0] : r[1].replace('À régler · ', '')) + '</span></span></button></div>';
  }

  // Fenêtre d'une facture : saisie, PDF, règlement
  function ktOptionsComptes(cur) {
    var g = function (grp, lab) { var l = ktComptes(grp); return l.length ? '<optgroup label="' + lab + '">' + l.map(function (c) { return '<option value="' + esc(c.code) + '"' + (c.code === cur ? ' selected' : '') + '>' + esc(c.nom) + '</option>'; }).join('') + '</optgroup>' : ''; };
    return g('dentaire', 'Dentaire (repère ' + ktP(ktSeuil()).replace(',0', '') + ')') + g('facture', 'Autres factures');
  }
  function ktRadios(nom, l, cur, dis) { return '<div class="kt-radios" role="radiogroup">' + l.map(function (x) { return '<label class="kt-radio"><input type="radio" name="' + nom + '" value="' + x[0] + '"' + (x[0] === cur ? ' checked' : '') + (dis ? ' disabled' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</div>'; }
  function ktFacture(id, defaut) {
    var K = ktEt(), f = id ? K.fac.filter(function (x) { return x.id === id; })[0] : Object.assign({ entite: 'ASSO', compte_code: 'conso', mois: K.mois }, defaut || {});
    if (!f) return;
    var ro = !ktEcrit(), p = f.paiement_id && K.pai[f.paiement_id], data = null, dis = ro ? ' disabled' : '';
    var lst = '<datalist id="ktfol">' + K.fourn.map(function (x) { return '<option value="' + esc(x.nom) + '">'; }).join('') + '</datalist>';
    var html = '<div class="kt-frm">' + lst
      + '<label class="dlg-l kt-plein">Fournisseur<input id="ktf-fo" list="ktfol" value="' + esc(f.fournisseur || '') + '" autocomplete="off"' + dis + '></label>'
      + '<p class="kt-prop" id="ktf-prop" hidden></p>'
      + '<label class="dlg-l">N° de facture<input id="ktf-num" value="' + esc(f.numero || '') + '"' + dis + '></label>'
      + '<label class="dlg-l">Montant TTC<input id="ktf-mt" inputmode="decimal" value="' + esc(ktSaisieNb(f.montant_ttc)) + '" placeholder="0,00"' + dis + '></label>'
      + '<label class="dlg-l">Date de la facture<input id="ktf-date" type="date" value="' + esc(f.date_facture || '') + '"' + dis + '></label>'
      + '<label class="dlg-l">Mois de rattachement<input id="ktf-mois" type="month" value="' + esc((f.mois || K.mois).slice(0, 7)) + '"' + dis + '></label>'
      + '<label class="dlg-l kt-plein">Compte<select id="ktf-cpt" class="kt-sel-in"' + dis + '>' + ktOptionsComptes(f.compte_code) + '</select></label>'
      + '<div class="dlg-l kt-plein">Payée par' + ktRadios('ktf-ent', [['ASSO', 'ASSO · Evydent'], ['SAS', 'SAS · Prestadental']], f.entite, ro) + '</div>'
      + '<label class="dlg-l kt-plein">Note<input id="ktf-note" value="' + esc(f.note || '') + '"' + dis + '></label>'
      + '<div class="kt-plein kt-fpdf">' + (f.fichier_id ? '<button type="button" class="btn l sm" data-ktvoir="' + f.id + '">' + ico('ktfacture', 18, 2) + 'Voir le PDF' + (f.page_debut ? ' · ' + (f.page_fin && f.page_fin !== f.page_debut ? 'pages ' + f.page_debut + ' à ' + f.page_fin : 'page ' + f.page_debut) : '') + '</button>' : '<span class="mu">Pas de PDF joint.</span>')
      + (ro ? '' : '<label class="btn l sm">' + ico('haut', 18, 2.2) + (f.fichier_id ? 'Remplacer' : 'Joindre un PDF ou une photo') + '<input type="file" id="ktf-file" accept="application/pdf,image/*" hidden></label>') + '<span id="ktf-fn" class="mu"></span></div>'
      + (f.paiement_id ? '<div class="kt-plein kt-freg"><span class="kt-p ok">Réglée</span> ' + (p ? esc(ktReglement(f)[1]) + (p.entite !== f.entite ? ' · payée par ' + p.entite : '') : '') + '</div>'
        : ro ? '<div class="kt-plein kt-freg"><span class="kt-p ' + ktReglement(f)[0] + '">Pas encore réglée</span></div>'
        : '<div class="kt-plein kt-deja"><label class="kt-chk"><input type="checkbox" id="ktf-deja"' + (ktDejaParDefaut(f) ? ' checked' : '') + '>Déjà réglée</label><select id="ktf-dmode" class="kt-sel-in" aria-label="Moyen de paiement">' + Object.keys(KT_MODES).map(function (k) { return '<option value="' + k + '"' + (k === ktModeParDefaut(f) ? ' selected' : '') + '>' + KT_MODES[k] + '</option>'; }).join('') + '</select><input type="date" id="ktf-ddate" class="kt-sel-in" aria-label="Date du paiement" value="' + esc(f.date_facture || ktIso(new Date())) + '"><span class="mu">sinon elle reste « à régler »</span></div>')
      + (f.a_verifier ? '<p class="kt-plein kt-verif">' + (f.source === 'stock' ? 'Arrivée du stock (import de la facture dans une commande) : le montant est la somme des articles, frais de port non compris. ' : 'Déposée : ') + 'vérifiez puis enregistrez.</p>' : '') + '</div>';
    var boutons = [];
    if (!ro && id) boutons.push({ t: 'Supprimer', v: 'del', cls: 'l kt-danger' });
    if (!ro && id && f.paiement_id) boutons.push({ t: 'Annuler le règlement', v: 'annreg', cls: 'l' });
    if (!ro && !f.paiement_id) boutons.push({ t: 'Enregistrer et régler…', v: 'regler', cls: 'l' });
    var titre = id ? (f.fournisseur || 'Facture') + (f.numero ? ' · n° ' + f.numero : '') : 'Nouvelle facture';
    var lire = function (bg) {
      var g = function (x) { return bg.querySelector('#' + x); }, fo = g('ktf-fo').value.trim(), mt = ktNum(g('ktf-mt').value), dt = g('ktf-date').value || null, mo = g('ktf-mois').value;
      if (!fo) { g('ktf-fo').focus(); toast('Indiquez le fournisseur'); return false; }
      if (g('ktf-mt').value.trim() && mt == null) { g('ktf-mt').focus(); toast('Montant illisible'); return false; }
      var e = bg.querySelector('input[name="ktf-ent"]:checked');
      data = { fournisseur: fo, numero: g('ktf-num').value.trim() || null, montant_ttc: mt, date_facture: dt, mois: mo ? mo + '-01' : (dt ? ktMois(dt) : K.mois), compte_code: g('ktf-cpt').value, entite: e ? e.value : 'ASSO', note: g('ktf-note').value.trim() || null, a_verifier: false };
      var fi = g('ktf-file'); data._file = fi && fi.files && fi.files[0] || null;
      var dj = g('ktf-deja'); data._deja = dj && dj.checked ? { mode: g('ktf-dmode').value, date_paiement: g('ktf-ddate').value || dt || ktIso(new Date()) } : null;
    };
    var pr = fenetre({ titre: titre, html: html, large: true, ok: ro ? 'Fermer' : 'Enregistrer', seul: ro, boutons: boutons.length ? boutons : null, lire: ro ? null : function (bg) { return lire(bg); } });
    setTimeout(function () {   // fournisseur connu : compte et entité proposés ; nom du fichier choisi
      var bg = document.querySelector('.dlg-bg:last-child'); if (!bg) return;
      var fo = bg.querySelector('#ktf-fo'), fi = bg.querySelector('#ktf-file');
      if (fo) fo.addEventListener('change', function () { var x = ktFo(fo.value); if (!x) return; if (x.compte_code) bg.querySelector('#ktf-cpt').value = x.compte_code; var r = bg.querySelector('input[name="ktf-ent"][value="' + x.entite + '"]'); if (r) r.checked = true; var dj = bg.querySelector('#ktf-deja'); if (dj && x.mode) { dj.checked = x.mode === 'prelevement' || x.mode === 'cb'; bg.querySelector('#ktf-dmode').value = x.mode; } var pp = bg.querySelector('#ktf-prop'); pp.hidden = false; pp.textContent = 'Comme d’habitude pour ' + x.nom + ' : ' + ktCompte(x.compte_code).nom + ' · ' + x.entite; });
      if (fi) fi.addEventListener('change', function () { bg.querySelector('#ktf-fn').textContent = fi.files[0] ? fi.files[0].name : ''; });
      var vo = bg.querySelector('[data-ktvoir]'); if (vo) vo.addEventListener('click', function () { ktVoirPdf(f); });   // la fenêtre arrête les clics : on écoute ici
    }, 0);
    pr.then(function (r) {
      if (!r || ro) return;
      if (r.bouton === 'del') return ktSupprimerFacture(f);
      if (r.bouton === 'annreg') return ktAnnulerPaiement(f.paiement_id);
      if (!data) return;
      ktSauverFacture(f, data).then(function (fid) { if (fid && r.bouton === 'regler') ktPayer([fid]); });
    });
    // « Enregistrer et régler » : les champs sont lus avant la fermeture
    setTimeout(function () { var bg = document.querySelector('.dlg-bg:last-child'); if (!bg) return; bg.querySelectorAll('[data-dlgb]').forEach(function (bb) { if (boutons[+bb.dataset.dlgb] && boutons[+bb.dataset.dlgb].v === 'regler') bb.addEventListener('click', function (e) { if (lire(bg) === false) e.stopImmediatePropagation(); }, true); }); }, 0);
  }
  // Prélèvement ou CB : la facture est souvent déjà payée quand on la saisit
  function ktModeParDefaut(f) { var x = ktFo(f.fournisseur); return x && x.mode ? x.mode : f.compte_code === 'prlvt' ? 'prelevement' : f.compte_code === 'cb' ? 'cb' : 'virement'; }
  function ktDejaParDefaut(f) { var m = ktModeParDefaut(f); return !!f.fournisseur && (m === 'prelevement' || m === 'cb'); }
  function ktApprendre(d) {   // le fournisseur garde le dernier compte et la dernière entité choisis
    var x = ktFo(d.fournisseur);
    if (x) { if (x.compte_code === d.compte_code && x.entite === d.entite) return Promise.resolve(); return sb.from('compta_fournisseurs').update({ compte_code: d.compte_code, entite: d.entite }).eq('id', x.id).then(function () {}); }
    return sb.from('compta_fournisseurs').insert({ nom: d.fournisseur, compte_code: d.compte_code, entite: d.entite }).then(function () {});
  }
  function ktSauverFacture(f, d) {
    var file = d._file, deja = d._deja; delete d._file; delete d._deja;
    var ins = !f.id, prom = file ? ktEnvoyerFichier(file).then(function (fi) { d.fichier_id = fi.id; d.page_debut = 1; d.page_fin = fi.pages || null; }) : Promise.resolve();
    return prom.then(function () { return ins ? sb.from('compta_factures').insert(d).select().single() : sb.from('compta_factures').update(d).eq('id', f.id).select().single(); })
      .then(function (r) {
        if (r.error) { toast(/duplicate|unique/i.test(r.error.message) ? 'Cette facture existe déjà (même fournisseur, même numéro).' : msgErr(r.error)); return null; }
        toast('✔ Facture ' + (ins ? 'ajoutée' : 'enregistrée') + (deja ? ' et réglée' : ''));
        var reg = deja && !r.data.paiement_id ? sb.from('compta_paiements').insert({ mode: deja.mode, date_paiement: deja.date_paiement, entite: d.entite, montant: d.montant_ttc || 0 }).select().single().then(function (q) { if (q.error) { toast(msgErr(q.error)); return; } return sb.from('compta_factures').update({ paiement_id: q.data.id }).eq('id', r.data.id); }).then(function () { var x = ktFo(d.fournisseur); if (x && x.mode !== deja.mode) return sb.from('compta_fournisseurs').update({ mode: deja.mode }).eq('id', x.id); }) : Promise.resolve();
        return reg.then(function () { return ktApprendre(d); }).then(function () { return ktCharger(); }).then(function () { return r.data.id; });
      }).catch(function (e) { toast(msgErr(e)); return null; });
  }
  async function ktSupprimerFacture(f) {
    if (!(await demander('Supprimer cette facture ?', (f.fournisseur || '') + (f.numero ? ' n° ' + f.numero : '') + ' · ' + eur(f.montant_ttc) + (f.paiement_id ? '\n\nElle est réglée : le paiement reste, sans cette facture.' : ''), 'Supprimer', true))) return;
    var r = await sb.from('compta_factures').delete().eq('id', f.id);
    if (r.error) { toast(msgErr(r.error)); return; }
    toast('✔ Facture supprimée'); ktCharger();
  }

  // ---------- Paiements ----------
  function ktPayer(ids) {
    var K = ktEt(), fs = K.fac.filter(function (f) { return ids.indexOf(f.id) >= 0 && !f.paiement_id; });
    if (!fs.length) return;
    var fos = fs.map(function (f) { return norm(f.fournisseur); });
    var autresMeme = ktARegler().filter(function (f) { return ids.indexOf(f.id) < 0 && fos.indexOf(norm(f.fournisseur)) >= 0; });
    var autres = ktARegler().filter(function (f) { return ids.indexOf(f.id) < 0 && autresMeme.indexOf(f) < 0; });
    var noms = fs.map(function (f) { return f.fournisseur; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var ligne = function (f, on) { return '<label class="kt-pli"><input type="checkbox" data-ktpf="' + f.id + '" data-mt="' + (+f.montant_ttc || 0) + '"' + (on ? ' checked' : '') + '><span><b>' + esc(f.fournisseur || '?') + (f.numero ? ' · ' + esc(f.numero) : '') + '</b><small>' + ktDateL(f.date_facture) + ' · ' + esc(ktCompte(f.compte_code).nom) + ' · ' + f.entite + '</small></span><b>' + eur(f.montant_ttc) + '</b></label>'; };
    var html = '<p>Un seul paiement pour plusieurs factures : chacune passe « réglée » avec le même moyen et la même date.</p><div class="kt-plst">' + fs.map(function (f) { return ligne(f, true); }).join('') + autresMeme.map(function (f) { return ligne(f, false); }).join('')
      + '<div id="ktp-plus"></div>' + (autres.length ? '<label class="kt-pli kt-pajout"><span>+</span><select id="ktp-autre" aria-label="Ajouter la facture d’un autre fournisseur"><option value="">Ajouter la facture d’un autre fournisseur réglée dans le même paiement…</option>' + autres.map(function (f) { return '<option value="' + f.id + '">' + esc((f.fournisseur || '?') + ' · ' + (f.numero || ktDateL(f.date_facture)) + ' · ' + eur(f.montant_ttc)) + '</option>'; }).join('') + '</select></label>' : '')
      + '<div class="kt-pli kt-ptot"><span>Montant du paiement</span><b id="ktp-tot"></b></div></div>'
      + '<div class="dlg-l">Moyen de paiement' + ktRadios('ktp-mode', [['virement', 'Virement'], ['cheque', 'Chèque'], ['cb', 'CB'], ['prelevement', 'Prélèvement']], (ktFo(fs[0].fournisseur) || {}).mode || 'virement') + '</div>'
      + '<div class="kt-frm kt-frm3"><label class="dlg-l">Date du paiement<input id="ktp-date" type="date" value="' + ktIso(new Date()) + '"></label><label class="dlg-l">N° de chèque<input id="ktp-chq" inputmode="numeric" placeholder="si chèque"></label><div class="dlg-l">Payé par' + ktRadios('ktp-ent', [['ASSO', 'ASSO'], ['SAS', 'SAS']], fs[0].entite) + '</div></div>'
      + '<label class="dlg-l">Note<input id="ktp-note" placeholder="facultatif"></label>';
    var data = null;
    var pr = fenetre({ titre: 'Régler ' + (fs.length > 1 ? fs.length + ' factures ' : 'la facture ') + noms.slice(0, 2).join(', ') + (noms.length > 2 ? '…' : ''), html: html, large: true, ok: 'Enregistrer le paiement', lire: function (bg) {
      var ids2 = [].slice.call(bg.querySelectorAll('[data-ktpf]:checked')).map(function (x) { return +x.dataset.ktpf; });
      if (!ids2.length) { toast('Cochez au moins une facture'); return false; }
      var mode = bg.querySelector('input[name="ktp-mode"]:checked').value, dt = bg.querySelector('#ktp-date').value;
      if (!dt) { bg.querySelector('#ktp-date').focus(); return false; }
      data = { ids: ids2, p: { mode: mode, date_paiement: dt, n_cheque: mode === 'cheque' ? bg.querySelector('#ktp-chq').value.trim() || null : null, entite: bg.querySelector('input[name="ktp-ent"]:checked').value, note: bg.querySelector('#ktp-note').value.trim() || null } };
    } });
    setTimeout(function () {
      var bg = document.querySelector('.dlg-bg:last-child'); if (!bg) return;
      var maj = function () { var t = 0; bg.querySelectorAll('[data-ktpf]:checked').forEach(function (x) { t += +x.dataset.mt; }); bg.querySelector('#ktp-tot').textContent = eur(t); var m = bg.querySelector('input[name="ktp-mode"]:checked'); bg.querySelector('#ktp-chq').disabled = !m || m.value !== 'cheque'; };
      bg.addEventListener('change', function (e) {
        if (e.target.id === 'ktp-autre' && e.target.value) { var f = K.fac.filter(function (x) { return x.id === +e.target.value; })[0]; if (f) { bg.querySelector('#ktp-plus').insertAdjacentHTML('beforeend', ligne(f, true)); e.target.querySelector('option[value="' + f.id + '"]').remove(); } e.target.value = ''; }
        maj();
      });
      maj();
    }, 0);
    pr.then(function (ok) {
      if (!ok || !data) return;
      var tot = K.fac.filter(function (f) { return data.ids.indexOf(f.id) >= 0; }).reduce(function (s, f) { return s + (+f.montant_ttc || 0); }, 0);
      data.p.montant = Math.round(tot * 100) / 100;
      sb.from('compta_paiements').insert(data.p).select().single().then(function (r) {
        if (r.error) { toast(msgErr(r.error)); return; }
        return sb.from('compta_factures').update({ paiement_id: r.data.id }).in('id', data.ids).then(function (r2) {
          if (r2.error) { toast(msgErr(r2.error)); return; }
          var fo = ktFo((K.fac.filter(function (f) { return f.id === data.ids[0]; })[0] || {}).fournisseur);
          if (fo && fo.mode !== data.p.mode) sb.from('compta_fournisseurs').update({ mode: data.p.mode }).eq('id', fo.id).then(function () {});
          data.ids.forEach(function (i) { delete K.sel[i]; });
          toast('✔ Paiement enregistré : ' + data.ids.length + ' ' + pl(data.ids.length, 'facture') + ' ' + pl(data.ids.length, 'réglée') + ' · ' + eur(data.p.montant));
          ktCharger();
        });
      });
    });
  }
  async function ktAnnulerPaiement(pid) {
    var K = ktEt(), p = K.pai[pid], fs = K.fac.filter(function (f) { return f.paiement_id === pid; });
    if (!(await demander('Annuler ce règlement ?', (p ? KT_MODES[p.mode] + ' du ' + ktDateL(p.date_paiement) + ' · ' + eur(p.montant) + '\n\n' : '') + (fs.length > 1 ? 'Les ' + fs.length + ' factures de ce paiement repassent « à régler ».' : 'La facture repasse « à régler ».'), 'Annuler le règlement', true))) return;
    var r = await sb.from('compta_factures').update({ paiement_id: null }).eq('paiement_id', pid);
    if (r.error) { toast(msgErr(r.error)); return; }
    await sb.from('compta_paiements').delete().eq('id', pid);
    toast('✔ Règlement annulé'); ktCharger();
  }
  function vKtPaiements() {
    var K = ktEt(), tel = telephone(), m = K.mois, m2 = ktAjMois(m, 1);
    var l = Object.keys(K.pai).map(function (k) { return K.pai[k]; }).filter(function (p) { return p.date_paiement >= m && p.date_paiement < m2 && (!K.pm || p.mode === K.pm); }).sort(function (a, b) { return a.date_paiement.localeCompare(b.date_paiement) || a.id - b.id; });
    var seg = vKtSeg([['', 'Tous'], ['virement', 'Virements'], ['cheque', 'Chèques'], ['cb', 'CB'], ['prelevement', tel ? 'Prélèv.' : 'Prélèvements']], K.pm, 'data-ktpm', 'Moyen de paiement');
    var h = vKtHd('Paiements', '<span class="a-cale"></span>', tel ? bandeDate(vKtNavMois(), '', null) + '<div class="kt-hd-seg">' + seg + '</div>' : bandeDate(vKtNavMois(), seg, 'Paiements faits en ' + ktNomMois(m).toLowerCase() + ' · un paiement peut régler plusieurs factures'));
    h += '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '">';
    var facDe = function (p) { return K.fac.filter(function (f) { return f.paiement_id === p.id; }); };
    if (!l.length) return h + '<p class="a-vide">Aucun paiement' + (K.pm ? ' par ' + KT_MODES[K.pm].toLowerCase() : '') + ' en ' + ktNomMois(m).toLowerCase() + '.</p></div>';
    var tot = {}; l.forEach(function (p) { tot[p.mode] = (tot[p.mode] || 0) + (+p.montant || 0); });
    if (tel) h += '<div class="tl-liste">' + l.map(function (p) { var fs = facDe(p); return tlL({ at: 'data-ktpaie="' + p.id + '"', ic: 'ktcarte', te: p.mode === 'cheque' ? 'pl' : p.mode === 'cb' ? 'oc' : 'eq', t: KT_MODES[p.mode] + (p.n_cheque ? ' n° ' + esc(p.n_cheque) : '') + ' · ' + ktDateC(p.date_paiement), s: esc(fs.map(function (f) { return f.fournisseur; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') || 'sans facture') + ' · ' + fs.length + ' ' + pl(fs.length, 'facture'), droite: eur(p.montant), gros: true }); }).join('') + '</div>';
    else h += '<section class="kt-tab"><div class="kt-pr h" aria-hidden="true"><span>Date</span><span>Moyen</span><span>Entité</span><span>Factures réglées</span><span class="d">Montant</span><span></span></div>'
      + l.map(function (p) { var fs = facDe(p), fo = fs.map(function (f) { return f.fournisseur; }).filter(function (x, i, a) { return a.indexOf(x) === i; }); return '<button class="kt-pr" data-ktpaie="' + p.id + '"><span>' + ktDateL(p.date_paiement) + '</span><span><b>' + KT_MODES[p.mode] + '</b>' + (p.n_cheque ? ' n° ' + esc(p.n_cheque) : '') + '</span><span><span class="kt-ent ' + (p.entite === 'SAS' ? 'sas' : 'asso') + '">' + p.entite + '</span></span><span>' + esc(fo.join(', ') || 'sans facture') + ' <span class="mu">· ' + fs.length + ' ' + pl(fs.length, 'facture') + '</span></span><span class="d"><b>' + eur(p.montant) + '</b></span><span class="kt-ch">' + ico('suiv', 16, 2.4) + '</span></button>'; }).join('')
      + '<div class="kt-pied">' + Object.keys(KT_MODES).filter(function (k) { return tot[k]; }).map(function (k) { return '<span>' + KT_MODES[k] + ' : <b>' + eur(tot[k]) + '</b></span>'; }).join('') + '<span class="grow"></span><span><b>' + l.length + ' ' + pl(l.length, 'paiement') + '</b></span></div></section>';
    return h + '</div>';
  }
  function ktVoirPaiement(pid) {
    var K = ktEt(), p = K.pai[pid]; if (!p) return;
    var fs = K.fac.filter(function (f) { return f.paiement_id === pid; });
    fenetre({ titre: KT_MODES[p.mode] + (p.n_cheque ? ' n° ' + p.n_cheque : '') + ' du ' + ktDateL(p.date_paiement), html: '<div class="kt-plst">' + fs.map(function (f) { return '<div class="kt-pli"><span></span><span><b>' + esc(f.fournisseur || '?') + (f.numero ? ' · ' + esc(f.numero) : '') + '</b><small>' + ktDateL(f.date_facture) + ' · ' + esc(ktCompte(f.compte_code).nom) + '</small></span><b>' + eur(f.montant_ttc) + '</b></div>'; }).join('') + '<div class="kt-pli kt-ptot"><span>Payé par ' + p.entite + '</span><b>' + eur(p.montant) + '</b></div></div>' + (p.note ? '<p>' + esc(p.note) + '</p>' : ''),
      large: true, ok: 'Fermer', seul: true, boutons: ktEcrit() ? [{ t: 'Annuler ce règlement', v: 'ann', cls: 'l kt-danger' }] : null }).then(function (r) { if (r && r.bouton === 'ann') ktAnnulerPaiement(pid); });
  }

  // ---------- Charges du mois et CA ----------
  function vKtCharges() {
    var K = ktEt(), tel = telephone(), m = K.mois, ro = !ktEcrit(), dis = ro ? ' disabled' : '', ca = K.ca[m], prev = ktAjMois(m, -1);
    var caIn = '<label class="kt-ca"><span>CA du mois</span><input class="in" id="ktca-in" data-ktca="' + m + '" inputmode="decimal" value="' + esc(ca != null ? ktSaisieNb(ca) : '') + '" placeholder="à saisir"' + dis + '></label>';
    var aPrev = K.chg.some(function (c) { return c.mois === prev; }), aCe = K.chg.some(function (c) { return c.mois === m; });
    var droite = !ro && aPrev && !tel ? '<span class="pl-hbtns"><button class="pl-imp" data-act="ktreprendre" aria-label="Reprendre les lignes du mois précédent">' + ico('refaire', 18, 2.2) + '<span class="m-hide">Reprendre les lignes de ' + KT_MOIS[+prev.slice(5, 7) - 1] + '</span></button></span>' : '<span class="a-cale"></span>';
    var h = vKtHd(tel ? 'Charges' : 'Charges du mois', droite, bandeDate(vKtNavMois(), tel ? '' : caIn, tel ? null : 'Lignes recopiées des relevés bancaires' + (aPrev && !aCe ? ' · « Reprendre les lignes » recopie celles de ' + KT_MOIS[+prev.slice(5, 7) - 1] + ' (montants à vérifier)' : '')));
    h += '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '">' + (tel ? '<div class="kt-card kt-ca-t">' + caIn + '</div>' + (!ro && aPrev ? '<button class="btn l" data-act="ktreprendre">' + ico('refaire', 18, 2.2) + 'Reprendre les lignes de ' + KT_MOIS[+prev.slice(5, 7) - 1] + '</button>' : '') : '') + '<div class="kt-chgs">';
    var sel = function (k, cur, l) { return '<select class="kt-in" data-k="' + k + '"' + dis + ' aria-label="' + (k === 'entite' ? 'Entité' : 'Moyen') + '">' + l.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === (cur || '') ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'; };
    ktComptes('charge').forEach(function (c) {
      var l = K.chg.filter(function (x) { return x.mois === m && x.compte_code === c.code; }), tot = l.reduce(function (s, x) { return s + ktChgMontant(x); }, 0), sal = c.code === 'salaires';
      h += '<section class="kt-card kt-chg"><h2>' + esc(c.nom) + (sal ? ' <small>brut + charges</small>' : '') + '<em' + (tot ? '' : ' class="kt-vide"') + '>' + (tot ? ktE(tot) : 'à saisir') + '</em></h2>';
      if (l.length) h += '<div class="kt-cl h' + (sal ? ' sal' : '') + '" aria-hidden="true">' + (sal ? '<span>Ligne</span><span class="d">Brut</span><span class="d">Charges</span><span class="d">Chargé</span><span class="d">% CA</span>' : '<span>Libellé</span><span>Entité</span><span>Moyen</span><span>Date</span><span class="d">Montant</span>') + '<span></span></div>';
      l.forEach(function (x) {
        var a = 'data-ktchg="' + x.id + '"';
        h += '<div class="kt-cl' + (sal ? ' sal' : '') + '" ' + a + '><input class="kt-in" data-k="libelle" value="' + esc(x.libelle) + '" placeholder="Libellé" aria-label="Libellé"' + dis + '>'
          + (sal ? '<input class="kt-in d" data-k="brut" inputmode="decimal" value="' + esc(ktSaisieNb(x.brut)) + '" aria-label="Brut"' + dis + '><input class="kt-in d" data-k="charges" inputmode="decimal" value="' + esc(ktSaisieNb(x.charges)) + '" aria-label="Charges"' + dis + '><b class="d">' + ktE(ktChgMontant(x)) + '</b><span class="d">' + ktP(ktPct(ktChgMontant(x), ca)) + '</span>'
            : sel('entite', x.entite, [['ASSO', 'ASSO'], ['SAS', 'SAS']]) + sel('mode', x.mode, [['', '—'], ['prelevement', 'Prélèv.'], ['virement', 'Virement'], ['cheque', 'Chèque'], ['cb', 'CB']]) + '<input class="kt-in" type="date" data-k="date_op" value="' + esc(x.date_op || '') + '" aria-label="Date"' + dis + '><input class="kt-in d" data-k="montant" inputmode="decimal" value="' + esc(ktSaisieNb(x.montant)) + '" placeholder="0,00" aria-label="Montant"' + dis + '>')
          + (ro ? '<span></span>' : '<button class="kt-x" data-ktchgdel="' + x.id + '" aria-label="Supprimer la ligne">' + ico('croix', 16, 2.4) + '</button>') + '</div>';
      });
      if (!ro) h += '<button class="kt-add" data-ktchgadd="' + esc(c.code) + '">' + ico('plus', 16, 2.4) + 'Ajouter une ligne</button>';
      if (sal) h += '<p class="kt-note">Repères de votre tableur : salariés ' + (K.params.repere_sal_salaries || 15) + ' %, praticiens ' + (K.params.repere_sal_praticiens || 45) + ' % du CA.</p>';
      h += '</section>';
    });
    return h + '</div></div>';
  }
  function ktChgModif(el) {
    var row = el.closest('[data-ktchg]'); if (!row || !ktEcrit()) return;
    var id = +row.dataset.ktchg, k = el.dataset.k, v = el.value, K = ktEt(), x = K.chg.filter(function (c) { return c.id === id; })[0]; if (!x) return;
    var o = {}; o[k] = ['montant', 'brut', 'charges'].indexOf(k) >= 0 ? ktNum(v) : k === 'date_op' ? v || null : k === 'mode' ? v || null : v;
    if (['montant', 'brut', 'charges'].indexOf(k) >= 0 && v.trim() && o[k] == null) { toast('Montant illisible'); return; }
    Object.assign(x, o);
    sb.from('compta_charges').update(o).eq('id', id).then(function (r) { if (r.error) toast(msgErr(r.error)); render(); });
  }
  function ktChgAjout(code) {
    var K = ktEt(), m = K.mois, prevL = K.chg.filter(function (c) { return c.compte_code === code; }).slice(-1)[0];
    sb.from('compta_charges').insert({ mois: m, compte_code: code, libelle: code === 'salaires' ? (K.chg.some(function (c) { return c.mois === m && c.compte_code === 'salaires'; }) ? 'Salaires praticiens' : 'Salaires salariés') : '', entite: prevL ? prevL.entite : 'ASSO', mode: code === 'salaires' ? null : 'prelevement', ordre: K.chg.length }).select().single().then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      K.chg.push(r.data); render();
      var e = document.querySelector('[data-ktchg="' + r.data.id + '"] [data-k="libelle"]'); if (e) e.focus();
    });
  }
  async function ktChgSuppr(id) {
    var K = ktEt(), x = K.chg.filter(function (c) { return c.id === id; })[0];
    if (x && (x.libelle || ktChgMontant(x)) && !(await demander('Supprimer cette ligne ?', (x.libelle || '') + (ktChgMontant(x) ? ' · ' + eur(ktChgMontant(x)) : ''), 'Supprimer', true))) return;
    var r = await sb.from('compta_charges').delete().eq('id', id);
    if (r.error) { toast(msgErr(r.error)); return; }
    K.chg = K.chg.filter(function (c) { return c.id !== id; }); render();
  }
  async function ktReprendre() {
    var K = ktEt(), m = K.mois, prev = ktAjMois(m, -1), l = K.chg.filter(function (c) { return c.mois === prev; });
    if (!l.length) return;
    var deja = K.chg.filter(function (c) { return c.mois === m; }).length;
    if (!(await demander('Reprendre les lignes de ' + KT_MOIS[+prev.slice(5, 7) - 1] + ' ?', l.length + ' ' + pl(l.length, 'ligne') + ' recopiées dans ' + KT_MOIS[+m.slice(5, 7) - 1] + ' avec leurs montants : vérifiez-les avec les relevés.' + (deja ? '\n\nLes ' + deja + ' lignes déjà saisies ce mois-ci restent.' : ''), 'Reprendre'))) return;
    var r = await sb.from('compta_charges').insert(l.map(function (c) { return { mois: m, compte_code: c.compte_code, libelle: c.libelle, entite: c.entite, mode: c.mode, date_op: c.date_op ? ktAjMois(m, 0).slice(0, 8) + c.date_op.slice(8) : null, montant: c.montant, brut: c.brut, charges: c.charges, ordre: c.ordre }; }));
    if (r.error) { toast(/date/i.test(r.error.message) ? 'Une date n’existe pas ce mois-ci : corrigez-la dans ' + KT_MOIS[+prev.slice(5, 7) - 1] + '.' : msgErr(r.error)); return; }
    toast('✔ ' + l.length + ' ' + pl(l.length, 'ligne') + ' ' + pl(l.length, 'reprise') + ' : montants à vérifier'); ktCharger();
  }
  function ktSauverCA(m, v) {
    var K = ktEt(), n = ktNum(v);
    if (String(v).trim() && n == null) { toast('Montant illisible'); return; }
    (n == null ? sb.from('compta_ca').delete().eq('mois', m) : sb.from('compta_ca').upsert({ mois: m, montant: n })).then(function (r) {
      if (r.error) { toast(msgErr(r.error)); return; }
      if (n == null) delete K.ca[m]; else K.ca[m] = n;
      toast('✔ CA de ' + KT_MOIS[+m.slice(5, 7) - 1] + ' : ' + (n == null ? 'effacé' : eur(n))); render();
    });
  }
  function ktSaisirCA() {
    var K = ktEt(), m = K.mois;
    saisir('CA de ' + ktNomMois(m).toLowerCase(), 'Le chiffre d’affaires du mois, tel qu’il ressort de vos comptes.', { label: 'Montant', type: 'nombre', valeur: K.ca[m] != null ? ktSaisieNb(K.ca[m]) : '', ok: 'Enregistrer' }).then(function (v) { if (v != null) ktSauverCA(m, v); });
  }

  // ---------- Dépôt des PDF et photos, découpe ----------
  // pdf.js 4.10.38 : lit les scans compressés en JBIG2 sans module complémentaire (celui de js/vendor demande un fichier wasm absent)
  function ktPdfjs() { return import(KT_PDFJS + 'pdf.min.mjs').then(function (p) { p.GlobalWorkerOptions.workerSrc = KT_PDFJS + 'pdf.worker.min.mjs'; return p; }); }
  function ktEnvoyerFichier(file, origine) {
    var pdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name), ext = pdf ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var chemin = 'depot/' + ktIso(new Date()).slice(0, 7) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var pages = pdf ? file.arrayBuffer().then(function (b) { return ktPdfjs().then(function (p) { return p.getDocument({ data: new Uint8Array(b), verbosity: 0 }).promise; }).then(function (d) { return d.numPages; }); }).catch(function () { return null; }) : Promise.resolve(1);
    return pages.then(function (n) {
      return sb.storage.from('compta').upload(chemin, file, { contentType: file.type || (pdf ? 'application/pdf' : 'image/jpeg'), upsert: false }).then(function (u) {
        if (u.error) throw u.error;
        return ktQ(sb.from('compta_fichiers').insert({ chemin: chemin, nom: file.name, pages: n, origine: origine || 'depot' }).select().single());
      });
    });
  }
  async function ktDeposer(files, origine) {
    var K = ktEt(); files = [].slice.call(files || []); if (!files.length) return;
    var crees = [], multi = [];
    for (var i = 0; i < files.length; i++) {
      toast('Envoi ' + (i + 1) + ' sur ' + files.length + ' : ' + files[i].name);
      try {
        var fi = await ktEnvoyerFichier(files[i], origine);
        if ((fi.pages || 1) > 1) multi.push(fi);
        else { var r = await sb.from('compta_factures').insert({ fichier_id: fi.id, page_debut: 1, page_fin: 1, a_verifier: true, source: origine === 'photo' ? 'photo' : 'depot', mois: K.mois }).select().single(); if (r.error) throw r.error; crees.push(r.data.id); }
      } catch (e) { toast(files[i].name + ' : ' + msgErr(e)); }
    }
    await ktCharger();
    toast('✔ ' + files.length + ' ' + pl(files.length, 'fichier') + ' ' + pl(files.length, 'déposé') + (multi.length ? ' · ' + multi.length + ' à découper' : ''));
    if (multi.length === 1 && !crees.length) { S.tab = 'ktajout'; ktOuvrirDecoupe(multi[0].id); }
    else if (crees.length === 1 && !multi.length) ktFacture(crees[0]);
    else { S.tab = 'ktajout'; render(); }
  }
  function ktTelecharger(chemin) { return sb.storage.from('compta').download(chemin).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function ktOuvrirDecoupe(fid) {
    var K = ktEt(), fi = K.fich.filter(function (x) { return x.id === fid; })[0]; if (!fi) return;
    K.dec = { f: fi, n: fi.pages || 0, coupes: { 1: true }, vign: {}, infos: {}, lecture: null, charge: true };
    KT_DOC = null; render();
    ktTelecharger(fi.chemin).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return ktPdfjs().then(function (p) { return p.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise; }); })
      .then(function (doc) { if (!K.dec || K.dec.f.id !== fid) return; KT_DOC = doc; K.dec.n = doc.numPages; K.dec.charge = false; render(); return ktVignettes(fid); })
      .catch(function (e) { toast('PDF illisible : ' + msgErr(e)); if (K.dec) K.dec.charge = false; render(); });
  }
  function ktRendrePage(p, larg, rot) {
    return KT_DOC.getPage(p).then(function (pg) {
      var v0 = pg.getViewport({ scale: 1, rotation: ((pg.rotate || 0) + (rot || 0)) % 360 }), sc = larg / v0.width, v = pg.getViewport({ scale: sc, rotation: ((pg.rotate || 0) + (rot || 0)) % 360 });
      var cv = document.createElement('canvas'); cv.width = Math.round(v.width); cv.height = Math.round(v.height);
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      return pg.render({ canvasContext: cx, viewport: v }).promise.then(function () { return cv; });
    });
  }
  async function ktVignettes(fid) {
    var K = ktEt();
    for (var p = 1; K.dec && K.dec.f.id === fid && p <= K.dec.n; p++) {
      if (K.dec.vign[p]) continue;
      var cv = await ktRendrePage(p, 150); if (!K.dec || K.dec.f.id !== fid) return;
      K.dec.vign[p] = cv.toDataURL('image/jpeg', .7);
      var im = document.querySelector('[data-ktpg="' + p + '"] img'); if (im) im.src = K.dec.vign[p]; else if (p % 6 === 0 || p === K.dec.n) render();
    }
    render();
  }
  function ktSegments() { var D = ktEt().dec, l = [], d = 1; for (var p = 2; p <= D.n + 1; p++) if (p > D.n || D.coupes[p]) { l.push({ d: d, f: p - 1 }); d = p; } return l; }
  var KT_COUL = ['#2b3e4c', '#c9b97a', '#7d8c97', '#1f7a4d', '#9a4a0b', '#5b6fa8', '#8a6d3b', '#4f8a8b'];
  function vKtDecoupe() {
    var K = ktEt(), D = K.dec, segs = ktSegments(), tel = telephone(), idx = {};
    segs.forEach(function (s, i) { for (var p = s.d; p <= s.f; p++) idx[p] = i; });
    var h = '<div class="kt-dec"><section class="kt-card kt-dec-g"><h2>' + (D.auto ? segs.length + ' ' + pl(segs.length, 'facture') + ' ' + pl(segs.length, 'repérée') + ' automatiquement' : 'Où commence chaque facture ?') + '</h2>'
      + '<p class="kt-aide">' + (D.auto ? 'L’appli a lu chaque page (« Page 1/13 », n° de facture, fournisseur) et placé un <b>trait de ciseaux</b> au début de chaque facture. <b>Vérifiez</b> : touchez une page pour ajouter ou retirer un trait.' : 'Touchez la <b>première page de chaque facture</b> : un trait de ciseaux s’ajoute devant. Les pages suivantes vont avec elle jusqu’au prochain trait. Ou laissez l’appli les repérer.') + '</p>'
      + (D.lecture ? '<div class="ban warn kt-lect">' + ico('loupe', 18, 2.2) + ' ' + esc(D.lecture) + '</div>' : ktEcrit() && D.n > 1 && !D.charge ? '<p><button class="btn l sm" data-act="ktocr">' + ico('loupe', 18, 2.2) + (D.auto ? 'Relire les pages' : 'Repérer les factures automatiquement') + '</button> <span class="mu">' + (D.n > 8 ? 'environ ' + Math.ceil(D.n * 2.5 / 60) + ' min pour ' + D.n + ' pages, sans rien envoyer à l’extérieur' : 'lecture dans le navigateur, sans rien envoyer à l’extérieur') + '</span></p>' : '')
      + (D.charge ? '<p class="a-vide">Ouverture du PDF…</p>' : '<div class="kt-pages">' + Array.apply(null, Array(D.n)).map(function (_, i) {
        var p = i + 1, c = KT_COUL[idx[p] % KT_COUL.length], inf = D.infos[p];
        return '<button class="kt-pg' + (D.coupes[p] ? ' deb' : '') + '" data-ktpg="' + p + '" aria-pressed="' + !!D.coupes[p] + '" aria-label="Page ' + p + (D.coupes[p] ? ', début de facture' : '') + '" style="--c:' + c + '">' + (D.coupes[p] ? '<em class="kt-cis" aria-hidden="true">' + ico('ktciseau', 12, 2.6) + '</em>' : '') + '<span class="kt-feuille">' + (D.vign[p] ? '<img src="' + D.vign[p] + '" alt="">' : '') + '</span><span class="kt-pgn">' + p + (inf && inf.px ? ' · ' + inf.px + '/' + inf.py : '') + '</span></button>';
      }).join('') + '</div>') + '</section>';
    h += '<div class="kt-dec-c"><section class="kt-card"><h2>' + segs.length + ' ' + pl(segs.length, 'facture') + ' dans ce PDF</h2><div class="kt-segs">' + segs.map(function (s, i) {
      var g = ktDevine(s); return '<div class="kt-seg"><i style="background:' + KT_COUL[i % KT_COUL.length] + '"></i><span><b>' + (g.fo ? esc(g.fo) : 'Facture ' + (i + 1)) + (g.num ? ' · ' + esc(g.num) : '') + '</b><small>' + (s.d === s.f ? 'page ' + s.d : 'pages ' + s.d + ' à ' + s.f) + '</small></span></div>';
    }).join('') + '</div></section>'
      + '<div class="kt-dec-b"><button class="btn l" data-act="ktdecx">Plus tard</button>' + (ktEcrit() ? '<button class="btn" data-act="ktdecok"' + (D.charge || D.lecture ? ' disabled' : '') + '>Créer ' + (segs.length > 1 ? 'les ' + segs.length + ' factures' : 'la facture') + '</button>' : '') + '</div>'
      + '<p class="kt-note">Chaque facture garde ses pages du PDF. Vous compléterez ensuite fournisseur, montant et compte dans « À vérifier ».</p></div></div>';
    return h;
  }
  function ktDevine(s) { var D = ktEt().dec, r = {}; for (var p = s.d; p <= s.f; p++) { var i = D.infos[p]; if (!i) continue; if (!r.fo && i.fo) r.fo = i.fo; if (!r.num && i.num) r.num = i.num; } return r; }
  // Lecture des pages (OCR dans le navigateur, Tesseract) : « Page 1/13 », n° de facture, fournisseur connu
  function ktChargerOcr() { return window.Tesseract ? Promise.resolve(window.Tesseract) : new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = KT_OCR; s.onload = function () { ok(window.Tesseract); }; s.onerror = function () { ko(new Error('Lecture automatique indisponible (pas de réseau ?)')); }; document.head.appendChild(s); }); }
  var KT_MOTS = ['site', 'chat', 'pret', 'loyer', 'leasing', 'total', 'facture', 'action', 'client', 'centre', 'dentaire', 'labo', 'laboratoire', 'impots', 'tresor public'];   // noms trop courants pour reconnaître un fournisseur
  function ktInfosPage(t) {
    var K = ktEt(), r = {}, n = norm(t), m;
    m = n.match(/page\s*:?\s*0*(\d{1,3})\s*(?:\/|sur|de|of)\s*0*(\d{1,3})/); if (m && +m[1] >= 1 && +m[1] <= +m[2]) { r.px = +m[1]; r.py = +m[2]; }
    m = t.match(/(?:FACTURE|Facture|INVOICE)\s*(?:N[°ºo]|n[°ºo]|num[ée]ro)?\s*[:.]?\s*([A-Z]{0,6}[-\/]?\d[\w\/-]{2,})/) || t.match(/N[°º]\s*(?:de\s*facture\s*)?[:.]?\s*([A-Z]{0,4}[-\/]?\d{4,}[\w\/-]*)/);
    if (m) r.num = m[1].replace(/[.,;:]+$/, '');
    // fournisseur connu : le nom (4 lettres au moins, mot entier) qui apparaît le plus haut dans la page
    var plat = ' ' + n.replace(/[^a-z0-9]+/g, ' ') + ' ', best = null;
    K.fourn.forEach(function (x) { var k = norm(x.nom).replace(/[^a-z0-9]+/g, ' ').trim(); if (k.replace(/ /g, '').length < 4 || KT_MOTS.indexOf(k) >= 0) return; var i = plat.indexOf(' ' + k + ' '); if (i >= 0 && (!best || i < best.i || (i === best.i && k.length > best.k.length))) best = { i: i, k: k, nom: x.nom }; });
    if (best) r.fo = best.nom;
    r.vide = t.replace(/\s/g, '').length < 30;
    return r;
  }
  async function ktReperer() {
    var K = ktEt(), D = K.dec; if (!D || !KT_DOC) return;
    var fid = D.f.id, T, w;
    try { D.lecture = 'Préparation de la lecture…'; render(); T = await ktChargerOcr(); w = await T.createWorker('fra'); }
    catch (e) { if (K.dec) K.dec.lecture = null; toast(msgErr(e)); render(); return; }
    try {
      for (var p = 1; K.dec && K.dec.f.id === fid && p <= D.n; p++) {
        D.lecture = 'Lecture de la page ' + p + ' sur ' + D.n + '…'; render();
        var cv = await ktRendrePage(p, 1700), r = await w.recognize(cv), inf = ktInfosPage(r.data.text || '');
        if ((r.data.confidence || 0) < 45 || (!inf.px && !inf.num && !inf.fo && !inf.vide)) {   // page scannée à l'envers ?
          var cv2 = await ktRendrePage(p, 1700, 180), r2 = await w.recognize(cv2);
          if ((r2.data.confidence || 0) > (r.data.confidence || 0) + 10) inf = ktInfosPage(r2.data.text || '');
        }
        D.infos[p] = inf;
      }
    } catch (e) { toast('Lecture interrompue : ' + msgErr(e)); }
    try { await w.terminate(); } catch (e) {}
    if (!K.dec || K.dec.f.id !== fid) return;
    D.coupes = ktCoupesAuto(D.infos, D.n); D.auto = true; D.lecture = null; render();
  }
  // Une facture commence : « Page 1/x », un autre n° de facture, un autre fournisseur, ou après la dernière page de la précédente.
  // On compare à la facture en cours (pas seulement à la page d'avant : les dos de page et pages à l'envers n'ont souvent rien de lisible).
  function ktCoupesAuto(I, n) {
    var c = { 1: true }, i1 = I[1] || {}, cur = { num: i1.num, fo: i1.fo, px: i1.px, py: i1.py };
    for (var p = 2; p <= n; p++) {
      var i = I[p] || {}, coupe = false;
      if (i.px === 1) coupe = true;
      else if (i.px > 1) coupe = false;
      else if (i.num && cur.num && i.num !== cur.num) coupe = true;
      else if (i.fo && cur.fo && i.fo !== cur.fo) coupe = true;
      else if ((i.num || i.fo) && cur.px && cur.py && cur.px === cur.py) coupe = true;
      else if (i.fo && !cur.fo && cur.num && !i.num) coupe = true;
      else if ((i.num || i.fo) && !cur.num && !cur.fo) coupe = true;   // la facture en cours n'avait rien de lisible
      if (coupe) { c[p] = true; cur = { num: i.num, fo: i.fo, px: i.px, py: i.py }; }
      else { cur.num = cur.num || i.num; cur.fo = cur.fo || i.fo; if (i.px) { cur.px = i.px; cur.py = i.py; } }
    }
    return c;
  }
  async function ktCreerDecoupe() {
    var K = ktEt(), D = K.dec; if (!D) return;
    var segs = ktSegments(), rows = segs.map(function (s) { var g = ktDevine(s), fo = g.fo ? ktFo(g.fo) : null; return { fichier_id: D.f.id, page_debut: s.d, page_fin: s.f, fournisseur: g.fo || null, numero: g.num || null, compte_code: fo && fo.compte_code || 'conso', entite: fo ? fo.entite : 'ASSO', a_verifier: true, source: D.f.origine === 'photo' ? 'photo' : 'depot', mois: K.mois }; });
    var r = await sb.from('compta_factures').insert(rows);
    if (r.error) { toast(/duplicate|unique/i.test(r.error.message) ? 'Une de ces factures existe déjà (même fournisseur, même numéro) : retirez le n° lu ou corrigez la découpe.' : msgErr(r.error)); return; }
    K.dec = null; KT_DOC = null; toast('✔ ' + rows.length + ' ' + pl(rows.length, 'facture') + ' ' + pl(rows.length, 'créée') + ' : à compléter'); K.f = 'verif'; ktCharger();
  }
  async function ktFichSuppr(id) {
    var K = ktEt(), fi = K.fich.filter(function (x) { return x.id === id; })[0]; if (!fi) return;
    if (!(await demander('Supprimer ce PDF ?', fi.nom + '\n\nAucune facture n’a encore été créée avec.', 'Supprimer', true))) return;
    await sb.storage.from('compta').remove([fi.chemin]);
    var r = await sb.from('compta_fichiers').delete().eq('id', id);
    if (r.error) { toast(msgErr(r.error)); return; }
    toast('✔ PDF supprimé'); ktCharger();
  }
  function ktVoirPdf(f) {
    var w = window.open('', '_blank');
    sb.from('compta_fichiers').select('chemin').eq('id', f.fichier_id).single().then(function (r) {
      if (r.error) throw r.error;
      return sb.storage.from('compta').createSignedUrl(r.data.chemin, 600);
    }).then(function (r) { if (r.error) throw r.error; var u = r.data.signedUrl + (f.page_debut ? '#page=' + f.page_debut : ''); if (w) w.location = u; else location.href = u; })
      .catch(function (e) { if (w) w.close(); toast(msgErr(e)); });
  }
  function vKtAjout() {
    var K = ktEt(), tel = telephone();
    if (K.dec) return vKtHd(tel ? 'Découper' : '« ' + esc(K.dec.f.nom || 'PDF') + ' » · ' + K.dec.n + ' pages', '<span class="a-cale"></span>') + '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '">' + vKtDecoupe() + '</div>';
    var h = vKtHd(tel ? 'Ajouter' : 'Ajouter des factures', '<span class="a-cale"></span>') + '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '">';
    if (ktEcrit()) h += '<label class="kt-depot" id="ktzone">' + ico('haut', 34, 2) + '<b>' + (tel ? 'Choisir des PDF ou des photos' : 'Déposez ici les PDF ou photos de factures') + '</b><span>' + (tel ? '' : 'ou cliquez pour les choisir · ') + 'plusieurs à la fois · un PDF de plusieurs factures se découpe ensuite</span><input type="file" id="ktdepot" accept="application/pdf,image/*" multiple hidden></label>'
      + (tel ? '<label class="btn gros kt-photo">' + ico('ktphoto', 22, 2) + 'Photographier une facture<input type="file" id="ktphoto" accept="image/*" capture="environment" hidden></label>' : '<p class="kt-note">Factures reçues par mail : faites glisser les pièces jointes depuis Outlook. Factures papier : scannez-les en un seul PDF (l’appli repère où chaque facture commence) ou photographiez-les avec le téléphone.</p>');
    var V = K.fac.filter(function (f) { return f.a_verifier; });
    if (K.fich.length) h += (tel ? tlSec('À découper · ' + K.fich.length) : '<h2 class="kt-h2">À découper · ' + K.fich.length + '</h2>') + '<div class="tl-liste">' + K.fich.map(function (x) { return '<div class="tl-l kt-lt"><span class="tl-i te-warn">' + ico('ktciseau', 22, 2) + '</span><button class="kt-ltb" data-ktdec="' + x.id + '"><span class="tl-n"><b>' + esc(x.nom || 'PDF') + '</b><span>' + (x.pages || '?') + ' pages · déposé le ' + ktDateL(String(x.cree_le).slice(0, 10)) + '</span></span><span class="kt-p warn">Découper</span></button>' + (ktEcrit() ? '<button class="kt-x" data-ktfichdel="' + x.id + '" aria-label="Supprimer ce PDF">' + ico('poubelle', 18, 2) + '</button>' : '') + '</div>'; }).join('') + '</div>';
    h += (tel ? tlSec('À vérifier · ' + V.length) : '<h2 class="kt-h2">À vérifier · ' + V.length + '</h2>');
    h += V.length ? '<div class="tl-liste">' + V.map(function (f) { return '<div class="tl-l kt-lt"><span class="tl-i ' + (f.source === 'stock' ? 'te-st' : 'te-eq') + '">' + ico(f.source === 'stock' ? 'boite' : f.source === 'photo' ? 'ktphoto' : 'ktfacture', 22, 2) + '</span><button class="kt-ltb" data-ktf="' + f.id + '"><span class="tl-n"><b>' + esc(f.fournisseur || 'Fournisseur à saisir') + (f.numero ? ' · ' + esc(f.numero) : '') + '</b><span>' + (f.source === 'stock' ? 'Arrivée du stock' : f.source === 'photo' ? 'Photo' : 'PDF déposé') + (f.page_debut && f.page_fin && f.page_fin > f.page_debut ? ' · pages ' + f.page_debut + ' à ' + f.page_fin : '') + ' · ' + esc(ktCompte(f.compte_code).nom) + '</span></span><span class="kt-ltd"><b>' + (f.montant_ttc != null ? eur(f.montant_ttc) : 'montant ?') + '</b></span></button></div>'; }).join('') + '</div>' : '<p class="a-vide">Rien à vérifier. Les factures importées dans une commande du stock arrivent ici toutes seules.</p>';
    return h + '</div>';
  }

  // ---------- Export pour le comptable ----------
  function ktPeriode() { var K = ktEt(); return K.expAn ? { d: K.mois.slice(0, 4) + '-01-01', f: K.mois.slice(0, 4) + '-12-01', n: 'année ' + K.mois.slice(0, 4) } : { d: K.mois, f: K.mois, n: ktNomMois(K.mois).toLowerCase() }; }
  function vKtExport() {
    var K = ktEt(), P = ktPeriode(), tel = telephone(), fs = K.fac.filter(function (f) { return f.mois >= P.d && f.mois <= P.f; }), nPdf = fs.filter(function (f) { return f.fichier_id; }).map(function (f) { return f.fichier_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).length;
    var h = vKtHd(tel ? 'Export' : 'Export comptable', '<span class="a-cale"></span>', bandeDate(vKtNavMois(), vKtSeg([['m', 'Le mois'], ['a', 'L’année']], K.expAn ? 'a' : 'm', 'data-ktexp', 'Période'), tel ? null : 'Pour votre comptable : ' + P.n));
    h += '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '"><div class="kt-exps">'
      + '<section class="kt-card"><h2>Tableau des factures et charges</h2><p class="kt-note">Un fichier qui s’ouvre dans Excel : une ligne par facture (fournisseur, n°, date, compte, entité, montant TTC, règlement), puis les charges du mois et le CA. ' + fs.length + ' ' + pl(fs.length, 'facture') + ' pour ' + P.n + '.</p><button class="btn" data-act="ktcsv">' + ico('telecharger', 18, 2.2) + 'Télécharger (Excel)</button></section>'
      + '<section class="kt-card"><h2>PDF des factures</h2><p class="kt-note">Tous les PDF et photos joints aux factures de ' + P.n + ', dans un seul fichier compressé (.zip). ' + nPdf + ' ' + pl(nPdf, 'fichier') + '.</p><button class="btn" data-act="ktzip"' + (nPdf ? '' : ' disabled') + '>' + ico('telecharger', 18, 2.2) + 'Télécharger les PDF</button></section></div></div>';
    return h;
  }
  function ktFichierTexte(nom, txt, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: type })); a.download = nom; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function ktCsv() {
    var K = ktEt(), P = ktPeriode(), c = function (v) { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }, n = function (v) { return v == null ? '' : String(nb(v)).replace('.', ','); };
    var L = [['Mois', 'Fournisseur', 'N° de facture', 'Date facture', 'Compte', 'Entité', 'Montant TTC', 'Réglée', 'Moyen', 'N° chèque', 'Date paiement', 'Note'].join(';')];
    K.fac.filter(function (f) { return f.mois >= P.d && f.mois <= P.f; }).sort(function (a, b) { return a.mois.localeCompare(b.mois) || ktCompte(a.compte_code).ordre - ktCompte(b.compte_code).ordre || String(a.date_facture).localeCompare(String(b.date_facture)); }).forEach(function (f) {
      var p = f.paiement_id && K.pai[f.paiement_id];
      L.push([f.mois.slice(0, 7), c(f.fournisseur), c(f.numero), ktDateL(f.date_facture), c(ktCompte(f.compte_code).nom), f.entite, n(f.montant_ttc), p || f.paiement_id ? 'oui' : 'non', p ? KT_MODES[p.mode] : '', c(p && p.n_cheque), p ? ktDateL(p.date_paiement) : '', c(f.note)].join(';'));
    });
    L.push(''); L.push(['Mois', 'Charge', 'Libellé', 'Entité', 'Moyen', 'Date', 'Montant', 'Brut', 'Charges'].join(';'));
    K.chg.filter(function (x) { return x.mois >= P.d && x.mois <= P.f; }).forEach(function (x) { L.push([x.mois.slice(0, 7), c(ktCompte(x.compte_code).nom), c(x.libelle), x.entite, x.mode ? KT_MODES[x.mode] : '', ktDateL(x.date_op), n(ktChgMontant(x)), n(x.brut), n(x.charges)].join(';')); });
    L.push(''); L.push('Mois;CA');
    Object.keys(K.ca).sort().filter(function (m) { return m >= P.d && m <= P.f; }).forEach(function (m) { L.push(m.slice(0, 7) + ';' + n(K.ca[m])); });
    ktFichierTexte('compta-' + (K.expAn ? K.mois.slice(0, 4) : K.mois.slice(0, 7)) + '.csv', '﻿' + L.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function ktChargerZip() { return window.JSZip ? Promise.resolve(window.JSZip) : new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = KT_VENDOR + 'jszip.min.js'; s.onload = function () { ok(window.JSZip); }; s.onerror = ko; document.head.appendChild(s); }); }
  async function ktZip() {
    var K = ktEt(), P = ktPeriode(), fs = K.fac.filter(function (f) { return f.mois >= P.d && f.mois <= P.f && f.fichier_id; });
    var ids = fs.map(function (f) { return f.fichier_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (!ids.length) return;
    try {
      toast('Préparation des PDF…');
      var Z = await ktChargerZip(), z = new Z(), fi = await ktQ(sb.from('compta_fichiers').select('*').in('id', ids));
      for (var i = 0; i < fi.length; i++) {
        var x = fi[i], des = fs.filter(function (f) { return f.fichier_id === x.id; }), f0 = des[0];
        var nom = (f0.mois || '').slice(0, 7) + ' ' + (des.length > 1 ? des.length + ' factures' : (f0.fournisseur || 'facture') + (f0.numero ? ' ' + f0.numero : '')) + ' (' + x.id + ').' + (x.chemin.split('.').pop());
        z.file(nom.replace(/[\\\/:*?"<>|]/g, '-'), await ktTelecharger(x.chemin));
      }
      var b = await z.generateAsync({ type: 'blob' }), a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'factures-' + (K.expAn ? K.mois.slice(0, 4) : K.mois.slice(0, 7)) + '.zip'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { toast(msgErr(e)); }
  }

  // ---------- Réglages ----------
  function vKtReglages() {
    var K = ktEt(), tel = telephone(), ro = !ktEcrit(), dis = ro ? ' disabled' : '';
    var h = vKtHd('Réglages', '<span class="a-cale"></span>') + '<div class="kt-corps' + (tel ? ' kt-tel' : '') + '"><div class="kt-regs">';
    h += '<section class="kt-card"><h2>Repères</h2><label class="kt-rl"><span>Dépenses dentaires (consommables + labo + implants), au plus</span><span class="kt-pc"><input class="kt-in d" data-ktpar="seuil_dentaire" inputmode="decimal" value="' + esc(String(ktSeuil()).replace('.', ',')) + '"' + dis + '> % du CA</span></label>'
      + ktComptes('dentaire').map(function (c) { return '<label class="kt-rl"><span>' + esc(c.nom) + '</span><span class="kt-pc"><input class="kt-in d" data-ktrep="' + esc(c.code) + '" inputmode="decimal" value="' + esc(c.repere != null ? String(c.repere).replace('.', ',') : '') + '" placeholder="—"' + dis + '> %</span></label>'; }).join('')
      + '<label class="kt-rl"><span>Salaires salariés chargés</span><span class="kt-pc"><input class="kt-in d" data-ktpar="repere_sal_salaries" inputmode="decimal" value="' + esc(K.params.repere_sal_salaries || '') + '"' + dis + '> %</span></label>'
      + '<label class="kt-rl"><span>Salaires praticiens chargés</span><span class="kt-pc"><input class="kt-in d" data-ktpar="repere_sal_praticiens" inputmode="decimal" value="' + esc(K.params.repere_sal_praticiens || '') + '"' + dis + '> %</span></label>'
      + '<p class="kt-note">Vert tant que la part du CA reste sous le repère, rouge dès qu’elle l’atteint.</p></section>';
    h += '<section class="kt-card"><h2>Comptes</h2>' + [['dentaire', 'Dentaire (comptés dans le repère)'], ['facture', 'Autres factures'], ['charge', 'Charges du mois (relevés bancaires)']].map(function (g) {
      return '<h3 class="kt-h3">' + g[1] + '</h3>' + K.comptes.filter(function (c) { return c.groupe === g[0]; }).map(function (c) { return '<div class="kt-rl"><input class="kt-in" data-ktcpn="' + esc(c.code) + '" value="' + esc(c.nom) + '" aria-label="Nom du compte"' + dis + '><label class="kt-chk"><input type="checkbox" data-ktcpa="' + esc(c.code) + '"' + (c.actif !== false ? ' checked' : '') + dis + '>Utilisé</label></div>'; }).join('');
    }).join('') + (ro ? '' : '<button class="kt-add" data-act="ktcptnew">' + ico('plus', 16, 2.4) + 'Ajouter un compte</button>') + '</section>';
    h += '<section class="kt-card"><h2>Fournisseurs <em>compte et entité proposés</em></h2>' + (K.fourn.length ? K.fourn.map(function (x) { return '<div class="kt-rl kt-fol"><b>' + esc(x.nom) + '</b><select class="kt-in" data-ktfoc="' + x.id + '" aria-label="Compte de ' + esc(x.nom) + '"' + dis + '>' + ktOptionsComptes(x.compte_code) + '</select><select class="kt-in" data-ktfoe="' + x.id + '" aria-label="Entité de ' + esc(x.nom) + '"' + dis + '><option' + (x.entite === 'ASSO' ? ' selected' : '') + '>ASSO</option><option' + (x.entite === 'SAS' ? ' selected' : '') + '>SAS</option></select>' + (ro ? '' : '<button class="kt-x" data-ktfodel="' + x.id + '" aria-label="Oublier ' + esc(x.nom) + '">' + ico('croix', 16, 2.4) + '</button>') + '</div>'; }).join('') : '<p class="kt-note">L’appli retient le compte et l’entité de chaque fournisseur à chaque facture enregistrée.</p>') + '</section>';
    h += '<section class="kt-card"><h2>Sécurité</h2><div class="kt-rl"><span>Code à 6 chiffres de la comptabilité</span><button class="btn l sm" data-act="ktcode">Changer mon code</button></div>'
      + '<label class="kt-rl"><span>Verrouiller après</span><select class="kt-in" data-ktpar="verrou_min"' + dis + '>' + [5, 10, 15, 30, 60].map(function (n) { return '<option value="' + n + '"' + (+K.params.verrou_min === n ? ' selected' : '') + '>' + n + ' minutes sans activité</option>'; }).join('') + '</select></label>'
      + '<div class="kt-rl"><span>Verrouiller maintenant</span><button class="btn l sm" data-act="ktverrou">' + ico('cadenas', 16, 2.2) + 'Verrouiller</button></div></section>';
    if (!ro) h += '<section class="kt-card kt-imp"><h2>Reprise de votre Excel</h2>' + vKtImport() + '</section>';
    return h + '</div></div>';
  }
  function ktParam(cle, v) {
    var K = ktEt(), n = ktNum(v); if (n == null) { toast('Nombre illisible'); render(); return; }
    sb.from('compta_parametres').upsert({ cle: cle, valeur: n }).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } K.params[cle] = n; if (cle === 'verrou_min' && K.etat) K.etat.verrou_min = n; toast('✔ Enregistré'); render(); });
  }
  function ktMajCompte(code, o) { var K = ktEt(); sb.from('compta_comptes').update(o).eq('code', code).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } Object.assign(ktCompte(code), o); toast('✔ Enregistré'); render(); }); }
  async function ktNouveauCompte() {
    var r = await fenetre({ titre: 'Nouveau compte', texte: 'Dans quel groupe ?', choix: [{ v: 'dentaire', t: 'Dentaire', s: 'compté dans le repère de ' + ktP(ktSeuil()).replace(',0', ''), on: false }, { v: 'facture', t: 'Autres factures', s: 'ex. honoraires, fournitures de bureau', on: true }, { v: 'charge', t: 'Charges du mois', s: 'saisies depuis les relevés bancaires' }], saisie: { label: 'Nom du compte' }, ok: 'Ajouter' });
    if (!r || !r.texte || !r.texte.trim()) return;
    var K = ktEt(), code = norm(r.texte).replace(/[^a-z0-9]+/g, '').slice(0, 20) || ('c' + Date.now());
    while (K.comptes.some(function (c) { return c.code === code; })) code += '2';
    var q = await sb.from('compta_comptes').insert({ code: code, nom: r.texte.trim(), groupe: r.v, ordre: Math.max.apply(null, K.comptes.map(function (c) { return c.ordre || 0; }).concat([0])) + 1 });
    if (q.error) { toast(msgErr(q.error)); return; }
    toast('✔ Compte ajouté'); ktCharger();
  }
  function ktChangerCode() {
    var html = '<label class="dlg-l">Code actuel<input id="ktc-a" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label><label class="dlg-l">Nouveau code (6 chiffres)<input id="ktc-n" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label><label class="dlg-l">Retapez le nouveau code<input id="ktc-n2" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>', d = null;
    fenetre({ titre: 'Changer mon code', html: html, ok: 'Changer', lire: function (bg) { var a = bg.querySelector('#ktc-a').value, n = bg.querySelector('#ktc-n').value, n2 = bg.querySelector('#ktc-n2').value; if (!/^\d{6}$/.test(n)) { toast('Le code fait 6 chiffres'); return false; } if (n !== n2) { toast('Les deux nouveaux codes sont différents'); return false; } d = { a: a, n: n }; } }).then(function (ok) {
      if (!ok || !d) return;
      sb.rpc('compta_definir_code', { p_ancien: d.a, p_nouveau: d.n }).then(function (r) { if (r.error) { toast(msgErr(r.error)); return; } toast(r.data && r.data.ok ? '✔ Code changé' : r.data && r.data.erreur === 'ancien' ? 'Code actuel incorrect' : 'Code refusé'); });
    });
  }

  // ---------- Reprise de l'Excel (une feuille par mois) ----------
  var KT_SECTIONS = [['consommables', 'conso'], ['laboratoire', 'labo'], ['invisalign', 'labo'], ['implant', 'implant'], ['prelevement', 'prlvt'], ['frais divers', 'divers'], ['frais cb', 'cb'], ['ndf', 'ndf'], ['note de frais', 'ndf'], ['pret', 'pret'], ['loyer', 'loyer'], ['assurance', 'assur'], ['leasing', 'leasing'], ['salaire', 'salaires'], ['impot', 'impots']];
  var KT_FEUILLES = [['janv', 1], ['fev', 2], ['mars', 3], ['avr', 4], ['mai', 5], ['juin', 6], ['juil', 7], ['aou', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12]];
  function vKtImport() {
    var K = ktEt(), I = K.imp;
    if (!I) return '<p class="kt-note">Pour reprendre les mois déjà saisis dans votre tableur (une feuille par mois : consommables, laboratoires, implants, prélèvements, frais, charges, salaires, CA). L’appli montre d’abord ce qu’elle a lu, mois par mois, avec ce qui paraît anormal ; rien n’est enregistré avant « Importer ».</p><div class="kt-rl"><label class="kt-pc">Année <input class="kt-in d" id="ktxan" inputmode="numeric" value="' + K.mois.slice(0, 4) + '"></label><label class="btn l sm">' + ico('haut', 16, 2.2) + 'Choisir le fichier Excel<input type="file" id="ktxlsx" accept=".xlsx" hidden></label></div>';
    if (I.lecture) return '<p class="a-vide">Lecture de ' + esc(I.nom) + '…</p>';
    return '<p class="kt-note"><b>' + esc(I.nom) + '</b> · année ' + I.an + '. Cochez les mois à reprendre.</p><div class="kt-imois">' + I.mois.map(function (x, i) {
      return '<label class="kt-im' + (x.al.length ? ' al' : '') + '"><input type="checkbox" data-ktimp="' + i + '"' + (x.on ? ' checked' : '') + '><span><b>' + ktNomMois(x.m) + '</b> <span class="mu">(feuille ' + esc(x.feuille) + ')</span><small>' + x.fac.length + ' factures · ' + eur(x.fac.reduce(function (s, f) { return s + (f.montant_ttc || 0); }, 0)) + ' · ' + x.chg.length + ' charges · CA ' + (x.ca != null ? eur(x.ca) : '—') + ' · ' + x.nPai + ' réglées</small>' + x.al.map(function (a) { return '<em>' + esc(a) + '</em>'; }).join('') + '</span></label>';
    }).join('') + '</div><div class="kt-rl"><button class="btn l sm" data-act="ktimpx">Annuler</button><button class="btn sm" data-act="ktimpgo"' + (I.busy ? ' disabled' : '') + '>' + (I.busy ? esc(I.busy) : 'Importer les mois cochés') + '</button></div>';
  }
  function ktXml(t) { return new DOMParser().parseFromString(t, 'application/xml'); }
  async function ktLireXlsx(file) {
    var Z = await ktChargerZip(), z = await Z.loadAsync(await file.arrayBuffer());
    var wb = ktXml(await z.file('xl/workbook.xml').async('string')), rel = ktXml(await z.file('xl/_rels/workbook.xml.rels').async('string')), ss = [];
    if (z.file('xl/sharedStrings.xml')) [].forEach.call(ktXml(await z.file('xl/sharedStrings.xml').async('string')).getElementsByTagName('si'), function (si) { ss.push([].map.call(si.getElementsByTagName('t'), function (t) { return t.textContent; }).join('')); });
    var cible = {}; [].forEach.call(rel.getElementsByTagName('Relationship'), function (r) { cible[r.getAttribute('Id')] = r.getAttribute('Target'); });
    var out = [];
    for (var s of [].slice.call(wb.getElementsByTagName('sheet'))) {
      var rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'), ch = (cible[rid] || '').replace(/^\/?xl\//, '');
      var fx = z.file('xl/' + ch); if (!fx) continue;
      var doc = ktXml(await fx.async('string')), cel = {};
      [].forEach.call(doc.getElementsByTagName('c'), function (c) {
        var r = c.getAttribute('r'), t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = null;
        if (t === 's' && v) val = ss[+v.textContent]; else if (t === 'inlineStr') val = [].map.call(c.getElementsByTagName('t'), function (x) { return x.textContent; }).join(''); else if (v) val = t === 'str' || t === 'e' ? v.textContent : t === 'b' ? v.textContent === '1' : +v.textContent;
        if (val != null && val !== '') cel[r] = val;
      });
      out.push({ nom: s.getAttribute('name'), c: cel });
    }
    return out;
  }
  function ktXDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') { if (v < 30000 || v > 60000) return null; var d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }
    var m = String(v).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,5})$/); if (!m) return null;
    var y = m[3].length === 2 ? '20' + m[3] : m[3].length === 5 ? m[3].slice(0, 4) : m[3]; if (y.length !== 4) return null;
    var iso = y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'), d2 = new Date(iso + 'T12:00:00');
    return isNaN(d2) || d2.getDate() !== +m[1] ? null : iso;
  }
  function ktXMode(v) { var n = norm(v).replace(/[^a-z]/g, ''); return /^vir/.test(n) ? 'virement' : /^pr/.test(n) ? 'prelevement' : /^cb/.test(n) ? 'cb' : /^ch/.test(n) ? 'cheque' : null; }
  function ktXEnt(v) { var n = norm(v); return /presta|sas/.test(n) ? 'SAS' : 'ASSO'; }
  function ktLireFeuille(F, an) {
    var cle = norm(F.nom).replace(/[^a-z]/g, ''), mo = null;
    KT_FEUILLES.some(function (x) { if (cle.indexOf(x[0]) === 0) { mo = x[1]; return true; } });
    if (!mo) return null;
    var m = an + '-' + String(mo).padStart(2, '0') + '-01', c = F.c, max = 0, R = { feuille: F.nom, m: m, fac: [], chg: [], al: [], ca: typeof c.M2 === 'number' ? Math.round(c.M2 * 100) / 100 : null };
    Object.keys(c).forEach(function (k) { var r = +k.replace(/[A-Z]+/, ''); if (r > max) max = r; });
    var sec = null, horsMois = 0, sansDate = 0;
    for (var r = 2; r <= max; r++) {
      var C_ = c['C' + r], D_ = c['D' + r], E_ = c['E' + r], F_ = c['F' + r], txt = norm(C_ || '').trim(), entete = /numero de facture|patient|masse salariale/.test(norm(D_ || '')) || norm(F_ || '') === 'montant';
      if (entete) { sec = null; KT_SECTIONS.some(function (x) { if (txt.indexOf(x[0]) >= 0) { sec = x[1]; return true; } }); continue; }
      if (!sec || !C_ || txt === 'total' || norm(E_ || '') === 'total') continue;
      var grp = ktCompte(sec).groupe;
      if (sec === 'salaires') { var b = typeof D_ === 'number' ? D_ : null, ch = typeof E_ === 'number' ? E_ : null; if (b != null || ch != null) R.chg.push({ mois: m, compte_code: sec, libelle: String(C_).trim(), entite: 'ASSO', brut: b, charges: ch }); continue; }
      if (typeof F_ !== 'number') continue;
      var mode = ktXMode(c['H' + r]), dPai = ktXDate(c['J' + r]), dF = ktXDate(E_), ent = ktXEnt(c['G' + r]);
      if (grp === 'charge') { R.chg.push({ mois: m, compte_code: sec, libelle: String(C_).trim(), entite: ent, mode: mode, date_op: dPai || dF, montant: Math.round(F_ * 100) / 100 }); continue; }
      if (E_ != null && E_ !== '' && !dF) sansDate++;
      if (dF && ktMois(dF) !== m) horsMois++;
      var num = D_ != null && String(D_).trim() && norm(String(D_)) !== 'patient' ? String(D_).trim() : null;
      if (num && /^\d+(\.0+)?$/.test(num)) num = String(parseInt(num, 10));
      var paye = dPai || (mode === 'prelevement' || mode === 'cb' ? (dF || m) : null);
      R.fac.push({ fournisseur: String(C_).trim().replace(/\s+/g, ' '), numero: num, date_facture: dF, mois: m, compte_code: sec, entite: ent, montant_ttc: Math.round(F_ * 100) / 100, source: 'excel', _p: paye && mode ? { mode: mode, date_paiement: paye, n_cheque: c['I' + r] != null ? String(c['I' + r]) : null, entite: ent } : null });
    }
    if (horsMois) R.al.push(horsMois + ' ' + pl(horsMois, 'facture') + ' datée' + (horsMois > 1 ? 's' : '') + ' d’un autre mois (gardées dans ' + KT_MOIS[mo - 1] + ')');
    if (sansDate) R.al.push(sansDate + ' date' + (sansDate > 1 ? 's' : '') + ' illisible' + (sansDate > 1 ? 's' : '') + ' (laissées vides)');
    R.nPai = R.fac.filter(function (f) { return f._p; }).length;
    return R;
  }
  async function ktImporterXlsx(file) {
    var K = ktEt(), an = ($('ktxan') || {}).value || K.mois.slice(0, 4);
    if (!/^20\d\d$/.test(an)) { toast('Année illisible'); return; }
    K.imp = { nom: file.name, an: an, lecture: true }; render();
    try {
      var feuilles = await ktLireXlsx(file), mois = feuilles.map(function (F) { return ktLireFeuille(F, an); }).filter(Boolean);
      // alertes entre mois : même CA, mois maigre, mois déjà repris
      var deja = await ktQ(sb.from('compta_factures').select('mois').eq('source', 'excel').gte('mois', an + '-01-01').lte('mois', an + '-12-01'));
      var moy = mois.reduce(function (s, x) { return s + x.fac.length; }, 0) / (mois.length || 1);
      mois.forEach(function (x) {
        var nAl = x.al.length;   // alertes de lecture (dates) : le mois reste coché ; celles qui suivent le décochent
        mois.forEach(function (y) { if (y !== x && x.ca != null && x.ca === y.ca && y.m < x.m) x.al.push('CA identique à ' + KT_MOIS[+y.m.slice(5, 7) - 1] + ' : copie d’onglet ?'); });
        var ft = x.fac.filter(function (f) { return f.date_facture; }), hors = ft.filter(function (f) { return ktMois(f.date_facture) !== x.m; });
        if (ft.length > 10 && hors.length > ft.length / 2) x.al.push('La plupart des dates sont d’un autre mois : onglet à vérifier');
        if (moy > 20 && x.fac.length < moy * .7) x.al.push('Moins de lignes que les autres mois (' + x.fac.length + ' contre ' + Math.round(moy) + ' en moyenne)');
        if (deja.some(function (d) { return d.mois === x.m; })) x.al.push('Déjà repris dans l’appli : le cocher ajouterait des doublons sans n°');
        x.on = x.al.length === nAl;
      });
      K.imp = { nom: file.name, an: an, mois: mois };
      if (!mois.length) { K.imp = null; toast('Aucune feuille de mois reconnue (JANV, FEV, MARS…)'); }
    } catch (e) { K.imp = null; toast('Fichier illisible : ' + msgErr(e)); }
    render();
  }
  async function ktImporterGo() {
    var K = ktEt(), I = K.imp; if (!I || I.busy) return;
    var ms = I.mois.filter(function (x) { return x.on; }); if (!ms.length) { toast('Cochez au moins un mois'); return; }
    var nF = ms.reduce(function (s, x) { return s + x.fac.length; }, 0), nC = ms.reduce(function (s, x) { return s + x.chg.length; }, 0);
    if (!(await demander('Importer ' + ms.length + ' ' + pl(ms.length, 'mois') + ' ?', nF + ' factures, ' + nC + ' lignes de charges et le CA de chaque mois. Les factures déjà présentes (même fournisseur, même numéro) sont laissées de côté.', 'Importer'))) return;
    try {
      I.busy = 'Vérification des doublons…'; render();
      var ex = await ktQ(sb.from('compta_factures').select('fournisseur,numero').not('numero', 'is', null).limit(20000)), vus = {};
      ex.forEach(function (f) { vus[norm(f.fournisseur) + '|' + f.numero] = 1; });
      var fac = [], doubles = 0;
      ms.forEach(function (x) { x.fac.forEach(function (f) { if (f.numero) { var k = norm(f.fournisseur) + '|' + f.numero; if (vus[k]) { doubles++; return; } vus[k] = 1; } fac.push(f); }); });
      // paiements : un par fournisseur, moyen, date, n° de chèque et entité
      var grp = {}, cles = [];
      fac.forEach(function (f) { if (!f._p) return; var k = [norm(f.fournisseur), f._p.mode, f._p.date_paiement, f._p.n_cheque || '', f._p.entite].join('|'); if (!grp[k]) { grp[k] = { p: Object.assign({ montant: 0 }, f._p), f: [] }; cles.push(k); } grp[k].f.push(f); grp[k].p.montant = Math.round((grp[k].p.montant + f.montant_ttc) * 100) / 100; });
      for (var i = 0; i < cles.length; i += 200) {
        I.busy = 'Paiements ' + Math.min(i + 200, cles.length) + ' / ' + cles.length + '…'; render();
        var part = cles.slice(i, i + 200), r = await ktQ(sb.from('compta_paiements').insert(part.map(function (k) { return grp[k].p; })).select('id'));
        part.forEach(function (k, j) { grp[k].f.forEach(function (f) { f.paiement_id = r[j].id; }); });
      }
      var rows = fac.map(function (f) { var o = Object.assign({}, f); delete o._p; return o; });
      for (var j = 0; j < rows.length; j += 200) { I.busy = 'Factures ' + Math.min(j + 200, rows.length) + ' / ' + rows.length + '…'; render(); await ktQ(sb.from('compta_factures').insert(rows.slice(j, j + 200))); }
      var chg = []; ms.forEach(function (x) { chg = chg.concat(x.chg); });
      for (var k2 = 0; k2 < chg.length; k2 += 200) await ktQ(sb.from('compta_charges').insert(chg.slice(k2, k2 + 200)));
      var cas = ms.filter(function (x) { return x.ca != null; }).map(function (x) { return { mois: x.m, montant: x.ca }; });
      if (cas.length) await ktQ(sb.from('compta_ca').upsert(cas));
      // fournisseurs : compte et entité les plus fréquents
      var fo = {}; rows.forEach(function (f) { var n = norm(f.fournisseur); if (!fo[n]) fo[n] = { nom: f.fournisseur, n: {} }; var k = f.compte_code + '|' + f.entite; fo[n].n[k] = (fo[n].n[k] || 0) + 1; });
      var neufs = Object.keys(fo).filter(function (n) { return !ktFo(fo[n].nom); }).map(function (n) { var best = Object.keys(fo[n].n).sort(function (a, b) { return fo[n].n[b] - fo[n].n[a]; })[0].split('|'); return { nom: fo[n].nom, compte_code: best[0], entite: best[1] }; });
      if (neufs.length) await sb.from('compta_fournisseurs').insert(neufs);
      K.imp = null;
      toast('✔ Reprise faite : ' + rows.length + ' factures, ' + chg.length + ' charges, ' + cas.length + ' CA' + (doubles ? ' · ' + doubles + ' doublons laissés' : ''));
      ktCharger();
    } catch (e) { I.busy = null; toast('Reprise interrompue : ' + msgErr(e)); render(); }
  }

  // ---------- Plus (téléphone) ----------
  function vKtPlus() {
    var K = ktEt();
    return hdA({ t: 'Plus', fixe: true, cls: 'kt-hd', cab: '<span class="hr-vide"></span>' }) + '<div class="a-corps tl-c kt-tel">'
      + tlSec('Comptabilité') + tlListe([
        { at: 'data-tab="ktajout"', ic: 'haut', te: 'eq', t: 'Ajouter des factures', s: K.fich.length ? K.fich.length + ' PDF à découper' : 'PDF, photos, à vérifier', sw: K.fich.length ? 'warn' : '' },
        { at: 'data-tab="ktexp"', ic: 'telecharger', te: 'pl', t: 'Export comptable', s: 'Tableau Excel et PDF du mois' },
        { at: 'data-tab="ktreg"', ic: 'reglage', te: 'ap', t: 'Réglages', s: 'Repères, comptes, fournisseurs, code' }
      ]) + tlSec('Sécurité') + tlListe([
        { at: 'data-act="ktverrou"', ic: 'cadenas', te: 'mo', t: 'Verrouiller', s: 'Le code sera redemandé' },
        { at: 'data-act="ktsortir"', ic: 'changer', te: 'mo', t: 'Se déconnecter' }
      ]) + '<p class="tl-ver">Version ' + esc(C.version || '') + (C.env === 'dev' ? ' · site de test' : '') + '</p></div>';
  }

  // ---------- Écrans, clics et saisies du module ----------
  var KT_VUES = { ktdb: vKtTdb, ktfac: vKtFactures, ktpai: vKtPaiements, ktchg: vKtCharges, ktajout: vKtAjout, ktexp: vKtExport, ktreg: vKtReglages, ktplus: vKtPlus };
  function vKt() { var K = ktEt(); if (!K.etat) return '<p class="chargement">Chargement…</p>'; if (!K.etat.acces) return vKtRefus(); if (!K.ouvert) return vKtCode(); if (!K.pret) return '<p class="chargement">Chargement de la comptabilité…</p>'; return (KT_VUES[S.tab] || vKtTdb)(); }
  // Clics : renvoie true si traité
  function ktAction(d) {
    var K = ktEt();
    if (d.ktk != null) { ktTouche(d.ktk); return true; }
    if (d.ktm != null) { ktAllerMois(+d.ktm); return true; }
    if (d.ktmois) { K.mois = d.ktmois; K.sel = {}; render(); return true; }
    if (d.ktper) { K.per = d.ktper; render(); return true; }
    if (d.tab && KT_TABS.indexOf(d.tab) >= 0) {
      if (d.ktfil) K.f = d.ktfil;
      if (d.ktcp != null) { K.compte = d.ktcp; if (!d.ktfil) K.f = 'mois'; }
      if (d.tab !== S.tab) { K.dec = d.tab === 'ktajout' ? K.dec : null; }
      S.tab = d.tab; render(); window.scrollTo(0, 0); return true;
    }
    if (d.ktfil) { K.f = d.ktfil; render(); return true; }
    if (d.ktcp != null) { K.compte = d.ktcp; render(); return true; }
    if (d.ktpm != null) { K.pm = d.ktpm; render(); return true; }
    if (d.ktexp) { K.expAn = d.ktexp === 'a'; render(); return true; }
    if (d.ktf) { ktFacture(+d.ktf); return true; }
    if (d.ktvoir) { var f = K.fac.filter(function (x) { return x.id === +d.ktvoir; })[0]; if (f) ktVoirPdf(f); return true; }
    if (d.ktpaie) { ktVoirPaiement(+d.ktpaie); return true; }
    if (d.ktchgadd) { ktChgAjout(d.ktchgadd); return true; }
    if (d.ktchgdel) { ktChgSuppr(+d.ktchgdel); return true; }
    if (d.ktpg) { var p = +d.ktpg; if (p > 1 && K.dec && !K.dec.lecture && ktEcrit()) { if (K.dec.coupes[p]) delete K.dec.coupes[p]; else K.dec.coupes[p] = true; render(); } return true; }
    if (d.ktdec) { ktOuvrirDecoupe(+d.ktdec); return true; }
    if (d.ktfichdel) { ktFichSuppr(+d.ktfichdel); return true; }
    if (d.ktfodel) { var x = K.fourn.filter(function (y) { return y.id === +d.ktfodel; })[0]; demander('Oublier ' + (x ? x.nom : 'ce fournisseur') + ' ?', 'Ses factures restent ; l’appli ne proposera plus son compte et son entité.', 'Oublier').then(function (ok) { if (ok) sb.from('compta_fournisseurs').delete().eq('id', +d.ktfodel).then(function () { ktCharger(); }); }); return true; }
    switch (d.act) {
      case 'ktnew': ktFacture(null); return true;
      case 'ktpayer': ktPayer(Object.keys(K.sel).map(Number)); return true;
      case 'ktdesel': K.sel = {}; render(); return true;
      case 'ktca': ktSaisirCA(); return true;
      case 'ktreprendre': ktReprendre(); return true;
      case 'ktocr': ktReperer(); return true;
      case 'ktdecok': ktCreerDecoupe(); return true;
      case 'ktdecx': K.dec = null; KT_DOC = null; render(); return true;
      case 'ktcsv': ktCsv(); return true;
      case 'ktzip': ktZip(); return true;
      case 'ktcode': ktChangerCode(); return true;
      case 'ktverrou': ktVerrouiller(true, ''); return true;
      case 'ktcptnew': ktNouveauCompte(); return true;
      case 'ktimpx': K.imp = null; render(); return true;
      case 'ktimpgo': ktImporterGo(); return true;
    }
    return false;
  }
  // Saisies (change) : renvoie true si traité
  function ktChange(e) {
    var t = e.target, d = t.dataset || {}, K = ktEt();
    if (d.ktsel) { if (t.checked) K.sel[d.ktsel] = true; else delete K.sel[d.ktsel]; render(); return true; }
    if (t.closest && t.closest('[data-ktchg]') && t.dataset.k) { ktChgModif(t); return true; }
    if (d.ktca) { ktSauverCA(d.ktca, t.value); return true; }
    if (d.ktpar) { ktParam(d.ktpar, t.value); return true; }
    if (d.ktrep) { var n = ktNum(t.value); if (t.value.trim() && n == null) { toast('Nombre illisible'); return true; } ktMajCompte(d.ktrep, { repere: n }); return true; }
    if (d.ktcpn) { if (t.value.trim()) ktMajCompte(d.ktcpn, { nom: t.value.trim() }); return true; }
    if (d.ktcpa) { ktMajCompte(d.ktcpa, { actif: t.checked }); return true; }
    if (d.ktfoc || d.ktfoe) { var o = d.ktfoc ? { compte_code: t.value } : { entite: t.value }; sb.from('compta_fournisseurs').update(o).eq('id', +(d.ktfoc || d.ktfoe)).then(function (r) { if (r.error) toast(msgErr(r.error)); else { toast('✔ Enregistré'); ktCharger(); } }); return true; }
    if (d.ktimp != null && K.imp) { K.imp.mois[+d.ktimp].on = t.checked; return true; }
    if (t.id === 'ktdepot') { ktDeposer(t.files, 'depot'); t.value = ''; return true; }
    if (t.id === 'ktphoto') { ktDeposer(t.files, 'photo'); t.value = ''; return true; }
    if (t.id === 'ktxlsx') { if (t.files[0]) ktImporterXlsx(t.files[0]); t.value = ''; return true; }
    return false;
  }
  // Frappe (input) : recherche sans perdre le curseur
  var KT_TQ = null;
  function ktSaisie(e) { if (e.target.id !== 'ktq') return false; ktEt().q = e.target.value; clearTimeout(KT_TQ); KT_TQ = setTimeout(render, 200); return true; }
  // Clavier : chiffres du code
  function ktClavier(e) { var K = S.kt; if (!K || K.ouvert || !K.etat || !K.etat.acces || document.querySelector('.dlg-bg')) return false; if (/^\d$/.test(e.key)) { ktTouche(e.key); return true; } if (e.key === 'Backspace') { ktTouche('x'); return true; } return false; }
  // Glisser-déposer des PDF sur la page « Ajouter des factures »
  function ktDepot(e) {
    if (!S.kt || !S.kt.ouvert || !ktEcrit() || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return false;
    e.preventDefault();
    var z = $('ktzone');
    if (e.type === 'dragover') { if (z) z.classList.add('on'); return true; }
    if (e.type === 'dragleave') { if (z && !z.contains(e.relatedTarget)) z.classList.remove('on'); return true; }
    if (e.type === 'drop') { if (z) z.classList.remove('on'); ktDeposer(e.dataTransfer.files, 'depot'); return true; }
    return false;
  }

  // =====================================================================
  // 3. DÉMARRAGE du site séparé — à SUPPRIMER à l'intégration (Evydent a sa connexion, son menu et son rendu)
  //    À l'intégration : ktAction(d) dans le gestionnaire de clics, ktChange / ktSaisie / ktClavier / ktDepot dans
  //    ceux de change / input / keydown / glisser-déposer, setInterval(ktVeille, 30000), et ktDemarrer() à la 1re ouverture.
  // =====================================================================
  function dernierId() { try { return localStorage.getItem('evy-dernier-id') || ''; } catch (e) { return ''; } }
  function vKtLogin() {
    var id = S.lid != null ? S.lid : dernierId();
    return '<div class="lg"><div class="lg-top"></div><div class="lg-in"><div class="lg-hd"><img class="lg-logo" src="../assets/logo-evydent.jpg" alt="Logo Evydent Val d’Yerres"><div class="lg-name">Espace dentaire Val d’Yerres</div><div class="lg-sub">Comptabilité' + (C.env === 'dev' ? ' · site de test' : '') + '</div></div>'
      + '<form class="lg-card" id="lform" autocomplete="on"><h1>Bonjour</h1>'
      + '<label>Identifiant<input id="lid" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Votre identifiant Evydent" value="' + esc(id) + '"></label>'
      + '<label>Mot de passe<span class="lg-pw"><input id="lpw" name="password" type="password" autocomplete="current-password" placeholder="Votre mot de passe"></span></label>'
      + (S.err ? '<p class="lg-err" role="alert">' + esc(S.err) + '</p>' : '')
      + '<button class="btn gold" id="lbtn" type="submit"' + (S.lbusy ? ' disabled' : '') + '>Se connecter</button>'
      + '<p class="lg-help">La même connexion qu’Evydent. Le code de la comptabilité sera demandé ensuite.</p></form>'
      + '<div class="lg-foot">Accès réservé à la direction<br><small>Version ' + esc(C.version || '') + '</small></div></div></div>';
  }
  function connexion(ev) {
    if (ev) ev.preventDefault();
    var id = ($('lid').value || '').trim(), pw = $('lpw').value;
    if (!id || !pw) { S.err = !id ? 'Tapez d’abord votre identifiant.' : 'Tapez votre mot de passe.'; S.lid = id; render(); return; }
    S.lbusy = true; S.lid = id; render();
    sb.auth.signInWithPassword({ email: emailDe(id), password: pw }).then(function (r) {
      S.lbusy = false;
      if (r.error) { S.err = msgErr(r.error); render(); var p = $('lpw'); if (p) p.focus(); return; }
      try { localStorage.setItem('evy-dernier-id', id); } catch (e) {}
      S.err = ''; S.lid = null; demarrer(r.data.session);
    });
  }
  function demarrer(session) {
    S.session = session; S.me = null; S.kt = null; render();
    sb.from('profils').select('*').eq('id', session.user.id).maybeSingle().then(function (r) {
      S.me = r.data || { nom: '?', actif: false };
      if (!S.me.actif) { ktEt().etat = { acces: false }; render(); return; }
      ktDemarrer();
    });
  }
  function sortir() { sb.rpc('compta_fermer').then(function () { return sb.auth.signOut(); }).then(function () { S.session = null; S.me = null; S.kt = null; S.tab = 'ktdb'; render(); }); }
  function railOn() { return !telephone() && window.innerWidth >= 900; }
  function railMini() { var v = null; try { v = localStorage.getItem('evy-rail'); } catch (e) {} return v ? v === 'mini' : tablette() || window.innerWidth < 1300; }
  function vKtRail() {
    var K = ktEt(), cur = S.tab, mini = railMini(), nR = ktARegler().length, nA = K.fich.length + K.fac.filter(function (f) { return f.a_verifier; }).length;
    var it = function (tab, n, ic, b, at) { return '<button class="rail-l' + (cur === tab ? ' on' : '') + '" ' + (at || 'data-tab="' + tab + '"') + (cur === tab ? ' aria-current="page"' : '') + ' title="' + esc(n) + '"><span class="rail-i">' + ico(ic, 21, 2.1) + (b && mini ? '<em class="rail-p">' + b + '</em>' : '') + '</span><span class="rail-t">' + n + '</span>' + (b && !mini ? '<em class="rail-b">' + b + '</em>' : '') + '</button>'; };
    return '<nav class="rail" aria-label="Pages de la comptabilité"><div class="rail-hd"><img class="rail-lo" src="../assets/icone-192.png" alt="" aria-hidden="true"><b class="rail-t">Comptabilité</b></div>'
      + it('ktdb', 'Tableau de bord', 'graph') + it('ktfac', 'Factures', 'ktfacture', nR) + it('ktpai', 'Paiements', 'ktcarte') + it('ktchg', 'Charges du mois', 'ktbanque') + it('ktajout', 'Ajouter des factures', 'haut', nA) + it('ktexp', 'Export comptable', 'telecharger')
      + '<span class="rail-sp"></span>' + it('ktreg', 'Réglages', 'reglage') + it('', 'Verrouiller', 'cadenas', null, 'data-act="ktverrou"')
      + '<button class="rail-l rail-r" data-act="railmini" aria-label="' + (mini ? 'Afficher les noms des pages' : 'Réduire en icônes') + '" title="' + (mini ? 'Afficher les noms' : 'Réduire en icônes') + '"><span class="rail-i">' + ico(mini ? 'suiv' : 'prec', 20, 2.4) + '</span><span class="rail-t">' + (mini ? 'Afficher les noms' : 'Réduire en icônes') + '</span></button></nav>';
  }
  function vKtBarTel() {
    var t = S.tab, cur = ['ktajout', 'ktexp', 'ktreg', 'ktplus'].indexOf(t) >= 0 ? 'ktplus' : t, nR = ktARegler().length;
    var it = function (tab, n, ic, b) { return '<button data-tab="' + tab + '" class="' + (cur === tab ? 'on' : '') + '"' + (cur === tab ? ' aria-current="page"' : '') + '><span class="bi">' + ico(ic, 24) + (b ? '<span class="badge">' + b + '</span>' : '') + '</span><span>' + n + '</span></button>'; };
    return '<nav class="bnav tg kt-bnav" aria-label="Pages">' + it('ktdb', 'Accueil', 'maison') + it('ktfac', 'Factures', 'ktfacture', nR) + it('ktpai', 'Paiements', 'ktcarte') + it('ktchg', 'Charges', 'ktbanque') + it('ktplus', 'Plus', 'menu') + '</nav>';
  }
  // Rendu : le champ en cours garde le curseur (repéré par son id ou ses attributs data-)
  function poser(app, h) {
    var a = document.activeElement, sel = null, pos = null;
    if (a && a !== document.body && app.contains(a)) {
      if (a.id) sel = '#' + a.id;
      else { var at = [].filter.call(a.attributes, function (x) { return /^data-/.test(x.name); }).map(function (x) { return '[' + x.name + '="' + String(x.value).replace(/"/g, '\\"') + '"]'; }).join(''); var row = a.closest('[data-ktchg]'); sel = at ? (row && !a.dataset.ktchg ? '[data-ktchg="' + row.dataset.ktchg + '"] ' : '') + at : null; }
      try { pos = a.selectionStart; } catch (e) {}
    }
    app.innerHTML = h;
    if (sel) { var b = app.querySelector(sel); if (b && b.tagName !== 'SELECT') { b.focus(); try { if (pos != null) b.setSelectionRange(pos, pos); } catch (e) {} } }
  }
  function render() {
    var app = $('app'), tel = telephone();
    document.body.classList.toggle('tablette', tablette());
    document.body.classList.toggle('ecran-lg', !S.session);
    if (!S.session) { document.body.classList.remove('rail-on', 'rail-mini', 'kt-on'); app.innerHTML = vKtLogin(); $('lform').addEventListener('submit', connexion); var i = $('lid').value ? $('lpw') : $('lid'); if (i && !tel) i.focus(); return; }
    var K = S.kt, dedans = !!(K && K.ouvert && K.pret && S.me);
    var on = dedans && railOn();
    document.body.classList.toggle('rail-on', on);
    document.body.classList.toggle('rail-mini', on && railMini());
    document.body.classList.toggle('kt-on', dedans);
    document.body.classList.toggle('kt-tel-on', dedans && tel);
    var h = S.me ? vKt() : '<p class="chargement">Chargement…</p>';
    poser(app, (on ? vKtRail() : '') + h + (dedans && tel ? vKtBarTel() : ''));
  }
  document.addEventListener('click', function (e) {
    ktActivite();
    var t = e.target.closest('button'); if (!t || !S.session || t.closest('.dlg-bg') || t.closest('#lform')) return;
    var d = t.dataset;
    if (d.act === 'railmini') { try { localStorage.setItem('evy-rail', railMini() ? 'large' : 'mini'); } catch (er) {} render(); return; }
    if (d.act === 'ktsortir') { sortir(); return; }
    ktAction(d);
  });
  document.addEventListener('change', function (e) { ktActivite(); if (S.session) ktChange(e); });
  document.addEventListener('input', function (e) { ktActivite(); if (S.session) ktSaisie(e); });
  document.addEventListener('keydown', function (e) { ktActivite(); if (S.session && ktClavier(e)) e.preventDefault(); });
  ['dragover', 'dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (S.session && S.tab === 'ktajout') ktDepot(e); else if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); }); });
  var largeur = window.innerWidth;
  window.addEventListener('resize', function () { var w = window.innerWidth; if ((w >= 900) !== (largeur >= 900) || (w >= 1300) !== (largeur >= 1300) || (w > 700) !== (largeur > 700)) { largeur = w; render(); } });
  setInterval(ktVeille, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ktVeille(); });
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && S.session) { S.session = null; S.me = null; S.kt = null; render(); } });
  sb.auth.getSession().then(function (r) { var s = r.data && r.data.session; if (s) demarrer(s); else render(); });
})();
