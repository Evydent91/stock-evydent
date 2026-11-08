// Fonction Supabase « equipe » : création des comptes et gestion des mots de passe.
// Elle tourne chez Supabase avec la clé de service (jamais envoyée au navigateur).
// Seules la référente et la responsable (rôle de gestion, compte actif) peuvent l'appeler.
//
// Actions (corps JSON) :
//   { action: "creer", identifiant, nom, role, cabinet, mdp }
//   { action: "reinit", user_id, mdp }          -> nouveau code / mot de passe
//   { action: "actif", user_id, actif }         -> bloque ou débloque la connexion
import { createClient } from "jsr:@supabase/supabase-js@2";

const DOMAINE = "espace-dentaire-val-d-yerres.fr";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const rep = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...CORS, "Content-Type": "application/json" } });
const erreur = (message: string, statut = 400) => rep({ erreur: message }, statut);

// Code assistante : 6 chiffres. Référente / responsable : 10 caractères minimum, avec lettres et chiffres.
function mdpValide(role: string, mdp: string): string | null {
  if (typeof mdp !== "string") return "Mot de passe manquant";
  if (role === "assistante") return /^\d{6}$/.test(mdp) ? null : "Le code d’une assistante doit faire 6 chiffres";
  if (mdp.length < 10 || !/[A-Za-z]/.test(mdp) || !/\d/.test(mdp))
    return "Le mot de passe doit faire au moins 10 caractères, avec des lettres et des chiffres";
  return null;
}
function identifiantPropre(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
}

// Clé de service fournie automatiquement par Supabase (nouvelle clé « secret » ou ancienne « service_role »)
function cleService(): string {
  try {
    const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const v = k.default || Object.values(k)[0];
    if (v) return String(v);
  } catch { /* ignoré */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erreur("Méthode non autorisée", 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, cleService(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Qui appelle ?
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: eU } = await admin.auth.getUser(jeton);
  if (eU || !u?.user) return erreur("Session invalide : reconnectez-vous", 401);
  const { data: moi } = await admin.from("profils").select("role, actif").eq("id", u.user.id).maybeSingle();
  if (!moi || !moi.actif || !["referente", "responsable"].includes(moi.role))
    return erreur("Réservé à la référente ou à la responsable", 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return erreur("Requête illisible"); }

  // 2. Création d'un compte
  if (b.action === "creer") {
    const identifiant = identifiantPropre(String(b.identifiant));
    const nom = String(b.nom || "").trim();
    const role = String(b.role || "assistante");
    const cabinet = b.cabinet ? Number(b.cabinet) : null;
    if (!/^[a-z0-9._-]{2,30}$/.test(identifiant)) return erreur("Identifiant : 2 à 30 lettres ou chiffres, sans espace ni accent");
    if (!nom) return erreur("Le prénom est obligatoire");
    if (!["assistante", "referente", "responsable"].includes(role)) return erreur("Rôle inconnu");
    if (cabinet !== null && !(cabinet >= 1 && cabinet <= 8)) return erreur("Cabinet : de 1 à 8");
    const pb = mdpValide(role, String(b.mdp));
    if (pb) return erreur(pb);
    const { data: deja } = await admin.from("profils").select("id").eq("identifiant", identifiant).maybeSingle();
    if (deja) return erreur("Cet identifiant est déjà utilisé");

    const { data: c, error: eC } = await admin.auth.admin.createUser({
      email: `${identifiant}@${DOMAINE}`, password: String(b.mdp), email_confirm: true,
    });
    if (eC || !c?.user) return erreur(eC?.message?.includes("already") ? "Cet identifiant est déjà utilisé" : "Création impossible : " + (eC?.message || "?"));
    const { error: eP } = await admin.from("profils").insert({ id: c.user.id, identifiant, nom, role, cabinet, actif: true });
    if (eP) { await admin.auth.admin.deleteUser(c.user.id); return erreur("Création impossible : " + eP.message); }
    return rep({ ok: true, id: c.user.id, identifiant });
  }

  // 3. Réinitialisation du code / mot de passe
  if (b.action === "reinit") {
    const { data: p } = await admin.from("profils").select("role").eq("id", String(b.user_id)).maybeSingle();
    if (!p) return erreur("Compte introuvable");
    const pb = mdpValide(p.role, String(b.mdp));
    if (pb) return erreur(pb);
    const { error } = await admin.auth.admin.updateUserById(String(b.user_id), { password: String(b.mdp) });
    if (error) return erreur("Changement impossible : " + error.message);
    return rep({ ok: true });
  }

  // 4. Blocage / déblocage de la connexion (le compte et son historique sont conservés)
  if (b.action === "actif") {
    const id = String(b.user_id), actif = !!b.actif;
    if (id === u.user.id && !actif) return erreur("Vous ne pouvez pas désactiver votre propre compte");
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: actif ? "none" : "876000h" });
    if (error) return erreur("Changement impossible : " + error.message);
    const { error: e2 } = await admin.from("profils").update({ actif }).eq("id", id);
    if (e2) return erreur(e2.message);
    return rep({ ok: true });
  }

  return erreur("Action inconnue");
});
