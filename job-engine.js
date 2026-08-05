/* =========================================================================
   PHASE 1 — JOB / SHIPMENT MASTER ENGINE
   =========================================================================
   Adds a central "Logistics Job / Shipment File" entity that becomes the
   source-of-truth transaction context for every document a student fills
   in, sitting ON TOP of the existing document-to-document transaction
   context already built in workflow-rules.js (skGetTransactionContext).

   This file is purely additive:
     - No existing function signature in engine.js / workflow-rules.js /
       documents-data.js changes.
     - Nothing here is required for the pre-Phase-1 simulator (no job
       created) to keep working exactly as it did before — skGetJobContext()
       simply returns {} until a student creates a Job.
     - Everything is scoped per student (localStorage, same pattern as
       skGetAllProgress in auth.js), so lab computers still don't need a
       shared backend for this phase.

   WHAT THIS PHASE DOES NOT DO YET (later phases, per the master prompt):
     - No scenario templates (Phase 5) — the student fills the Job form
       themselves for now.
     - No cross-document mismatch warnings (Phase 3) — if a student edits a
       job-sourced value inside a document, that correction is NOT currently
       propagated back into the shared Job Master or flagged as a mismatch.
       This is a deliberate Phase-1 simplification: the Job Master is the
       single source of truth and documents consume/verify it, they don't
       yet feed corrections back upstream. Flagging for domain review before
       Phase 3, as instructed.
     - No scoring/audit/instructor dashboard hooks (Phases 6/7).
   ========================================================================= */

const SKELORA_JOB_PREFIX = "skelora_job_v1_";
const SKELORA_JOB_SEQ_PREFIX = "skelora_job_seq_v1_";

/* Every field the Job Master captures. `contextKey` ties a field to the
   SAME txn./proc. namespace already used by hundreds of field definitions
   across the 102 built documents (see workflow-rules.js's transaction
   context) — so a Job's Exporter Name, for example, autofills into every
   document whose own field already declares contextKey:"txn.sellerName",
   with zero changes needed to documents-data.js. Every contextKey below was
   verified to actually exist on real document fields first (grepped across
   documents-data.js) — nothing here is a guess that would silently autofill
   nothing. Fields with contextKey:null (mode, cargo description, invoice
   value, LC number's applicant/beneficiary note) aren't part of that
   namespace yet; they're surfaced in the Job strip / form only for now.

   `section` groups fields for the Create-Job form UI — Company & Document
   Information, Seller Information, Buyer Information, Shipment Information
   (incl. Container), Product Details, Packaging Information, Pricing &
   Charges, Applicant & Beneficiary, Contract Reference & Purpose, Amount &
   Currency, Banking Details — matching the sections requested for the form. */
const CONTAINER_NUMBER_POOL = [
  "MSKU1234567","TCLU7654321","MSCU2345678","CMAU9988771","HLXU4432109",
  "ONEU5567234","TRIU8821456","EGHU3345678","FCIU6612390","SEGU7789012","BMOU2245781"
];
const JOB_FIELD_MAP = [
  // ---------- Company & Document Information ----------
  {key:"mode",            label:"Shipment Mode",                contextKey:null, section:"Company & Document Information",
    type:"select", options:["Sea Export","Sea Import","Air Export","Air Import","Road / Domestic","Warehouse Transfer"]},
  {key:"origin",          label:"Origin",                        contextKey:null, section:"Company & Document Information", type:"text", placeholder:"Cochin, India"},
  {key:"destination",     label:"Destination",                   contextKey:null, section:"Company & Document Information", type:"text", placeholder:"Dubai, UAE"},

  // ---------- Seller Information ----------
  {key:"sellerName",      label:"Exporter / Seller Name",        contextKey:"txn.sellerName", section:"Seller Information", type:"text", placeholder:"Meridian Exports Pvt. Ltd."},
  {key:"sellerAddress",   label:"Exporter Address",              contextKey:"txn.sellerAddress", section:"Seller Information", type:"text", placeholder:"Plot 14, MIDC Industrial Area, Pune"},
  {key:"sellerCountry",   label:"Exporter Country",              contextKey:"txn.sellerCountry", section:"Seller Information", type:"text", placeholder:"India"},
  {key:"sellerGSTIN",     label:"Exporter GSTIN",                contextKey:"txn.sellerGSTIN", section:"Seller Information", type:"text", placeholder:"27AAAPL1234C1ZV"},
  {key:"sellerIEC",       label:"Exporter IEC Code",             contextKey:"txn.sellerIEC", section:"Seller Information", type:"text", placeholder:"0312045678", help:"Import Export Code — required on most Indian export documents."},

  // ---------- Buyer Information ----------
  {key:"buyerName",       label:"Importer / Buyer Name",         contextKey:"txn.buyerName",  section:"Buyer Information", type:"text", placeholder:"Nordic Trading GmbH"},
  {key:"buyerAddress",    label:"Importer Address",              contextKey:"txn.buyerAddress", section:"Buyer Information", type:"text", placeholder:"Hafenstrasse 22, 20457 Hamburg"},
  {key:"buyerGSTIN",      label:"Buyer GSTIN (if domestic)",     contextKey:"txn.buyerGSTIN", section:"Buyer Information", type:"text", placeholder:"Leave blank for a foreign buyer"},

  // ---------- Shipment Information (incl. Container) ----------
  {key:"portOfLoading",   label:"Port / Airport of Loading",     contextKey:"txn.portOfLoading", section:"Shipment Information", type:"text", placeholder:"Nhava Sheva (JNPT)"},
  {key:"portOfDischarge", label:"Port / Airport of Discharge",   contextKey:"txn.portOfDischarge", section:"Shipment Information", type:"text", placeholder:"Jebel Ali"},
  {key:"vesselName",      label:"Vessel / Flight Name",          contextKey:"txn.vesselName", section:"Shipment Information", type:"text", placeholder:"MV Meridian Star"},
  {key:"voyageNo",        label:"Voyage / Flight No.",           contextKey:"txn.voyageNo", section:"Shipment Information", type:"text", placeholder:"V.221E"},
  {key:"carrierName",     label:"Carrier / Shipping Line",       contextKey:"txn.carrierName", section:"Shipment Information", type:"text", placeholder:"Maersk Line"},
  {key:"containerNo",     label:"Container Number",              contextKey:"txn.containerNo", section:"Shipment Information",
    type:"select", options:CONTAINER_NUMBER_POOL, help:"Pick one — every document in this Job will refer to the same container."},
  {key:"sealNo",          label:"Seal Number",                   contextKey:"txn.sealNo", section:"Shipment Information", type:"text", placeholder:"SL-884523"},
  {key:"vehicleNumber",   label:"Vehicle Number (road transport)", contextKey:"txn.vehicleNumber", section:"Shipment Information", type:"text", placeholder:"KL-07-AB-4521"},

  // ---------- Product Details ----------
  {key:"cargo",           label:"Cargo / Product Description",  contextKey:null, section:"Product Details", type:"text", placeholder:"Garments"},
  {key:"hsCode",          label:"HS Code",                       contextKey:"txn.hsCode", section:"Product Details", type:"text", placeholder:"6109.10.00"},

  // ---------- Packaging Information ----------
  {key:"quantity",        label:"Quantity (packages)",           contextKey:"txn.noOfPackages", section:"Packaging Information", type:"number", placeholder:"500"},
  {key:"grossWeight",      label:"Gross Weight (KG)",            contextKey:"txn.grossWeight", section:"Packaging Information", type:"number", placeholder:"8500"},

  // ---------- Pricing & Charges ----------
  {key:"invoiceValue",    label:"Invoice Value",                 contextKey:null, section:"Pricing & Charges", type:"number", placeholder:"40000"},
  {key:"incoterm",        label:"Incoterm",                      contextKey:"txn.incoterm", section:"Pricing & Charges",
    type:"select", options:["EXW","FCA","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"], help:"Once set, every document that asks for Incoterm — and the goods/charges that follow from it — stays consistent across this Job."},

  // ---------- Applicant & Beneficiary (Letter of Credit) ----------
  {key:"lcNumber",        label:"Letter of Credit Number",       contextKey:"txn.lcNumber", section:"Applicant & Beneficiary", type:"text", placeholder:"LC-DXB-88213",
    help:"On LC-based documents, the Applicant is your Buyer and the Beneficiary is your Seller above — no separate entry needed."},

  // ---------- Contract Reference & Purpose ----------
  {key:"poNumber",        label:"Purchase Order / Order Ref. No.", contextKey:"txn.poNumber", section:"Contract Reference & Purpose", type:"text", placeholder:"PO-88213", help:"A Proforma Invoice itself has no PO field, since it's the quotation that comes BEFORE an order exists."},
  {key:"salesOrderNo",    label:"Sales Order No.",               contextKey:"txn.salesOrderNo", section:"Contract Reference & Purpose", type:"text", placeholder:"SO-55231"},
  {key:"commercialInvoiceNo", label:"Commercial Invoice No.",    contextKey:"txn.commercialInvoiceNo", section:"Contract Reference & Purpose", type:"text", placeholder:"CI-2026-0091"},

  // ---------- Amount & Currency ----------
  {key:"currency",        label:"Currency",                      contextKey:"txn.currency", section:"Amount & Currency", type:"select", options:["USD","EUR","INR","AED"]},

  // ---------- Banking Details ----------
  {key:"supplierBankName",       label:"Bank Name",              contextKey:"proc.supplierBankName", section:"Banking Details", type:"text", placeholder:"HDFC Bank"},
  {key:"supplierBankAccountNo",  label:"Bank Account Number",    contextKey:"proc.supplierBankAccountNo", section:"Banking Details", type:"text", placeholder:"50100123456789"},
  {key:"supplierIfscCode",       label:"IFSC Code",              contextKey:"proc.supplierIfscCode", section:"Banking Details", type:"text", placeholder:"HDFC0001234"}
];

function _sk_jobKey(userId){ return SKELORA_JOB_PREFIX + userId; }
function _sk_jobSeqKey(userId){ return SKELORA_JOB_SEQ_PREFIX + userId; }

/* SKL-YYYY-NNNNN, sequential per student, never reused even if a job is
   later closed — matches the master prompt's example format exactly. */
function skGenerateJobId(userId){
  let n = 1;
  try{
    n = parseInt(localStorage.getItem(_sk_jobSeqKey(userId)) || "0", 10) + 1;
    localStorage.setItem(_sk_jobSeqKey(userId), String(n));
  }catch(e){ /* localStorage unavailable — fall back to n=1, non-fatal */ }
  const year = new Date().getFullYear();
  return `SKL-${year}-${String(n).padStart(5,"0")}`;
}

function skGetActiveJob(userId){
  if(!userId) return null;
  try{
    const raw = localStorage.getItem(_sk_jobKey(userId));
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

/* PHASE 9: a Job now also carries its OWN document scope — docSlugs, the
   list of exercises the student themselves picked when creating this Job
   (distinct from an assignment's docSlugs, which is faculty-authored and
   shared computer-wide). skIsDocumentAllowedForJob() below checks both:
   assignment scope wins if the Job is following one, otherwise the Job's
   own docSlugs governs, otherwise (neither set — a legacy job, or one
   genuinely started with no scope) everything stays open as before. */

/* Walks the PREREQUISITES chain (workflow-rules.js) and returns `slugs`
   plus every direct/transitive prerequisite those slugs need. This MUST
   be transitive, not one-level-only: skCheckPrerequisites (workflow-
   rules.js) requires a document's own direct prerequisite to be COMPLETED
   before it unlocks, and skIsDocumentAllowedForJob blocks anything outside
   this Job's docSlugs — so a document added one level deep (say Out of
   Charge, needed by Delivery Order) that itself needs Bill of Entry would
   be impossible to ever complete inside this Job if Bill of Entry weren't
   also pulled in. A one-level-only version was tried and reverted for
   exactly this reason — it "reduced the count" but silently produced
   documents students could select yet never finish. Returns {expanded,
   added} so callers can tell the student which extra documents were
   pulled in automatically. */
function skExpandDocSlugsWithPrerequisites(slugs){
  const result = new Set((slugs||[]).filter(Boolean));
  const originalSize = result.size;
  let changed = true;
  while(changed){
    changed = false;
    Array.from(result).forEach(slug=>{
      const prereqs = (typeof skGetPrerequisites === "function") ? skGetPrerequisites(slug) : [];
      prereqs.forEach(p=>{ if(!result.has(p)){ result.add(p); changed = true; } });
    });
  }
  const expanded = Array.from(result);
  return {expanded, added: expanded.length - originalSize};
}

/* Creates a new Job and makes it the active one for this student. Only one
   active job at a time — starting a new job replaces it (the dashboard UI
   confirms with the student first if the current job has any fields
   filled in, see skelora-institute-dashboard.html). docSlugs is the
   student's own document selection for this Job (already expanded with
   prerequisites by the caller); an assignment's docSlugs (if any) takes
   precedence over it wherever scope is checked. */
function skCreateJob(userId, fields, assignmentId, docSlugs){
  if(!userId) return null;
  const job = {
    jobId: skGenerateJobId(userId),
    createdAt: new Date().toISOString(),
    status: "in-progress",
    fields: Object.assign({}, fields),
    assignmentId: assignmentId || null,
    docSlugs: Array.isArray(docSlugs) ? docSlugs.slice() : []
  };
  try{ localStorage.setItem(_sk_jobKey(userId), JSON.stringify(job)); }catch(e){}
  return job;
}

function skUpdateJobFields(userId, patch){
  const job = skGetActiveJob(userId);
  if(!job) return null;
  job.fields = Object.assign({}, job.fields, patch);
  try{ localStorage.setItem(_sk_jobKey(userId), JSON.stringify(job)); }catch(e){}
  return job;
}

/* Changes which documents THIS Job's own scope covers (used by "Edit Job
   Details"). Has no effect on an assignment's scope, if the Job is
   following one — that's changed separately via skSetJobAssignment. */
function skUpdateJobDocSlugs(userId, docSlugs){
  const job = skGetActiveJob(userId);
  if(!job) return null;
  job.docSlugs = Array.isArray(docSlugs) ? docSlugs.slice() : [];
  try{ localStorage.setItem(_sk_jobKey(userId), JSON.stringify(job)); }catch(e){}
  return job;
}

/* Attach/change/clear which assignment the active job is following.
   Pass null to unlink (job goes back to unrestricted). */
function skSetJobAssignment(userId, assignmentId){
  const job = skGetActiveJob(userId);
  if(!job) return null;
  job.assignmentId = assignmentId || null;
  try{ localStorage.setItem(_sk_jobKey(userId), JSON.stringify(job)); }catch(e){}
  return job;
}

function skCloseJob(userId){
  const job = skGetActiveJob(userId);
  if(!job) return null;
  job.status = "closed";
  job.closedAt = new Date().toISOString();
  try{ localStorage.setItem(_sk_jobKey(userId), JSON.stringify(job)); }catch(e){}
  return job;
}

/* Clears the active job slot entirely (used before starting a fresh one). */
function skDeleteActiveJob(userId){
  try{ localStorage.removeItem(_sk_jobKey(userId)); }catch(e){}
}

/* =========================================================================
   PHASE 9 — JOB HISTORY / "SCENARIOS COMPLETED"
   =========================================================================
   Before Phase 9, closing a Job just flipped its status in the SAME single
   active-job slot — the moment a new Job was created, that old record was
   silently overwritten and gone for good. There was no way to answer "how
   many scenarios has this student finished?" at all. This section adds a
   real, append-only history, per student, of every Job that has ever been
   finished (completed in full, or closed early) — same storage pattern as
   the audit log in auth.js. ========================================================================= */
const SKELORA_JOB_HISTORY_PREFIX = "skelora_job_history_v1_";
function _sk_jobHistoryKey(userId){ return SKELORA_JOB_HISTORY_PREFIX + userId; }

function skGetJobHistory(userId){
  try{
    const raw = localStorage.getItem(_sk_jobHistoryKey(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  }catch(e){ return []; }
}
function _sk_saveJobHistory(userId, list){
  const capped = list.length > 200 ? list.slice(list.length - 200) : list;
  try{ localStorage.setItem(_sk_jobHistoryKey(userId), JSON.stringify(capped)); }catch(e){}
}

/* The document scope THIS job is actually measured against: an assignment
   (if it's following one) takes precedence, otherwise the job's own
   self-selected docSlugs. A job with neither has no measurable scope
   (returns []) — same "unrestricted, nothing to complete" case as
   skIsDocumentAllowedForJob below. */
function skGetJobDocScope(job){
  if(!job) return [];
  if(job.assignmentId){
    const assignment = (typeof skGetAssignment === "function") ? skGetAssignment(job.assignmentId) : null;
    if(assignment) return assignment.docSlugs.slice();
  }
  return Array.isArray(job.docSlugs) ? job.docSlugs.slice() : [];
}

/* {completed, total, done} against this job's own scope, reading this
   student's real progress store — done is true only once every document
   in scope has status "completed". A job with no scope (total:0) is never
   "done" this way; it just isn't tracked as a scenario. */
function skGetJobScopeProgress(userId, job){
  const scope = skGetJobDocScope(job);
  if(scope.length === 0) return {completed: 0, total: 0, done: false};
  const all = (typeof skGetAllProgress === "function") ? skGetAllProgress(userId) : {};
  const completed = scope.filter(slug => all[slug] && all[slug].status === "completed").length;
  return {completed, total: scope.length, done: completed === scope.length};
}

/* =========================================================================
   PHASE 9b — GUIDED JOB WORKFLOW (work through a Job's documents in order)
   ========================================================================= */

/* Orders `slugs` so every document's prerequisites (per workflow-rules.js's
   DOC_PREREQUISITES chain) come before it — a plain topological sort
   (DFS-based). Since a Job's docSlugs are already expanded to include
   their full prerequisite closure (skExpandDocSlugsWithPrerequisites, at
   creation time), this ordering is always completable top-to-bottom
   without ever hitting a document still locked by an unmet prerequisite.
   Slugs outside `slugs` (or ones skGetPrerequisites doesn't know about)
   are simply not chased further. */
function skTopologicalOrderDocs(slugs){
  const inScope = new Set(slugs || []);
  const visited = new Set();
  const order = [];
  function visit(slug){
    if(visited.has(slug) || !inScope.has(slug)) return;
    visited.add(slug);
    const prereqs = (typeof skGetPrerequisites === "function") ? skGetPrerequisites(slug) : [];
    prereqs.forEach(visit);
    order.push(slug);
  }
  (slugs || []).forEach(visit);
  return order;
}

/* The next document the student should work on for their active Job — in
   prerequisite-safe order, skipping anything already completed. Returns
   null once every document in scope is done (or if the Job has no scope
   at all). This is what powers both the dashboard's "Start Working"
   button and the auto-advance prompt on each document's completion
   screen (see engine.js renderComplete()). */
function skGetNextJobDocument(userId, job){
  const scope = skGetJobDocScope(job);
  if(scope.length === 0) return null;
  const ordered = skTopologicalOrderDocs(scope);
  const all = (typeof skGetAllProgress === "function") ? skGetAllProgress(userId) : {};
  return ordered.find(slug => !(all[slug] && all[slug].status === "completed")) || null;
}

/* Archives the active Job into this student's Job History and clears the
   active slot so a new Job can start clean. Marks it "completed" if every
   document in scope is done, otherwise "closed" (an early/manual close,
   e.g. via the dashboard's "Close This Job" button) — only "completed"
   entries count toward the "Scenarios Completed" stat. Does NOT touch any
   completed document or its saved progress — only the Job record itself
   moves into history. Returns the archived record, or null if there was
   no active job. */
function skFinishJob(userId){
  const job = skGetActiveJob(userId);
  if(!job) return null;
  const scopeProgress = skGetJobScopeProgress(userId, job);
  const finished = Object.assign({}, job, {
    status: scopeProgress.done ? "completed" : "closed",
    finishedAt: new Date().toISOString(),
    docSlugs: skGetJobDocScope(job),
    documentsCompleted: scopeProgress.completed,
    documentsTotal: scopeProgress.total
  });
  const history = skGetJobHistory(userId);
  history.push(finished);
  _sk_saveJobHistory(userId, history);
  skDeleteActiveJob(userId);
  return finished;
}

/* Merges an imported Job History array (from another lab computer's "My
   Progress" export) into this student's own history — deduped by jobId,
   so re-importing the same file twice (or importing after already having
   some local history) never double-counts a scenario. Same shape/pattern
   as skMergeAuditLog in auth.js. Returns how many NEW entries were added. */
function skMergeJobHistory(userId, importedHistory){
  if(!userId || !Array.isArray(importedHistory) || importedHistory.length===0) return 0;
  const existing = skGetJobHistory(userId);
  const seen = new Set(existing.map(j => j.jobId));
  let added = 0;
  importedHistory.forEach(j=>{
    if(!j || !j.jobId || seen.has(j.jobId)) return;
    seen.add(j.jobId);
    existing.push(j);
    added++;
  });
  existing.sort((a,b) => new Date(a.finishedAt||a.createdAt) - new Date(b.finishedAt||b.createdAt));
  _sk_saveJobHistory(userId, existing);
  return added;
}

/* Restores a Job object exactly as exported from another lab computer's
   "My Progress" file — used when a student switches computers mid-
   semester. Also bumps this computer's Job ID sequence counter past the
   imported job's number if needed, so the NEXT Job this student creates
   here can't collide with one they already made elsewhere (e.g. importing
   SKL-2026-00003 on a computer whose local counter is still at 1). */
function skRestoreJob(userId, job){
  if(!userId || !job || !job.jobId) return null;
  try{
    localStorage.setItem(_sk_jobKey(userId), JSON.stringify(job));
    const m = /-(\d+)$/.exec(job.jobId);
    if(m){
      const importedN = parseInt(m[1], 10);
      const currentN = parseInt(localStorage.getItem(_sk_jobSeqKey(userId)) || "0", 10);
      if(importedN > currentN) localStorage.setItem(_sk_jobSeqKey(userId), String(importedN));
    }
  }catch(e){}
  return job;
}

/* =========================================================================
   TWO STUDENT-FACING TOGGLES (both OFF by default)
   =========================================================================
   Concern raised: if EVERY field always auto-fills into every document,
   students just click through without actually typing/verifying anything
   — "button operators" instead of learners. So auto-fill-everything and
   auto-add-every-document are now both opt-IN switches, off by default:

   1. Autofill mode — "basic" (default) only pre-fills the original 4
      company-identity fields (Exporter/Importer name + address). "full"
      pre-fills all 28 fields that carry a real contextKey. A student (or
      instructor) has to deliberately switch it to "full" for the richer
      autofill to apply.

   2. Auto-add documents — OFF (default) means the student picks documents
      for their Job themselves in the checkbox picker, same as always. ON
      means every one of the 102 documents is added to the Job automatically,
      skipping manual selection entirely.

   Both are per-student settings (localStorage), so one student turning
   this on doesn't affect anyone else's session on a shared lab computer. */
const SKELORA_AUTOFILL_MODE_PREFIX = "skelora_autofill_mode_v1_";
const SKELORA_AUTOADD_DOCS_PREFIX = "skelora_autoadd_docs_v1_";

function skGetAutofillMode(userId){
  if(!userId) return "basic";
  try{ return localStorage.getItem(SKELORA_AUTOFILL_MODE_PREFIX + userId) === "full" ? "full" : "basic"; }
  catch(e){ return "basic"; }
}
function skSetAutofillMode(userId, mode){
  if(!userId) return;
  try{ localStorage.setItem(SKELORA_AUTOFILL_MODE_PREFIX + userId, mode === "full" ? "full" : "basic"); }
  catch(e){ /* non-fatal */ }
}
function skGetAutoAddDocsEnabled(userId){
  if(!userId) return false;
  try{ return localStorage.getItem(SKELORA_AUTOADD_DOCS_PREFIX + userId) === "1"; }
  catch(e){ return false; }
}
function skSetAutoAddDocsEnabled(userId, enabled){
  if(!userId) return;
  try{ localStorage.setItem(SKELORA_AUTOADD_DOCS_PREFIX + userId, enabled ? "1" : "0"); }
  catch(e){ /* non-fatal */ }
}

/* UPDATED: earlier this list was deliberately narrowed to name/address only,
   so students had to type everything else themselves. Per a later
   instruction it was widened to every field with a real contextKey. Now,
   per the toggle above, BOTH behaviors exist side by side — this is the
   "full" list; JOB_MASTER_AUTOFILL_KEYS_BASIC below is the original
   narrow one — and skBuildJobContextFromData picks between them based on
   skGetAutofillMode(). */
const JOB_MASTER_AUTOFILL_KEYS = JOB_FIELD_MAP.filter(f => !!f.contextKey).map(f => f.key);
const JOB_MASTER_AUTOFILL_KEYS_BASIC = ["sellerName", "sellerAddress", "buyerName", "buyerAddress"];

/* Returns the Job Master's fields as a transaction-context map, in the
   EXACT {contextKey: {value, sourceSlug, sourceTitle}} shape that
   skGetTransactionContext() in workflow-rules.js builds from completed
   documents — so the two merge with a single Object.assign, no new
   plumbing needed in engine.js. sourceSlug is a synthetic "job-master"
   (not a real document slug) purely for provenance if ever displayed. */
function skGetJobContext(userId){
  return skBuildJobContextFromData(skGetActiveJob(userId), skGetAutofillMode(userId));
}

/* Same job-context logic as skGetJobContext, but takes a Job object
   directly instead of reading localStorage via userId — needed so the
   Phase 7 instructor dashboard can score an imported student's Job (from
   another lab computer's export file, see skExportComputerData). `mode`
   defaults to "full" for that scoring path — only the live student session
   (skGetJobContext, which knows the userId and thus the toggle) passes
   "basic" through when that's what the student has selected. */
function skBuildJobContextFromData(job, mode){
  const context = {};
  if(!job || job.status !== "in-progress") return context;
  const allowKeys = mode === "basic" ? JOB_MASTER_AUTOFILL_KEYS_BASIC : JOB_MASTER_AUTOFILL_KEYS;
  JOB_FIELD_MAP.forEach(f=>{
    if(!f.contextKey) return;
    if(!allowKeys.includes(f.key)) return;
    const val = job.fields[f.key];
    if(val===undefined || val===null || val==="") return;
    context[f.contextKey] = {value: val, sourceSlug: "job-master", sourceTitle: `Job ${job.jobId}`};
  });
  return context;
}

/* =========================================================================
   PHASE 5 — SCENARIO TEMPLATES
   Pre-built realistic Job Master starting points, so a student doesn't have
   to invent every shipment detail from scratch before they can even begin.
   Each template supplies the SAME fields JOB_FIELD_MAP already defines —
   picking one just pre-fills the Job creation form, which the student can
   still edit before (or after) creating the Job. Nothing here bypasses
   verification: it's a starting point, not an autofill-and-forget shortcut.

   Scope note: this phase does NOT yet filter which of the 81 documents are
   "required" vs "optional" per scenario, or enforce mode-specific workflow
   branching (e.g. hiding Bill of Lading fields for a Road scenario) — that
   is Phase 8 in the master prompt (mode-specific workflows), a separate,
   later step. Every document remains available regardless of scenario,
   exactly as it does today.
   ========================================================================= */
const SCENARIO_TEMPLATES = [
  {
    id: "sea-export", title: "Sea Export — Cochin → Dubai",
    summary: "A standard FCL sea export of finished goods, CIF terms.",
    fields: {
      mode: "Sea Export", origin: "Cochin, India", destination: "Dubai, UAE",
      sellerName: "Malabar Spices Exporters Pvt. Ltd.", sellerAddress: "12 Export Promotion Industrial Estate, Kochi, Kerala, India",
      buyerName: "Al Fahim Trading LLC", buyerAddress: "Al Quoz Industrial Area 3, Dubai, UAE", poNumber: "PO-88213",
      cargo: "Garments — Assorted Cotton T-Shirts", quantity: "500", grossWeight: "8500",
      invoiceValue: "40000", currency: "USD", incoterm: "CIF",
      portOfLoading: "Kochi Port (Vallarpadam)", portOfDischarge: "Jebel Ali Port", containerNo: "MSKU1234567"
    }
  },
  {
    id: "sea-import", title: "Sea Import — Dubai → Cochin",
    summary: "A standard FCL sea import of raw materials into India.",
    fields: {
      mode: "Sea Import", origin: "Dubai, UAE", destination: "Cochin, India",
      sellerName: "Al Fahim Trading LLC", sellerAddress: "Al Quoz Industrial Area 3, Dubai, UAE",
      buyerName: "Meridian Imports Pvt. Ltd.", buyerAddress: "Plot 14, MIDC Industrial Area, Pune, Maharashtra, India", poNumber: "PO-77410",
      cargo: "Industrial Chemicals — Bulk Packed Drums", quantity: "200", grossWeight: "18000",
      invoiceValue: "65000", currency: "USD", incoterm: "CIF",
      portOfLoading: "Jebel Ali Port", portOfDischarge: "Kochi Port (Vallarpadam)", containerNo: "TCLU7654321"
    }
  },
  {
    id: "air-export", title: "Air Export — Cochin → Dubai",
    summary: "A time-sensitive air export shipment, high value, low weight.",
    fields: {
      mode: "Air Export", origin: "Kochi, India", destination: "Dubai, UAE",
      sellerName: "Kerala Chemical Exports Pvt. Ltd.", sellerAddress: "Cochin Special Economic Zone, Kakkanad, Kochi, Kerala, India",
      buyerName: "Nordic Trading GmbH", buyerAddress: "Hafenstrasse 22, 20457 Hamburg, Germany", poNumber: "PO-91027",
      cargo: "Pharmaceutical Intermediates", quantity: "40", grossWeight: "620",
      invoiceValue: "28000", currency: "USD", incoterm: "FOB",
      portOfLoading: "Cochin International Airport (COK)", portOfDischarge: "Dubai International Airport (DXB)", containerNo: ""
    }
  },
  {
    id: "air-import", title: "Air Import — Dubai → Cochin",
    summary: "An urgent air import of spare parts.",
    fields: {
      mode: "Air Import", origin: "Dubai, UAE", destination: "Cochin, India",
      sellerName: "Gulf Precision Parts LLC", sellerAddress: "Jebel Ali Free Zone, Dubai, UAE",
      buyerName: "Meridian Manufacturing Pvt. Ltd.", buyerAddress: "Plot 14, MIDC Industrial Area, Pune, Maharashtra, India", poNumber: "PO-63558",
      cargo: "Precision-Machined Ball Bearings", quantity: "240", grossWeight: "310",
      invoiceValue: "6000", currency: "USD", incoterm: "CIP",
      portOfLoading: "Dubai International Airport (DXB)", portOfDischarge: "Cochin International Airport (COK)", containerNo: ""
    }
  },
  {
    id: "domestic-road", title: "Domestic Road Movement",
    summary: "A domestic B2B delivery within India, GST-invoiced.",
    fields: {
      mode: "Road / Domestic", origin: "Pune, Maharashtra, India", destination: "Navi Mumbai, Maharashtra, India",
      sellerName: "Meridian Exports Pvt. Ltd.", sellerAddress: "Plot 14, MIDC Industrial Area, Pune, Maharashtra, India",
      buyerName: "Sunrise Imports Pvt. Ltd.", buyerAddress: "14 Industrial Estate, Navi Mumbai, Maharashtra, India", poNumber: "PO-45092",
      cargo: "Cotton T-Shirts, Assorted Sizes", quantity: "240", grossWeight: "5760",
      invoiceValue: "600000", currency: "INR", incoterm: "DAP",
      portOfLoading: "", portOfDischarge: "", containerNo: ""
    }
  },
  {
    id: "warehouse-transfer", title: "Warehouse Transfer",
    summary: "An internal stock transfer between two of the same company's warehouses.",
    fields: {
      mode: "Warehouse Transfer", origin: "Kochi Warehouse 2, Kerala, India", destination: "Chennai Distribution Centre, Tamil Nadu, India",
      sellerName: "Malabar Spices Exporters Pvt. Ltd.", sellerAddress: "12 Export Promotion Industrial Estate, Kochi, Kerala, India",
      buyerName: "Malabar Spices Exporters Pvt. Ltd. (Chennai DC)", buyerAddress: "Distribution Centre, Ambattur Industrial Estate, Chennai, Tamil Nadu, India", poNumber: "PO-INTERNAL-2201",
      cargo: "Premium Black Pepper — Bulk Stock", quantity: "1200", grossWeight: "24000",
      invoiceValue: "0", currency: "INR", incoterm: "",
      portOfLoading: "", portOfDischarge: "", containerNo: ""
    }
  },
  {
    id: "dangerous-goods", title: "Dangerous Goods Shipment (Sea Export)",
    summary: "A sea export requiring a Dangerous Goods Declaration and MSDS alongside the standard document set.",
    fields: {
      mode: "Sea Export", origin: "Mundra, India", destination: "Jebel Ali, UAE",
      sellerName: "Konkan Specialty Chemicals Pvt. Ltd.", sellerAddress: "GIDC Industrial Estate, Ankleshwar, Gujarat, India",
      buyerName: "Gulf Petrochemical Trading LLC", buyerAddress: "Jebel Ali Free Zone, Dubai, UAE", poNumber: "PO-30871",
      cargo: "UN1170 — Ethanol Solution, Class 3 Flammable Liquid", quantity: "160", grossWeight: "19200",
      invoiceValue: "52000", currency: "USD", incoterm: "FOB",
      portOfLoading: "Mundra Port", portOfDischarge: "Jebel Ali Port", containerNo: "MSCU2345678"
    }
  }
];

/* =========================================================================
   PHASE 8 — MODE-SPECIFIC WORKFLOWS
   =========================================================================
   Classifies which of the 81 documents genuinely apply to which of the 6
   Job modes, based on (a) each document's own moduleLabel in
   documents-data.js, and (b) its real position in the PREREQUISITES chain
   in workflow-rules.js (e.g. Mate Receipt only ever appears in the sea leg
   of that chain, so it's Sea-only regardless of label; Dispatch Note
   appears both in the road-to-port leg AND is labeled "Warehouse
   Documentation", so it's tagged for both).

   This is INFORMATIONAL ONLY, per the master prompt's own "do not over-
   automate" instruction (section 15) — a document not applicable to the
   active Job's mode is labeled as such and excluded from that Job's
   completion denominator, but a student can still open and complete it.
   Nothing here changes lock/unlock logic (PREREQUISITES, section 6) or
   removes access to any of the 81 documents.

   A handful of these are genuinely ambiguous even after checking both
   signals (e.g. whether Purchase Order/RFQ/Vendor Bill represent a
   separate domestic-procurement track or are themselves part of importing
   raw materials internationally) — those are tagged ALL_MODES (available
   everywhere, never marked "not applicable"), which is the safe default
   whenever the classification was uncertain rather than guessing narrow.
   ========================================================================= */
const ALL_MODES = ["Sea Export","Sea Import","Air Export","Air Import","Road / Domestic","Warehouse Transfer"];

const MODE_APPLICABILITY = {
  "export-license": ["Sea Export", "Air Export"],
  "import-license": ["Sea Import", "Air Import"],
  "are-1": ["Sea Export", "Air Export"],
  "uld-manifest": ["Air Export", "Air Import"],
  "vendor-comparison-statement": ALL_MODES,
  "bin-card": ["Sea Import", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "cycle-count-sheet": ["Sea Import", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "trip-sheet": ["Road / Domestic", "Sea Export", "Air Export"],
  "weighbridge-slip": ["Road / Domestic", "Sea Export", "Air Export", "Warehouse Transfer"],
  "icegate-registration-form": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "vendor-master": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "supplier-evaluation": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "purchase-requisition": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "request-for-quotation": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "purchase-order": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "vendor-bill": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "payment-voucher": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "inventory-valuation-report": ["Sea Export", "Sea Import", "Air Export", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "proforma-invoice": ["Sea Export", "Air Export"],
  "sales-order": ["Sea Export", "Air Export", "Road / Domestic"],
  "commercial-invoice": ["Sea Export", "Air Export"],
  "tax-invoice-gst": ["Road / Domestic", "Warehouse Transfer", "Sea Import", "Air Import"],
  "packing-list": ["Sea Export", "Air Export"],
  "stock-transfer-note": ["Warehouse Transfer", "Road / Domestic"],
  "picking-slip": ["Warehouse Transfer", "Road / Domestic"],
  "goods-issue-note": ["Warehouse Transfer", "Road / Domestic"],
  "certificate-of-origin": ["Sea Export", "Air Export"],
  "certificate-of-analysis": ["Sea Export", "Air Export"],
  "fumigation-certificate": ["Sea Export", "Air Export"],
  "phytosanitary-certificate": ["Sea Export", "Air Export"],
  "weight-certificate": ["Sea Export", "Air Export"],
  "insurance-certificate": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "letter-of-credit": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "bill-of-exchange": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "bank-guarantee": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "export-declaration": ["Sea Export", "Air Export"],
  "dangerous-goods-declaration": ["Sea Export", "Air Export"],
  "msds": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "ocean-freight-quotation": ["Sea Export", "Sea Import"],
  "shipping-instructions": ["Sea Export", "Air Export"],
  "booking-confirmation": ["Sea Export", "Air Export"],
  "vgm-certificate": ["Sea Export"],
  "shipping-order": ["Sea Export"],
  "security-declaration": ["Sea Export", "Air Export"],
  "container-load-plan": ["Sea Export"],
  "container-packing-certificate": ["Sea Export"],
  "seal-report": ["Sea Export"],
  "vehicle-inspection-report": ["Road / Domestic", "Sea Export", "Air Export"],
  "road-permit": ["Road / Domestic", "Sea Export", "Air Export"],
  "delivery-challan": ["Road / Domestic", "Sea Export", "Air Export"],
  "dispatch-note": ["Road / Domestic", "Warehouse Transfer", "Sea Export", "Air Export"],
  "lorry-receipt": ["Road / Domestic", "Sea Export", "Air Export"],
  "dock-receipt": ["Sea Export"],
  "shipping-bill": ["Sea Export", "Air Export"],
  "edi-copy": ["Sea Export", "Air Export"],
  "inspection-certificate": ["Sea Export", "Air Export"],
  "mate-receipt": ["Sea Export"],
  "master-bill-of-lading": ["Sea Export"],
  "house-bill-of-lading": ["Sea Export"],
  "bill-of-lading-sea": ["Sea Export"],
  "freight-invoice-sea": ["Sea Export"],
  "sea-waybill": ["Sea Export"],
  "air-waybill": ["Air Export", "Air Import"],
  "air-freight-invoice": ["Air Export", "Air Import"],
  "cargo-manifest": ["Sea Import", "Air Import"],
  "arrival-notice": ["Sea Import", "Air Import"],
  "container-destuffing": ["Sea Import"],
  "import-invoice": ["Sea Import", "Air Import"],
  "bill-of-entry": ["Sea Import", "Air Import"],
  "assessment-copy": ["Sea Import", "Air Import"],
  "customs-declaration": ["Sea Import", "Air Import"],
  "duty-calculation": ["Sea Import", "Air Import"],
  "out-of-charge": ["Sea Import", "Air Import"],
  "customs-gate-pass": ["Sea Import", "Air Import"],
  "e-way-bill": ["Sea Import", "Air Import", "Road / Domestic", "Warehouse Transfer"],
  "delivery-order": ["Sea Import", "Air Import"],
  "goods-receipt-note": ["Sea Import", "Air Import", "Warehouse Transfer"],
  "put-away-slip": ["Sea Import", "Air Import", "Warehouse Transfer"],
  "damage-report": ["Sea Import", "Air Import", "Warehouse Transfer", "Road / Domestic"],
  "warehouse-receipt": ["Sea Import", "Air Import", "Warehouse Transfer"],
  "proof-of-delivery": ["Road / Domestic", "Sea Import", "Air Import", "Warehouse Transfer"],
  "equipment-interchange-receipt": ["Sea Export", "Sea Import"],
  "letter-of-indemnity": ["Sea Import", "Air Import"],
  "bank-realization-certificate": ["Sea Export", "Air Export"],
  "gsp-certificate-of-origin": ["Sea Export", "Air Export"],
  "demurrage-detention-invoice": ["Sea Import", "Air Import"],
  "marine-insurance-claim-form": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "halal-kosher-certificate": ["Sea Export", "Air Export"],
  "credit-note": ["Sea Export", "Air Export", "Road / Domestic"],
  "debit-note": ["Sea Export", "Air Export", "Road / Domestic"],

  /* ---- Ported from v2 ---- */
  "letter-of-undertaking": ["Sea Export", "Air Export"],
  "registration-cum-membership-certificate": ["Sea Export", "Air Export"],
  "gst-e-invoice-irn": ALL_MODES,
  "softex-form": ["Sea Export", "Air Export"],
  "export-general-manifest": ["Sea Export", "Air Export"],
  "importer-security-filing": ["Sea Import"],
  "transshipment-permit": ["Sea Export", "Sea Import"],
  "multimodal-transport-document": ["Sea Export", "Sea Import", "Road / Domestic"],
  "forwarders-cargo-receipt": ["Sea Export", "Air Export"],
  "marine-insurance-policy": ["Sea Export", "Air Export", "Sea Import", "Air Import"],
  "cargo-survey-damage-claim-report": ["Sea Import", "Air Import", "Warehouse Transfer", "Road / Domestic"],
  "cfs-gate-pass": ["Sea Export", "Sea Import"],
};

/* True if this document is tagged as applying to the given mode, OR if the
   slug isn't in the table at all (defensive default — never silently hide
   a document just because it's missing from this classification; that
   would be a regression, not a feature). Passing a falsy mode (no active
   Job, or Job has no mode set yet) always returns true — mode filtering
   only ever activates once a Job with a mode actually exists. */
function skIsDocumentApplicableForMode(slug, mode){
  if(!mode) return true;
  const modes = MODE_APPLICABILITY[slug];
  if(!modes) return true;
  return modes.includes(mode);
}

/* Given the full catalog of exercise slugs (EXERCISE_SLUGS, built from
   EXERCISES in workflow-rules.js) and a mode, returns just the ones
   genuinely applicable — the denominator a mode-aware Final Job Audit
   should use, instead of "all 81" for every Job regardless of mode. */
function skGetApplicableSlugsForMode(allSlugs, mode){
  if(!mode) return allSlugs.slice();
  return allSlugs.filter(slug => skIsDocumentApplicableForMode(slug, mode));
}

/* =========================================================================
   ASSIGNMENTS — faculty-authored tasks that scope a student's Job to a
   specific, hand-picked set of documents.
   =========================================================================
   Unlike everything else in this file (per-student, keyed by userId),
   assignments are SHARED across every account on this computer — the same
   "lab computer, no server" model the Administration panel already uses
   for its class-wide analytics (see skGetAllProgress usage in
   skelora-institute-dashboard.html). A faculty account creates an
   assignment here; every student account on the SAME computer can then see
   and follow it when starting a Job.

   An assignment does not replace the existing scenario/mode system — it
   layers on top of it. skIsDocumentAllowedForJob() is the single gate both
   the dashboard's Document Library and workstation.html's boot() call
   through, so "only the documents in the assignment can be filled" is
   enforced in one place, not re-implemented per screen. */
const SKELORA_ASSIGNMENTS_KEY = "skelora_assignments_v1";

function skGetAssignments(){
  try{
    const raw = localStorage.getItem(SKELORA_ASSIGNMENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  }catch(e){ return []; }
}
function _sk_saveAssignments(list){
  try{ localStorage.setItem(SKELORA_ASSIGNMENTS_KEY, JSON.stringify(list)); }catch(e){}
}
function skGetAssignment(id){
  if(!id) return null;
  return skGetAssignments().find(a=>a.id===id) || null;
}
/* data: {title, question, docSlugs:[...], createdByName} — docSlugs must have
   at least 1 entry; the caller (UI) is responsible for that minimum, this
   layer just stores whatever list it's given. */
function skCreateAssignment(data){
  const list = skGetAssignments();
  const assignment = {
    id: "ASG-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random()*900+100),
    title: (data.title||"Untitled Assignment").trim(),
    question: (data.question||"").trim(),
    docSlugs: Array.isArray(data.docSlugs) ? data.docSlugs.slice() : [],
    createdByName: data.createdByName || "Faculty",
    createdAt: new Date().toISOString()
  };
  list.push(assignment);
  _sk_saveAssignments(list);
  return assignment;
}
function skUpdateAssignment(id, patch){
  const list = skGetAssignments();
  const idx = list.findIndex(a=>a.id===id);
  if(idx===-1) return null;
  list[idx] = Object.assign({}, list[idx], patch, {docSlugs: patch.docSlugs ? patch.docSlugs.slice() : list[idx].docSlugs});
  _sk_saveAssignments(list);
  return list[idx];
}
function skDeleteAssignment(id){
  _sk_saveAssignments(skGetAssignments().filter(a=>a.id!==id));
}

/* True whenever there's no restriction in play (no active job, job not
   following an assignment, or the assignment was since deleted — fail
   OPEN rather than silently locking a student out of everything because
   an instructor removed an assignment after the fact). Only returns false
   when a job is actively following an assignment AND this slug is
   genuinely not on that assignment's list. */
/* PHASE 9: an assignment (faculty-authored, if the job is following one)
   still takes precedence — same fail-OPEN behavior as before if it's
   since been deleted. Otherwise, a job with its own self-selected
   docSlugs restricts access to just that list. A job with neither (no
   assignment, no self-selected scope — e.g. a job created before Phase 9,
   or one genuinely left unscoped) stays fully open, exactly as before. */
function skIsDocumentAllowedForJob(slug, job){
  if(!job) return true;
  if(job.assignmentId){
    const assignment = skGetAssignment(job.assignmentId);
    if(assignment) return assignment.docSlugs.includes(slug);
    // assignment was deleted since — fall through to the job's own scope, if any
  }
  if(Array.isArray(job.docSlugs) && job.docSlugs.length > 0){
    return job.docSlugs.includes(slug);
  }
  return true;
}
