// Choix de l'environnement selon l'adresse du site.
// - github.io ou localhost  -> base de TEST (Evydent-Dev)
// - toute autre adresse (Netlify) -> base RÉELLE (Evydent-Prod)
// Seules les clés publiques (publishable) figurent ici : elles sont faites pour être visibles.
(function () {
  var h = location.hostname;
  var dev = /github\.io$/.test(h) || h === 'localhost' || h === '127.0.0.1';
  window.CONFIG = dev
    ? { env: 'dev',  url: 'https://fmtpigazzplaqexvqyit.supabase.co', key: 'sb_publishable_n63Rb2pU-f6fLOiU5gkjig_ubY_PRJr' }
    : { env: 'prod', url: 'https://jpvfhkotenlylekkvigc.supabase.co', key: 'sb_publishable_vI_EjQrTCYIhcrDEiQmwPg_bm-r5_U8' };
  // Domaine technique ajouté à un identifiant sans « @ » (aucun email n'est envoyé)
  window.CONFIG.domaine = 'espace-dentaire-val-d-yerres.fr';
  window.CONFIG.version = '2.3.0-dev.88';
})();
