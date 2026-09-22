import React from "react";
import { ArrowRight, BriefcaseBusiness, FileText, Home, Mic, Search, Scale, ShieldAlert, Users } from "lucide-react";

export type LegalTemplate = {
  id: string;
  title: string;
  group: string;
  description: string;
  placeholder: string;
  chips: string[];
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
};

export const LEGAL_TEMPLATES: LegalTemplate[] = [
  { id: "accueil", title: "Accueil juridique", group: "Outils", description: "Point de départ pour identifier votre besoin juridique et choisir le bon parcours.", placeholder: "Décrivez simplement votre situation juridique...", chips: ["Comprendre", "Vérifier", "Agir"], icon: Scale, tone: "emerald" },
  { id: "logement", title: "Logement & Bail d’habitation", group: "Particulier", description: "Loyer, caution, état des lieux, réparations, résiliation et litiges entre propriétaire et locataire.", placeholder: "Ex. Mon propriétaire veut augmenter mon loyer ou mettre fin au bail...", chips: ["Loyer", "Caution", "Résiliation"], icon: Home, tone: "blue" },
  { id: "foncier", title: "Foncier & Terrains", group: "Particulier", description: "Terrain, ACD, certificat de propriété et litiges fonciers.", placeholder: "Ex. J'ai acheté un terrain et je veux vérifier mes droits...", chips: ["Terrain", "ACD", "Double vente"], icon: Home, tone: "green" },
  { id: "travail", title: "Travail & Salaire", group: "Particulier", description: "Contrat, licenciement, salaire, CNPS et indemnités.", placeholder: "Ex. Mon employeur veut me licencier...", chips: ["Licenciement", "Salaire", "CNPS"], icon: BriefcaseBusiness, tone: "orange" },
  { id: "famille", title: "Famille", group: "Particulier", description: "Mariage, séparation, filiation, pension et enfants.", placeholder: "Ex. Je veux comprendre mes droits concernant...", chips: ["Pension", "Filiation", "Séparation"], icon: Users, tone: "violet" },
  { id: "succession", title: "Succession & Héritage", group: "Particulier", description: "Succession, héritiers, partage et biens familiaux.", placeholder: "Ex. Après un décès, nous devons partager les biens...", chips: ["Succession", "Héritiers", "Partage"], icon: Users, tone: "purple" },
  { id: "urgence", title: "Urgence Police & Plainte", group: "Urgence", description: "Garde à vue, plainte, interpellation et urgence juridique.", placeholder: "Ex. Je viens d'être convoqué par la police...", chips: ["Garde à vue", "Plainte", "Interpellation"], icon: ShieldAlert, tone: "rose" },
  { id: "cyber", title: "Cybercriminalité", group: "Urgence", description: "Escroquerie en ligne, Mobile Money et comptes piratés.", placeholder: "Ex. J'ai été victime d'une arnaque Mobile Money...", chips: ["Arnaque", "Mobile Money", "Compte piraté"], icon: ShieldAlert, tone: "red" },
  { id: "affaires", title: "Droit des Affaires", group: "Entreprise", description: "Conseil juridique pour entreprises, dirigeants et entrepreneurs.", placeholder: "Ex. Je crée une entreprise à Abidjan et je veux sécuriser...", chips: ["Entreprise", "Contrat", "Associés"], icon: BriefcaseBusiness, tone: "blue" },
  { id: "pme", title: "PME / PMI", group: "Entreprise", description: "Accompagnement juridique quotidien des PME et PMI.", placeholder: "Ex. Ma PME rencontre un problème avec un client...", chips: ["PME", "Conformité", "Conseil"], icon: BriefcaseBusiness, tone: "indigo" },
  { id: "ohada", title: "OHADA", group: "Entreprise", description: "Droit commercial, sociétés, recouvrement et procédures OHADA.", placeholder: "Ex. Mon entreprise doit recouvrer une facture...", chips: ["OHADA", "Recouvrement", "Société"], icon: Scale, tone: "slate" },
  { id: "bail-pro", title: "Location & Bail professionnel", group: "Entreprise", description: "Baux commerciaux, bureaux, magasins, entrepôts et locaux professionnels.", placeholder: "Ex. Mon bail commercial arrive à échéance...", chips: ["Bail commercial", "Loyer", "Résiliation"], icon: Home, tone: "amber" },
  { id: "contrats", title: "Contrats", group: "Entreprise", description: "Analyse, rédaction et sécurisation de contrats.", placeholder: "Ex. Je veux vérifier ce contrat avant de le signer...", chips: ["Contrat", "Clause", "Signature"], icon: FileText, tone: "cyan" },
  { id: "impayes", title: "Factures & Impayés", group: "Entreprise", description: "Recouvrement, mise en demeure et injonction de payer.", placeholder: "Ex. Un client ne paie pas ma facture depuis...", chips: ["Impayé", "Mise en demeure", "Recouvrement"], icon: FileText, tone: "orange" },
  { id: "documents", title: "Documents juridiques", group: "Outils", description: "Préparer une mise en demeure, lettre, contrat ou demande.", placeholder: "Ex. Je veux préparer une mise en demeure pour...", chips: ["Mise en demeure", "Lettre", "Contrat"], icon: FileText, tone: "teal" },
  { id: "orientation", title: "Orientation avocat", group: "Outils", description: "Structurer votre dossier avant de consulter un professionnel.", placeholder: "Ex. Voici les faits de mon dossier...", chips: ["Préparer dossier", "Questions", "Pièces"], icon: Search, tone: "blue" },

];

export default function LegalTemplatePicker({
  selectedId, onSelect, description, setDescription, onSubmit, onLive, loading,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  description: string;
  setDescription: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onLive: () => void;
  loading: boolean;
}) {
  const selected = LEGAL_TEMPLATES.find((t) => t.id === selectedId) || LEGAL_TEMPLATES[0];
  const Icon = selected.icon;
  const isTemplateOne = selected.id === "accueil";
  const groups = ["Particulier", "Urgence", "Entreprise", "Outils"];

  return (
    <section className="mt-5 rounded-[24px] bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Templates JurisCoach</p>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">Choisissez votre parcours juridique</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Le même dossier peut continuer en <b>Texte</b> ou en <b>Live</b>.</p>
          </div>
          <div className="hidden sm:flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-2 text-[10px] font-bold text-slate-500"><Scale className="w-3.5 h-3.5 text-emerald-700" /> Droit ivoirien</div>
        </div>

        <div className="mt-4 space-y-3">
          {groups.map((group) => (
            <div key={group}>
              <div className="text-[9px] uppercase tracking-wider font-black text-slate-400 mb-1.5">{group}</div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {LEGAL_TEMPLATES.filter((t) => t.group === group).map((t) => {
                  const TIcon = t.icon;
                  const active = t.id === selectedId;
                  return <button key={t.id} type="button" onClick={() => onSelect(t.id)}
                    className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition ${active ? "bg-emerald-700 border-emerald-700 text-white shadow-sm" : "bg-slate-50 border-slate-200 text-slate-700 hover:border-emerald-300"}`}>
                    <TIcon className="w-3.5 h-3.5" /> {t.title}
                  </button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6 bg-gradient-to-b from-slate-50/80 to-white">
        {isTemplateOne && (
          <div className="mb-4 overflow-hidden rounded-[22px] bg-gradient-to-br from-[#062b45] via-[#073d5d] to-[#0b6b57] text-white p-5 sm:p-6 relative">
            <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider">JurisCoach · Côte d'Ivoire</div>
              <h3 className="mt-3 text-xl sm:text-2xl font-black leading-tight">Votre assistant juridique, simplement.</h3>
              <p className="mt-1.5 text-xs text-slate-200 max-w-md">Décrivez votre situation. Commencez en texte ou passez en Live avec JurisCoach.</p>
              <div className="mt-4 flex gap-2">
                <span className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 text-[10px] font-bold">🇨🇮 Droit ivoirien</span>
                <span className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 text-[10px] font-bold">🔒 Protégé</span>
              </div>
            </div>
          </div>
        )}
        <div className="rounded-[22px] border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center"><Icon className="w-6 h-6 text-blue-800" /></div>
              <div><div className="text-[10px] font-black uppercase tracking-wider text-blue-700">Thème actif · {selected.group}</div><h3 className="text-lg sm:text-xl font-black text-slate-900">{selected.title}</h3></div>
            </div>
            <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-black text-blue-700">APPLIQUÉ</span>
          </div>
          <p className="mt-2 text-xs sm:text-sm text-slate-500">{selected.description}</p>
        </div>

        <form onSubmit={onSubmit} className="mt-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {selected.chips.map((chip) => <button key={chip} type="button" onClick={() => setDescription(description ? description + " " + chip + "." : chip + ".")} className="shrink-0 rounded-full bg-white border border-slate-200 px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:border-emerald-300 cursor-pointer">{chip}</button>)}
          </div>
          <textarea required rows={5} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={selected.placeholder}
            className="w-full bg-white border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none rounded-2xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 resize-none" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
            <button type="submit" disabled={loading} className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-black py-3.5 rounded-2xl cursor-pointer">
              <Search className="w-4 h-4" /> {loading ? "Analyse..." : "Analyser en texte"}
            </button>
            <button type="button" onClick={onLive} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-black py-3.5 rounded-2xl cursor-pointer">
              <Mic className="w-4 h-4 text-orange-400" /> Continuer en Live
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>🔒 Conversation protégée</span><span className="flex items-center gap-1">Mobile & tablette <ArrowRight className="w-3 h-3" /></span>
          </div>
        </form>
      </div>
    </section>
  );
}
